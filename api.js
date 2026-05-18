// ============================================================
//  api.js — 所有 Supabase 数据库操作
//  如需修改数据库逻辑，只改这个文件
// ============================================================

const SUPA_URL = 'https://wuiblzpyhcjxevotwcqz.supabase.co';
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind1aWJsenB5aGNqeGV2b3R3Y3F6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxMjg3NTksImV4cCI6MjA5MjcwNDc1OX0.ImJ1yH8v0op6_5G2P4fI--uJG8LOXIPt-JujPCzeN54';

// 初始化 Supabase 客户端（APK 内会打包本地 supabase 脚本）
const sb = supabase.createClient(SUPA_URL, SUPA_KEY);

const OFFLINE_USER_ID = 'local-offline-user';
const OFFLINE_PROFILE = {
  id: OFFLINE_USER_ID,
  email: 'offline@local.app',
  nickname: '本机学习',
  role: 'user',
  daily_goal: 20,
  offline: true
};

function isOfflineMode() {
  return currentUser?.id === OFFLINE_USER_ID || localStorage.getItem('offline-mode') === '1';
}

function localKey(userId, name) {
  return `${name}:${userId || OFFLINE_USER_ID}`;
}

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn('Local storage write failed', key, error);
    throw error;
  }
  return value;
}

function rejectedProfilesKey() {
  return localKey(currentUser?.id || 'admin', 'rejected_profiles');
}

function readRejectedProfileIds() {
  return readJson(rejectedProfilesKey(), []);
}

function hideRejectedProfileLocally(userId) {
  const ids = new Set(readRejectedProfileIds());
  ids.add(userId);
  try { writeJson(rejectedProfilesKey(), [...ids]); } catch {}
}

function progressMemoryKey(userId) {
  return localKey(userId, 'progress_memory');
}

function readProgressMemoryBackup(userId) {
  return readJson(progressMemoryKey(userId), {});
}

function writeProgressMemoryBackup(userId, wordRo, memory = {}) {
  if (!wordRo) return;
  const existing = readProgressMemoryBackup(userId);
  const wrongCount = Number(memory.wrongCount || 0);
  const errorStreak = Number(memory.errorStreak || 0);
  const lastWrongAt = memory.lastWrongAt || null;
  if (!wrongCount && !errorStreak && !lastWrongAt) {
    delete existing[wordRo];
    try { writeJson(progressMemoryKey(userId), existing); } catch {}
    return;
  }
  existing[wordRo] = {
    wrongCount,
    errorStreak,
    lastWrongAt,
    backedUpAt: new Date().toISOString()
  };
  const pruned = Object.fromEntries(Object.entries(existing)
    .sort((a, b) => String(b[1]?.backedUpAt || '').localeCompare(String(a[1]?.backedUpAt || '')))
    .slice(0, 500));
  try { writeJson(progressMemoryKey(userId), pruned); } catch {}
}

async function loadBundledWords() {
  const response = await fetch('./data/vocab.json', { cache: 'no-store' });
  if (!response.ok) throw new Error('本地词库读取失败');
  const payload = await response.json();
  return Array.isArray(payload) ? payload : (payload.words || []);
}

function rowToProgress(r) {
  const legacyNextReviewAt = r.next_review ? new Date(`${r.next_review}T00:00:00`).toISOString() : null;
  const reviewStage = r.review_stage ?? r.review_count ?? r.reviewStage ?? 0;
  const qr = r.quiz_right ?? r.qr ?? 0;
  const qt = r.quiz_total ?? r.qt ?? 0;
  return {
    seen: r.seen ?? !!(r.known || qr || qt),
    known: r.known,
    qr,
    qt,
    level: r.level || 'unknown',
    reviewStage,
    nextReviewAt: r.next_review_at || r.nextReviewAt || legacyNextReviewAt,
    lastReviewedAt: r.last_reviewed_at || r.lastReviewedAt || null,
    reviewCount: reviewStage,
    nextReview: r.next_review || r.nextReview || (r.next_review_at ? String(r.next_review_at).slice(0, 10) : null),
    wrongCount: r.wrong_count ?? r.wrongCount,
    errorStreak: r.error_streak ?? r.errorStreak,
    lastWrongAt: r.last_wrong_at || r.lastWrongAt || null
  };
}

