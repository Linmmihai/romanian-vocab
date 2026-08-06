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
  ? supabase.createClient(SUPA_URL, SUPA_KEY, {
      // Every write that may be replayed has its own explicit idempotency
      // protocol. Disable opaque PostgREST POST retries so a timed-out legacy
      // write can never arrive after a newer request.
      db: { retry: false }
    })
  : createUnavailableSupabaseClient();

const OFFLINE_USER_ID = 'local-offline-user';
const API_DEFAULT_DAILY_GOAL = 200;
const OFFLINE_PROFILE = {
  id: OFFLINE_USER_ID,
  email: 'offline@local.app',
  nickname: '本机学习',
  role: 'user',
  daily_goal: API_DEFAULT_DAILY_GOAL,
  offline: true
};
const PROGRESS_LOAD_TIMEOUT_MS = 3500;
const PROGRESS_SAVE_TIMEOUT_MS = 8000;
const DAILY_STATE_TIMEOUT_MS = 12000;
const PROGRESS_PAGE_SIZE = 500;
const WORDS_LOAD_TIMEOUT_MS = 3500;
const BUNDLED_WORDS_LOAD_TIMEOUT_MS = 6000;
// v3 invalidates caches created before online users became cloud-first. Those
// caches can contain deleted word IDs that violate progress.word_id's FK.
const VOCAB_DATA_VERSION = '20260726-phrase-curation-v1';
const LEGACY_WORDS_CACHE_PREFIX = 'words_cache:';
const PENDING_PROGRESS_RETRY_LIMIT = 25;
const PENDING_PROGRESS_RETRY_CONCURRENCY = 5;
const PENDING_DAILY_STATE_RETRY_LIMIT = 10;

function apiNormalizedRoKey(value) {
  return String(value || '').normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ro');
}

function apiNormalizeVocabularyWord(word = {}) {
  const base = {
    ...word,
    zh: String(word.zh || '').normalize('NFC').trim(),
    ro: String(word.ro || '').normalize('NFC').trim().replace(/\s+/g, ' '),
    ipa: String(word.ipa || '').normalize('NFC').trim(),
    hint: String(word.hint || '').normalize('NFC').trim(),
    example_ro: String(word.example_ro || word.exampleRo || '').normalize('NFC').trim(),
    example_zh: String(word.example_zh || word.exampleZh || '').normalize('NFC').trim()
  };
  const taxonomy = window.RomanianVocabTaxonomy;
  const normalized = taxonomy?.normalizeWord ? taxonomy.normalizeWord(base) : base;
  return {
    ...normalized,
    cat: normalized.topic || base.topic || base.cat || 'unclassified',
    grammar_data: normalized.grammar_data || base.grammar_data || {},
    verification_status: normalized.verification_status || base.verification_status || 'needs_review',
    source: normalized.source || base.source || 'admin_submission'
  };
}

function apiValidateVocabularyWord(word, options = {}) {
  const taxonomy = window.RomanianVocabTaxonomy;
  const problems = [];
  const exampleOnly = options.allowExampleOnly && !word.zh && !!word.example_ro;
  if (!word.ro) problems.push('缺少罗马尼亚语');
  if (!exampleOnly && !word.zh) problems.push('缺少中文');
  if (/[\u3400-\u9fff]/u.test(word.ro)) problems.push('罗语字段包含中文');
  if (taxonomy?.looksLikeTemplateWord?.(word)) problems.push('检测到表头或模板内容');
  if (!exampleOnly && word.topic === 'unclassified') problems.push('缺少明确主题');
  if (!exampleOnly && word.part_of_speech === 'other') problems.push('缺少明确词性');
  if (!exampleOnly && !word.unit_type) problems.push('缺少词汇单位');
  if (word.example_ro && !word.example_zh) problems.push('罗语例句缺少中文翻译');
  if (word.example_zh && !word.example_ro) problems.push('中文例句缺少罗语原句');
  return problems;
}

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

