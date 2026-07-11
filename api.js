// ============================================================
//  api.js — 所有 Supabase 数据库操作
//  如需修改数据库逻辑，只改这个文件
// ============================================================

const SUPA_URL = 'https://wuiblzpyhcjxevotwcqz.supabase.co';
const SUPA_KEY = 'sb_publishable_R_1KpyBLGgn_BW1McVso7w_maR5OzDJ';

// 初始化 Supabase 客户端（APK 内会打包本地 supabase 脚本）
function createUnavailableSupabaseClient() {
  const unavailable = () => {
    throw new Error('云端服务暂不可用，请使用离线模式或稍后重试');
  };
  const chain = {
    select: unavailable,
    insert: unavailable,
    update: unavailable,
    delete: unavailable,
    upsert: unavailable,
    eq: unavailable,
    in: unavailable,
    gte: unavailable,
    order: unavailable,
    limit: unavailable,
    range: unavailable,
    single: unavailable,
    maybeSingle: unavailable
  };
  return {
    offlineUnavailable: true,
    rpc: async () => ({ data: null, error: new Error('云端服务暂不可用，请使用离线模式或稍后重试') }),
    from: () => chain,
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      signInWithPassword: async () => ({ data: null, error: new Error('云端登录暂不可用，请使用离线模式或稍后重试') }),
      signUp: async () => ({ data: null, error: new Error('云端注册暂不可用，请使用离线模式或稍后重试') }),
      signOut: async () => ({ error: null }),
      resetPasswordForEmail: async () => ({ error: new Error('云端服务暂不可用，请稍后重试') }),
      updateUser: async () => ({ data: null, error: new Error('云端服务暂不可用，请稍后重试') }),
      refreshSession: async () => ({ data: null, error: new Error('云端服务暂不可用，请稍后重试') }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } })
    }
  };
}

const sb = typeof supabase !== 'undefined' && supabase?.createClient
  ? supabase.createClient(SUPA_URL, SUPA_KEY)
  : createUnavailableSupabaseClient();

const OFFLINE_USER_ID = 'local-offline-user';
const OFFLINE_PROFILE = {
  id: OFFLINE_USER_ID,
  email: 'offline@local.app',
  nickname: '本机学习',
  role: 'user',
  daily_goal: 20,
  offline: true
};
const PROGRESS_LOAD_TIMEOUT_MS = 3500;
const WORDS_LOAD_TIMEOUT_MS = 3500;
const BUNDLED_WORDS_LOAD_TIMEOUT_MS = 6000;
const WORDS_CACHE_KEY = 'words_cache:v2';
const WORDS_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PENDING_PROGRESS_RETRY_LIMIT = 25;
const PENDING_PROGRESS_RETRY_CONCURRENCY = 5;
const PENDING_DAILY_STATE_RETRY_LIMIT = 10;

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