function mergeProgressMemory(progress, backup = {}) {
  return {
    ...progress,
    wrongCount: progress.wrongCount ?? backup.wrongCount ?? 0,
    errorStreak: progress.errorStreak ?? backup.errorStreak ?? 0,
    lastWrongAt: progress.lastWrongAt || backup.lastWrongAt || null
  };
}

// ── 词库 ──────────────────────────────────────────────────

/**
 * 从数据库加载全部词汇（自动分页，支持超过1000条）
 * @returns {Promise<Array>} 词汇数组
 */
async function apiLoadWords() {
  if (isOfflineMode()) return loadBundledWords();
  let all = [], from = 0;
  try {
    while (true) {
      const { data, error } = await sb.from('words').select('*').order('id').range(from, from + 999);
      if (error || !data || !data.length) break;
      all = all.concat(data);
      if (data.length < 1000) break;
      from += 1000;
    }
    return all.length ? all : loadBundledWords();
  } catch {
    return loadBundledWords();
  }
}

/**
 * 更新一个词条
 * @param {number} wordId
 * @param {object} updates - { zh, ro, ipa, hint, cat }
 */
async function apiUpdateWord(wordId, updates) {
  if (isOfflineMode()) throw new Error('离线模式下不能修改共享词库');
  const { error } = await sb.from('words').update(updates).eq('id', wordId);
  if (error) throw new Error(error.message);
}

/**
 * 批量更新重音和语法信息。使用当前登录用户会话，遵守 Supabase RLS。
 */
async function apiApplyStressGrammarPatch(rows, onProgress) {
  let done = 0;
  const concurrency = 6;
  async function worker(queue) {
    while (queue.length) {
      const row = queue.shift();
      await apiUpdateWord(row.id, { ipa: row.ipa, hint: row.hint });
      done++;
      if (onProgress) onProgress(done, rows.length);
    }
  }
  const queue = [...rows];
  await Promise.all(Array.from({ length: concurrency }, () => worker(queue)));
  return done;
}

/**
 * 批量插入词汇，跳过重复（以 ro 字段为唯一键）；重复词可只补例句
 * @param {Array} words - [{ zh, ro, ipa, hint, cat, example_ro, example_zh }]
 * @returns {{ inserted: number, skipped: number, updatedExamples: number }}
 */