async function withTimeout(request, ms, message) {
  if (request && typeof request.abortSignal === 'function') {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    try {
      return await request.abortSignal(controller.signal);
    } catch (error) {
      if (error?.name === 'AbortError' || controller.signal.aborted) throw new Error(message);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([request, timeout]).finally(() => clearTimeout(timer));
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

function isLocalStorageQuotaError(error) {
  return error?.name === 'QuotaExceededError' || error?.code === 22 || error?.code === 1014;
}

function removeOversizedVocabularyCaches() {
  const obsoleteKeys = [];
  try {
    for (let index = 0; index < Number(localStorage.length || 0); index++) {
      const key = localStorage.key(index);
      if (key?.startsWith(LEGACY_WORDS_CACHE_PREFIX)) obsoleteKeys.push(key);
    }
    obsoleteKeys.forEach(key => localStorage.removeItem(key));
  } catch (error) {
    console.warn('Legacy vocabulary cache cleanup failed', error);
  }
  return obsoleteKeys.length;
}

function criticalStorageUserId(key) {
  const prefixes = [
    'daily_state_pending:',
    'progress_pending:',
    'daily_state_event:',
    'progress_pending_event:',
    'daily_queue:',
    'daily_log:'
  ];
  const prefix = prefixes.find(candidate => String(key || '').startsWith(candidate));
  if (!prefix) return '';
  return String(key).slice(prefix.length).split(':')[0];
}

function writeLocalStorageString(key, value) {
  try {
    localStorage.setItem(key, value);
    return;
  } catch (error) {
    if (!isLocalStorageQuotaError(error)) throw error;
  }

  // Vocabulary is already available through the service-worker Cache Storage.
  // Old releases also copied the 4.5 MB JSON file into localStorage (roughly
  // twice that size as UTF-16), starving the durable sync outbox.
  removeOversizedVocabularyCaches();
  try {
    localStorage.setItem(key, value);
    return;
  } catch (error) {
    if (!isLocalStorageQuotaError(error)) throw error;
    const userId = criticalStorageUserId(key);
    if (!userId || userId === OFFLINE_USER_ID || key === localKey(userId, 'progress')) throw error;
    // For an online user the full progress snapshot is a rebuildable cloud
    // mirror. Preserve pending events first if storage is still exhausted.
    try { localStorage.removeItem(localKey(userId, 'progress')); } catch {}
    localStorage.setItem(key, value);
  }
}

function writeJson(key, value) {
  try {
    writeLocalStorageString(key, JSON.stringify(value));
  } catch (error) {
    console.warn('Local storage write failed', key, error);
    throw error;
  }
  return value;
}

// Reclaim space before authentication or startup sync attempts any writes.
removeOversizedVocabularyCaches();

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

function dailyStateEventPrefix(userId) {
  return `daily_state_event:${userId || OFFLINE_USER_ID}:`;
}

function progressEventJournalPrefix(userId) {
  return `progress_pending_event:${userId || OFFLINE_USER_ID}:`;
}

const DAILY_SYNC_CLIENT_ID = globalThis.crypto?.randomUUID
  ? `daily-${globalThis.crypto.randomUUID()}`
  : `daily-${Date.now()}-${Math.random().toString(36).slice(2)}`;
let dailySyncClientSequence = 0;
const dailyStateSyncChains = new Map();

function storageValuesWithPrefix(prefix) {
  const values = [];
  try {
    for (let index = 0; index < Number(localStorage.length || 0); index++) {
      const key = localStorage.key(index);
      if (!key || !key.startsWith(prefix)) continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      try { values.push(JSON.parse(raw)); } catch {}
    }
  } catch {}
  return values;
}

function normalizeDailyQueueSyncState(queue = {}) {
  return {
    goal: Math.max(1, Number(queue.goal || API_DEFAULT_DAILY_GOAL)),
    word_id: normalizeIdArray(queue.word_id),
    word_ro: normalizeRoArray(queue.word_ro || []),
    completed_word_id: normalizeIdArray(queue.completed_word_id),
    completed_word_ro: normalizeRoArray(queue.completed_word_ro || []),
    introduced_word_id: normalizeIdArray(queue.introduced_word_id),
    introduced_word_ro: normalizeRoArray(queue.introduced_word_ro || []),
    completed: !!queue.completed
  };
}

function normalizeDailyLogSyncState(log = {}) {
  return {
    new_words: Math.max(0, Number(log.new_words || 0)),
    goal: Math.max(1, Number(log.goal || API_DEFAULT_DAILY_GOAL)),
    completed: !!log.completed
  };
}

function createDailyStateEvent(userId, date, part, basePayload, targetPayload) {
  const nextSequence = dailySyncClientSequence + 1;
  const eventId = createDailySyncToken('daily', date);
  const event = {
    eventId,
    userId,
    date,
    clientId: DAILY_SYNC_CLIENT_ID,
    clientSeq: nextSequence,
    parts: [part],
    base: {
      [part]: part === 'queue'
        ? normalizeDailyQueueSyncState(basePayload || {})
        : normalizeDailyLogSyncState(basePayload || {})
    },
    target: {
      [part]: part === 'queue'
        ? normalizeDailyQueueSyncState(targetPayload || {})
        : normalizeDailyLogSyncState(targetPayload || {})
    },
    tokens: {
      [part]: targetPayload?.sync_token || targetPayload?.syncToken || eventId
    },
    targetUpdatedAt: {
      [part]: targetPayload?.updated_at || targetPayload?.updatedAt || new Date().toISOString()
    },
    createdAt: new Date().toISOString(),
    attempts: 0
  };
  try {
    writeLocalStorageString(`${dailyStateEventPrefix(userId)}${eventId}`, JSON.stringify(event));
    dailySyncClientSequence = nextSequence;
    return { ok: true, event };
  } catch (error) {
    return { ok: false, error };
  }
}

function readPendingDailyEvents(userId) {
  return storageValuesWithPrefix(dailyStateEventPrefix(userId))
    .filter(event => event?.eventId && event?.date)
    .sort((left, right) => {
      if (left.clientId === right.clientId) return Number(left.clientSeq || 0) - Number(right.clientSeq || 0);
      return String(left.createdAt || '').localeCompare(String(right.createdAt || ''));
    });
}

function updatePendingDailyEvent(userId, event, patch = {}) {
  if (!event?.eventId) return;
  try {
    writeLocalStorageString(
      `${dailyStateEventPrefix(userId)}${event.eventId}`,
      JSON.stringify({ ...event, ...patch })
    );
  } catch {}
}

function clearPendingDailyEvent(userId, eventId) {
  try { localStorage.removeItem(`${dailyStateEventPrefix(userId)}${eventId}`); } catch {}
}

function writeProgressEventJournal(userId, wordId, wordRo, event, pendingProgress = {}, memory = {}) {
  if (!event?.eventId) return { ok: false, error: new Error('Missing progress event id') };
  const { pendingEvents: _embeddedEvents, ...pendingSnapshot } = pendingProgress || {};
  const record = {
    userId,
    wordId: wordId !== null && wordId !== undefined ? Number(wordId) : null,
    wordRo: wordRo || '',
    event,
    // Keep one event per storage key. Embedding the aggregate event array here
    // grows quadratically and can resurrect an already-confirmed event after a
    // different tab clears its journal record.
    pendingProgress: pendingSnapshot,
    memory,
    createdAt: event.occurredAt || new Date().toISOString()
  };
  try {
    writeLocalStorageString(`${progressEventJournalPrefix(userId)}${event.eventId}`, JSON.stringify(record));
    return { ok: true, record };
  } catch (error) {
    return { ok: false, error };
  }
}

function readProgressEventJournal(userId) {
  return storageValuesWithPrefix(progressEventJournalPrefix(userId))
    .filter(record => record?.event?.eventId)
    .sort((left, right) => String(left.createdAt || '').localeCompare(String(right.createdAt || '')));
}

function clearProgressEventJournal(userId, eventId) {
  try { localStorage.removeItem(`${progressEventJournalPrefix(userId)}${eventId}`); } catch {}
}

function applyIdArrayDelta(currentValues = [], baseValues = [], targetValues = []) {
  const current = normalizeIdArray(currentValues);
  const base = new Set(normalizeIdArray(baseValues).map(String));
  const target = normalizeIdArray(targetValues);
  const targetKeys = new Set(target.map(String));
  const removals = new Set([...base].filter(key => !targetKeys.has(key)));
  return normalizeIdArray([
    ...target,
    ...current.filter(value => !removals.has(String(value)))
  ]);
}

function applyRoArrayDelta(currentValues = [], baseValues = [], targetValues = []) {
  const current = normalizeRoArray(currentValues);
  const base = new Set(normalizeRoArray(baseValues).map(normalizeProgressWordRoKey));
  const target = normalizeRoArray(targetValues);
  const targetKeys = new Set(target.map(normalizeProgressWordRoKey));
  const removals = new Set([...base].filter(key => !targetKeys.has(key)));
  return normalizeRoArray([
    ...target,
    ...current.filter(value => !removals.has(normalizeProgressWordRoKey(value)))
  ]);
}

function applyDailyQueueEventLocally(currentPayload = {}, basePayload = {}, targetPayload = {}) {
  const current = normalizeDailyQueueSyncState(currentPayload);
  const base = normalizeDailyQueueSyncState(basePayload);
  const target = normalizeDailyQueueSyncState(targetPayload);
  const completed_word_id = applyIdArrayDelta(current.completed_word_id, base.completed_word_id, target.completed_word_id);
  const completed_word_ro = applyRoArrayDelta(current.completed_word_ro, base.completed_word_ro, target.completed_word_ro);
  const completedIdKeys = new Set(completed_word_id.map(String));
  const completedRoKeys = new Set(completed_word_ro.map(normalizeProgressWordRoKey));
  const word_id = applyIdArrayDelta(current.word_id, base.word_id, target.word_id)
    .filter(value => !completedIdKeys.has(String(value)));
  const word_ro = applyRoArrayDelta(current.word_ro, base.word_ro, target.word_ro)
    .filter(value => !completedRoKeys.has(normalizeProgressWordRoKey(value)));
  const goalChanged = Number(target.goal) !== Number(base.goal);
  const completedChanged = target.completed !== base.completed;
  return {
    ...currentPayload,
    ...current,
    goal: goalChanged ? target.goal : current.goal,
    word_id,
    word_ro,
    completed_word_id,
    completed_word_ro,
    introduced_word_id: applyIdArrayDelta(current.introduced_word_id, base.introduced_word_id, target.introduced_word_id),
    introduced_word_ro: applyRoArrayDelta(current.introduced_word_ro, base.introduced_word_ro, target.introduced_word_ro),
    completed: completedChanged ? target.completed : current.completed
  };
}

function applyDailyLogEventLocally(currentPayload = {}, basePayload = {}, targetPayload = {}) {
  const current = normalizeDailyLogSyncState(currentPayload);
  const base = normalizeDailyLogSyncState(basePayload);
  const target = normalizeDailyLogSyncState(targetPayload);
  const countDelta = target.new_words - base.new_words;
  return {
    ...currentPayload,
    ...current,
    new_words: Math.max(0, current.new_words + countDelta),
    goal: target.goal !== base.goal ? target.goal : current.goal,
    completed: target.completed !== base.completed ? target.completed : current.completed
  };
}

function applyPendingDailyEventsToState(userId, date, cloudQueue = null, cloudLog = null) {
  let queue = cloudQueue;
  let log = cloudLog;
  readPendingDailyEvents(userId)
    .filter(event => event.date === date)
    .forEach(event => {
      if (event.target?.queue) queue = applyDailyQueueEventLocally(queue || event.base?.queue || {}, event.base?.queue || {}, event.target.queue);
      if (event.target?.log) log = applyDailyLogEventLocally(log || event.base?.log || {}, event.base?.log || {}, event.target.log);
    });
  return { queue, log };
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

function resolveCurrentWordForProgress(key, progress = {}) {
  const storedWordRo = getProgressEntryWordRo(progress, String(key || '').replace(/^legacy:/, ''));
  const currentWord = typeof getWordByRo === 'function' ? getWordByRo(storedWordRo) : null;
  return {
    wordId: currentWord?.id ?? getProgressEntryWordId(key, progress),
    wordRo: currentWord?.ro || storedWordRo
  };
}

function readProgressMemoryBackup(userId) {
  return readJson(progressMemoryKey(userId), {});
}

function readPendingProgress(userId) {
  const pending = readJson(progressPendingKey(userId), {});
  for (const record of readProgressEventJournal(userId)) {
    const key = progressEntryKey(record.wordId, record.wordRo);
    if (!key) continue;
    const existing = pending[key] || {};
    const events = [...(Array.isArray(existing.pendingEvents) ? existing.pendingEvents : [])];
    if (!events.some(event => event?.eventId === record.event.eventId)) events.push(record.event);
    pending[key] = {
      ...existing,
      ...(record.pendingProgress || {}),
      word_id: record.wordId,
      word_ro: record.wordRo,
      pendingSync: true,
      pendingSyncAt: existing.pendingSyncAt || record.createdAt,
      pendingSyncToken: existing.pendingSyncToken || createProgressSyncToken(key),
      pendingEvents: events
    };
  }
  return pending;
}

function readPendingDailyState(userId) {
  return readJson(dailyStatePendingKey(userId), {});
}

function hasPendingDailyState(userId) {
  return readPendingDailyEvents(userId).length > 0 ||
    Object.values(readPendingDailyState(userId) || {}).some(entry => entry?.queue || entry?.log);
}

function apiGetPendingSyncSummary(userId) {
  const pendingProgress = readPendingProgress(userId);
  const pendingDaily = readPendingDailyState(userId);
  const pendingDailyEvents = readPendingDailyEvents(userId);
  const dailyEntries = Object.values(pendingDaily || {}).filter(entry => entry?.queue || entry?.log);
  const legacyDailyCount = dailyEntries.reduce((count, entry) => {
    return count + (entry?.queue ? 1 : 0) + (entry?.log ? 1 : 0);
  }, 0);
  const dailyCount = pendingDailyEvents.length || legacyDailyCount;
  const timestamps = [
    ...Object.values(pendingProgress || {}).map(entry => entry?.pendingSyncAt),
    ...dailyEntries.map(entry => entry?.pendingSyncAt),
    ...pendingDailyEvents.map(event => event?.createdAt)
  ].filter(Boolean).sort();
  const errors = [...dailyEntries, ...pendingDailyEvents]
    .map(entry => entry?.lastError)
    .filter(Boolean);
  const lastError = errors.length ? errors[errors.length - 1] : '';
  const progressCount = Object.keys(pendingProgress || {}).length;
  return {
    progressCount,
    dailyCount,
    dailyDateCount: new Set([
      ...Object.keys(pendingDaily || {}).filter(date => pendingDaily[date]?.queue || pendingDaily[date]?.log),
      ...pendingDailyEvents.map(event => event.date)
    ]).size,
    totalCount: progressCount + dailyCount,
    oldestPendingAt: timestamps[0] || null,
    lastError
  };
}

function createDailySyncToken(part, date) {
  return `${part}:${date}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

function createProgressSyncToken(key) {
  return `progress:${key}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

function createProgressEventId(key = '') {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${String(key || 'progress')}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

function normalizeProgressIso(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function progressSyncSnapshot(progress = {}) {
  const scheduler = typeof RomanianVocabScheduler !== 'undefined'
    ? RomanianVocabScheduler.normalizeSchedulerProgress(progress || {})
    : (progress || {});
  const reviewStage = typeof RomanianVocabScheduler !== 'undefined'
    ? RomanianVocabScheduler.getReviewStage(progress || {})
    : Number(progress.reviewStage || progress.review_stage || progress.reviewCount || progress.review_count || 0);
  return {
    seen: !!progress.seen,
    seenViaCard: !!(progress.seenViaCard ?? progress.seen_via_card),
    known: !!progress.known,
    qr: Math.max(0, Number(progress.qr ?? progress.quiz_right ?? 0) || 0),
    qt: Math.max(0, Number(progress.qt ?? progress.quiz_total ?? 0) || 0),
    grammarQr: Math.max(0, Number(progress.grammarQr ?? progress.grammar_qr ?? 0) || 0),
    grammarQt: Math.max(0, Number(progress.grammarQt ?? progress.grammar_qt ?? 0) || 0),
    level: progress.level || 'unknown',
    reviewStage: Math.max(0, Number(reviewStage || 0)),
    nextReviewAt: normalizeProgressIso(progress.nextReviewAt || progress.next_review_at || progress.nextReview),
    lastReviewedAt: normalizeProgressIso(progress.lastReviewedAt || progress.last_reviewed_at || scheduler.lastReviewedAt),
    wasMasteredAt: normalizeProgressIso(progress.wasMasteredAt || progress.was_mastered_at),
    wrongCount: Math.max(0, Number(progress.wrongCount ?? progress.wrong_count ?? 0) || 0),
    errorStreak: Math.max(0, Number(progress.errorStreak ?? progress.error_streak ?? 0) || 0),
    correctStreakSinceWrong: Math.max(0, Number(progress.correctStreakSinceWrong ?? progress.correct_streak_since_wrong ?? 0) || 0),
    lastWrongAt: normalizeProgressIso(progress.lastWrongAt || progress.last_wrong_at),
    weakClearedAt: normalizeProgressIso(progress.weakClearedAt || progress.weak_cleared_at),
    cardState: scheduler.cardState || progress.cardState || progress.card_state || 'new',
    dueAt: normalizeProgressIso(scheduler.dueAt || progress.dueAt || progress.due_at || progress.nextReviewAt),
    intervalDays: Math.max(0, Number(scheduler.intervalDays ?? progress.intervalDays ?? progress.interval_days ?? 0) || 0),
    memoryStrength: Math.max(0, Number(scheduler.memoryStrength ?? progress.memoryStrength ?? progress.memory_strength ?? 0) || 0),
    reps: Math.max(0, Number(scheduler.reps ?? progress.reps ?? 0) || 0),
    correctCount: Math.max(0, Number(scheduler.correctCount ?? progress.correctCount ?? progress.correct_count ?? 0) || 0),
    fuzzyCount: Math.max(0, Number(scheduler.fuzzyCount ?? progress.fuzzyCount ?? progress.fuzzy_count ?? 0) || 0),
    forgetCount: Math.max(0, Number(scheduler.forgetCount ?? progress.forgetCount ?? progress.forget_count ?? 0) || 0),
    lapses: Math.max(0, Number(scheduler.lapses ?? progress.lapses ?? 0) || 0),
    recentResults: Array.isArray(scheduler.recentResults)
      ? scheduler.recentResults.map(String).filter(Boolean).slice(-5)
      : [],
    needsReinforcement: !!(scheduler.needsReinforcement ?? progress.needsReinforcement ?? progress.needs_reinforcement)
  };
}

function createProgressPendingEvent(key, baseProgress = {}, targetProgress = {}, options = {}) {
  return {
    eventId: options.eventId || createProgressEventId(key),
    occurredAt: options.occurredAt || new Date().toISOString(),
    correction: !!options.correction,
    base: progressSyncSnapshot(baseProgress),
    target: progressSyncSnapshot(targetProgress)
  };
}

function appendProgressPendingEvent(existing = {}, event) {
  const prior = Array.isArray(existing?.pendingEvents) ? existing.pendingEvents : [];
  return [...prior, event];
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
    map[nextKey] = mergeStoredProgress(map[nextKey], { ...(progress || {}), word_id: wordId, word_ro: wordRo }, memoryBackup[nextKey] || memoryBackup[key]);
  });
  Object.entries(pendingProgress).forEach(([key, progress]) => {
    const wordId = getProgressEntryWordId(key, progress);
    const wordRo = getProgressEntryWordRo(progress, key);
    const nextKey = progressEntryKey(wordId, wordRo) || key;
    if (progress?.pendingDelete) {
      delete map[nextKey];
    } else if (progress?.pendingCorrection) {
      map[nextKey] = mergeStoredProgress(null, { ...(progress || {}), word_id: wordId, word_ro: wordRo, pendingSync: true }, memoryBackup[nextKey] || memoryBackup[key]);
    } else {
      map[nextKey] = mergeStoredProgress(map[nextKey], { ...(progress || {}), word_id: wordId, word_ro: wordRo, pendingSync: true }, memoryBackup[nextKey] || memoryBackup[key]);
    }
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
    snapshot[nextKey] = mergeStoredProgress(snapshot[nextKey], { ...(progress || {}), word_id: wordId, word_ro: wordRo });
    delete snapshot[nextKey].pendingSync;
  });
  try {
    writeJson(localKey(userId, 'progress'), snapshot);
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}

function writePendingProgress(userId, wordId, wordRo, progress = {}, baseProgress = null, options = {}) {
  const key = progressEntryKey(wordId, wordRo);
  if (!key) return { ok: true, skipped: true };
  const pending = readPendingProgress(userId);
  const localProgress = readJson(localKey(userId, 'progress'), {});
  const existing = pending[key] || {};
  const merged = mergeCloudProgress(progress || {}, pending[key] || localProgress[key] || null);
  const event = createProgressPendingEvent(
    key,
    baseProgress || pending[key] || localProgress[key] || {},
    progress || {},
    options
  );
  const pendingEntry = {
    ...merged,
    word_id: getProgressEntryWordId(key, progress),
    word_ro: wordRo || progress?.word_ro || progress?.wordRo || '',
    pendingSync: true,
    pendingSyncAt: new Date().toISOString(),
    pendingSyncToken: createProgressSyncToken(key),
    pendingCorrection: false,
    pendingDelete: false,
    pendingEvents: appendProgressPendingEvent(existing, event)
  };
  const journalStatus = writeProgressEventJournal(userId, getProgressEntryWordId(key, progress), wordRo, event, pendingEntry);
  if (!journalStatus.ok) return journalStatus;
  pending[key] = pendingEntry;
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

function queueProgressForSync(userId, wordId, wordRo, progress = {}, memory = {}, baseProgress = null, options = {}) {
  const pendingStatus = writePendingProgress(userId, wordId, wordRo, progress, baseProgress, options);
  const localStatus = pendingStatus.ok
    ? writeLocalProgressEntry(userId, wordId, wordRo, progress)
    : { ok: false, skipped: true, error: pendingStatus.error };
  const memoryBackup = pendingStatus.ok
    ? writeProgressMemoryBackup(userId, wordId, wordRo, memory)
    : { ok: false, skipped: true, error: pendingStatus.error };
  return {
    // The event queue is the durable source of truth. If the redundant local
    // snapshot is full, the pending event still survives and will be replayed.
    ok: pendingStatus.ok,
    localStatus,
    pendingStatus,
    memoryBackup
  };
}

function queueProgressCorrectionForSync(userId, wordId, wordRo, progress = null, memory = {}) {
  const key = progressEntryKey(wordId, wordRo);
  if (!userId || !key) return { ok: false, error: new Error('Missing progress identity') };
  const localProgress = readJson(localKey(userId, 'progress'), {});
  const pendingProgress = readPendingProgress(userId);
  const resolvedWordId = getProgressEntryWordId(key, progress || { word_id: wordId });
  const resolvedWordRo = wordRo || progress?.word_ro || progress?.wordRo || '';
  const now = new Date().toISOString();
  const previousProgress = pendingProgress[key] || localProgress[key] || {};
  if (progress) {
    const correctionEvent = createProgressPendingEvent(key, previousProgress, progress, { correction: true });
    localProgress[key] = {
      ...progress,
      word_id: resolvedWordId,
      word_ro: resolvedWordRo,
      wordId: resolvedWordId,
      wordRo: resolvedWordRo
    };
    delete localProgress[key].pendingSync;
    pendingProgress[key] = {
      ...localProgress[key],
      pendingSync: true,
      pendingSyncAt: now,
      pendingSyncToken: createProgressSyncToken(key),
      pendingCorrection: true,
      pendingDelete: false,
      pendingEvents: appendProgressPendingEvent(previousProgress, correctionEvent)
    };
  } else {
    const correctionEvent = createProgressPendingEvent(key, previousProgress, {}, { correction: true });
    delete localProgress[key];
    pendingProgress[key] = {
      word_id: resolvedWordId,
      word_ro: resolvedWordRo,
      pendingSync: true,
      pendingSyncAt: now,
      pendingSyncToken: createProgressSyncToken(key),
      pendingCorrection: true,
      pendingDelete: true,
      pendingEvents: appendProgressPendingEvent(previousProgress, correctionEvent)
    };
  }
  const correctionEvent = pendingProgress[key]?.pendingEvents?.[pendingProgress[key].pendingEvents.length - 1];
  const journalStatus = writeProgressEventJournal(
    userId,
    resolvedWordId,
    resolvedWordRo,
    correctionEvent,
    pendingProgress[key],
    memory
  );
  if (!journalStatus.ok) return journalStatus;
  try {
    writeJson(progressPendingKey(userId), pendingProgress);
  } catch (error) {
    return { ok: false, error };
  }
  let localStatus = { ok: true };
  try {
    writeJson(localKey(userId, 'progress'), localProgress);
  } catch (error) {
    localStatus = { ok: false, error };
  }
  const memoryBackup = writeProgressMemoryBackup(userId, resolvedWordId, resolvedWordRo, progress ? memory : {});
  return { ok: true, localStatus, memoryBackup };
}

function queueProgressBatchForSync(userId, entries = []) {
  const validEntries = (entries || []).filter(entry => progressEntryKey(entry?.wordId ?? entry?.word_id, entry?.wordRo ?? entry?.word_ro));
  if (!userId || !validEntries.length) return { ok: true, skipped: true };
  try {
    const localProgress = readJson(localKey(userId, 'progress'), {});
    const pendingProgress = readPendingProgress(userId);
    const memoryBackup = readProgressMemoryBackup(userId);
    const backedUpAt = new Date().toISOString();

    validEntries.forEach(({ wordId, wordRo, progress = {}, memory = {}, baseProgress = null, pendingEvents = null }) => {
      const key = progressEntryKey(wordId ?? progress?.word_id ?? progress?.wordId, wordRo ?? progress?.word_ro ?? progress?.wordRo);
      const existing = pendingProgress[key] || {};
      const merged = mergeCloudProgress(progress || {}, pendingProgress[key] || localProgress[key] || null);
      const newEvents = Array.isArray(pendingEvents) && pendingEvents.length
        ? pendingEvents
        : [createProgressPendingEvent(key, baseProgress || pendingProgress[key] || localProgress[key] || {}, progress || {})];
      localProgress[key] = { ...merged, word_id: getProgressEntryWordId(key, progress), word_ro: wordRo || progress?.word_ro || progress?.wordRo || '' };
      delete localProgress[key].pendingSync;
      pendingProgress[key] = {
        ...merged,
        word_id: getProgressEntryWordId(key, progress),
        word_ro: wordRo || progress?.word_ro || progress?.wordRo || '',
        pendingSync: true,
        pendingSyncAt: progress?.pendingSyncAt || backedUpAt,
        pendingSyncToken: createProgressSyncToken(key),
        pendingCorrection: false,
        pendingDelete: false,
        pendingEvents: [...(Array.isArray(existing.pendingEvents) ? existing.pendingEvents : []), ...newEvents]
      };
      for (const event of newEvents) {
        const journalStatus = writeProgressEventJournal(
          userId,
          getProgressEntryWordId(key, progress),
          wordRo || progress?.word_ro || progress?.wordRo || '',
          event,
          pendingProgress[key],
          memory
        );
        if (!journalStatus.ok) throw journalStatus.error;
      }

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
    writeJson(progressPendingKey(userId), pendingProgress);
    let localError = null;
    let memoryError = null;
    try { writeJson(localKey(userId, 'progress'), localProgress); } catch (error) { localError = error; }
    try { writeJson(progressMemoryKey(userId), prunedMemory); } catch (error) { memoryError = error; }
    return { ok: true, saved: validEntries.length, localError, memoryError };
  } catch (error) {
    return { ok: false, error };
  }
}

function writePendingProgressBatch(userId, entries = []) {
  if (!entries.length) return { ok: true, skipped: true };
  try {
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
      const existing = pending[key] || {};
      const baseProgress = pending[key] || localProgress[key] || {};
      const merged = mergeCloudProgress(progress || {}, baseProgress || null);
      const event = createProgressPendingEvent(key, baseProgress, progress || {});
      const pendingEntry = {
        ...merged,
        word_id: getProgressEntryWordId(key, progress),
        word_ro: wordRo || progress?.word_ro || progress?.wordRo || '',
        pendingSync: true,
        pendingSyncAt: progress?.pendingSyncAt || now,
        pendingSyncToken: createProgressSyncToken(key),
        pendingCorrection: false,
        pendingDelete: false,
        pendingEvents: appendProgressPendingEvent(existing, event)
      };
      const journalStatus = writeProgressEventJournal(
        userId,
        getProgressEntryWordId(key, progress),
        wordRo || progress?.word_ro || progress?.wordRo || '',
        event,
        pendingEntry
      );
      if (!journalStatus.ok) throw journalStatus.error;
      pending[key] = pendingEntry;
    });
    writeJson(progressPendingKey(userId), pending);
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}

function clearPendingProgress(userId, wordId, wordRo, expectedToken = '') {
  const key = progressEntryKey(wordId, wordRo);
  if (!key) return false;
  const pending = readPendingProgress(userId);
  if (!(key in pending)) return true;
  const currentToken = pending[key]?.pendingSyncToken || pending[key]?.pending_sync_token || '';
  if (expectedToken && currentToken && currentToken !== expectedToken) return false;
  delete pending[key];
  try {
    writeJson(progressPendingKey(userId), pending);
    return true;
  } catch {
    return false;
  }
}

function writeAuthoritativeProgressEntry(userId, wordId, wordRo, cloudRow) {
  const key = progressEntryKey(wordId, wordRo);
  if (!userId || !key || !cloudRow) return { ok: false };
  const map = readJson(localKey(userId, 'progress'), {});
  map[key] = {
    ...rowToProgress(cloudRow),
    wordId: Number(wordId),
    word_id: Number(wordId),
    wordRo: wordRo || cloudRow.word_ro || '',
    word_ro: wordRo || cloudRow.word_ro || ''
  };
  delete map[key].pendingSync;
  try {
    writeJson(localKey(userId, 'progress'), map);
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
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

function writeAuthoritativeDailyState(userId, date, cloudState = {}) {
  const optimistic = applyPendingDailyEventsToState(
    userId,
    date,
    cloudState.queue || null,
    cloudState.log || null
  );
  if (optimistic.queue) writeLocalQueue(userId, optimistic.queue, date);
  if (optimistic.log) {
    const logs = readJson(localKey(userId, 'daily_log'), {});
    logs[date] = { ...optimistic.log, local: !!readPendingDailyEvents(userId).some(event => event.date === date && event.target?.log) };
    writeJson(localKey(userId, 'daily_log'), logs);
  }
  return optimistic;
}

async function syncDailyStateEvent(userId, event) {
  const { data, error } = await withTimeout(
    sb.rpc('apply_daily_state_sync_event', {
      p_event_id: event.eventId,
      p_state_date: event.date,
      p_client_id: event.clientId,
      p_client_seq: event.clientSeq,
      p_base_state: event.base || {},
      p_target_state: event.target || {}
    }),
    DAILY_STATE_TIMEOUT_MS,
    '每日状态原子同步超时'
  );
  if (error) {
    if (isMissingRpcError(error)) {
      throw new Error('云端尚未安装每日状态原子同步迁移；数据已安全保存在本机');
    }
    throw new Error(error.message || '每日状态原子同步失败');
  }
  if (!data?.queue || !data?.log) throw new Error('每日状态原子同步未返回完整确认');

  clearPendingDailyEvent(userId, event.eventId);
  for (const part of event.parts || []) {
    clearPendingDailyStatePart(
      userId,
      event.date,
      part,
      event.tokens?.[part] || '',
      event.targetUpdatedAt?.[part] || ''
    );
  }
  const optimistic = writeAuthoritativeDailyState(userId, event.date, data);
  return { ...data, ...optimistic };
}

function readPendingDailyEventsThrough(userId, requestedEvent) {
  const requestedSequence = Number(requestedEvent?.clientSeq || 0);
  const sameClientEvents = readPendingDailyEvents(userId)
    .filter(event => event.clientId === requestedEvent.clientId && Number(event.clientSeq || 0) <= requestedSequence);
  if (!sameClientEvents.some(event => event.eventId === requestedEvent.eventId)) {
    sameClientEvents.push(requestedEvent);
  }
  sameClientEvents.sort((left, right) => Number(left.clientSeq || 0) - Number(right.clientSeq || 0));
  return sameClientEvents;
}

async function syncPendingDailyEventsThrough(userId, requestedEvent) {
  const sameClientEvents = readPendingDailyEventsThrough(userId, requestedEvent);
  let requestedResult = null;
  for (const pendingEvent of sameClientEvents) {
    const result = await syncDailyStateEvent(userId, pendingEvent);
    if (pendingEvent.eventId === requestedEvent.eventId) requestedResult = result;
  }
  if (!requestedResult) throw new Error('当前每日状态事件尚未获得云端确认');
  return requestedResult;
}

function enqueueDailyStateEventSync(userId, event) {
  // Client sequence is global to this runtime, so writes must also be global
  // per user. This keeps a midnight rollover from sending tomorrow's event
  // ahead of an in-flight event for the previous date.
  const chainKey = String(userId);
  const previous = dailyStateSyncChains.get(chainKey) || Promise.resolve();
  const next = previous
    .catch(() => {})
    // A later base->target delta does not contain an earlier failed delta.
    // Always drain this client's durable prefix first; the server independently
    // rejects sequence gaps as a second line of defense.
    .then(() => syncPendingDailyEventsThrough(userId, event))
    .catch(error => {
      updatePendingDailyEvent(userId, event, {
        attempts: Number(event.attempts || 0) + 1,
        lastError: error?.message || String(error || '同步失败')
      });
      markPendingDailyStateError(userId, event.date, error);
      throw error;
    });
  dailyStateSyncChains.set(chainKey, next);
  next.finally(() => {
    if (dailyStateSyncChains.get(chainKey) === next) dailyStateSyncChains.delete(chainKey);
  }).catch(() => {});
  return next;
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

async function loadBundledWords() {
  const response = await fetchWithTimeout(
    `./data/vocab.json?v=${encodeURIComponent(VOCAB_DATA_VERSION)}`,
    { cache: 'reload' },
    BUNDLED_WORDS_LOAD_TIMEOUT_MS,
    '本地词库读取超时'
  );
  if (!response.ok) throw new Error('本地词库读取失败');
  const payload = await response.json();
  const words = Array.isArray(payload) ? payload : (payload.words || []);
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
    lastReviewedAt,
    syncRevision: Number(r.sync_revision ?? r.syncRevision ?? 0),
    stateUpdatedAt: r.state_updated_at || r.stateUpdatedAt || r.updated_at || null,
    updatedAt: r.updated_at || r.updatedAt || null
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

function mergeStoredProgress(existing = null, incoming = {}, backup = {}) {
  const merged = RomanianVocabProgressModel.mergeEntries(existing, incoming || {});
  return mergeProgressMemory(merged, backup);
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
  const lastReviewedAt = RomanianVocabProgressModel.newerIso(localProgress.lastReviewedAt, cloudProgress.lastReviewedAt) || new Date().toISOString();
  const lastWrongAt = RomanianVocabProgressModel.newerIso(localProgress.lastWrongAt, cloudProgress.lastWrongAt);
  const weakClearedAt = RomanianVocabProgressModel.newerIso(localProgress.weakClearedAt, cloudProgress.weakClearedAt);
  const wasMasteredAt = RomanianVocabProgressModel.newerIso(localProgress.wasMasteredAt, cloudProgress.wasMasteredAt);
  const {
    existingScheduler: cloudScheduler,
    incomingScheduler: localScheduler,
    schedulerBase
  } = RomanianVocabProgressModel.selectSchedulerBase(cloudProgress, localProgress);
  const nextReviewAt = RomanianVocabProgressModel.newerIso(
    localProgress.nextReviewAt || localProgress.nextReview,
    cloudProgress.nextReviewAt || cloudProgress.nextReview
  ) || lastReviewedAt;
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
  merged.level = RomanianVocabProgressModel.normalizeLevel(merged);
  return merged;
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
  const introduced_word_id = normalizeIdArray([
    ...(cloudPayload.introduced_word_id || []),
    ...(localPayload.introduced_word_id || [])
  ]);
  const word_id = normalizeIdArray([
    ...(localPayload.word_id || []),
    ...(cloudPayload.word_id || [])
  ])
    .filter(value => !completedIdKeys.has(String(value)));
  const completed = normalizeRoArray([
    ...(cloudPayload.completed_word_ro || []),
    ...(localPayload.completed_word_ro || [])
  ]);
  const completedKeys = new Set(completed.map(value => value.toLocaleLowerCase('ro')));
  const introduced_word_ro = normalizeRoArray([
    ...(cloudPayload.introduced_word_ro || []),
    ...(localPayload.introduced_word_ro || [])
  ]);
  const word_ro = normalizeRoArray([
    ...(localPayload.word_ro || []),
    ...(cloudPayload.word_ro || [])
  ])
    .filter(value => !completedKeys.has(value.toLocaleLowerCase('ro')));
  const goal = Math.max(Number(localPayload.goal || cloudPayload.goal || API_DEFAULT_DAILY_GOAL), 1);
  return {
    ...cloudPayload,
    ...localPayload,
    goal,
    word_id,
    word_ro,
    completed_word_id,
    completed_word_ro: completed,
    introduced_word_id,
    introduced_word_ro,
    completed: !!(localPayload.completed || cloudPayload.completed),
    updated_at: cloudPayload.updated_at || cloudPayload.updatedAt || new Date().toISOString()
  };
}

function mergeDailyLogPayload(localPayload, cloudPayload = null, completionGoal = localPayload.goal, options = {}) {
  if (!cloudPayload) return localPayload;
  const newWords = Math.max(Number(localPayload.new_words || 0), Number(cloudPayload.new_words || 0));
  const goal = Math.max(Number(localPayload.goal || cloudPayload.goal || API_DEFAULT_DAILY_GOAL), 1);
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
    completed,
    updated_at: cloudPayload.updated_at || cloudPayload.updatedAt || new Date().toISOString()
  };
}

// ── 词库 ──────────────────────────────────────────────────

/**
 * 从数据库加载全部词汇（自动分页，支持超过1000条）
 * @returns {Promise<Array>} 词汇数组
 */
async function apiLoadWords(options = {}) {
  const { preferCloud = !isOfflineMode() } = options;
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
      if (error) throw new Error(error.message);
      if (!data || !data.length) break;
      all = all.concat(data);
      if (data.length < 1000) break;
      from += 1000;
    }
    if (all.length) {
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
      await apiUpdateWord(row.id, {
        ipa: row.ipa,
        hint: row.hint,
        grammar_data: row.grammar_data || null
      });
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
  const normalized = words.map(apiNormalizeVocabularyWord).filter(w => w.ro);
  const firstInvalid = normalized
    .map(word => ({ word, problems: apiValidateVocabularyWord(word, { allowExampleOnly: true }) }))
    .find(item => item.problems.length);
  if (firstInvalid) throw new Error(`${firstInvalid.word.ro || '词条'}：${firstInvalid.problems[0]}`);
  let exampleSchemaMissing = false;
  const existingRows = await apiLoadWords({ preferCloud: true });
  const existingByRo = new Map((existingRows || []).map(row => [apiNormalizedRoKey(row.ro), row]));
  const seenKeys = new Set(existingByRo.keys());
  const newWords = normalized.filter(word => {
    const key = apiNormalizedRoKey(word.ro);
    if (!key || seenKeys.has(key)) return false;
    seenKeys.add(key);
    return true;
  });
  const missingZh = newWords.filter(w => !w.zh);
  if (missingZh.length) {
    throw new Error(`新词缺少中文：${missingZh.map(w => w.ro).join('、')}`);
  }
  const payload = newWords.map(w => ({
    zh: w.zh, ro: w.ro,
    ipa: w.ipa || '',
    hint: w.hint || '',
    cat: w.topic,
    topic: w.topic,
    part_of_speech: w.part_of_speech,
    unit_type: w.unit_type,
    grammar_data: w.grammar_data || {},
    cefr: w.cefr || null,
    register: w.register || null,
    verification_status: 'verified',
    source: w.source || 'admin_approved',
    example_ro: w.example_ro || '',
    example_zh: w.example_zh || ''
  }));
  let inserted = 0;
  if (payload.length) {
    const { data, error } = await sb.from('words').insert(payload).select();
    if (error && isMissingExampleColumnsError(error)) {
      exampleSchemaMissing = true;
      const fallbackPayload = payload.map(({ example_ro, example_zh, ...row }) => row);
      const retry = await sb.from('words').insert(fallbackPayload).select();
      if (retry.error) throw new Error(retry.error.message);
      inserted = retry.data?.length || 0;
    } else if (error) {
      if (/words_ro_normalized_unique|duplicate key/i.test(error.message || '')) {
        throw new Error('罗马尼亚语词条已存在（大小写和首尾空格不区分）');
      }
      throw new Error(error.message);
    } else {
      inserted = data?.length || 0;
    }
  }
  let updatedExamples = 0;
  for (const word of normalized) {
    const existing = existingByRo.get(apiNormalizedRoKey(word.ro));
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
  return words
    .map(apiNormalizeVocabularyWord)
    .filter(w => w.ro && (w.zh || w.example_ro))
    .map(w => ({
      zh: w.zh,
      ro: w.ro,
      ipa: w.ipa,
      hint: w.hint,
      cat: w.topic,
      topic: w.topic,
      part_of_speech: w.part_of_speech,
      unit_type: w.unit_type,
      grammar_data: w.grammar_data || {},
      cefr: w.cefr || null,
      register: w.register || null,
      verification_status: w.verification_status || 'needs_review',
      source: w.source || 'admin_submission',
      example_ro: w.example_ro,
      example_zh: w.example_zh
    }));
}

/**
 * 提交词汇到管理员审核队列。审核通过后才写入正式词库。
 */
async function apiSubmitWordsForReview(words, submitter = {}) {
  if (isOfflineMode()) throw new Error('离线模式下不能提交共享词库审核');
  const normalized = normalizePendingWordPayload(words);
  if (!normalized.length) throw new Error('没有可提交审核的词汇');
  const firstInvalid = normalized
    .map(word => ({ word, problems: apiValidateVocabularyWord(word, { allowExampleOnly: true }) }))
    .find(item => item.problems.length);
  if (firstInvalid) throw new Error(`${firstInvalid.word.ro || '词条'}：${firstInvalid.problems[0]}`);
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

async function apiLoadCloudProgressRows(userId) {
  const rows = [];
  for (let from = 0; ; from += PROGRESS_PAGE_SIZE) {
    const to = from + PROGRESS_PAGE_SIZE - 1;
    const { data, error } = await withTimeout(
      sb.from('progress')
        .select('*')
        .eq('user_id', userId)
        .order('word_id', { ascending: true })
        .range(from, to),
      PROGRESS_LOAD_TIMEOUT_MS,
      '云端进度读取超时'
    );
    if (error) throw new Error(error.message);
    rows.push(...(data || []));
    if (!data || data.length < PROGRESS_PAGE_SIZE) break;
  }
  return rows;
}

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
    data = await apiLoadCloudProgressRows(userId);
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
    map[key] = mergeStoredProgress(map[key], progress, memoryBackup[key] || memoryBackup[r.word_ro]);
  });
  if (legacyRows) {
    console.warn(`Loaded ${legacyRows} legacy progress row(s) without word_id; using normalized word_ro fallback until migration/backfill is complete.`);
    window.reportClientIssue?.('legacy_progress_fallback', 'Progress rows without stable word ID', {
      operation: 'load_progress',
      count: legacyRows
    });
  }
  Object.entries(pendingProgress).forEach(([key, progress]) => {
    const wordId = getProgressEntryWordId(key, progress);
    const wordRo = getProgressEntryWordRo(progress, key);
    const nextKey = progressEntryKey(wordId, wordRo) || key;
    if (progress?.pendingDelete) {
      delete map[nextKey];
    } else if (progress?.pendingCorrection) {
      map[nextKey] = mergeStoredProgress(null, { ...progress, word_id: wordId, word_ro: wordRo, pendingSync: true }, memoryBackup[nextKey] || memoryBackup[key]);
    } else {
      map[nextKey] = mergeStoredProgress(map[nextKey], { ...progress, word_id: wordId, word_ro: wordRo, pendingSync: true }, memoryBackup[nextKey] || memoryBackup[key]);
    }
  });
  writeLocalProgressSnapshot(userId, map);
  return markProgressSource(map, Object.keys(pendingProgress).length ? 'cloudWithPending' : 'cloud');
}

async function apiVerifyProgressState(userId, expectedMap = {}) {
  if (isOfflineMode()) return { ok: false, error: '离线模式无法确认云端进度' };
  const rows = await apiLoadCloudProgressRows(userId);
  const cloudById = new Map((rows || [])
    .filter(row => row?.word_id !== null && row?.word_id !== undefined)
    .map(row => [String(row.word_id), progressSyncSnapshot(rowToProgress(row))]));
  const expectedById = new Map();
  Object.entries(expectedMap || {}).forEach(([key, progress]) => {
    const wordId = getProgressEntryWordId(key, progress);
    if (wordId === null) return;
    expectedById.set(String(wordId), progressSyncSnapshot(progress || {}));
  });
  const allIds = new Set([...cloudById.keys(), ...expectedById.keys()]);
  const mismatchedWordIds = [...allIds].filter(wordId => {
    if (!cloudById.has(wordId) || !expectedById.has(wordId)) return true;
    return JSON.stringify(cloudById.get(wordId)) !== JSON.stringify(expectedById.get(wordId));
  });
  return {
    ok: mismatchedWordIds.length === 0,
    expectedCount: expectedById.size,
    cloudCount: cloudById.size,
    mismatchCount: mismatchedWordIds.length,
    mismatchedWordIds: mismatchedWordIds.slice(0, 20),
    verifiedAt: new Date().toISOString()
  };
}

async function apiApplyProgressSyncEvent(wordId, wordRo, event) {
  const { data, error } = await withTimeout(
    sb.rpc('apply_progress_sync_event', {
      p_event_id: event.eventId,
      p_word_id: Number(wordId),
      p_word_ro: wordRo,
      p_occurred_at: event.occurredAt || new Date().toISOString(),
      p_base_state: event.base || progressSyncSnapshot({}),
      p_target_state: event.target || progressSyncSnapshot({}),
      p_correction: !!event.correction
    }),
    PROGRESS_SAVE_TIMEOUT_MS,
    '云端进度保存超时'
  );
  if (error) throw new Error(error.message);
  if (!data || typeof data !== 'object') throw new Error('云端未返回可确认的进度记录');
  return data;
}

async function apiMergeLegacyProgressBaselines(userId, progressMap = {}) {
  if (isOfflineMode()) return { merged: 0, skipped: true };
  const migrationKey = localKey(userId, 'legacy_progress_baseline_v1');
  if (localStorage.getItem(migrationKey) === '1') return { merged: 0, skipped: true };
  const entries = Object.entries(progressMap || {}).map(([key, progress]) => {
    const resolved = resolveCurrentWordForProgress(key, progress);
    if (!resolved.wordId || !resolved.wordRo) return null;
    const snapshot = progressSyncSnapshot(progress || {});
    return {
      wordId: resolved.wordId,
      wordRo: resolved.wordRo,
      seen: snapshot.seen,
      seenViaCard: snapshot.seenViaCard,
      grammarQr: snapshot.grammarQr,
      grammarQt: snapshot.grammarQt,
      wasMasteredAt: snapshot.wasMasteredAt,
      correctStreakSinceWrong: snapshot.correctStreakSinceWrong
    };
  }).filter(Boolean);
  let merged = 0;
  for (let from = 0; from < entries.length; from += 200) {
    const { data, error } = await withTimeout(
      sb.rpc('merge_legacy_progress_baselines', {
        p_entries: entries.slice(from, from + 200)
      }),
      PROGRESS_SAVE_TIMEOUT_MS,
      '旧版进度字段迁移超时'
    );
    if (error) throw new Error(error.message);
    merged += Number(data || 0);
  }
  localStorage.setItem(migrationKey, '1');
  return { merged };
}

async function apiRetryPendingProgress(userId, limit = PENDING_PROGRESS_RETRY_LIMIT) {
  if (isOfflineMode()) return { attempted: 0, saved: 0, failed: 0, remaining: 0 };
  const pendingProgress = readPendingProgress(userId);
  const entries = Object.entries(pendingProgress)
    .sort((a, b) => String(a[1]?.pendingSyncAt || '').localeCompare(String(b[1]?.pendingSyncAt || '')));
  const batch = entries.slice(0, Math.max(1, Number(limit || PENDING_PROGRESS_RETRY_LIMIT)));
  let saved = 0;
  let unresolved = 0;
  for (let i = 0; i < batch.length; i += PENDING_PROGRESS_RETRY_CONCURRENCY) {
    const chunk = batch.slice(i, i + PENDING_PROGRESS_RETRY_CONCURRENCY);
    const candidates = chunk.map(([key, progress]) => resolveCurrentWordForProgress(key, progress));
    const candidateWordIds = [...new Set(candidates.map(candidate => candidate.wordId).filter(Boolean))];
    const [{ data: validWords, error: wordsError }, { data: cloudRows, error: cloudError }] = await Promise.all([
      candidateWordIds.length
        ? withTimeout(sb.from('words').select('id,ro').in('id', candidateWordIds), PROGRESS_LOAD_TIMEOUT_MS, '词汇身份确认超时')
        : Promise.resolve({ data: [], error: null }),
      candidateWordIds.length
        ? withTimeout(sb.from('progress').select('*').eq('user_id', userId).in('word_id', candidateWordIds), PROGRESS_LOAD_TIMEOUT_MS, '待同步进度读取超时')
        : Promise.resolve({ data: [], error: null })
    ]);
    if (wordsError) throw new Error(wordsError.message);
    if (cloudError) throw new Error(cloudError.message);
    const validWordById = new Map((validWords || []).map(word => [String(word.id), word]));
    const cloudById = new Map((cloudRows || []).map(row => [String(row.word_id), row]));
    const results = await Promise.allSettled(chunk.map(async ([key, pending], index) => {
      const candidate = candidates[index];
      const wordId = candidate.wordId;
      if (!wordId || !validWordById.has(String(wordId))) return { unresolved: true };
      const wordRo = validWordById.get(String(wordId)).ro || candidate.wordRo;
      const cloudRow = cloudById.get(String(wordId)) || null;
      let events = Array.isArray(pending.pendingEvents) ? pending.pendingEvents.filter(Boolean) : [];
      if (!events.length) {
        const cloudProgress = cloudRow ? rowToProgress(cloudRow) : {};
        const targetProgress = pending.pendingDelete
          ? {}
          : (pending.pendingCorrection ? pending : mergeCloudProgress(pending, cloudRow));
        events = [createProgressPendingEvent(key, cloudProgress, targetProgress, {
          correction: !!(pending.pendingCorrection || pending.pendingDelete),
          occurredAt: pending.pendingSyncAt || new Date().toISOString()
        })];
      }
      let confirmedRow = cloudRow;
      for (const event of events) {
        confirmedRow = await apiApplyProgressSyncEvent(wordId, wordRo, event);
        clearProgressEventJournal(userId, event.eventId);
      }
      const expectedToken = pending.pendingSyncToken || pending.pending_sync_token || '';
      const cleared = clearPendingProgress(userId, wordId, wordRo, expectedToken);
      if (cleared) writeAuthoritativeProgressEntry(userId, wordId, wordRo, confirmedRow);
      return { unresolved: false, cleared };
    }));
    results.forEach((result, index) => {
      if (result.status === 'fulfilled' && !result.value?.unresolved) {
        if (result.value?.cleared) saved++;
      } else if (result.status === 'fulfilled') {
        unresolved++;
        console.warn('Pending progress references a word missing from the current cloud vocabulary', chunk[index][0]);
      } else {
        console.warn('Pending progress retry failed', chunk[index][0], result.reason);
      }
    });
  }
  const remaining = Object.keys(readPendingProgress(userId)).length;
  const failed = Math.max(0, batch.length - saved - unresolved);
  return { attempted: batch.length, saved, failed, unresolved, remaining, totalPending: entries.length };
}

async function apiRetryPendingDailyState(userId, limit = PENDING_DAILY_STATE_RETRY_LIMIT) {
  if (isOfflineMode()) return { attempted: 0, saved: 0, failed: 0, remaining: 0 };
  let events = readPendingDailyEvents(userId);

  // Upgrade pending snapshots written by older app versions into one-time
  // delta events. The cloud row is captured as the base, so migration never
  // replays a legacy absolute counter as a fresh increment.
  if (!events.length) {
    const legacyEntries = Object.entries(readPendingDailyState(userId))
      .filter(([, state]) => state?.queue || state?.log)
      .sort((a, b) => String(a[1]?.pendingSyncAt || '').localeCompare(String(b[1]?.pendingSyncAt || '')));
    for (const [date, state] of legacyEntries) {
      try {
        if (state.queue) {
          const { data: cloudQueue, error } = await withTimeout(
            sb.from('daily_queue').select('*').eq('user_id', userId).eq('queue_date', date).maybeSingle(),
            DAILY_STATE_TIMEOUT_MS,
            '旧版每日队列迁移读取超时'
          );
          if (error) throw new Error(error.message);
          const baseQueue = cloudQueue || {
            goal: state.queue.goal || API_DEFAULT_DAILY_GOAL,
            word_id: [], word_ro: [], completed_word_id: [], completed_word_ro: [],
            introduced_word_id: [], introduced_word_ro: [], completed: false
          };
          const targetQueue = mergeDailyQueuePayload(state.queue, baseQueue);
          const status = createDailyStateEvent(userId, date, 'queue', baseQueue, targetQueue);
          if (!status.ok) throw status.error;
        }
        if (state.log) {
          const { data: cloudLog, error } = await withTimeout(
            sb.from('daily_log').select('*').eq('user_id', userId).eq('log_date', date).maybeSingle(),
            DAILY_STATE_TIMEOUT_MS,
            '旧版今日记录迁移读取超时'
          );
          if (error) throw new Error(error.message);
          const baseLog = cloudLog || {
            new_words: 0,
            goal: state.log.goal || API_DEFAULT_DAILY_GOAL,
            completed: false
          };
          const targetLog = mergeDailyLogPayload(state.log, baseLog, state.log.goal, {
            completedExplicit: typeof state.log.completed === 'boolean'
          });
          const status = createDailyStateEvent(userId, date, 'log', baseLog, targetLog);
          if (!status.ok) throw status.error;
        }
      } catch (error) {
        markPendingDailyStateError(userId, date, error);
      }
    }
    events = readPendingDailyEvents(userId);
  }

  const batch = events.slice(0, Math.max(1, Number(limit || PENDING_DAILY_STATE_RETRY_LIMIT)));
  let saved = 0;
  for (const event of batch) {
    try {
      await enqueueDailyStateEventSync(userId, event);
      saved++;
    } catch (error) {
      console.warn('Pending daily state event retry failed', event.date, event.eventId, error);
    }
  }
  const remainingEvents = readPendingDailyEvents(userId);
  const remainingLegacy = Object.values(readPendingDailyState(userId) || {})
    .reduce((count, state) => count + (state?.queue ? 1 : 0) + (state?.log ? 1 : 0), 0);
  const remaining = remainingEvents.length || remainingLegacy;
  const failed = Math.max(0, batch.length - saved);
  return { attempted: batch.length, saved, failed, remaining, totalPending: events.length };
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

async function apiLoadClientEventSummary(days = 7) {
  if (isOfflineMode()) return [];
  const { data, error } = await sb.rpc('admin_get_client_event_summary', {
    days_count: Math.max(1, Math.min(30, Number(days) || 7))
  });
  if (error) throw new Error(error.message);
  return data || [];
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
  const completeProgress = {
    ...(options.progress || {}),
    ...normalized,
    ...memory,
    known: !!known,
    qr: Number(qr || 0),
    qt: Number(qt || 0),
    level: level || 'unknown',
    reviewStage: normalizedStage,
    ...scheduler
  };
  const completeSnapshot = progressSyncSnapshot(completeProgress);
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
    seen: completeSnapshot.seen,
    seen_via_card: completeSnapshot.seenViaCard,
    grammar_qr: completeSnapshot.grammarQr,
    grammar_qt: completeSnapshot.grammarQt,
    was_mastered_at: completeSnapshot.wasMasteredAt,
    review_stage: normalizedStage,
    next_review_at: normalized.nextReviewAt || now,
    last_reviewed_at: normalized.lastReviewedAt || now,
    wrong_count: memory.wrongCount || 0,
    error_streak: memory.errorStreak || 0,
    correct_streak_since_wrong: completeSnapshot.correctStreakSinceWrong,
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

  const { data: cloudRow, error: cloudError } = await withTimeout(
    sb.from('progress')
      .select('*')
      .eq('user_id', userId)
      .eq('word_id', stableWordId)
      .maybeSingle(),
    PROGRESS_LOAD_TIMEOUT_MS,
    '云端进度读取超时'
  );
  if (cloudError) throw new Error(cloudError.message);
  const baseProgress = cloudRow ? rowToProgress(cloudRow) : {};
  const requestedProgress = { ...rowToProgress(schedulerPayload), ...(options.progress || {}) };
  const targetProgress = options.correction
    ? requestedProgress
    : mergeCloudProgress(requestedProgress, cloudRow);
  const progressEvent = createProgressPendingEvent(
    progressEntryKey(stableWordId, wordRo),
    baseProgress,
    targetProgress,
    { correction: !!options.correction, eventId: options.eventId, occurredAt: options.occurredAt }
  );
  const journalStatus = writeProgressEventJournal(
    userId,
    stableWordId,
    wordRo,
    progressEvent,
    { ...targetProgress, word_id: stableWordId, word_ro: wordRo, pendingSync: true },
    memory
  );
  if (!journalStatus.ok) throw journalStatus.error;
  const confirmedRow = await apiApplyProgressSyncEvent(stableWordId, wordRo, progressEvent);
  clearProgressEventJournal(userId, progressEvent.eventId);
  const cleared = clearPendingProgress(userId, stableWordId, wordRo, expectedPendingToken);
  if (!expectedPendingToken || cleared) writeAuthoritativeProgressEntry(userId, stableWordId, wordRo, confirmedRow);
  const memoryBackup = writeProgressMemoryBackup(userId, stableWordId, wordRo, memory);
  return {
    savedPayload: 'atomicEvent',
    memoryBackedByDb: true,
    memoryBackup
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
      goal: parsed.goal || goal || API_DEFAULT_DAILY_GOAL,
      word_id: normalizeIdArray(parsed.word_id),
      word_ro: Array.isArray(parsed.word_ro) ? parsed.word_ro : [],
      completed_word_id: normalizeIdArray(parsed.completed_word_id),
      completed_word_ro: Array.isArray(parsed.completed_word_ro) ? parsed.completed_word_ro : [],
      introduced_word_id: normalizeIdArray(parsed.introduced_word_id),
      introduced_word_ro: Array.isArray(parsed.introduced_word_ro) ? parsed.introduced_word_ro : [],
      completed: !!parsed.completed,
      sync_revision: Math.max(0, Number(parsed.sync_revision || parsed.syncRevision || 0)),
      updated_at: parsed.updated_at || parsed.updatedAt || null,
      local: true
    };
  } catch {
    return null;
  }
}

function writeLocalQueue(userId, queue, date = getQueueDateKey()) {
  const payload = {
    goal: queue.goal || API_DEFAULT_DAILY_GOAL,
    word_id: normalizeIdArray(queue.word_id),
    word_ro: queue.word_ro || [],
    completed_word_id: normalizeIdArray(queue.completed_word_id),
    completed_word_ro: queue.completed_word_ro || [],
    introduced_word_id: normalizeIdArray(queue.introduced_word_id),
    introduced_word_ro: queue.introduced_word_ro || [],
    completed: !!queue.completed,
    sync_revision: Math.max(0, Number(queue.sync_revision || queue.syncRevision || 0)),
    updated_at: queue.updated_at || queue.updatedAt || new Date().toISOString()
  };
  writeLocalStorageString(getLocalQueueKey(userId, date), JSON.stringify(payload));
  return { user_id: userId, queue_date: date, ...payload, local: true };
}

async function apiGetDailyQueue(userId, goal) {
  const today = getQueueDateKey();
  const localQueue = readLocalQueue(userId, goal, today);
  const pendingQueue = readPendingDailyState(userId)?.[today]?.queue || null;
  const pendingEvents = readPendingDailyEvents(userId).filter(event => event.date === today && event.target?.queue);
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
        .maybeSingle(),
      DAILY_STATE_TIMEOUT_MS,
      '每日队列读取超时'
    );
    if (!error && data) {
      const cloudQueue = {
        ...data,
        word_id: normalizeIdArray(data.word_id),
        word_ro: data.word_ro || [],
        completed_word_id: normalizeIdArray(data.completed_word_id),
        completed_word_ro: data.completed_word_ro || [],
        introduced_word_id: normalizeIdArray(data.introduced_word_id),
        introduced_word_ro: data.introduced_word_ro || []
      };
      const resolvedQueue = pendingEvents.length
        ? applyPendingDailyEventsToState(userId, today, cloudQueue, null).queue
        : (pendingQueue ? mergeDailyQueuePayload(pendingQueue, cloudQueue) : cloudQueue);
      writeLocalQueue(userId, resolvedQueue, today);
      return resolvedQueue;
    }
    if (error && error.code !== 'PGRST116') {
      if (localEffectiveQueue) return { ...localEffectiveQueue, syncError: error.message };
      return {
        user_id: userId,
        queue_date: today,
        goal: goal || API_DEFAULT_DAILY_GOAL,
        word_id: [],
        word_ro: [],
        completed_word_id: [],
        completed_word_ro: [],
        introduced_word_id: [],
        introduced_word_ro: [],
        completed: false,
        syncError: error.message
      };
    }
  } catch (error) {
    if (localEffectiveQueue) return { ...localEffectiveQueue, syncError: error?.message || '每日队列读取失败' };
  }
  return localEffectiveQueue || null;
}

async function apiSaveDailyQueue(userId, queue, options = {}) {
  const today = getQueueDateKey();
  const baseQueue = readLocalQueue(userId, queue.goal, today) || {
    goal: queue.goal || API_DEFAULT_DAILY_GOAL,
    word_id: [],
    word_ro: [],
    completed_word_id: [],
    completed_word_ro: [],
    introduced_word_id: [],
    introduced_word_ro: [],
    completed: false
  };
  const payload = {
    user_id: userId,
    queue_date: today,
    goal: queue.goal || API_DEFAULT_DAILY_GOAL,
    word_id: normalizeIdArray(queue.word_id),
    word_ro: queue.word_ro || [],
    completed_word_id: normalizeIdArray(queue.completed_word_id),
    completed_word_ro: queue.completed_word_ro || [],
    introduced_word_id: normalizeIdArray(queue.introduced_word_id),
    introduced_word_ro: queue.introduced_word_ro || [],
    completed: !!queue.completed,
    updated_at: new Date().toISOString(),
    sync_token: createDailySyncToken('queue', today)
  };
  const pendingStatus = queueDailyStateForSync(userId, today, { queue: payload });
  const eventStatus = createDailyStateEvent(userId, today, 'queue', baseQueue, payload);
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
      pendingSync: pendingStatus.ok && eventStatus.ok,
      syncError: [localWriteError?.message, pendingStatus.ok && eventStatus.ok ? '' : '本机待同步队列写入失败'].filter(Boolean).join('；') || undefined
    };
  }
  if (!eventStatus.ok) {
    return {
      ...payload,
      local: true,
      pendingSync: pendingStatus.ok,
      syncError: [eventStatus.error?.message || '本机原子同步事件写入失败', localWriteError?.message].filter(Boolean).join('；')
    };
  }
  try {
    const result = await enqueueDailyStateEventSync(userId, eventStatus.event);
    const confirmedQueue = result.queue || payload;
    return localWriteError ? { ...confirmedQueue, syncError: localWriteError.message } : confirmedQueue;
  } catch (error) {
    return { ...payload, local: true, pendingSync: true, syncError: [error.message || '每日队列云端同步失败', localWriteError?.message, pendingStatus.ok ? '' : '本机待同步队列写入失败'].filter(Boolean).join('；') };
  }
}

// ── 报错反馈 ──────────────────────────────────────────────

async function apiReportClientEvent(eventType, details = {}) {
  if (isOfflineMode() || !currentUser?.id) return { saved: false, reason: 'offline_or_signed_out' };
  const normalizedType = String(eventType || 'client_error').replace(/[^a-z0-9_]/gi, '_').slice(0, 48);
  const safeDetails = Object.fromEntries(Object.entries(details)
    .filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value))
    .slice(0, 12)
    .map(([key, value]) => [String(key).slice(0, 40), typeof value === 'string' ? value.slice(0, 240) : value]));
  const { error } = await sb.from('client_events').insert({
    user_id: currentUser.id,
    event_type: normalizedType,
    details: safeDetails,
    app_version: String(window.ROMANIAN_VOCAB_APP_VERSION || 'unknown').slice(0, 64)
  });
  if (error) throw new Error(error.message);
  return { saved: true };
}
window.apiReportClientEvent = apiReportClientEvent;

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
  const pendingEvents = readPendingDailyEvents(userId).filter(event => event.date === today && event.target?.log);
  const ensureLocalTodayLog = (extra = {}) => {
    const updatedAt = new Date().toISOString();
    const syncToken = createDailySyncToken('log', today);
    const local = localLogs[today] || {
      user_id: userId,
      log_date: today,
      new_words: 0,
      goal: goal || API_DEFAULT_DAILY_GOAL,
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
      DAILY_STATE_TIMEOUT_MS,
      '今日记录读取超时'
    ));
  } catch (loadError) {
    error = loadError;
  }
  if (data) {
    const merged = pendingEvents.length
      ? applyPendingDailyEventsToState(userId, today, null, data).log
      : (pendingLog
        ? mergeDailyLogPayload(pendingLog, data, goal, { completedExplicit: typeof pendingLog.completed === 'boolean' })
        : data);
    delete merged.syncError;
    localLogs[today] = { ...merged, local: pendingEvents.length > 0 };
    writeJson(localKey(userId, 'daily_log'), localLogs);
    return merged;
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
  // The atomic RPC creates daily_log and daily_queue together. Avoid a direct
  // INSERT that could be retried independently from the queue state.
  const local = ensureLocalTodayLog();
  const saved = await apiUpdateTodayLog(userId, 0, goal || API_DEFAULT_DAILY_GOAL, goal || API_DEFAULT_DAILY_GOAL, { completed: false });
  if (saved?.syncError) return { ...local, syncError: saved.syncError };
  return readJson(localKey(userId, 'daily_log'), {})[today] || local;
}

/**
 * 更新今日完成任务数；数据库字段沿用 daily_log.new_words 以保持兼容
 */
async function apiUpdateTodayLog(userId, completedTasks, goal, completionGoal = goal, options = {}) {
  const today = getLocalDateKey();
  const completed = typeof options.completed === 'boolean' ? options.completed : completedTasks >= completionGoal;
  const logs = readJson(localKey(userId, 'daily_log'), {});
  const baseLog = logs[today] || {
    user_id: userId,
    log_date: today,
    new_words: 0,
    goal: goal || API_DEFAULT_DAILY_GOAL,
    completed: false
  };
  const updatedAt = new Date().toISOString();
  const syncToken = createDailySyncToken('log', today);
  const localPayload = {
    user_id: userId,
    log_date: today,
    new_words: completedTasks,
    goal,
    completed,
    updated_at: updatedAt,
    sync_token: syncToken
  };
  const pendingStatus = queueDailyStateForSync(userId, today, { log: localPayload });
  const eventStatus = createDailyStateEvent(userId, today, 'log', baseLog, localPayload);
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
      pendingSync: pendingStatus.ok && eventStatus.ok,
      syncError: [localWriteError?.message, pendingStatus.ok && eventStatus.ok ? '' : '本机待同步队列写入失败'].filter(Boolean).join('；') || undefined
    };
  }
  if (!eventStatus.ok) {
    return {
      saved: 'local',
      pendingSync: pendingStatus.ok,
      syncError: [eventStatus.error?.message || '本机原子同步事件写入失败', localWriteError?.message].filter(Boolean).join('；')
    };
  }
  try {
    const result = await enqueueDailyStateEventSync(userId, eventStatus.event);
    return localWriteError
      ? { saved: 'database', log: result.log, syncError: localWriteError.message }
      : { saved: 'database', log: result.log };
  } catch (error) {
    return {
      saved: 'local',
      pendingSync: true,
      syncError: [error.message || '今日记录保存失败', localWriteError?.message, pendingStatus.ok ? '' : '本机待同步队列写入失败'].filter(Boolean).join('；')
    };
  }
}

async function apiVerifyTodayState(userId, snapshot = {}) {
  if (isOfflineMode()) {
    return { ok: false, logOk: false, queueOk: false, error: '离线模式无法确认云端记录' };
  }
  const date = snapshot.date || getLocalDateKey();
  const [logResult, queueResult] = await Promise.all([
    withTimeout(
      sb.from('daily_log')
        .select('*')
        .eq('user_id', userId)
        .eq('log_date', date)
        .maybeSingle(),
      DAILY_STATE_TIMEOUT_MS,
      '今日记录云端确认超时'
    ),
    withTimeout(
      sb.from('daily_queue')
        .select('*')
        .eq('user_id', userId)
        .eq('queue_date', date)
        .maybeSingle(),
      DAILY_STATE_TIMEOUT_MS,
      '每日队列云端确认超时'
    )
  ]);
  if (logResult.error) throw new Error(logResult.error.message || '今日记录云端确认失败');
  if (queueResult.error) throw new Error(queueResult.error.message || '每日队列云端确认失败');

  const cloudLog = logResult.data;
  const cloudQueue = queueResult.data;
  const expectedLog = snapshot.log || {};
  const expectedQueue = snapshot.queue || {};
  const expectedProcessed = Number(expectedLog.new_words || 0);
  const expectedGoal = Math.max(1, Number(expectedLog.goal || 1));
  const logOk = !!cloudLog &&
    Number(cloudLog.new_words || 0) === expectedProcessed &&
    Number(cloudLog.goal || 0) === expectedGoal &&
    cloudLog.completed === !!expectedLog.completed;
  const sameSet = (left = [], right = [], keyOf = value => String(value)) => {
    const a = new Set(left.map(keyOf));
    const b = new Set(right.map(keyOf));
    return a.size === b.size && [...a].every(key => b.has(key));
  };

  const expectedOpenRos = normalizeRoArray(expectedQueue.word_ro || []);
  const expectedCompletedRos = normalizeRoArray(expectedQueue.completed_word_ro || []);
  const cloudOpenRos = normalizeRoArray(cloudQueue?.word_ro || []);
  const cloudCompletedRos = normalizeRoArray(cloudQueue?.completed_word_ro || []);
  const rosOk = sameSet(expectedOpenRos, cloudOpenRos, normalizeProgressWordRoKey) &&
    sameSet(expectedCompletedRos, cloudCompletedRos, normalizeProgressWordRoKey);

  const expectedOpenIds = normalizeIdArray(expectedQueue.word_id || []);
  const expectedCompletedIds = normalizeIdArray(expectedQueue.completed_word_id || []);
  const cloudOpenIds = normalizeIdArray(cloudQueue?.word_id || []);
  const cloudCompletedIds = normalizeIdArray(cloudQueue?.completed_word_id || []);
  const idsOk = sameSet(expectedOpenIds, cloudOpenIds) &&
    sameSet(expectedCompletedIds, cloudCompletedIds);
  const canVerifyByIds = Array.isArray(cloudQueue?.word_id) &&
    expectedOpenIds.length === expectedOpenRos.length &&
    expectedCompletedIds.length === expectedCompletedRos.length;
  const referenceOk = canVerifyByIds ? idsOk : rosOk;

  const expectedIntroducedRos = normalizeRoArray(expectedQueue.introduced_word_ro || []);
  const cloudIntroducedRos = normalizeRoArray(cloudQueue?.introduced_word_ro || []);
  const expectedIntroducedIds = normalizeIdArray(expectedQueue.introduced_word_id || []);
  const cloudIntroducedIds = normalizeIdArray(cloudQueue?.introduced_word_id || []);
  const canVerifyIntroducedByIds = Array.isArray(cloudQueue?.introduced_word_id) &&
    expectedIntroducedIds.length === expectedIntroducedRos.length;
  const introducedOk = canVerifyIntroducedByIds
    ? sameSet(expectedIntroducedIds, cloudIntroducedIds)
    : sameSet(expectedIntroducedRos, cloudIntroducedRos, normalizeProgressWordRoKey);
  const queueOk = !!cloudQueue && referenceOk &&
    introducedOk &&
    Number(cloudQueue.goal || 0) === Number(expectedQueue.goal || 0) &&
    cloudQueue.completed === !!expectedQueue.completed;

  return {
    ok: logOk && queueOk,
    logOk,
    queueOk,
    verifiedAt: new Date().toISOString(),
    cloud: {
      processed: Number(cloudLog?.new_words || 0),
      goal: Number(cloudLog?.goal || 0),
      completed: cloudLog?.completed === true
    }
  };
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
  return data?.daily_goal || API_DEFAULT_DAILY_GOAL;
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
  return Number(localStorage.getItem(localKey(userId, 'daily_goal'))) || API_DEFAULT_DAILY_GOAL;
}