function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function fetchWithTimeout(url, options = {}, ms = 6000, message = '请求超时') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error(message);
    throw error;
  } finally {
    clearTimeout(timer);
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

function readCachedWords() {
  try {
    const cached = readJson(WORDS_CACHE_KEY, null);
    if (!cached?.savedAt || !Array.isArray(cached.words)) return null;
    if (Date.now() - Number(cached.savedAt) > WORDS_CACHE_TTL_MS) return null;
    return cached.words;
  } catch {
    return null;
  }
}

function writeCachedWords(words) {
  if (!Array.isArray(words) || !words.length) return;
  try {
    writeJson(WORDS_CACHE_KEY, { savedAt: Date.now(), words });
  } catch (error) {
    console.warn('Words cache write failed', error);
  }
}

function updateCachedWord(wordId, updates) {
  const cached = readCachedWords();
  if (!Array.isArray(cached) || !cached.length) return;
  const nextWords = cached.map(word => Number(word?.id) === Number(wordId)
    ? { ...word, ...updates }
    : word
  );
  writeCachedWords(nextWords);
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

function userWatchSettingsKey() {
  return localKey(currentUser?.id || 'admin', 'user_watch_settings');
}

function readLocalUserWatchSettings() {
  return readJson(userWatchSettingsKey(), {});
}

function writeLocalUserWatchSetting(userId, watched) {
  const settings = readLocalUserWatchSettings();
  settings[userId] = watched !== false;
  writeJson(userWatchSettingsKey(), settings);
  return settings[userId];
}

function progressMemoryKey(userId) {
  return localKey(userId, 'progress_memory');
}

function progressPendingKey(userId) {
  return localKey(userId, 'progress_pending');
}

function dailyStatePendingKey(userId) {
  return localKey(userId, 'daily_state_pending');
}

function normalizeProgressWordRoKey(value) {
  return String(value || '')
    .normalize('NFC')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[şŞ]/g, match => match === 'Ş' ? 'Ș' : 'ș')
    .replace(/[ţŢ]/g, match => match === 'Ţ' ? 'Ț' : 'ț')
    .toLocaleLowerCase('ro');
}

function progressEntryKey(wordId, wordRo = '') {
  if (wordId !== undefined && wordId !== null && String(wordId).trim() !== '') {
    return String(wordId);
  }
  const legacyKey = normalizeProgressWordRoKey(wordRo);
  return legacyKey ? `legacy:${legacyKey}` : '';
}

function getProgressEntryWordId(key, progress = {}) {
  const value = progress?.wordId ?? progress?.word_id ?? (/^\d+$/.test(String(key || '')) ? key : null);
  return value !== undefined && value !== null && String(value).trim() !== '' ? Number(value) : null;
}

function getProgressEntryWordRo(progress = {}, fallback = '') {
  return progress?.wordRo || progress?.word_ro || fallback || '';
}

function readProgressMemoryBackup(userId) {
  return readJson(progressMemoryKey(userId), {});
}

function readPendingProgress(userId) {
  return readJson(progressPendingKey(userId), {});
}

function readPendingDailyState(userId) {
  return readJson(dailyStatePendingKey(userId), {});
}

function hasPendingDailyState(userId) {
  return Object.values(readPendingDailyState(userId) || {}).some(entry => entry?.queue || entry?.log);
}

function createDailySyncToken(part, date) {
  return `${part}:${date}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

function createProgressSyncToken(key) {
  return `progress:${key}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

function markProgressSource(map, source, error = null) {
  try {
    Object.defineProperty(map, '__progressSource', { value: source, enumerable: false });
    if (error) Object.defineProperty(map, '__progressError', { value: error, enumerable: false });
  } catch {}
  return map;
}

function isMissingRpcError(error) {
  const message = String(error?.message || error || '');
  return /function .* does not exist|schema cache|not find|could not find|404/i.test(message);
}

function readLocalProgressFallback(userId) {
  const memoryBackup = readProgressMemoryBackup(userId);
  const localProgress = readJson(localKey(userId, 'progress'), {});
  const pendingProgress = readPendingProgress(userId);
  const map = {};
  Object.entries(localProgress).forEach(([key, progress]) => {
    const wordId = getProgressEntryWordId(key, progress);
    const wordRo = getProgressEntryWordRo(progress, key);
    const nextKey = progressEntryKey(wordId, wordRo) || key;
    map[nextKey] = mergeProgressMemory({ ...(progress || {}), word_id: wordId, word_ro: wordRo }, memoryBackup[nextKey] || memoryBackup[key]);
  });
  Object.entries(pendingProgress).forEach(([key, progress]) => {
    const wordId = getProgressEntryWordId(key, progress);
    const wordRo = getProgressEntryWordRo(progress, key);
    const nextKey = progressEntryKey(wordId, wordRo) || key;
    map[nextKey] = mergeProgressMemory({ ...(progress || {}), word_id: wordId, word_ro: wordRo, pendingSync: true }, memoryBackup[nextKey] || memoryBackup[key]);
  });
  return map;
}

function writeLocalProgressSnapshot(userId, progressMap = {}) {
  if (!userId) return { ok: true, skipped: true };
  const snapshot = {};
  Object.entries(progressMap || {}).forEach(([key, progress]) => {
    if (!key || key.startsWith('__')) return;
    const wordId = getProgressEntryWordId(key, progress);
    const wordRo = getProgressEntryWordRo(progress, key);
    const nextKey = progressEntryKey(wordId, wordRo);
    if (!nextKey) return;
    snapshot[nextKey] = { ...(progress || {}), word_id: wordId, word_ro: wordRo };
    delete snapshot[nextKey].pendingSync;
  });
  try {
    writeJson(localKey(userId, 'progress'), snapshot);
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}

function writePendingProgress(userId, wordId, wordRo, progress = {}) {
  const key = progressEntryKey(wordId, wordRo);
  if (!key) return { ok: true, skipped: true };
  const pending = readPendingProgress(userId);
  const localProgress = readJson(localKey(userId, 'progress'), {});
  const merged = mergeCloudProgress(progress || {}, pending[key] || localProgress[key] || null);
  pending[key] = {
    ...merged,
    word_id: getProgressEntryWordId(key, progress),
    word_ro: wordRo || progress?.word_ro || progress?.wordRo || '',
    pendingSync: true,
    pendingSyncAt: new Date().toISOString(),
    pendingSyncToken: createProgressSyncToken(key)
  };
  try {
    writeJson(progressPendingKey(userId), pending);
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}

function writeLocalProgressEntry(userId, wordId, wordRo, progress = {}) {
  const key = progressEntryKey(wordId, wordRo);
  if (!userId || !key) return { ok: true, skipped: true };
  const map = readJson(localKey(userId, 'progress'), {});
  map[key] = mergeCloudProgress({ ...(progress || {}), word_id: getProgressEntryWordId(key, progress), word_ro: wordRo || progress?.word_ro || progress?.wordRo || '' }, map[key] || null);
  delete map[key].pendingSync;
  try {
    writeJson(localKey(userId, 'progress'), map);
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}

function queueProgressForSync(userId, wordId, wordRo, progress = {}, memory = {}) {
  const localStatus = writeLocalProgressEntry(userId, wordId, wordRo, progress);
  const pendingStatus = writePendingProgress(userId, wordId, wordRo, progress);
  const memoryBackup = writeProgressMemoryBackup(userId, wordId, wordRo, memory);
  return {
    ok: localStatus.ok && pendingStatus.ok && memoryBackup.ok !== false,
    localStatus,
    pendingStatus,
    memoryBackup
  };
}

function queueProgressBatchForSync(userId, entries = []) {
  const validEntries = (entries || []).filter(entry => progressEntryKey(entry?.wordId ?? entry?.word_id, entry?.wordRo ?? entry?.word_ro));
  if (!userId || !validEntries.length) return { ok: true, skipped: true };
  try {
    const localProgress = readJson(localKey(userId, 'progress'), {});
    const pendingProgress = readPendingProgress(userId);
    const memoryBackup = readProgressMemoryBackup(userId);
    const backedUpAt = new Date().toISOString();

    validEntries.forEach(({ wordId, wordRo, progress = {}, memory = {} }) => {
      const key = progressEntryKey(wordId ?? progress?.word_id ?? progress?.wordId, wordRo ?? progress?.word_ro ?? progress?.wordRo);
      const merged = mergeCloudProgress(progress || {}, pendingProgress[key] || localProgress[key] || null);
      localProgress[key] = { ...merged, word_id: getProgressEntryWordId(key, progress), word_ro: wordRo || progress?.word_ro || progress?.wordRo || '' };
      delete localProgress[key].pendingSync;
      pendingProgress[key] = {
        ...merged,
        word_id: getProgressEntryWordId(key, progress),
        word_ro: wordRo || progress?.word_ro || progress?.wordRo || '',
        pendingSync: true,
        pendingSyncAt: progress?.pendingSyncAt || backedUpAt,
        pendingSyncToken: createProgressSyncToken(key)
      };

      const wrongCount = Number(memory.wrongCount || 0);
      const errorStreak = Number(memory.errorStreak || 0);
      const lastWrongAt = memory.lastWrongAt || null;
      const weakClearedAt = memory.weakClearedAt || null;
      if (!wrongCount && !errorStreak && !lastWrongAt && !weakClearedAt) {
        delete memoryBackup[key];
      } else {
        memoryBackup[key] = { wrongCount, errorStreak, lastWrongAt, weakClearedAt, backedUpAt };
      }
    });

    const prunedMemory = Object.fromEntries(Object.entries(memoryBackup)
      .sort((a, b) => String(b[1]?.backedUpAt || '').localeCompare(String(a[1]?.backedUpAt || '')))
      .slice(0, 500));
    writeJson(localKey(userId, 'progress'), localProgress);
    writeJson(progressPendingKey(userId), pendingProgress);
    writeJson(progressMemoryKey(userId), prunedMemory);
    return { ok: true, saved: validEntries.length };
  } catch (error) {
    return { ok: false, error };
  }
}

function writePendingProgressBatch(userId, entries = []) {
  if (!entries.length) return { ok: true, skipped: true };
  const pending = readPendingProgress(userId);
  const localProgress = readJson(localKey(userId, 'progress'), {});
  const now = new Date().toISOString();
  entries.forEach(([wordId, wordRo, progress]) => {
    if (progress === undefined && typeof wordRo === 'object') {
      progress = wordRo;
      wordRo = progress?.word_ro || progress?.wordRo || '';
    }
    const key = progressEntryKey(wordId, wordRo);
    if (!key) return;
    const merged = mergeCloudProgress(progress || {}, pending[key] || localProgress[key] || null);
    pending[key] = {
      ...merged,
      word_id: getProgressEntryWordId(key, progress),
      word_ro: wordRo || progress?.word_ro || progress?.wordRo || '',
      pendingSync: true,
      pendingSyncAt: progress?.pendingSyncAt || now,
      pendingSyncToken: createProgressSyncToken(key)
    };
  });
  try {
    writeJson(progressPendingKey(userId), pending);
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}

function clearPendingProgress(userId, wordId, wordRo, expectedToken = '') {
  const key = progressEntryKey(wordId, wordRo);
  if (!key) return;
  const pending = readPendingProgress(userId);
  if (!(key in pending)) return;
  const currentToken = pending[key]?.pendingSyncToken || pending[key]?.pending_sync_token || '';
  if (expectedToken && currentToken && currentToken !== expectedToken) return;
  delete pending[key];
  try { writeJson(progressPendingKey(userId), pending); } catch {}
}

function clearPendingProgressBatch(userId, keys = []) {
  const pending = readPendingProgress(userId);
  let changed = false;
  keys.forEach(entry => {
    const key = typeof entry === 'string' ? entry : entry?.key;
    const expectedToken = typeof entry === 'string' ? '' : (entry?.pendingSyncToken || entry?.token || '');
    if (key in pending) {
      const currentToken = pending[key]?.pendingSyncToken || pending[key]?.pending_sync_token || '';
      if (expectedToken && currentToken && currentToken !== expectedToken) return;
      delete pending[key];
      changed = true;
    }
  });
  if (changed) {
    try { writeJson(progressPendingKey(userId), pending); } catch {}
  }
}

function queueDailyStateForSync(userId, date, patch = {}) {
  if (!userId || !date) return { ok: true, skipped: true };
  const pending = readPendingDailyState(userId);
  const existing = pending[date] || {};
  const now = new Date().toISOString();
  pending[date] = {
    ...existing,
    ...(patch.queue ? { queue: patch.queue } : {}),
    ...(patch.log ? { log: patch.log } : {}),
    pendingSyncAt: existing.pendingSyncAt || now,
    updatedAt: now,
    lastError: patch.lastError || existing.lastError || null,
    attempts: Number(existing.attempts || 0)
  };
  try {
    writeJson(dailyStatePendingKey(userId), pending);
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}

function markPendingDailyStateError(userId, date, error) {
  const pending = readPendingDailyState(userId);
  if (!pending[date]) return;
  pending[date] = {
    ...pending[date],
    attempts: Number(pending[date].attempts || 0) + 1,
    lastError: error?.message || String(error || '同步失败'),
    updatedAt: new Date().toISOString()
  };
  try { writeJson(dailyStatePendingKey(userId), pending); } catch {}
}

function clearPendingDailyStatePart(userId, date, part, syncedToken = '', syncedUpdatedAt = '') {
  const pending = readPendingDailyState(userId);
  const entry = pending[date];
  if (!entry?.[part]) return;
  const currentToken = entry[part]?.sync_token || entry[part]?.syncToken || '';
  if (syncedToken && currentToken && currentToken !== syncedToken) return;
  const currentUpdatedAt = entry[part]?.updated_at || entry[part]?.updatedAt || '';
  if (!currentToken && syncedUpdatedAt && currentUpdatedAt && String(currentUpdatedAt) > String(syncedUpdatedAt)) return;
  delete entry[part];
  delete entry.lastError;
  if (!entry.queue && !entry.log) {
    delete pending[date];
  } else {
    pending[date] = { ...entry, updatedAt: new Date().toISOString() };
  }
  try { writeJson(dailyStatePendingKey(userId), pending); } catch {}
}

async function upsertDailyQueuePayload(payload) {
  const { sync_token, syncToken, local, syncError, pendingSync, ...cloudPayload } = payload;
  let { error } = await sb.from('daily_queue').upsert(cloudPayload, { onConflict: 'user_id,queue_date' });
  if (error && /word_id|completed_word_id|schema cache|Could not find/i.test(error.message || '')) {
    const { word_id, completed_word_id, ...legacyPayload } = cloudPayload;
    ({ error } = await sb.from('daily_queue').upsert(legacyPayload, { onConflict: 'user_id,queue_date' }));
  }
  if (error) throw new Error(error.message);
  return payload;
}

async function upsertDailyLogPayload(payload) {
  const { sync_token, syncToken, local, syncError, pendingSync, ...cloudPayload } = payload;
  let { error } = await withTimeout(
    sb.from('daily_log').upsert(cloudPayload, { onConflict: 'user_id,log_date' }),
    PROGRESS_LOAD_TIMEOUT_MS,
    '今日记录保存超时'
  );
  if (error && /updated_at|schema cache|Could not find/i.test(error.message || '')) {
    const { updated_at, updatedAt, ...legacyPayload } = cloudPayload;
    ({ error } = await withTimeout(
      sb.from('daily_log').upsert(legacyPayload, { onConflict: 'user_id,log_date' }),
      PROGRESS_LOAD_TIMEOUT_MS,
      '今日记录保存超时'
    ));
  }
  if (error) throw new Error(error.message);
  return payload;
}

function writeProgressMemoryBackup(userId, wordId, wordRo, memory = {}) {
  const key = progressEntryKey(wordId, wordRo);
  if (!key) return { ok: true, skipped: true };
  const existing = readProgressMemoryBackup(userId);
  const wrongCount = Number(memory.wrongCount || 0);
  const errorStreak = Number(memory.errorStreak || 0);
  const lastWrongAt = memory.lastWrongAt || null;
  const weakClearedAt = memory.weakClearedAt || null;
  if (!wrongCount && !errorStreak && !lastWrongAt && !weakClearedAt) {
    delete existing[key];
    try {
      writeJson(progressMemoryKey(userId), existing);
      return { ok: true, cleared: true };
    } catch (error) {
      return { ok: false, error };
    }
  }
  existing[key] = {
    wrongCount,
    errorStreak,
    lastWrongAt,
    weakClearedAt,
    backedUpAt: new Date().toISOString()
  };
  const pruned = Object.fromEntries(Object.entries(existing)
    .sort((a, b) => String(b[1]?.backedUpAt || '').localeCompare(String(a[1]?.backedUpAt || '')))
    .slice(0, 500));
  try {
    writeJson(progressMemoryKey(userId), pruned);
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}

async function loadBundledWords(options = {}) {
  const { allowStoredCache = true } = options;
  if (allowStoredCache) {
    const cached = readCachedWords();
    if (cached?.length) {
      console.info(`Words loaded from local cache: ${cached.length}`);
      return cached;
    }
  }
  const response = await fetchWithTimeout(
    './data/vocab.json',
    { cache: 'force-cache' },
    BUNDLED_WORDS_LOAD_TIMEOUT_MS,
    '本地词库读取超时'
  );
  if (!response.ok) throw new Error('本地词库读取失败');
  const payload = await response.json();
  const words = Array.isArray(payload) ? payload : (payload.words || []);
  writeCachedWords(words);
  console.info(`Words loaded from bundled file: ${words.length}`);
  return words;
}

function rowToProgress(r) {
  const legacyNextReviewAt = r.next_review ? new Date(`${r.next_review}T00:00:00`).toISOString() : null;
  const reviewStage = r.review_stage ?? r.review_count ?? r.reviewStage ?? 0;
  const qr = r.quiz_right ?? r.qr ?? 0;
  const qt = r.quiz_total ?? r.qt ?? 0;
  const nextReviewAt = r.next_review_at || r.nextReviewAt || legacyNextReviewAt;
  const lastReviewedAt = r.last_reviewed_at || r.lastReviewedAt || null;
  const seen = r.seen ?? !!(
    r.known ||
    qr ||
    qt ||
    reviewStage ||
    (r.level && r.level !== 'unknown')
  );
  const recentResults = (() => {
    const value = r.recent_results ?? r.recentResults;
    if (Array.isArray(value)) return value;
    if (typeof value === 'string' && value.trim()) {
      try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) return parsed;
      } catch {}
    }
    return [];
  })();
  const baseProgress = {
    wordId: r.word_id ?? r.wordId ?? null,
    word_id: r.word_id ?? r.wordId ?? null,
    wordRo: r.word_ro ?? r.wordRo ?? '',
    word_ro: r.word_ro ?? r.wordRo ?? '',
    seen,
    seenViaCard: !!(r.seen_via_card ?? r.seenViaCard),
    known: r.known,
    qr,
    qt,
    grammarQr: r.grammar_qr ?? r.grammarQr ?? 0,
    grammarQt: r.grammar_qt ?? r.grammarQt ?? 0,
    level: r.level || 'unknown',
    reviewStage,
    nextReviewAt,
    lastReviewedAt,
    reviewCount: reviewStage,
    nextReview: r.next_review || r.nextReview || (r.next_review_at ? String(r.next_review_at).slice(0, 10) : null),
    wasMasteredAt: r.was_mastered_at || r.wasMasteredAt || null,
    wrongCount: r.wrong_count ?? r.wrongCount,
    errorStreak: r.error_streak ?? r.errorStreak,
    correctStreakSinceWrong: r.correct_streak_since_wrong ?? r.correctStreakSinceWrong ?? 0,
    lastWrongAt: r.last_wrong_at || r.lastWrongAt || null,
    weakClearedAt: r.weak_cleared_at || r.weakClearedAt || null,
    cardState: r.card_state || r.cardState,
    dueAt: r.due_at || r.dueAt || nextReviewAt,
    intervalDays: r.interval_days ?? r.intervalDays,
    memoryStrength: r.memory_strength ?? r.memoryStrength,
    reps: r.reps,
    correctCount: r.correct_count ?? r.correctCount,
    fuzzyCount: r.fuzzy_count ?? r.fuzzyCount,
    forgetCount: r.forget_count ?? r.forgetCount,
    lapses: r.lapses,
    recentResults,
    needsReinforcement: r.needs_reinforcement ?? r.needsReinforcement,
    lastReviewedAt
  };
  return typeof RomanianVocabScheduler !== 'undefined'
    ? { ...baseProgress, ...RomanianVocabScheduler.normalizeSchedulerProgress(baseProgress) }
    : baseProgress;
}

function mergeProgressMemory(progress, backup = {}) {
  return {
    ...progress,
    wrongCount: progress.wrongCount ?? backup.wrongCount ?? 0,
    errorStreak: progress.errorStreak ?? backup.errorStreak ?? 0,
    lastWrongAt: progress.lastWrongAt || backup.lastWrongAt || null,
    weakClearedAt: progress.weakClearedAt || backup.weakClearedAt || null,
    cardState: progress.cardState || backup.cardState || 'new',
    dueAt: progress.dueAt || backup.dueAt || progress.nextReviewAt || null,
    intervalDays: progress.intervalDays ?? backup.intervalDays ?? 0,
    memoryStrength: progress.memoryStrength ?? backup.memoryStrength ?? 0,
    reps: progress.reps ?? backup.reps ?? progress.qt ?? 0,
    correctCount: progress.correctCount ?? backup.correctCount ?? progress.qr ?? 0,
    fuzzyCount: progress.fuzzyCount ?? backup.fuzzyCount ?? 0,
    forgetCount: progress.forgetCount ?? backup.forgetCount ?? Math.max(0, Number(progress.qt || 0) - Number(progress.qr || 0)),
    lapses: progress.lapses ?? backup.lapses ?? 0,
    recentResults: Array.isArray(progress.recentResults) ? progress.recentResults : (backup.recentResults || []),
    needsReinforcement: progress.needsReinforcement ?? backup.needsReinforcement ?? false
  };
}

function validIso(value) {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function newerIso(a, b) {
  const aIso = validIso(a);
  const bIso = validIso(b);
  if (!aIso) return bIso;
  if (!bIso) return aIso;
  return new Date(aIso).getTime() >= new Date(bIso).getTime() ? aIso : bIso;
}

function laterReviewIso(a, b, fallback = new Date().toISOString()) {
  return newerIso(a, b) || fallback;
}

function normalizeProgressLevel(progress = {}) {
  const qt = Number(progress.qt || 0);
  const qr = Number(progress.qr || 0);
  const reviewStage = RomanianVocabScheduler.getReviewStage(progress);
  if (qt >= 3 && qr / qt >= 0.8 && reviewStage >= 2) return 'mastered';
  if (
    progress.seen ||
    progress.known ||
    qt ||
    qr ||
    reviewStage ||
    progress.lastReviewedAt
  ) return 'learning';
  return 'unknown';
}

function mergeCloudProgress(localProgress = {}, cloudRow = null) {
  const cloudProgress = cloudRow ? rowToProgress(cloudRow) : {};
  const qr = Math.max(Number(localProgress.qr || 0), Number(cloudProgress.qr || 0));
  const qt = Math.max(Number(localProgress.qt || 0), Number(cloudProgress.qt || 0), qr);
  const reviewStage = Math.max(
    RomanianVocabScheduler.getReviewStage(localProgress),
    RomanianVocabScheduler.getReviewStage(cloudProgress)
  );
  const wrongCount = Math.max(Number(localProgress.wrongCount || 0), Number(cloudProgress.wrongCount || 0));
  const errorStreak = Math.max(Number(localProgress.errorStreak || 0), Number(cloudProgress.errorStreak || 0));
  const correctStreakSinceWrong = Math.max(Number(localProgress.correctStreakSinceWrong || 0), Number(cloudProgress.correctStreakSinceWrong || 0));
  const grammarQr = Math.max(Number(localProgress.grammarQr || 0), Number(cloudProgress.grammarQr || 0));
  const grammarQt = Math.max(Number(localProgress.grammarQt || 0), Number(cloudProgress.grammarQt || 0), grammarQr);
  const lastReviewedAt = newerIso(localProgress.lastReviewedAt, cloudProgress.lastReviewedAt) || new Date().toISOString();
  const lastWrongAt = newerIso(localProgress.lastWrongAt, cloudProgress.lastWrongAt);
  const weakClearedAt = newerIso(localProgress.weakClearedAt, cloudProgress.weakClearedAt);
  const wasMasteredAt = newerIso(localProgress.wasMasteredAt, cloudProgress.wasMasteredAt);
  const localScheduler = typeof RomanianVocabScheduler !== 'undefined'
    ? RomanianVocabScheduler.normalizeSchedulerProgress(localProgress)
    : localProgress;
  const cloudScheduler = typeof RomanianVocabScheduler !== 'undefined'
    ? RomanianVocabScheduler.normalizeSchedulerProgress(cloudProgress)
    : cloudProgress;
  const localSchedulerTime = new Date(localScheduler.lastReviewedAt || localScheduler.dueAt || 0).getTime();
  const cloudSchedulerTime = new Date(cloudScheduler.lastReviewedAt || cloudScheduler.dueAt || 0).getTime();
  const localWouldDowngrade = isSchedulerMergeDowngrade(cloudScheduler, localScheduler, cloudProgress, localProgress);
  const schedulerBase = localWouldDowngrade
    ? cloudScheduler
    : (localSchedulerTime >= cloudSchedulerTime ? localScheduler : cloudScheduler);
  const nextReviewAt = laterReviewIso(
    localProgress.nextReviewAt || localProgress.nextReview,
    cloudProgress.nextReviewAt || cloudProgress.nextReview,
    lastReviewedAt
  );
  const dueAt = schedulerBase.dueAt || nextReviewAt;
  const merged = {
    ...cloudProgress,
    ...localProgress,
    seen: !!(localProgress.seen || cloudProgress.seen || localProgress.known || cloudProgress.known || qt || reviewStage),
    seenViaCard: !!(localProgress.seenViaCard || cloudProgress.seenViaCard),
    known: !!(localProgress.known || cloudProgress.known || qr > 0 || reviewStage > 0),
    qr,
    qt,
    grammarQr,
    grammarQt,
    reviewStage,
    reviewCount: reviewStage,
    nextReviewAt,
    dueAt,
    cardState: schedulerBase.cardState || 'new',
    intervalDays: Number(schedulerBase.intervalDays || 0),
    memoryStrength: Number(schedulerBase.memoryStrength || 0),
    reps: Math.max(Number(localScheduler.reps || 0), Number(cloudScheduler.reps || 0)),
    correctCount: Math.max(Number(localScheduler.correctCount || 0), Number(cloudScheduler.correctCount || 0)),
    fuzzyCount: Math.max(Number(localScheduler.fuzzyCount || 0), Number(cloudScheduler.fuzzyCount || 0)),
    forgetCount: Math.max(Number(localScheduler.forgetCount || 0), Number(cloudScheduler.forgetCount || 0)),
    lapses: Math.max(Number(localScheduler.lapses || 0), Number(cloudScheduler.lapses || 0)),
    recentResults: Array.isArray(schedulerBase.recentResults) ? schedulerBase.recentResults : [],
    needsReinforcement: !!schedulerBase.needsReinforcement,
    lastReviewedAt,
    wasMasteredAt,
    wrongCount,
    errorStreak,
    correctStreakSinceWrong,
    lastWrongAt,
    weakClearedAt
  };
  merged.level = normalizeProgressLevel(merged);
  return merged;
}

function isSchedulerMergeDowngrade(existingScheduler = {}, incomingScheduler = {}, existingProgress = {}, incomingProgress = {}) {
  if (typeof RomanianVocabScheduler === 'undefined' || !RomanianVocabScheduler.isProgressDowngrade) return true;
  return RomanianVocabScheduler.isProgressDowngrade(
    existingScheduler,
    incomingScheduler,
    existingProgress,
    incomingProgress
  );
}

function normalizeRoArray(values = []) {
  const seen = new Set();
  return (Array.isArray(values) ? values : [])
    .map(value => String(value || '').trim())
    .filter(Boolean)
    .filter(value => {
      const key = value.toLocaleLowerCase('ro');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function normalizeIdArray(values = []) {
  const seen = new Set();
  return (Array.isArray(values) ? values : [])
    .map(value => Number(value))
    .filter(value => Number.isFinite(value))
    .filter(value => {
      const key = String(value);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function mergeDailyQueuePayload(localPayload, cloudPayload = null) {
  if (!cloudPayload) return localPayload;
  const completed_word_id = normalizeIdArray([
    ...(cloudPayload.completed_word_id || []),
    ...(localPayload.completed_word_id || [])
  ]);
  const completedIdKeys = new Set(completed_word_id.map(String));
  const word_id = normalizeIdArray([
    ...(cloudPayload.word_id || []),
    ...(localPayload.word_id || [])
  ]).filter(value => !completedIdKeys.has(String(value)));
  const completed = normalizeRoArray([
    ...(cloudPayload.completed_word_ro || []),
    ...(localPayload.completed_word_ro || [])
  ]);
  const completedKeys = new Set(completed.map(value => value.toLocaleLowerCase('ro')));
  const word_ro = normalizeRoArray([
    ...(cloudPayload.word_ro || []),
    ...(localPayload.word_ro || [])
  ]).filter(value => !completedKeys.has(value.toLocaleLowerCase('ro')));
  const goal = Math.max(Number(localPayload.goal || 20), Number(cloudPayload.goal || 20), 1);
  return {
    ...cloudPayload,
    ...localPayload,
    goal,
    word_id,
    word_ro,
    completed_word_id,
    completed_word_ro: completed,
    completed: !!(localPayload.completed || cloudPayload.completed),
    updated_at: localPayload.updated_at || new Date().toISOString()
  };
}

function mergeDailyLogPayload(localPayload, cloudPayload = null, completionGoal = localPayload.goal, options = {}) {
  if (!cloudPayload) return localPayload;
  const newWords = Math.max(Number(localPayload.new_words || 0), Number(cloudPayload.new_words || 0));
  const goal = Math.max(Number(localPayload.goal || 20), Number(cloudPayload.goal || 20), 1);
  const doneGoal = Math.max(Number(completionGoal || goal), 1);
  const hasLocalCompleted = typeof localPayload.completed === 'boolean';
  const hasCloudCompleted = typeof cloudPayload.completed === 'boolean';
  const completed = (hasLocalCompleted || hasCloudCompleted)
    ? !!(localPayload.completed || cloudPayload.completed)
    : newWords >= doneGoal;
  return {
    ...cloudPayload,
    ...localPayload,
    new_words: newWords,
    goal,
    completed
  };
}

// ── 词库 ──────────────────────────────────────────────────

/**
 * 从数据库加载全部词汇（自动分页，支持超过1000条）
 * @returns {Promise<Array>} 词汇数组
 */
async function apiLoadWords(options = {}) {
  const { preferCloud = false } = options;
  if (isOfflineMode()) return loadBundledWords();
  if (!preferCloud) return loadBundledWords();
  let all = [], from = 0;
  try {
    while (true) {
      const { data, error } = await withTimeout(
        sb.from('words').select('*').order('id').range(from, from + 999),
        WORDS_LOAD_TIMEOUT_MS,
        '云端词库读取超时'
      );
      if (error || !data || !data.length) break;
      all = all.concat(data);
      if (data.length < 1000) break;
      from += 1000;
    }
    if (all.length) {
      writeCachedWords(all);
      console.info(`Words loaded from cloud: ${all.length}`);
      return all;
    }
    return loadBundledWords();
  } catch (error) {
    console.warn('Cloud words load failed, falling back to bundled words', error);
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
  // Progress is keyed by stable word_id, so editing ro text no longer detaches a student's history.
  const { data, error } = await sb.from('words').update(updates).eq('id', wordId).select('id').maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.id) throw new Error('词条未保存：没有权限或词条不存在');
  updateCachedWord(wordId, updates);
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
 * @returns {Promise<object>} { word_id: { known, qr, qt, word_ro } } plus legacy:* fallback keys
 */
async function apiLoadProgress(userId) {
  if (isOfflineMode()) return markProgressSource(readLocalProgressFallback(userId), 'offline');
  let data = null;
  let error = null;
  try {
    ({ data, error } = await withTimeout(
      sb.from('progress').select('*').eq('user_id', userId),
      PROGRESS_LOAD_TIMEOUT_MS,
      '云端进度读取超时'
    ));
  } catch (loadError) {
    error = loadError;
  }
  if (error) {
    const fallback = readLocalProgressFallback(userId);
    if (Object.keys(fallback).length) return markProgressSource(fallback, 'localFallback', error.message);
    throw new Error(error.message);
  }
  const memoryBackup = readProgressMemoryBackup(userId);
  const pendingProgress = readPendingProgress(userId);
  const map = {};
  let legacyRows = 0;
  (data || []).forEach(r => {
    const progress = rowToProgress(r);
    const key = progressEntryKey(r.word_id, r.word_ro);
    if (!r.word_id) legacyRows++;
    map[key] = mergeProgressMemory(progress, memoryBackup[key] || memoryBackup[r.word_ro]);
  });
  if (legacyRows) {
    console.warn(`Loaded ${legacyRows} legacy progress row(s) without word_id; using normalized word_ro fallback until migration/backfill is complete.`);
  }
  Object.entries(pendingProgress).forEach(([key, progress]) => {
    const wordId = getProgressEntryWordId(key, progress);
    const wordRo = getProgressEntryWordRo(progress, key);
    const nextKey = progressEntryKey(wordId, wordRo) || key;
    map[nextKey] = mergeProgressMemory({ ...progress, word_id: wordId, word_ro: wordRo, pendingSync: true }, memoryBackup[nextKey] || memoryBackup[key]);
  });
  writeLocalProgressSnapshot(userId, map);
  return markProgressSource(map, Object.keys(pendingProgress).length ? 'cloudWithPending' : 'cloud');
}

async function apiRetryPendingProgress(userId, limit = PENDING_PROGRESS_RETRY_LIMIT) {
  if (isOfflineMode()) return { attempted: 0, saved: 0, failed: 0 };
  const pendingProgress = readPendingProgress(userId);
  const entries = Object.entries(pendingProgress)
    .sort((a, b) => String(a[1]?.pendingSyncAt || '').localeCompare(String(b[1]?.pendingSyncAt || '')));
  const batch = entries.slice(0, Math.max(1, Number(limit || PENDING_PROGRESS_RETRY_LIMIT)));
  let saved = 0;
  for (let i = 0; i < batch.length; i += PENDING_PROGRESS_RETRY_CONCURRENCY) {
    const chunk = batch.slice(i, i + PENDING_PROGRESS_RETRY_CONCURRENCY);
    const wordIds = chunk
      .map(([key, p]) => getProgressEntryWordId(key, p))
      .filter(Boolean);
    const { data: cloudRows, error: cloudError } = wordIds.length
      ? await sb.from('progress').select('*').eq('user_id', userId).in('word_id', wordIds)
      : { data: [], error: null };
    if (cloudError) throw new Error(cloudError.message);
    const cloudById = new Map((cloudRows || []).map(row => [String(row.word_id), row]));
    const results = await Promise.allSettled(chunk.map(async ([key, p]) => {
      const wordId = getProgressEntryWordId(key, p);
      const wordRo = getProgressEntryWordRo(p, '');
      const mergedProgress = mergeCloudProgress(p, wordId ? cloudById.get(String(wordId)) : null);
      await apiSaveProgress(
        userId,
        wordId,
        wordRo,
        !!mergedProgress.known,
        mergedProgress.qr || 0,
        mergedProgress.qt || 0,
        mergedProgress.level || 'unknown',
        {
          reviewStage: RomanianVocabScheduler.getReviewStage(mergedProgress),
          nextReviewAt: mergedProgress.nextReviewAt || mergedProgress.nextReview || new Date().toISOString(),
          dueAt: mergedProgress.dueAt || mergedProgress.nextReviewAt || mergedProgress.nextReview || new Date().toISOString(),
          intervalDays: mergedProgress.intervalDays || 0,
          memoryStrength: mergedProgress.memoryStrength || 0,
          cardState: mergedProgress.cardState || 'new',
          reps: mergedProgress.reps || 0,
          correctCount: mergedProgress.correctCount || 0,
          fuzzyCount: mergedProgress.fuzzyCount || 0,
          forgetCount: mergedProgress.forgetCount || 0,
          lapses: mergedProgress.lapses || 0,
          recentResults: mergedProgress.recentResults || [],
          needsReinforcement: !!mergedProgress.needsReinforcement,
          lastReviewedAt: mergedProgress.lastReviewedAt || new Date().toISOString()
        },
        null,
        {
          wrongCount: mergedProgress.wrongCount || 0,
          errorStreak: mergedProgress.errorStreak || 0,
          lastWrongAt: mergedProgress.lastWrongAt || null,
          weakClearedAt: mergedProgress.weakClearedAt || null
        },
        {
          pendingSyncToken: p.pendingSyncToken || p.pending_sync_token || ''
        }
      );
    }));
    const savedKeys = [];
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        saved++;
        savedKeys.push({
          key: chunk[index][0],
          pendingSyncToken: chunk[index][1]?.pendingSyncToken || chunk[index][1]?.pending_sync_token || ''
        });
      } else {
        console.warn('Pending progress retry failed', chunk[index][0], result.reason);
      }
    });
    clearPendingProgressBatch(userId, savedKeys);
  }
  const failed = batch.length - saved;
  const remaining = Math.max(0, entries.length - saved);
  return { attempted: batch.length, saved, failed, remaining, totalPending: entries.length };
}

async function apiRetryPendingDailyState(userId, limit = PENDING_DAILY_STATE_RETRY_LIMIT) {
  if (isOfflineMode()) return { attempted: 0, saved: 0, failed: 0, remaining: 0 };
  const pendingState = readPendingDailyState(userId);
  const entries = Object.entries(pendingState)
    .filter(([, state]) => state?.queue || state?.log)
    .sort((a, b) => String(a[1]?.pendingSyncAt || '').localeCompare(String(b[1]?.pendingSyncAt || '')));
  const batch = entries.slice(0, Math.max(1, Number(limit || PENDING_DAILY_STATE_RETRY_LIMIT)));
  let saved = 0;
  for (const [date, state] of batch) {
    let entrySaved = false;
    try {
      if (state.queue) {
        const queuePayload = {
          ...state.queue,
          user_id: userId,
          queue_date: date,
          word_id: normalizeIdArray(state.queue.word_id),
          word_ro: state.queue.word_ro || [],
          completed_word_id: normalizeIdArray(state.queue.completed_word_id),
          completed_word_ro: state.queue.completed_word_ro || []
        };
        const { data: cloudQueue, error: readError } = await sb.from('daily_queue')
          .select('*')
          .eq('user_id', userId)
          .eq('queue_date', date)
          .maybeSingle();
        if (readError) throw new Error(readError.message);
        const mergedQueue = mergeDailyQueuePayload(queuePayload, cloudQueue);
        await upsertDailyQueuePayload(mergedQueue);
        clearPendingDailyStatePart(userId, date, 'queue', queuePayload.sync_token || queuePayload.syncToken || '', queuePayload.updated_at || queuePayload.updatedAt || '');
        entrySaved = true;
      }
      if (state.log) {
        const logPayload = {
          ...state.log,
          user_id: userId,
          log_date: date
        };
        const { data: cloudLog, error: readError } = await withTimeout(
          sb.from('daily_log')
            .select('*')
            .eq('user_id', userId)
            .eq('log_date', date)
            .maybeSingle(),
          PROGRESS_LOAD_TIMEOUT_MS,
          '今日记录读取超时'
        );
        if (readError) throw new Error(readError.message);
        const mergedLog = mergeDailyLogPayload(logPayload, cloudLog, logPayload.goal, { completedExplicit: typeof logPayload.completed === 'boolean' });
        await upsertDailyLogPayload(mergedLog);
        clearPendingDailyStatePart(userId, date, 'log', logPayload.sync_token || logPayload.syncToken || '', logPayload.updated_at || logPayload.updatedAt || '');
        entrySaved = true;
      }
      if (entrySaved) saved++;
    } catch (error) {
      console.warn('Pending daily state retry failed', date, error);
      markPendingDailyStateError(userId, date, error);
    }
  }
  const remaining = Object.values(readPendingDailyState(userId) || {}).filter(state => state?.queue || state?.log).length;
  const failed = Math.max(0, batch.length - saved);
  return { attempted: batch.length, saved, failed, remaining, totalPending: entries.length };
}

/**
 * 加载全班学习进度（排行榜用）
 */
async function apiLoadAllProgress() {
  if (isOfflineMode()) return [];
  if (typeof sb.rpc === 'function') {
    const { data, error } = await sb.rpc('admin_load_all_progress');
    if (!error) return data || [];
    if (!isMissingRpcError(error)) throw new Error(error.message);
  }
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
 * @param {number|string} wordId - stable words.id identity
 * @param {string} wordRo - display/debug metadata only
 * @param {boolean} known
 * @param {number} qr - 答对次数
 * @param {number} qt - 总答题次数
 */
/**
 * 保存/更新一个词的学习进度（含熟练度 level）
 */
async function apiSaveProgress(userId, wordId, wordRo, known, qr, qt, level, review = {}, legacyReviewCount = null, memory = {}, options = {}) {
  if (typeof wordRo === 'boolean') {
    const legacyWordRo = String(wordId || '');
    const legacyKnown = wordRo;
    const legacyQr = known;
    const legacyQt = qr;
    const legacyLevel = qt;
    const legacyReview = level || {};
    const legacyReviewCountValue = review;
    const legacyMemory = memory || {};
    wordRo = legacyWordRo;
    wordId = null;
    known = legacyKnown;
    qr = legacyQr;
    qt = legacyQt;
    level = legacyLevel;
    review = legacyReview;
    legacyReviewCount = legacyReviewCountValue;
    memory = legacyMemory;
    options = {};
    console.warn('apiSaveProgress called without wordId; saving through legacy fallback key.');
  }
  const stableWordId = wordId !== undefined && wordId !== null && String(wordId).trim() !== '' ? Number(wordId) : null;
  const expectedPendingToken = options.pendingSyncToken || '';
  const normalized = typeof review === 'string'
    ? {
        nextReviewAt: new Date(`${review}T00:00:00`).toISOString(),
        reviewStage: legacyReviewCount || 0,
        lastReviewedAt: new Date().toISOString()
      }
    : review;
  const now = new Date().toISOString();
  const normalizedStage = RomanianVocabScheduler.getReviewStage(normalized);
  const scheduler = typeof RomanianVocabScheduler !== 'undefined'
    ? RomanianVocabScheduler.normalizeSchedulerProgress({ ...normalized, known, qr, qt, level })
    : normalized;
  const basePayload = {
    user_id: userId,
    word_id: stableWordId,
    word_ro: wordRo,
    known,
    quiz_right: qr || 0,
    quiz_total: qt || 0,
    level: level || 'unknown',
    updated_at: now
  };
  const modernPayload = {
    ...basePayload,
    review_stage: normalizedStage,
    next_review_at: normalized.nextReviewAt || now,
    last_reviewed_at: normalized.lastReviewedAt || now,
    wrong_count: memory.wrongCount || 0,
    error_streak: memory.errorStreak || 0,
    last_wrong_at: memory.lastWrongAt || null,
    weak_cleared_at: memory.weakClearedAt || null
  };
  const schedulerPayload = {
    ...modernPayload,
    card_state: scheduler.cardState || 'new',
    due_at: scheduler.dueAt || normalized.dueAt || normalized.nextReviewAt || now,
    interval_days: Number(scheduler.intervalDays || 0),
    memory_strength: Number(scheduler.memoryStrength || 0),
    reps: Number(scheduler.reps || 0),
    correct_count: Number(scheduler.correctCount || 0),
    fuzzy_count: Number(scheduler.fuzzyCount || 0),
    forget_count: Number(scheduler.forgetCount || 0),
    lapses: Number(scheduler.lapses || 0),
    recent_results: Array.isArray(scheduler.recentResults) ? scheduler.recentResults : [],
    needs_reinforcement: !!scheduler.needsReinforcement
  };
  const reviewOnlyPayload = {
    ...basePayload,
    review_stage: normalizedStage,
    next_review_at: normalized.nextReviewAt || now,
    last_reviewed_at: normalized.lastReviewedAt || now
  };
  const legacyPayload = {
    ...basePayload,
    review_count: normalizedStage,
    next_review: (normalized.nextReviewAt || now).slice(0, 10)
  };

  if (isOfflineMode()) {
    const map = readJson(localKey(userId, 'progress'), {});
    const key = progressEntryKey(stableWordId, wordRo);
    map[key] = rowToProgress({ ...schedulerPayload });
    writeJson(localKey(userId, 'progress'), map);
    const memoryBackup = writeProgressMemoryBackup(userId, stableWordId, wordRo, memory);
    return {
      savedPayload: 'offline',
      memoryBackedByDb: true,
      memoryBackup
    };
  }

  if (!stableWordId) {
    const status = queueProgressForSync(userId, null, wordRo, { ...rowToProgress(schedulerPayload), pendingSync: true }, memory);
    return {
      savedPayload: 'legacyLocalOnly',
      memoryBackedByDb: false,
      memoryBackup: status.memoryBackup,
      fallbackWarning: 'Missing word_id; progress queued locally under legacy word_ro fallback.'
    };
  }

  let { error } = await sb.from('progress').upsert(schedulerPayload, { onConflict: 'user_id,word_id' });
  if (!error) {
    clearPendingProgress(userId, stableWordId, wordRo, expectedPendingToken);
    const memoryBackup = writeProgressMemoryBackup(userId, stableWordId, wordRo, memory);
    return {
      savedPayload: 'scheduler',
      memoryBackedByDb: true,
      memoryBackup
    };
  }

  const modernError = error;
  ({ error } = await sb.from('progress').upsert(modernPayload, { onConflict: 'user_id,word_id' }));
  if (!error) {
    clearPendingProgress(userId, stableWordId, wordRo, expectedPendingToken);
    const memoryBackup = writeProgressMemoryBackup(userId, stableWordId, wordRo, memory);
    console.warn('Progress saved without scheduler columns; local scheduler fields remain in pending/local backup.', modernError);
    return {
      savedPayload: 'modern',
      memoryBackedByDb: true,
      memoryBackup,
      fallbackWarning: modernError.message
    };
  }

  const schedulerError = modernError;
  ({ error } = await sb.from('progress').upsert(reviewOnlyPayload, { onConflict: 'user_id,word_id' }));
  if (!error) {
    clearPendingProgress(userId, stableWordId, wordRo, expectedPendingToken);
    const memoryBackup = writeProgressMemoryBackup(userId, stableWordId, wordRo, memory);
    console.warn('Progress saved without wrongbook memory columns; local backup is being used.', modernError);
    return {
      savedPayload: 'reviewOnly',
      memoryBackedByDb: false,
      memoryBackup,
      fallbackWarning: schedulerError.message
    };
  }

  ({ error } = await sb.from('progress').upsert(legacyPayload, { onConflict: 'user_id,word_id' }));
  if (error) throw new Error(`${schedulerError.message}; ${error.message}`);
  clearPendingProgress(userId, stableWordId, wordRo, expectedPendingToken);
  const memoryBackup = writeProgressMemoryBackup(userId, stableWordId, wordRo, memory);
  console.warn('Progress saved with legacy review columns; wrongbook memory is local-backup only.', modernError);
  return {
    savedPayload: 'legacy',
    memoryBackedByDb: false,
    memoryBackup,
    fallbackWarning: modernError.message
  };
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
      word_id: normalizeIdArray(parsed.word_id),
      word_ro: Array.isArray(parsed.word_ro) ? parsed.word_ro : [],
      completed_word_id: normalizeIdArray(parsed.completed_word_id),
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
    word_id: normalizeIdArray(queue.word_id),
    word_ro: queue.word_ro || [],
    completed_word_id: normalizeIdArray(queue.completed_word_id),
    completed_word_ro: queue.completed_word_ro || [],
    completed: !!queue.completed
  };
  localStorage.setItem(getLocalQueueKey(userId, date), JSON.stringify(payload));
  return { user_id: userId, queue_date: date, ...payload, local: true };
}

async function apiGetDailyQueue(userId, goal) {
  const today = getQueueDateKey();
  const localQueue = readLocalQueue(userId, goal, today);
  const pendingQueue = readPendingDailyState(userId)?.[today]?.queue || null;
  const localEffectiveQueue = pendingQueue
    ? mergeDailyQueuePayload(pendingQueue, localQueue)
    : localQueue;
  if (isOfflineMode()) return localEffectiveQueue;
  try {
    const { data, error } = await withTimeout(
      sb.from('daily_queue')
        .select('*')
        .eq('user_id', userId)
        .eq('queue_date', today)
        .single(),
      PROGRESS_LOAD_TIMEOUT_MS,
      '每日队列读取超时'
    );
    if (!error && data) {
      const cloudQueue = {
        ...data,
        word_id: normalizeIdArray(data.word_id),
        word_ro: data.word_ro || [],
        completed_word_id: normalizeIdArray(data.completed_word_id),
        completed_word_ro: data.completed_word_ro || []
      };
      return localEffectiveQueue ? mergeDailyQueuePayload(localEffectiveQueue, cloudQueue) : cloudQueue;
    }
    if (error && error.code !== 'PGRST116') {
      if (localEffectiveQueue) return { ...localEffectiveQueue, syncError: error.message };
      return {
        user_id: userId,
        queue_date: today,
        goal: goal || 20,
        word_id: [],
        word_ro: [],
        completed_word_id: [],
        completed_word_ro: [],
        completed: false,
        syncError: error.message
      };
    }
  } catch {}
  return localEffectiveQueue || null;
}

async function apiSaveDailyQueue(userId, queue, options = {}) {
  const today = getQueueDateKey();
  const payload = {
    user_id: userId,
    queue_date: today,
    goal: queue.goal || 20,
    word_id: normalizeIdArray(queue.word_id),
    word_ro: queue.word_ro || [],
    completed_word_id: normalizeIdArray(queue.completed_word_id),
    completed_word_ro: queue.completed_word_ro || [],
    completed: !!queue.completed,
    updated_at: new Date().toISOString(),
    sync_token: createDailySyncToken('queue', today)
  };
  const pendingStatus = queueDailyStateForSync(userId, today, { queue: payload });
  let localWriteError = null;
  try {
    writeLocalQueue(userId, payload, today);
  } catch (error) {
    localWriteError = error;
  }
  if (isOfflineMode()) {
    return {
      ...payload,
      local: true,
      pendingSync: pendingStatus.ok,
      syncError: [localWriteError?.message, pendingStatus.ok ? '' : '本机待同步队列写入失败'].filter(Boolean).join('；') || undefined
    };
  }
  try {
    const { data: cloudQueue, error: readError } = await sb.from('daily_queue')
      .select('*')
      .eq('user_id', userId)
      .eq('queue_date', today)
      .maybeSingle();
    if (readError) return { ...payload, syncError: [readError.message, localWriteError?.message, pendingStatus.ok ? '' : '本机待同步队列写入失败'].filter(Boolean).join('；') };
    const mergedPayload = options.forceLocal ? payload : mergeDailyQueuePayload(payload, cloudQueue);
    await upsertDailyQueuePayload(mergedPayload);
    try {
      writeLocalQueue(userId, mergedPayload, today);
    } catch (error) {
      localWriteError = localWriteError || error;
    }
    clearPendingDailyStatePart(userId, today, 'queue', payload.sync_token, payload.updated_at);
    return localWriteError ? { ...mergedPayload, syncError: localWriteError.message } : mergedPayload;
  } catch (error) {
    markPendingDailyStateError(userId, today, error);
    return { ...payload, syncError: [error.message || '每日队列云端同步失败', localWriteError?.message, pendingStatus.ok ? '' : '本机待同步队列写入失败'].filter(Boolean).join('；') };
  }
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
  if (typeof sb.rpc === 'function') {
    const { error } = await sb.rpc('admin_set_user_role', { target_user_id: userId, new_role: role });
    if (!error) return;
    if (!/function .*admin_set_user_role|schema cache|not find/i.test(error.message || '')) {
      throw new Error(error.message);
    }
  }
  const { error } = await sb.from('profiles').update({ role }).eq('id', userId);
  if (error) throw new Error(error.message);
}

/**
 * 删除用户资料记录（用于拒绝待审批用户）
 */
async function apiDeleteUserProfile(userId) {
  if (isOfflineMode()) throw new Error('离线模式下无法删除用户记录');
  if (typeof sb.rpc === 'function') {
    const { data, error } = await sb.rpc('admin_delete_user_profile', { target_user_id: userId });
    if (!error) return data || 'deleted';
    if (!isMissingRpcError(error)) throw new Error(error.message);
  }
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

async function apiLoadUserWatchSettings(userIds = []) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  const local = readLocalUserWatchSettings();
  const defaults = Object.fromEntries(ids.map(id => [id, local[id] !== false]));
  if (!ids.length || isOfflineMode()) return defaults;
  const { data, error } = await sb.from('profiles').select('id,watch_enabled').in('id', ids);
  if (error) return defaults;
  (data || []).forEach(row => {
    defaults[row.id] = row.watch_enabled !== false;
  });
  return defaults;
}

async function apiSetUserWatch(userId, watched) {
  const value = watched !== false;
  writeLocalUserWatchSetting(userId, value);
  if (isOfflineMode()) return { saved: 'local' };
  const { error } = await sb.from('profiles').update({ watch_enabled: value }).eq('id', userId);
  if (error) return { saved: 'local', warning: error.message };
  return { saved: 'database' };
}

// ── 每日学习记录 ──────────────────────────────────────────

/**
 * 获取今日的学习记录，没有则创建
 */
async function apiGetTodayLog(userId, goal) {
  const today = getLocalDateKey();
  const localLogs = readJson(localKey(userId, 'daily_log'), {});
  const pendingLog = readPendingDailyState(userId)?.[today]?.log || null;
  const ensureLocalTodayLog = (extra = {}) => {
    const updatedAt = new Date().toISOString();
    const syncToken = createDailySyncToken('log', today);
    const local = localLogs[today] || {
      user_id: userId,
      log_date: today,
      new_words: 0,
      goal: goal || 20,
      completed: false,
      updated_at: updatedAt
    };
    localLogs[today] = { ...local, local: true, updated_at: local.updated_at || updatedAt, sync_token: local.sync_token || syncToken, ...extra };
    writeJson(localKey(userId, 'daily_log'), localLogs);
    queueDailyStateForSync(userId, today, { log: localLogs[today] });
    return localLogs[today];
  };
  if (isOfflineMode()) {
    return ensureLocalTodayLog();
  }
  let data = null;
  let error = null;
  try {
    ({ data, error } = await withTimeout(
      sb.from('daily_log').select('*').eq('user_id', userId).eq('log_date', today).single(),
      PROGRESS_LOAD_TIMEOUT_MS,
      '今日记录读取超时'
    ));
  } catch (loadError) {
    error = loadError;
  }
  if (data) {
    const local = pendingLog
      ? mergeDailyLogPayload(pendingLog, localLogs[today], goal, { completedExplicit: typeof pendingLog.completed === 'boolean' })
      : localLogs[today];
    if (local) {
      const merged = mergeDailyLogPayload(local, data, goal, { completedExplicit: typeof local.completed === 'boolean' });
      delete merged.syncError;
      localLogs[today] = { ...merged, local: true };
      writeJson(localKey(userId, 'daily_log'), localLogs);
      return merged;
    }
    return data;
  }
  const localFallback = pendingLog
    ? mergeDailyLogPayload(pendingLog, localLogs[today], goal, { completedExplicit: typeof pendingLog.completed === 'boolean' })
    : localLogs[today];
  if (localFallback) {
    if (error && error.code !== 'PGRST116') return { ...localFallback, syncError: error.message || localFallback.syncError };
    const { syncError, ...localToday } = localFallback;
    localLogs[today] = localToday;
    writeJson(localKey(userId, 'daily_log'), localLogs);
    return localToday;
  }
  if (error && error.code !== 'PGRST116') {
    return ensureLocalTodayLog({ syncError: error.message || '今日记录读取失败' });
  }
  // 创建今日记录
  let created = null;
  let createError = null;
  try {
    ({ data: created, error: createError } = await withTimeout(
      sb.from('daily_log')
        .insert({ user_id: userId, log_date: today, new_words: 0, goal: goal || 20, completed: false })
        .select()
        .single(),
      PROGRESS_LOAD_TIMEOUT_MS,
      '今日记录创建超时'
    ));
  } catch (error) {
    createError = error;
  }
  if (createError) return ensureLocalTodayLog({ syncError: createError.message || '今日记录创建失败' });
  return created;
}

/**
 * 更新今日完成任务数；数据库字段沿用 daily_log.new_words 以保持兼容
 */
async function apiUpdateTodayLog(userId, completedTasks, goal, completionGoal = goal, options = {}) {
  const today = getLocalDateKey();
  const completed = typeof options.completed === 'boolean' ? options.completed : completedTasks >= completionGoal;
  const logs = readJson(localKey(userId, 'daily_log'), {});
  const updatedAt = new Date().toISOString();
  const syncToken = createDailySyncToken('log', today);
  const localPayload = { user_id: userId, log_date: today, new_words: completedTasks, goal, completed, updated_at: updatedAt, sync_token: syncToken };
  const pendingStatus = queueDailyStateForSync(userId, today, { log: localPayload });
  logs[today] = { ...localPayload, local: true };
  let localWriteError = null;
  try {
    writeJson(localKey(userId, 'daily_log'), logs);
  } catch (error) {
    localWriteError = error;
  }
  if (isOfflineMode()) {
    return {
      saved: 'local',
      pendingSync: pendingStatus.ok,
      syncError: [localWriteError?.message, pendingStatus.ok ? '' : '本机待同步队列写入失败'].filter(Boolean).join('；') || undefined
    };
  }
  let cloudLog = null;
  let readError = null;
  try {
    ({ data: cloudLog, error: readError } = await withTimeout(
      sb.from('daily_log')
        .select('*')
        .eq('user_id', userId)
        .eq('log_date', today)
        .maybeSingle(),
      PROGRESS_LOAD_TIMEOUT_MS,
      '今日记录读取超时'
    ));
  } catch (error) {
    readError = error;
  }
  if (readError) return { saved: 'local', syncError: [readError.message || '今日记录读取失败', localWriteError?.message, pendingStatus.ok ? '' : '本机待同步队列写入失败'].filter(Boolean).join('；') };
  const mergedPayload = options.forceLocal
    ? localPayload
    : mergeDailyLogPayload(localPayload, cloudLog, completionGoal, { completedExplicit: typeof options.completed === 'boolean' });
  let error = null;
  try {
    await upsertDailyLogPayload(mergedPayload);
  } catch (saveError) {
    error = saveError;
  }
  if (error) return { saved: 'local', syncError: [error.message || '今日记录保存失败', localWriteError?.message, pendingStatus.ok ? '' : '本机待同步队列写入失败'].filter(Boolean).join('；') };
  logs[today] = mergedPayload;
  try {
    writeJson(localKey(userId, 'daily_log'), logs);
  } catch (error) {
    localWriteError = localWriteError || error;
  }
  clearPendingDailyStatePart(userId, today, 'log', localPayload.sync_token, localPayload.updated_at);
  return localWriteError
    ? { saved: 'database', syncError: localWriteError.message }
    : { saved: 'database' };
}

/**
 * 获取最近N天的学习记录
 */
async function apiGetRecentLogs(userId, days = 14) {
  const localLogs = Object.values(readJson(localKey(userId, 'daily_log'), {}));
  const pendingLogs = Object.values(readPendingDailyState(userId) || {})
    .map(entry => entry?.log)
    .filter(Boolean);
  const localMerged = [...localLogs, ...pendingLogs].reduce((map, log) => {
    if (!log?.log_date) return map;
    map[log.log_date] = mergeDailyLogPayload(log, map[log.log_date] || null, log.goal, { completedExplicit: typeof log.completed === 'boolean' });
    return map;
  }, {});
  if (isOfflineMode()) {
    return Object.values(localMerged)
      .sort((a, b) => String(b.log_date).localeCompare(String(a.log_date)))
      .slice(0, days);
  }
  const { data } = await sb.from('daily_log').select('*')
    .eq('user_id', userId)
    .order('log_date', { ascending: false })
    .limit(days);
  const merged = {};
  (data || []).forEach(log => {
    if (log?.log_date) merged[log.log_date] = log;
  });
  Object.values(localMerged).forEach(log => {
    if (!log?.log_date) return;
    merged[log.log_date] = mergeDailyLogPayload(log, merged[log.log_date] || null, log.goal, { completedExplicit: typeof log.completed === 'boolean' });
  });
  return Object.values(merged)
    .sort((a, b) => String(b.log_date).localeCompare(String(a.log_date)))
    .slice(0, days);
}

/**
 * 加载最近N天的全班学习记录（排行榜连 streak 用）
 */
async function apiGetClassRecentLogs(days = 30) {
  if (isOfflineMode()) return apiGetRecentLogs(OFFLINE_USER_ID, days);
  if (typeof sb.rpc === 'function') {
    const { data, error } = await sb.rpc('admin_get_class_recent_logs', { days_count: days });
    if (!error) return data || [];
    if (!isMissingRpcError(error)) throw new Error(error.message);
  }
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