async function apiInsertWords(words) {
  if (isOfflineMode()) throw new Error('离线模式下不能添加到共享词库');
  const normalized = words.map(w => ({
    ...w,
    zh: String(w.zh || '').trim(),
    ro: String(w.ro || '').trim(),
    example_ro: String(w.example_ro || w.exampleRo || '').trim(),
    example_zh: String(w.example_zh || w.exampleZh || '').trim()
  })).filter(w => w.ro);
  const roList = [...new Set(normalized.map(w => w.ro))];
  let exampleSchemaMissing = false;
  let { data: existingRows, error: existingError } = await sb
    .from('words')
    .select('id,ro,example_ro,example_zh')
    .in('ro', roList);
  if (existingError && isMissingExampleColumnsError(existingError)) {
    exampleSchemaMissing = true;
    const retry = await sb
      .from('words')
      .select('id,ro')
      .in('ro', roList);
    existingRows = retry.data;
    existingError = retry.error;
  }
  if (existingError) throw new Error(existingError.message);
  const existingByRo = new Map((existingRows || []).map(row => [row.ro, row]));
  const newWords = normalized.filter(w => !existingByRo.has(w.ro));
  const missingZh = newWords.filter(w => !w.zh);
  if (missingZh.length) {
    throw new Error(`新词缺少中文：${missingZh.map(w => w.ro).join('、')}`);
  }
  const payload = newWords.map(w => ({
    zh: w.zh, ro: w.ro,
    ipa: w.ipa || '',
    hint: w.hint || '',
    cat: w.cat || '其他',
    example_ro: w.example_ro || '',
    example_zh: w.example_zh || '',
    level: 'A1-B2',
    // Kept only for database compatibility; the app no longer uses difficulty.
    difficulty: w.difficulty || 'beginner'
  }));
  let inserted = 0;
  if (payload.length) {
    const { data, error } = await sb.from('words')
      .upsert(payload, { onConflict: 'ro', ignoreDuplicates: true })
      .select();
    if (error && isMissingExampleColumnsError(error)) {
      exampleSchemaMissing = true;
      const fallbackPayload = payload.map(({ example_ro, example_zh, ...row }) => row);
      const retry = await sb.from('words')
        .upsert(fallbackPayload, { onConflict: 'ro', ignoreDuplicates: true })
        .select();
      if (retry.error) throw new Error(retry.error.message);
      inserted = retry.data?.length || 0;
    } else if (error) {
      throw new Error(error.message);
    } else {
      inserted = data?.length || 0;
    }
  }
  let updatedExamples = 0;
  for (const word of normalized) {
    const existing = existingByRo.get(word.ro);
    if (!existing || !word.example_ro) continue;
    if (String(existing.example_ro || '').trim()) continue;
    const updates = { example_ro: word.example_ro };
    if (word.example_zh && !String(existing.example_zh || '').trim()) updates.example_zh = word.example_zh;
    const { error } = await sb.from('words').update(updates).eq('id', existing.id);
    if (error && isMissingExampleColumnsError(error)) {
      exampleSchemaMissing = true;
      continue;
    }
    if (error) throw new Error(error.message);
    updatedExamples++;
  }
  return { inserted, skipped: normalized.length - inserted, updatedExamples, exampleSchemaMissing };
}

function isMissingExampleColumnsError(error) {
  return /example_(ro|zh)|schema cache|Could not find/i.test(error?.message || '');
}

function normalizePendingWordPayload(words) {
  return words.map(w => ({
    zh: String(w.zh || '').trim(),
    ro: String(w.ro || '').trim(),
    ipa: String(w.ipa || '').trim(),
    hint: String(w.hint || '').trim(),
    cat: w.cat || 'Daily Life',
    example_ro: String(w.example_ro || w.exampleRo || '').trim(),
    example_zh: String(w.example_zh || w.exampleZh || '').trim()
  })).filter(w => w.ro && (w.zh || w.example_ro));
}

/**
 * 提交词汇到管理员审核队列。审核通过后才写入正式词库。
 */
async function apiSubmitWordsForReview(words, submitter = {}) {
  if (isOfflineMode()) throw new Error('离线模式下不能提交共享词库审核');
  const normalized = normalizePendingWordPayload(words);
  if (!normalized.length) throw new Error('没有可提交审核的词汇');
  const missingZh = normalized.filter(w => !w.zh && !w.example_ro);
  if (missingZh.length) throw new Error(`新词缺少中文：${missingZh.map(w => w.ro).join('、')}`);

  const payload = normalized.map(w => ({
    ...w,
    status: 'pending',
    submitted_by: submitter.id || currentUser?.id || null,
    submitted_email: submitter.email || currentUser?.email || null
  }));
  const { data, error } = await sb.from('pending_words').insert(payload).select();
  if (error) throw new Error(error.message);
  return { submitted: data?.length || payload.length };
}

