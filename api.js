// ============================================================
//  api.js — 所有 Supabase 数据库操作
//  如需修改数据库逻辑，只改这个文件
// ============================================================

const SUPA_URL = 'https://wuiblzpyhcjxevotwcqz.supabase.co';
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind1aWJsenB5aGNqeGV2b3R3Y3F6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxMjg3NTksImV4cCI6MjA5MjcwNDc1OX0.ImJ1yH8v0op6_5G2P4fI--uJG8LOXIPt-JujPCzeN54';

// 初始化 Supabase 客户端（由 index.html 的 CDN script 提供 supabase 全局变量）
const sb = supabase.createClient(SUPA_URL, SUPA_KEY);

// ── 词库 ──────────────────────────────────────────────────

/**
 * 从数据库加载全部词汇（自动分页，支持超过1000条）
 * @returns {Promise<Array>} 词汇数组
 */
async function apiLoadWords() {
  let all = [], from = 0;
  while (true) {
    const { data, error } = await sb.from('words').select('*').order('id').range(from, from + 999);
    if (error || !data || !data.length) break;
    all = all.concat(data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return all;
}

/**
 * 更新一个词条
 * @param {number} wordId
 * @param {object} updates - { zh, ro, ipa, hint, cat }
 */
async function apiUpdateWord(wordId, updates) {
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
 * 批量插入词汇，跳过重复（以 ro 字段为唯一键）
 * @param {Array} words - [{ zh, ro, ipa, hint, cat }]
 * @returns {{ inserted: number, skipped: number }}
 */
async function apiInsertWords(words) {
  const payload = words.map(w => ({
    zh: w.zh, ro: w.ro,
    ipa: w.ipa || '',
    hint: w.hint || '',
    cat: w.cat || '其他',
    level: 'A1-A2',
    // Kept only for database compatibility; the app no longer uses difficulty.
    difficulty: w.difficulty || 'beginner'
  }));
  const { data, error } = await sb.from('words')
    .upsert(payload, { onConflict: 'ro', ignoreDuplicates: true })
    .select();
  if (error) throw new Error(error.message);
  return { inserted: data?.length || 0, skipped: words.length - (data?.length || 0) };
}

/**
 * 删除一个词条
 * @param {number} wordId
 */
async function apiDeleteWord(wordId) {
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
  const { data } = await sb.from('progress').select('*').eq('user_id', userId);
  const map = {};
  (data || []).forEach(r => {
    const legacyNextReviewAt = r.next_review ? new Date(`${r.next_review}T00:00:00`).toISOString() : null;
    const reviewStage = r.review_stage ?? r.review_count ?? 0;
    map[r.word_ro] = {
      known: r.known,
      qr: r.quiz_right,
      qt: r.quiz_total,
      level: r.level || 'unknown',
      reviewStage,
      nextReviewAt: r.next_review_at || legacyNextReviewAt,
      lastReviewedAt: r.last_reviewed_at || null,
      reviewCount: reviewStage,
      nextReview: r.next_review || (r.next_review_at ? String(r.next_review_at).slice(0, 10) : null),
      wrongCount: r.wrong_count || Math.max(0, (r.quiz_total || 0) - (r.quiz_right || 0)),
      errorStreak: r.error_streak || 0,
      lastWrongAt: r.last_wrong_at || null
    };
  });
  return map;
}

/**
 * 加载全班学习进度（排行榜用）
 */
async function apiLoadAllProgress() {
  const { data, error } = await sb.from('progress').select('*');
  if (error) throw new Error(error.message);
  return data || [];
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

  let { error } = await sb.from('progress').upsert(modernPayload, { onConflict: 'user_id,word_ro' });
  if (!error) return;

  const modernError = error;
  ({ error } = await sb.from('progress').upsert(reviewOnlyPayload, { onConflict: 'user_id,word_ro' }));
  if (!error) return;

  ({ error } = await sb.from('progress').upsert(legacyPayload, { onConflict: 'user_id,word_ro' }));
  if (error) throw new Error(`${modernError.message}; ${error.message}`);
}

// ── 每日学习队列 ──────────────────────────────────────────

function getQueueDateKey() {
  return new Date().toISOString().slice(0, 10);
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
  const { data, error } = await sb.from('word_reports').select('*').order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

/**
 * 标记一条报错为已解决
 */
async function apiResolveReport(reportId) {
  const { error } = await sb.from('word_reports').update({ status: 'resolved' }).eq('id', reportId);
  if (error) throw new Error(error.message);
}

/**
 * 获取待处理报错数量
 */
async function apiPendingReportCount() {
  const { count } = await sb.from('word_reports').select('*', { count: 'exact', head: true }).eq('status', 'pending');
  return count || 0;
}

// ── 用户管理 ──────────────────────────────────────────────

/**
 * 加载所有用户资料（管理员用）
 */
async function apiLoadUsers() {
  const { data, error } = await sb.from('profiles').select('*').order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

/**
 * 加载排行榜用户资料
 */
async function apiLoadLeaderboardUsers() {
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
  const { data } = await sb.from('profiles').select('*').eq('id', userId).single();
  return data;
}

/**
 * 设置用户角色
 */
async function apiSetUserRole(userId, role) {
  const { error } = await sb.from('profiles').update({ role }).eq('id', userId);
  if (error) throw new Error(error.message);
}

/**
 * 更新用户昵称
 */
async function apiUpdateNickname(userId, nickname) {
  const { error } = await sb.from('profiles').update({ nickname }).eq('id', userId);
  if (error) throw new Error(error.message);
}

// ── 每日学习记录 ──────────────────────────────────────────

/**
 * 获取今日的学习记录，没有则创建
 */
async function apiGetTodayLog(userId, goal) {
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await sb.from('daily_log').select('*').eq('user_id', userId).eq('log_date', today).single();
  if (data) return data;
  // 创建今日记录
  const { data: created } = await sb.from('daily_log').insert({ user_id: userId, log_date: today, new_words: 0, goal: goal || 20, completed: false }).select().single();
  return created;
}

/**
 * 更新今日新词数
 */
async function apiUpdateTodayLog(userId, newWords, goal) {
  const today = new Date().toISOString().slice(0, 10);
  const completed = newWords >= goal;
  const { error } = await sb.from('daily_log').upsert(
    { user_id: userId, log_date: today, new_words: newWords, goal, completed },
    { onConflict: 'user_id,log_date' }
  );
  if (error) throw new Error(error.message);
}

/**
 * 获取最近N天的学习记录
 */
async function apiGetRecentLogs(userId, days = 14) {
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
  const since = new Date();
  since.setDate(since.getDate() - days + 1);
  const sinceStr = since.toISOString().slice(0, 10);
  const { data, error } = await sb.from('daily_log').select('*')
    .gte('log_date', sinceStr)
    .order('log_date', { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

/**
 * 获取用户设置的每日目标（存在 profiles 的 metadata 里）
 */
async function apiGetDailyGoal(userId) {
  const { data } = await sb.from('profiles').select('daily_goal').eq('id', userId).single();
  return data?.daily_goal || 20;
}

/**
 * 保存每日目标
 */
async function apiSetDailyGoal(userId, goal) {
  const { error } = await sb.from('profiles').update({ daily_goal: goal }).eq('id', userId);
  if (error) throw new Error(error.message);
}