async function apiLoadPendingWords() {
  if (isOfflineMode()) return [];
  const { data, error } = await sb.from('pending_words').select('*').order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

async function apiUpdatePendingWord(rowId, updates) {
  if (isOfflineMode()) throw new Error('离线模式下不能修改审核词汇');
  const normalized = normalizePendingWordPayload([updates])[0];
  if (!normalized) throw new Error('请填写罗语；新词需要中文，已有词补例句需要罗语例句');
  const { error } = await sb.from('pending_words').update(normalized).eq('id', rowId).eq('status', 'pending');
  if (error) throw new Error(error.message);
}

async function apiApprovePendingWord(row) {
  if (isOfflineMode()) throw new Error('离线模式下不能审核共享词库');
  if (!row?.id) throw new Error('找不到待审核词汇');
  const { inserted, skipped, updatedExamples, exampleSchemaMissing } = await apiInsertWords([row]);
  const { error } = await sb.from('pending_words').update({
    status: 'approved',
    reviewed_by: currentUser?.id || null,
    reviewed_at: new Date().toISOString()
  }).eq('id', row.id);
  if (error) throw new Error(error.message);
  return { inserted, skipped, updatedExamples, exampleSchemaMissing };
}

async function apiApprovePendingWords(rows) {
  if (isOfflineMode()) throw new Error('离线模式下不能审核共享词库');
  const pendingRows = (rows || []).filter(row => row?.id && row.status === 'pending');
  if (!pendingRows.length) throw new Error('没有待审核词汇');
  const { inserted, skipped, updatedExamples, exampleSchemaMissing } = await apiInsertWords(pendingRows);
  const { error } = await sb.from('pending_words').update({
    status: 'approved',
    reviewed_by: currentUser?.id || null,
    reviewed_at: new Date().toISOString()
  }).in('id', pendingRows.map(row => row.id));
  if (error) throw new Error(error.message);
  return { approved: pendingRows.length, inserted, skipped, updatedExamples, exampleSchemaMissing };
}

async function apiRejectPendingWord(rowId) {
  if (isOfflineMode()) throw new Error('离线模式下不能审核共享词库');
  const { error } = await sb.from('pending_words').update({
    status: 'rejected',
    reviewed_by: currentUser?.id || null,
    reviewed_at: new Date().toISOString()
  }).eq('id', rowId);
  if (error) throw new Error(error.message);
}

async function apiPendingWordSubmissionCount() {
  if (isOfflineMode()) return 0;
  const { count } = await sb.from('pending_words').select('*', { count: 'exact', head: true }).eq('status', 'pending');
  return count || 0;
}

/**
 * 删除一个词条
 * @param {number} wordId
 */
async function apiDeleteWord(wordId) {
  if (isOfflineMode()) throw new Error('离线模式下不能删除共享词库');
  const { error } = await sb.from('words').delete().eq('id', wordId);
  if (error) throw new Error(error.message);
}

// ── 学习进度 ──────────────────────────────────────────────

/**
 * 加载当前用户的所有学习进度
 * @param {string} userId
 * @returns {Promise<object>} { word_ro: { known, qr, qt } }
 */
async function apiLoadProgress(userId) {
  if (isOfflineMode()) return readJson(localKey(userId, 'progress'), {});
  const { data } = await sb.from('progress').select('*').eq('user_id', userId);
  const memoryBackup = readProgressMemoryBackup(userId);
  const map = {};
  (data || []).forEach(r => {
    const progress = rowToProgress(r);
    map[r.word_ro] = mergeProgressMemory(progress, memoryBackup[r.word_ro]);
  });
  return map;
}

/**
 * 加载全班学习进度（排行榜用）
 */
async function apiLoadAllProgress() {
  if (isOfflineMode()) return [];
  let all = [], from = 0;
  while (true) {
    const { data, error } = await sb.from('progress')
      .select('*')
      .order('updated_at', { ascending: false })
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    if (!data || !data.length) break;
    all = all.concat(data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return all;
}

/**
 * 保存/更新一个词的学习进度
 * @param {string} userId
 * @param {string} wordRo
 * @param {boolean} known
 * @param {number} qr - 答对次数
 * @param {number} qt - 总答题次数
 */
/**
 * 保存/更新一个词的学习进度（含熟练度 level）
 */
async function apiSaveProgress(userId, wordRo, known, qr, qt, level, review = {}, legacyReviewCount = null, memory = {}) {
  const normalized = typeof review === 'string'
    ? {
        nextReviewAt: new Date(`${review}T00:00:00`).toISOString(),
        reviewStage: legacyReviewCount || 0,
        lastReviewedAt: new Date().toISOString()
      }
    : review;
  const now = new Date().toISOString();
  const basePayload = {
    user_id: userId,
    word_ro: wordRo,
    known,
    quiz_right: qr || 0,
    quiz_total: qt || 0,
    level: level || 'unknown',
    updated_at: now
  };
  const modernPayload = {
    ...basePayload,
    review_stage: normalized.reviewStage || 0,
    next_review_at: normalized.nextReviewAt || now,
    last_reviewed_at: normalized.lastReviewedAt || now,
    wrong_count: memory.wrongCount || 0,
    error_streak: memory.errorStreak || 0,
    last_wrong_at: memory.lastWrongAt || null
  };
  const reviewOnlyPayload = {
    ...basePayload,
    review_stage: normalized.reviewStage || 0,
    next_review_at: normalized.nextReviewAt || now,
    last_reviewed_at: normalized.lastReviewedAt || now
  };
  const legacyPayload = {
    ...basePayload,
    review_count: normalized.reviewStage || 0,
    next_review: (normalized.nextReviewAt || now).slice(0, 10)
  };

  if (isOfflineMode()) {
    const map = readJson(localKey(userId, 'progress'), {});
    map[wordRo] = rowToProgress({ word_ro: wordRo, ...modernPayload });
    writeJson(localKey(userId, 'progress'), map);
    writeProgressMemoryBackup(userId, wordRo, memory);
    return;
  }

  let { error } = await sb.from('progress').upsert(modernPayload, { onConflict: 'user_id,word_ro' });
  if (!error) {
    writeProgressMemoryBackup(userId, wordRo, memory);
    return;
  }

  const modernError = error;
  ({ error } = await sb.from('progress').upsert(reviewOnlyPayload, { onConflict: 'user_id,word_ro' }));
  if (!error) {
    writeProgressMemoryBackup(userId, wordRo, memory);
    return;
  }

  ({ error } = await sb.from('progress').upsert(legacyPayload, { onConflict: 'user_id,word_ro' }));
  if (error) throw new Error(`${modernError.message}; ${error.message}`);
  writeProgressMemoryBackup(userId, wordRo, memory);
}

// ── 每日学习队列 ──────────────────────────────────────────

function getQueueDateKey() {
  return getLocalDateKey();
}

function getLocalDateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getLocalQueueKey(userId, date = getQueueDateKey()) {
  return `daily_queue:${userId}:${date}`;
}

function readLocalQueue(userId, goal, date = getQueueDateKey()) {
  try {
    const raw = localStorage.getItem(getLocalQueueKey(userId, date));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return {
      user_id: userId,
      queue_date: date,
      goal: parsed.goal || goal || 20,
      word_ro: Array.isArray(parsed.word_ro) ? parsed.word_ro : [],
      completed_word_ro: Array.isArray(parsed.completed_word_ro) ? parsed.completed_word_ro : [],
      completed: !!parsed.completed,
      local: true
    };
  } catch {
    return null;
  }
}

function writeLocalQueue(userId, queue, date = getQueueDateKey()) {
  const payload = {
    goal: queue.goal || 20,
    word_ro: queue.word_ro || [],
    completed_word_ro: queue.completed_word_ro || [],
    completed: !!queue.completed
  };
  localStorage.setItem(getLocalQueueKey(userId, date), JSON.stringify(payload));
  return { user_id: userId, queue_date: date, ...payload, local: true };
}

async function apiGetDailyQueue(userId, goal) {
  const today = getQueueDateKey();
  if (isOfflineMode()) return readLocalQueue(userId, goal, today);
  try {
    const { data, error } = await sb.from('daily_queue')
      .select('*')
      .eq('user_id', userId)
      .eq('queue_date', today)
      .single();
    if (!error && data) {
      return {
        ...data,
        word_ro: data.word_ro || [],
        completed_word_ro: data.completed_word_ro || []
      };
    }
  } catch {}
  return readLocalQueue(userId, goal, today);
}

async function apiSaveDailyQueue(userId, queue) {
  const today = getQueueDateKey();
  const payload = {
    user_id: userId,
    queue_date: today,
    goal: queue.goal || 20,
    word_ro: queue.word_ro || [],
    completed_word_ro: queue.completed_word_ro || [],
    completed: !!queue.completed,
    updated_at: new Date().toISOString()
  };
  if (isOfflineMode()) return writeLocalQueue(userId, payload, today);
  try {
    const { error } = await sb.from('daily_queue').upsert(payload, { onConflict: 'user_id,queue_date' });
    if (!error) return payload;
  } catch {}
  return writeLocalQueue(userId, payload, today);
}

// ── 报错反馈 ──────────────────────────────────────────────

/**
 * 提交一条用户报错
 */
async function apiSubmitReport({ wordId, wordRo, wordZh, reporterId, reporterEmail, issueType, note }) {
  if (isOfflineMode()) throw new Error('离线模式下无法提交到服务器');
  const { error } = await sb.from('word_reports').insert({
    word_id: wordId, word_ro: wordRo, word_zh: wordZh,
    reporter_id: reporterId, reporter_email: reporterEmail,
    issue_type: issueType, note: note || null, status: 'pending'
  });
  if (error) throw new Error(error.message);
}

/**
 * 加载所有报错记录（管理员用）
 */
async function apiLoadReports() {
  if (isOfflineMode()) return [];
  const { data, error } = await sb.from('word_reports').select('*').order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

/**
 * 标记一条报错为已解决
 */
async function apiResolveReport(reportId) {
  if (isOfflineMode()) throw new Error('离线模式下无法修改服务器记录');
  const { error } = await sb.from('word_reports').update({ status: 'resolved' }).eq('id', reportId);
  if (error) throw new Error(error.message);
}

/**
 * 获取待处理报错数量
 */
async function apiPendingReportCount() {
  if (isOfflineMode()) return 0;
  const { count } = await sb.from('word_reports').select('*', { count: 'exact', head: true }).eq('status', 'pending');
  return count || 0;
}

// ── 用户管理 ──────────────────────────────────────────────

/**
 * 加载所有用户资料（管理员用）
 */
async function apiLoadUsers() {
  if (isOfflineMode()) return [OFFLINE_PROFILE];
  const { data, error } = await sb.from('profiles').select('*').order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  const hidden = new Set(readRejectedProfileIds());
  return (data || []).filter(user => user.role !== 'rejected' && !hidden.has(user.id));
}

/**
 * 加载排行榜用户资料
 */
async function apiLoadLeaderboardUsers() {
  if (isOfflineMode()) return [OFFLINE_PROFILE];
  const { data, error } = await sb.from('profiles')
    .select('id,nickname,email,role')
    .in('role', ['user', 'admin']);
  if (error) throw new Error(error.message);
  return data || [];
}

/**
 * 获取单个用户的 profile
 */
async function apiGetProfile(userId) {
  if (userId === OFFLINE_USER_ID || isOfflineMode()) {
    return { ...OFFLINE_PROFILE, daily_goal: apiGetLocalDailyGoal(userId) };
  }
  const { data } = await sb.from('profiles').select('*').eq('id', userId).single();
  return data;
}

/**
 * 设置用户角色
 */
async function apiSetUserRole(userId, role) {
  if (isOfflineMode()) throw new Error('离线模式下无法修改用户角色');
  const { error } = await sb.from('profiles').update({ role }).eq('id', userId);
  if (error) throw new Error(error.message);
}

/**
 * 删除用户资料记录（用于拒绝待审批用户）
 */
async function apiDeleteUserProfile(userId) {
  if (isOfflineMode()) throw new Error('离线模式下无法删除用户记录');
  const { data, error } = await sb.from('profiles').delete().eq('id', userId).select('id');
  if (error) throw new Error(error.message);
  if (data?.length) return 'deleted';
  const fallback = await sb.from('profiles').update({ role: 'rejected' }).eq('id', userId);
  if (fallback.error) {
    hideRejectedProfileLocally(userId);
    return 'hidden';
  }
  return 'rejected';
}

/**
 * 更新用户昵称
 */
async function apiUpdateNickname(userId, nickname) {
  if (isOfflineMode()) {
    localStorage.setItem(localKey(userId, 'nickname'), nickname);
    return;
  }
  const { error } = await sb.from('profiles').update({ nickname }).eq('id', userId);
  if (error) throw new Error(error.message);
}

// ── 每日学习记录 ──────────────────────────────────────────

/**
 * 获取今日的学习记录，没有则创建
 */
async function apiGetTodayLog(userId, goal) {
  const today = getLocalDateKey();
  if (isOfflineMode()) {
    const logs = readJson(localKey(userId, 'daily_log'), {});
    if (!logs[today]) {
      logs[today] = { user_id: userId, log_date: today, new_words: 0, goal: goal || 20, completed: false, local: true };
      writeJson(localKey(userId, 'daily_log'), logs);
    }
    return logs[today];
  }
  const { data } = await sb.from('daily_log').select('*').eq('user_id', userId).eq('log_date', today).single();
  if (data) return data;
  // 创建今日记录
  const { data: created } = await sb.from('daily_log').insert({ user_id: userId, log_date: today, new_words: 0, goal: goal || 20, completed: false }).select().single();
  return created;
}

/**
 * 更新今日完成任务数；数据库字段沿用 daily_log.new_words 以保持兼容
 */
async function apiUpdateTodayLog(userId, completedTasks, goal) {
  const today = getLocalDateKey();
  const completed = completedTasks >= goal;
  if (isOfflineMode()) {
    const logs = readJson(localKey(userId, 'daily_log'), {});
    logs[today] = { user_id: userId, log_date: today, new_words: completedTasks, goal, completed, local: true };
    writeJson(localKey(userId, 'daily_log'), logs);
    return;
  }
  const { error } = await sb.from('daily_log').upsert(
    { user_id: userId, log_date: today, new_words: completedTasks, goal, completed },
    { onConflict: 'user_id,log_date' }
  );
  if (error) throw new Error(error.message);
}

/**
 * 获取最近N天的学习记录
 */
async function apiGetRecentLogs(userId, days = 14) {
  if (isOfflineMode()) {
    const logs = Object.values(readJson(localKey(userId, 'daily_log'), {}));
    return logs
      .sort((a, b) => String(b.log_date).localeCompare(String(a.log_date)))
      .slice(0, days);
  }
  const { data } = await sb.from('daily_log').select('*')
    .eq('user_id', userId)
    .order('log_date', { ascending: false })
    .limit(days);
  return data || [];
}

/**
 * 加载最近N天的全班学习记录（排行榜连 streak 用）
 */
async function apiGetClassRecentLogs(days = 30) {
  if (isOfflineMode()) return apiGetRecentLogs(OFFLINE_USER_ID, days);
  const since = new Date();
  since.setDate(since.getDate() - days + 1);
  const sinceStr = getLocalDateKey(since);
  const { data, error } = await sb.from('daily_log').select('*')
    .gte('log_date', sinceStr)
    .order('log_date', { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

/**
 * 获取用户设置的每日任务目标（存在 profiles 的 metadata 里）
 */
async function apiGetDailyGoal(userId) {
  if (isOfflineMode()) return apiGetLocalDailyGoal(userId);
  const { data } = await sb.from('profiles').select('daily_goal').eq('id', userId).single();
  return data?.daily_goal || 20;
}

/**
 * 保存每日任务目标
 */
async function apiSetDailyGoal(userId, goal) {
  if (isOfflineMode()) {
    localStorage.setItem(localKey(userId, 'daily_goal'), String(goal));
    return;
  }
  const { error } = await sb.from('profiles').update({ daily_goal: goal }).eq('id', userId);
  if (error) throw new Error(error.message);
}

function apiGetLocalDailyGoal(userId = OFFLINE_USER_ID) {
  return Number(localStorage.getItem(localKey(userId, 'daily_goal'))) || 20;
}
