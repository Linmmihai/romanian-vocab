// ============================================================
//  app.js — 主应用逻辑
//  页面状态、交互、渲染和跨模块流程编排
// ============================================================

// ── 全局状态 ─────────────────────────────────────────────
let currentUser = null;
let userRole = null;
let progressMap = {};
let W = [];           // 全部词汇（从数据库加载）
let wordRoIndex = new Map();
let wordByRoIndex = new Map();
let wordIdIndex = new Map();
let filtered = [];    // 当前分类筛选后的词汇
let idx = 0;          // 卡片当前索引
let flipped = false;
let flashHistory = [];
let flashOverrideRo = null;
let lastCardAnswerSnapshot = null;
let curCat = '全部';
let flashMode = 'today'; // today | review
let learningCollectionId = 'news_core';
let learningCollectionSwitchVersion = 0;
let todayQueue = [];
let todayQueueCompleted = new Set();
let todayQueueRecord = null;
let dailyQueueLoaded = false;
let exampleBank = {};
let exampleBankLoaded = false;
let exampleBankLoadPromise = null;
let grammarCourseMeta = {};
let grammarCourses = [];
let grammarTopicContent = {};
let grammarCoursesLoaded = false;
let grammarCoursesLoadPromise = null;
let grammarSearchQuery = '';

let qMode = 'zh';     // 测验模式：'zh' | 'ro'
let qExerciseMode = 'translation'; // translation | nounPlural | verbConj | stress | listening
let qPracticeScope = 'smart'; // smart | today | weak | wrong | due | new | all
let qList = [];
let qIdx = 0;
let qRight = 0;       // 本次会话累计答对（不重置）
let qTotal = 0;       // 本次会话累计答题（不重置）
let qRoundRight = 0;  // 本轮答对（用于显示结算）
let qRoundTotal = 0;  // 本轮答题
let qRoundWrong = 0;  // 本轮答错（用于结算建议）
let qStarted = false;
let qScopedPracticePool = null;
let qScopedPracticePoolKey = '';
let lastLearningHint = '';
let progressVersion = 0;
let dailyQueueVersion = 0;
let reviewPanelMetricsCache = { key: '', metrics: null };
let listVisibleLimit = 40;
let listRenderTimer = null;

let editingWordId = null;
let editingReportId = null;
let editingPendingWordId = null;
let detailWordRo = null;
let flashcardButtonsBound = false;
let cardGesturesBound = false;
let flashcardAnswerInFlight = false;
let flashCardRenderTimer = null;
let wrongbookCardRenderTimer = null;
let fastProgressFlushTimer = null;
let progressSnapshotWriteTimer = null;
let todayStateFlushTimer = null;
let manualSyncInFlight = null;
let syncUiState = { phase: 'checking', message: '', lastError: '' };
let pendingTodayGoalPrompt = false;
let pendingTodayAccuracyStats = { correct: 0, total: 0 };
const fastProgressQueue = new Map();
const CARD_FLIP_TRANSITION_MS = 180;
const CARD_CONTENT_SWAP_DELAY_MS = 95;
const FAST_PERSIST_DELAY_MS = 900;
const {
  autoStressWord,
  getStressDisplay,
  normalizeStressText,
  lowerRo,
  stressToHtml,
  getGrammarInfo
} = window.RomanianVocabText;
const {
  TOPICS,
  PARTS_OF_SPEECH,
  UNIT_TYPES,
  REGISTERS,
  CEFR_LEVELS,
  LEARNING_COLLECTIONS,
  normalizeTopic,
  normalizePartOfSpeech,
  normalizeUnitType,
  normalizeGrammarData,
  normalizeCefr,
  normalizeRegister,
  normalizeWord: normalizeTaxonomyWord,
  getTopicLabel,
  getPartOfSpeechLabel,
  getUnitTypeLabel,
  getRegisterLabel,
  getLearningCollectionLabel,
  normalizeLearningCollection,
  wordMatchesLearningCollection,
  getClassificationSummary,
  looksLikeTemplateWord,
  qualityIssues: getTaxonomyQualityIssues
} = window.RomanianVocabTaxonomy;

// 需加强列表状态（内部仍沿用 wrongbook 命名以兼容本地数据）
let wbList = [];
let wbIdx = 0;
let wbFlipped = false;
let wbStreaks = {};
let wbGraduated = 0;
let wbAutoAdvanceTimer = null;
const WB_GRADUATE = 3;
const DEFAULT_DAILY_GOAL = 200;
const DAILY_GOAL_MAX = 5000;
const DEFAULT_DAILY_NEW_LIMIT = 30;
const DAILY_NEW_LIMIT_MAX = 500;
const PENDING_PROGRESS_RETRY_COOLDOWN_MS = 5 * 60 * 1000;
const CLOUD_PROGRESS_REFRESH_COOLDOWN_MS = 60 * 1000;
const IDLE_PROGRESS_BACKUP_MS = 150 * 1000;
const DEFAULT_LEARNING_COLLECTION = 'news_core';

// 每日任务目标状态
let dailyGoal = DEFAULT_DAILY_GOAL;        // 今天实际处理量，允许临时扩展
let defaultDailyGoal = DEFAULT_DAILY_GOAL; // 用户主动保存的每日固定处理目标
let dailyNewLimit = DEFAULT_DAILY_NEW_LIMIT;
let todayNewWords = 0;      // 今日已完成任务数；字段名兼容 legacy daily_log.new_words
let todaySeenWords = new Set(); // 今天已经见过的词 id 集合
let todayIntroducedWords = new Set(); // 今天第一次进入学习流程的新词
let todayLog = null;
let activeDailyDateKey = getDateKeyFor(new Date());
let dailyDateReloadInFlight = null;
const CALENDAR_CACHE_TTL_MS = 5 * 60 * 1000;
let calendarCache = { key: '', logs: null, fetchedAt: 0 };
let lastProgressWarningAt = 0;
let progressCloudSyncInFlight = null;
let progressCloudSyncTimer = null;
let progressLoaded = false;
let dailyReminderTimer = null;
let dailyCheckinPromptShown = false;
let adminWeeklySummaryText = '';
let adminWatchSettings = {};

const DEFAULT_REMINDER_SETTINGS = {
  enabled: false,
  time: '20:30',
  lastSentDate: ''
};

function normalizeDailyGoalValue(value, fallback = DEFAULT_DAILY_GOAL) {
  return Math.max(1, Math.min(DAILY_GOAL_MAX, Number(value) || fallback || DEFAULT_DAILY_GOAL));
}

function normalizeDailyNewLimitValue(value, fallback = DEFAULT_DAILY_NEW_LIMIT) {
  if (value === null || value === undefined || String(value).trim() === '') {
    return Math.max(0, Math.min(DAILY_NEW_LIMIT_MAX, Number(fallback) || DEFAULT_DAILY_NEW_LIMIT));
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return Math.max(0, Math.min(DAILY_NEW_LIMIT_MAX, Number(fallback) || DEFAULT_DAILY_NEW_LIMIT));
  return Math.max(0, Math.min(DAILY_NEW_LIMIT_MAX, Math.round(parsed)));
}

function getEffectiveDailyNewLimit() {
  return normalizeDailyNewLimitValue(dailyNewLimit, DEFAULT_DAILY_NEW_LIMIT);
}

function getTodayNewLimitProgressText() {
  const effectiveLimit = getEffectiveDailyNewLimit();
  return `${todayIntroducedWords.size}/${effectiveLimit}`;
}

async function migrateLegacyDailyGoal(userId, profileGoal) {
  const rawGoal = Number(profileGoal || 0);
  const migrationKey = `daily_goal_200_migrated:${userId || 'local'}`;
  if (rawGoal !== 20 || localStorage.getItem(migrationKey) === '1') {
    return normalizeDailyGoalValue(profileGoal, DEFAULT_DAILY_GOAL);
  }
  try {
    await apiSetDailyGoal(userId, DEFAULT_DAILY_GOAL);
    localStorage.setItem(migrationKey, '1');
  } catch (error) {
    console.warn('Daily goal migration will retry later', error);
  }
  return DEFAULT_DAILY_GOAL;
}

function normalizeWordText(value) {
  return String(value || '').normalize('NFC').trim().replace(/\s+/g, ' ');
}

function roKey(value) {
  const raw = String(value ?? '');
  if (typeof wordIdIndex !== 'undefined' && wordIdIndex?.has(raw)) {
    return normalizeWordText(wordIdIndex.get(raw)?.ro)
      .replace(/[şŞ]/g, match => match === 'Ş' ? 'Ș' : 'ș')
      .replace(/[ţŢ]/g, match => match === 'Ţ' ? 'Ț' : 'ț')
      .toLocaleLowerCase('ro');
  }
  return normalizeWordText(value)
    .replace(/[şŞ]/g, match => match === 'Ş' ? 'Ș' : 'ș')
    .replace(/[ţŢ]/g, match => match === 'Ţ' ? 'Ț' : 'ț')
    .toLocaleLowerCase('ro');
}

function getRoAliasKeys(wordRo) {
  const key = roKey(wordRo);
  return key ? [key] : [];
}

function rebuildWordRoIndex() {
  wordRoIndex = new Map();
  wordByRoIndex = new Map();
  wordIdIndex = new Map();
  W.forEach(word => {
    if (word?.id !== undefined && word?.id !== null) wordIdIndex.set(String(word.id), word);
    const canonical = normalizeWordText(word?.ro);
    if (!canonical) return;
    const exactKey = roKey(canonical);
    if (exactKey) wordRoIndex.set(exactKey, canonical);
    if (exactKey) wordByRoIndex.set(exactKey, word);
  });
}

function normalizeScheduler(progress = {}, now = new Date()) {
  if (window.RomanianVocabScheduler?.normalizeSchedulerProgress) {
    return window.RomanianVocabScheduler.normalizeSchedulerProgress(progress, now);
  }
  return {
    cardState: progress.cardState || progress.card_state || 'new',
    dueAt: progress.dueAt || progress.due_at || progress.nextReviewAt || progress.nextReview || null,
    intervalDays: Number(progress.intervalDays || progress.interval_days || 0) || 0,
    memoryStrength: Number(progress.memoryStrength || progress.memory_strength || 0) || 0,
    reps: Number(progress.reps || progress.qt || 0) || 0,
    correctCount: Number(progress.correctCount || progress.correct_count || progress.qr || 0) || 0,
    fuzzyCount: Number(progress.fuzzyCount || progress.fuzzy_count || 0) || 0,
    forgetCount: Number(progress.forgetCount || progress.forget_count || Math.max(0, (progress.qt || 0) - (progress.qr || 0))) || 0,
    lapses: Number(progress.lapses || 0) || 0,
    recentResults: Array.isArray(progress.recentResults) ? progress.recentResults : [],
    needsReinforcement: !!(progress.needsReinforcement || progress.needs_reinforcement),
    lastReviewedAt: progress.lastReviewedAt || progress.last_reviewed_at || null
  };
}

function getProgressIntegrityFields(progress = {}) {
  const scheduler = normalizeScheduler(progress || {});
  return {
    known: !!progress.known,
    level: getStoredLevel(progress),
    cardState: scheduler.cardState,
    dueAt: scheduler.dueAt || null,
    intervalDays: Number(scheduler.intervalDays || 0),
    easeFactor: Number(progress.easeFactor || progress.ease_factor || 0),
    memoryStrength: Number(scheduler.memoryStrength || 0),
    reps: Number(scheduler.reps || 0),
    lapses: Number(scheduler.lapses || 0),
    reviewStage: window.RomanianVocabScheduler.getReviewStage(progress),
    nextReviewAt: progress.nextReviewAt || progress.nextReview || scheduler.dueAt || null,
    lastReviewedAt: progress.lastReviewedAt || scheduler.lastReviewedAt || null,
    qr: Number(progress.qr || 0),
    qt: Number(progress.qt || 0)
  };
}

function debugProgressWrite(source, wordRo, previous, next, extra = {}) {
  if (!isDailyQueueDebugEnabled()) return;
  const prevFields = previous ? getProgressIntegrityFields(previous) : null;
  const nextFields = next ? getProgressIntegrityFields(next) : null;
  const changedFields = [];
  if (prevFields && nextFields) {
    Object.keys(nextFields).forEach(field => {
      if (String(prevFields[field] ?? '') !== String(nextFields[field] ?? '')) changedFields.push(field);
    });
  }
  const schedulerFields = ['cardState', 'dueAt', 'intervalDays', 'memoryStrength', 'reps', 'lapses', 'reviewStage', 'nextReviewAt'];
  console.info('[progress-write-debug]', JSON.stringify({
    source,
    wordRo,
    created: !previous,
    overwritten: !!previous,
    changedFieldCount: changedFields.length,
    changedFields,
    schedulerFieldsPreserved: prevFields ? schedulerFields.every(field => !changedFields.includes(field)) : true,
    prev: prevFields,
    next: nextFields,
    progressLoaded,
    dailyQueueLoaded,
    ...extra
  }));
}

function mergeProgressMaps(...maps) {
  const normalized = {};
  maps.forEach(map => {
    Object.entries(map || {}).forEach(([rawKey, progress]) => {
      const word = resolveWordFromProgressKey(rawKey, progress);
      const key = word ? String(word.id) : progressFallbackKey(rawKey, progress);
      if (!key) return;
      normalized[key] = window.RomanianVocabProgressModel.mergeEntries(normalized[key], {
        ...(progress || {}),
        wordId: word?.id ?? progress?.wordId ?? progress?.word_id ?? null,
        word_id: word?.id ?? progress?.word_id ?? progress?.wordId ?? null,
        wordRo: word?.ro ?? progress?.wordRo ?? progress?.word_ro ?? '',
        word_ro: word?.ro ?? progress?.word_ro ?? progress?.wordRo ?? ''
      });
    });
  });
  return normalized;
}

function normalizeProgressMap(map = {}) {
  return mergeProgressMaps(map);
}

function replaceProgressMap(map = {}) {
  progressMap = normalizeProgressMap(map);
  progressVersion++;
  if (currentUser?.id && typeof writeLocalProgressSnapshot === 'function') {
    scheduleLocalProgressSnapshotWrite();
  }
}

function scheduleLocalProgressSnapshotWrite() {
  if (!currentUser?.id || typeof writeLocalProgressSnapshot !== 'function') return;
  if (progressSnapshotWriteTimer) clearTimeout(progressSnapshotWriteTimer);
  progressSnapshotWriteTimer = setTimeout(() => {
    progressSnapshotWriteTimer = null;
    try { writeLocalProgressSnapshot(currentUser.id, progressMap); } catch {}
  }, 800);
}

function getProgress(wordRef) {
  const key = progressKeyForWordRef(wordRef);
  return (key && progressMap[key]) || null;
}

function setProgress(wordRef, progress, options = {}) {
  const word = resolveWord(wordRef) || resolveWordFromProgressKey(wordRef, progress);
  const key = word ? String(word.id) : progressFallbackKey(wordRef, progress);
  if (key) {
    const previous = progressMap[key] || null;
    const nextProgress = {
      ...(options.replace ? progress : window.RomanianVocabProgressModel.mergeEntries(previous, progress)),
      wordId: word?.id ?? progress?.wordId ?? progress?.word_id ?? null,
      word_id: word?.id ?? progress?.word_id ?? progress?.wordId ?? null,
      wordRo: word?.ro ?? progress?.wordRo ?? progress?.word_ro ?? '',
      word_ro: word?.ro ?? progress?.word_ro ?? progress?.wordRo ?? ''
    };
    debugProgressWrite(options.source || 'setProgress', word?.ro || String(wordRef || ''), previous, nextProgress, {
      replace: !!options.replace
    });
    progressMap[key] = nextProgress;
    progressVersion++;
  }
}

function deleteProgress(wordRef) {
  const key = progressKeyForWordRef(wordRef);
  if (key) delete progressMap[key];
  progressVersion++;
}

function canonicalWordRo(wordRo) {
  const key = roKey(wordRo);
  return wordRoIndex.get(key) || normalizeWordText(wordRo);
}

function resolveWord(wordRef) {
  if (!wordRef && wordRef !== 0) return null;
  if (typeof wordRef === 'object') {
    if (wordRef.id !== undefined && wordRef.id !== null && wordIdIndex.has(String(wordRef.id))) return wordIdIndex.get(String(wordRef.id));
    if (wordRef.ro) return getWordByRo(wordRef.ro);
    return null;
  }
  const raw = String(wordRef);
  if (wordIdIndex.has(raw)) return wordIdIndex.get(raw);
  return wordByRoIndex.get(roKey(raw)) || null;
}

function resolveWordFromProgressKey(rawKey, progress = {}) {
  const explicitId = progress?.wordId ?? progress?.word_id ?? (/^\d+$/.test(String(rawKey || '')) ? rawKey : null);
  if (explicitId !== undefined && explicitId !== null && wordIdIndex.has(String(explicitId))) return wordIdIndex.get(String(explicitId));
  const wordRo = progress?.wordRo || progress?.word_ro || String(rawKey || '').replace(/^legacy:/, '');
  return getWordByRo(wordRo);
}

function progressFallbackKey(rawKey, progress = {}) {
  const wordRo = progress?.wordRo || progress?.word_ro || String(rawKey || '').replace(/^legacy:/, '');
  const key = roKey(wordRo);
  return key ? `legacy:${key}` : '';
}

function progressKeyForWordRef(wordRef) {
  const word = resolveWord(wordRef);
  if (word?.id !== undefined && word?.id !== null) return String(word.id);
  const key = roKey(String(wordRef || '').replace(/^legacy:/, ''));
  return key ? `legacy:${key}` : '';
}

function dailyWordKey(wordRef) {
  const word = resolveWord(wordRef);
  if (word?.id !== undefined && word?.id !== null) return String(word.id);
  const key = roKey(String(wordRef || ''));
  return key ? `legacy:${key}` : '';
}

function normalizeWordRoList(list = []) {
  const seen = new Set();
  const normalized = [];
  (Array.isArray(list) ? list : []).forEach(value => {
    const key = dailyWordKey(value);
    if (!key || seen.has(key)) return;
    seen.add(key);
    normalized.push(key);
  });
  return normalized;
}

function setHasRo(set, wordRo) {
  const key = dailyWordKey(wordRo);
  return [...set].some(value => dailyWordKey(value) === key);
}

function setAddRo(set, wordRo) {
  const key = dailyWordKey(wordRo);
  [...set].forEach(value => {
    if (dailyWordKey(value) === key) set.delete(value);
  });
  if (key) set.add(key);
}

function setDeleteRo(set, wordRo) {
  const key = dailyWordKey(wordRo);
  [...set].forEach(value => {
    if (dailyWordKey(value) === key) set.delete(value);
  });
}

function roListIncludes(list, wordRo) {
  const key = dailyWordKey(wordRo);
  return (list || []).some(value => dailyWordKey(value) === key);
}

function roListWithout(list, wordRo) {
  const key = dailyWordKey(wordRo);
  return (list || []).filter(value => dailyWordKey(value) !== key);
}

function queueIdsToWords(values = []) {
  return normalizeWordRoList(values).map(value => getWordByRo(value)).filter(Boolean);
}

function queueIdsToWordRos(values = []) {
  return queueIdsToWords(values).map(word => word.ro);
}

function queueIdsToWordIds(values = []) {
  return queueIdsToWords(values).map(word => Number(word.id)).filter(Number.isFinite);
}

function todayTemporaryGoalKey() {
  return `daily_goal_today:${currentUser?.id || 'local'}:${getDateKeyFor(new Date())}`;
}

function dailyCheckinKey() {
  return `daily_checkin:${currentUser?.id || 'local'}:${getDateKeyFor(new Date())}`;
}

function todaySeenWordsKey() {
  return `daily_seen_words:${currentUser?.id || 'local'}:${getDateKeyFor(new Date())}`;
}

function todayIntroducedWordsKey() {
  return `daily_introduced_words:${currentUser?.id || 'local'}:${getDateKeyFor(new Date())}`;
}

function dailyNewLimitKey() {
  return `daily_new_limit:${currentUser?.id || 'local'}`;
}

function todayAccuracyKey(dateKey = activeDailyDateKey || getDateKeyFor(new Date())) {
  return `daily_accuracy:${currentUser?.id || 'local'}:${dateKey}`;
}

function isDailyStateCurrent() {
  return activeDailyDateKey === getDateKeyFor(new Date());
}

function resetDailyRuntimeState(dateKey = getDateKeyFor(new Date())) {
  const previousDateKey = activeDailyDateKey;
  if (previousDateKey && pendingTodayAccuracyStats.total) {
    flushTodayAccuracyStats(previousDateKey);
  }
  pendingTodayAccuracyStats = { correct: 0, total: 0 };
  activeDailyDateKey = dateKey;
  todayLog = null;
  todayNewWords = 0;
  todayQueue = [];
  todayQueueCompleted = new Set();
  todaySeenWords = readTodaySeenWords();
  todayIntroducedWords = readTodayIntroducedWords();
  todayQueueRecord = null;
  dailyGoal = Math.max(defaultDailyGoal, readTodayTemporaryGoal());
  dailyCheckinPromptShown = false;
  lastCardAnswerSnapshot = null;
  flashHistory = [];
  flashOverrideRo = null;
  lastLearningHint = '';
  dailyQueueLoaded = false;
  dailyQueueVersion++;
  invalidateCalendarCache();
  invalidateQuizPracticePool();
}

function scheduleDailyStateReloadAfterDateChange() {
  if (!currentUser?.id || userRole === 'pending' || dailyDateReloadInFlight) return;
  dailyDateReloadInFlight = (async () => {
    try {
      await loadTodayLog();
      await loadDailyQueue();
    } catch (error) {
      console.warn('Daily state reload after date change failed', error);
      setSyncBadge('今日状态刷新失败', '');
    } finally {
      dailyDateReloadInFlight = null;
    }
  })();
}

function ensureDailyStateCurrent(options = {}) {
  if (isDailyStateCurrent()) return true;
  resetDailyRuntimeState();
  if (options.reload) scheduleDailyStateReloadAfterDateChange();
  return false;
}

function getProgressDateKey(value) {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return getDateKeyFor(date);
}

function wasWordCompletedOnActiveDate(wordRo) {
  const p = getProgress(wordRo);
  return getProgressDateKey(p?.lastReviewedAt || p?.last_reviewed_at) === activeDailyDateKey;
}

function readTodayTemporaryGoal() {
  try {
    const raw = localStorage.getItem(todayTemporaryGoalKey());
    return raw ? normalizeDailyGoalValue(raw, 0) : 0;
  } catch {
    return 0;
  }
}

function hasTodayTemporaryGoal() {
  try {
    return localStorage.getItem(todayTemporaryGoalKey()) !== null;
  } catch {
    return false;
  }
}

function clearTodayTemporaryGoal() {
  try {
    localStorage.removeItem(todayTemporaryGoalKey());
  } catch {}
}

function writeTodayTemporaryGoal(goal) {
  try {
    localStorage.setItem(todayTemporaryGoalKey(), String(normalizeDailyGoalValue(goal, defaultDailyGoal)));
  } catch {}
}

function isDefaultGoalDone() {
  return isDailyStateCurrent() && todayNewWords >= defaultDailyGoal;
}

function isCurrentTodayGoalDone() {
  return isDailyStateCurrent() && todayNewWords >= dailyGoal;
}

function resolveLoadedDailyGoal({ logGoal = 0, queueGoal = 0, completedCount = 0 } = {}) {
  const explicitTemporaryGoal = hasTodayTemporaryGoal() ? readTodayTemporaryGoal() : 0;
  if (explicitTemporaryGoal > defaultDailyGoal) {
    return Math.max(defaultDailyGoal, explicitTemporaryGoal);
  }
  const candidateGoal = Math.max(Number(logGoal || 0), Number(queueGoal || 0), defaultDailyGoal);
  const completed = Number(completedCount || 0);
  if (candidateGoal > defaultDailyGoal && completed > defaultDailyGoal) {
    return Math.max(candidateGoal, completed);
  }
  return defaultDailyGoal;
}

function getDailyQueueLocalSaveMessage() {
  if (isOfflineMode()) return '离线模式：每日队列已保存在本设备';
  return '每日队列已保存在本设备，暂未同步到其他设备';
}

function handleDailyQueueSyncError(record, operation = '保存') {
  if (!record?.syncError) return false;
  const safelyStored = !!record.local || !!record.pendingSync ||
    (typeof hasPendingDailyState === 'function' && currentUser?.id && hasPendingDailyState(currentUser.id));
  console.warn(`Daily queue cloud ${operation} deferred`, record.syncError);
  if (safelyStored) {
    setSyncBadge('队列待同步', '');
    showProgressSaveWarning('每日队列已安全保存在本机，稍后会自动同步');
  } else {
    setSyncBadge('队列同步失败', '');
    showProgressSaveWarning(`每日队列${operation}失败：${record.syncError}`);
  }
  return true;
}

function hasOpenTodayQueue() {
  return todayQueue.some(ro => !setHasRo(todayQueueCompleted, ro));
}

function getDeferredTodayQueueCount() {
  return todayQueue
    .filter(ro => !setHasRo(todayQueueCompleted, ro))
    .map(ro => getWordByRo(ro))
    .filter(Boolean)
    .filter(isRetryDeferred)
    .length;
}

function isDailyQueueDebugEnabled() {
  try {
    return new URLSearchParams(location.search).has('debugQueue') ||
      localStorage.getItem('debug_daily_queue') === '1';
  } catch {
    return false;
  }
}

function collectDailyQueueDebugMetrics(stage = 'snapshot', extra = {}) {
  const activeQueueRos = Array.isArray(todayQueue)
    ? todayQueue.filter(ro => !setHasRo(todayQueueCompleted, ro))
    : [];
  const activeQueueWords = activeQueueRos.map(ro => getWordByRo(ro)).filter(Boolean);
  const dueReviewWords = getRemainingDueReviewWords(W);
  const retryWords = W.filter(isPendingLearningRetryWord);
  const deferredWords = activeQueueWords.filter(isRetryDeferred);
  const unseenWords = getUnseenWords(W).filter(w => !setHasRo(todaySeenWords, w.ro) && !setHasRo(todayQueueCompleted, w.ro));
  const metrics = {
    stage,
    queueSize: activeQueueRos.length,
    savedQueueSize: Array.isArray(todayQueue) ? todayQueue.length : 0,
    filteredSize: Array.isArray(filtered) ? filtered.length : 0,
    reviewCount: dueReviewWords.length,
    retryCount: retryWords.length,
    deferredCount: deferredWords.length,
    newWordCount: unseenWords.length,
    fixedDailyNewLimit: dailyNewLimit,
    effectiveDailyNewLimit: getEffectiveDailyNewLimit(),
    dailyLearnedCount: todayNewWords,
    dailyGoal,
    remainingQuota: Math.max(0, Number(dailyGoal || 0) - Number(todayNewWords || 0)),
    unseenWordsAvailable: unseenWords.length,
    completedCount: todayQueueCompleted?.size || 0,
    seenTodayCount: todaySeenWords?.size || 0,
    dailyQueueLoaded,
    flashMode,
    curCat,
    pausedForCheckin: shouldPauseTodayStudyForCheckin(),
    pausedForGoal: shouldPauseTodayStudyForGoal(),
    queuePreview: activeQueueRos.slice(0, 8),
    filteredPreview: Array.isArray(filtered) ? filtered.slice(0, 8).map(w => w?.ro).filter(Boolean) : [],
    deferredPreview: deferredWords.slice(0, 8).map(w => w.ro),
    newPreview: unseenWords.slice(0, 8).map(w => w.ro),
    ...extra
  };
  if (isDailyQueueDebugEnabled()) {
    console.info('[daily-queue-debug]', JSON.stringify(metrics));
  }
  return metrics;
}

function debugDailyQueue(stage, extra = {}) {
  if (!isDailyQueueDebugEnabled()) return null;
  return collectDailyQueueDebugMetrics(stage, extra);
}

const dailyQueuePerfCounters = {};

function startDailyQueuePerf(name) {
  if (!isDailyQueueDebugEnabled()) return null;
  dailyQueuePerfCounters[name] = (dailyQueuePerfCounters[name] || 0) + 1;
  return {
    name,
    count: dailyQueuePerfCounters[name],
    startedAt: performance.now(),
    queueSizeBefore: Array.isArray(todayQueue) ? todayQueue.length : 0,
    idxBefore: idx
  };
}

function finishDailyQueuePerf(perf, extra = {}) {
  if (!perf) return;
  const payload = {
    functionName: perf.name,
    callCount: perf.count,
    durationMs: Math.round((performance.now() - perf.startedAt) * 100) / 100,
    idx: idx,
    idxBefore: perf.idxBefore,
    queueSizeBefore: perf.queueSizeBefore,
    queueSizeAfter: Array.isArray(todayQueue) ? todayQueue.length : 0,
    filteredSize: Array.isArray(filtered) ? filtered.length : 0,
    dailyQueueLoaded,
    ...extra
  };
  console.info('[daily-queue-perf]', JSON.stringify(payload));
}

if (typeof window !== 'undefined') {
  window.__rvDebugDailyQueue = () => collectDailyQueueDebugMetrics('manual');
  window.__rvDebugDailyQueuePerfCounters = dailyQueuePerfCounters;
}

function isActiveTodayQueueWord(w) {
  if (!w || isRetryDeferred(w)) return false;
  const p = getProgress(w.ro);
  return !hasWordProgress(p) ||
    isReviewDue(p) ||
    isPendingLearningRetryWord(w) ||
    normalizeScheduler(p || {}).needsReinforcement;
}

function getEligibleUnseenWordsForToday(words = W) {
  const queuedKeys = new Set(normalizeWordRoList(todayQueue).map(roKey));
  return getUnseenWords(words)
    .filter(w => !setHasRo(todaySeenWords, w.ro))
    .filter(w => !setHasRo(todayQueueCompleted, w.ro))
    .filter(w => !queuedKeys.has(roKey(w.ro)));
}

function saveRepairedTodayQueue(reason) {
  if (!currentUser?.id) return;
  saveTodayQueue({ background: true }).catch(error => {
    console.warn(`Daily queue repair save failed: ${reason}`, error);
    setSyncBadge('队列待同步', '');
  });
}

function ensureTodayQueueHasActiveCards(reason = 'unspecified', options = {}) {
  const perf = startDailyQueuePerf('ensureTodayQueueHasActiveCards');
  let changed = false;
  let persisted = false;
  let eligibleNewCount = 0;
  let vocabScanned = 0;
  let activeOpenCount = 0;
  let deferredOpenCount = 0;
  let activeSlots = 0;
  if (!progressLoaded) {
    debugDailyQueue('ensureTodayQueueHasActiveCards:blocked-progress-not-loaded', { reason });
    finishDailyQueuePerf(perf, {
      reason,
      changed: false,
      persisted: false,
      blocked: 'progress-not-loaded',
      vocabScanned: 0,
      eligibleNewCount: 0
    });
    return false;
  }
  const queueRos = normalizeWordRoList(todayQueue);
  const completedKeys = new Set([...todayQueueCompleted].map(roKey));
  const activeOpenWords = queueRos
    .filter(ro => !completedKeys.has(roKey(ro)))
    .map(ro => getWordByRo(ro))
    .filter(isActiveTodayQueueWord);
  const deferredOpenWords = queueRos
    .filter(ro => !completedKeys.has(roKey(ro)))
    .map(ro => getWordByRo(ro))
    .filter(Boolean)
    .filter(isRetryDeferred);
  activeOpenCount = activeOpenWords.length;
  deferredOpenCount = deferredOpenWords.length;
  activeSlots = Math.max(0, Number(dailyGoal || 0) - Number(todayNewWords || 0));
  if (!options.force && (activeOpenCount >= activeSlots || !activeSlots || shouldPauseTodayStudyForCheckin() || shouldPauseTodayStudyForGoal())) {
    debugDailyQueue('ensureTodayQueueHasActiveCards:fast-active', {
      reason,
      activeOpenCount,
      deferredOpenCount,
      activeSlots
    });
    finishDailyQueuePerf(perf, {
      reason,
      changed: false,
      persisted: false,
      fastPath: 'active-queue-full',
      activeOpenCount,
      deferredOpenCount,
      activeSlots,
      vocabScanned: 0,
      eligibleNewCount: 0
    });
    return false;
  }

  debugDailyQueue('ensureTodayQueueHasActiveCards:before', {
    reason,
    activeOpenCount,
    deferredOpenCount,
    activeSlots,
    eligibleNewCount
  });

  const mergedQueue = buildOpenTodayQueue(dailyGoal);
  changed = mergedQueue.join('|') !== queueRos.join('|');
  if (!changed) {
    finishDailyQueuePerf(perf, {
      reason,
      changed: false,
      persisted: false,
      activeOpenCount,
      deferredOpenCount,
      activeSlots,
      vocabScanned,
      eligibleNewCount,
      injectedCount: 0
    });
    return false;
  }

  todayQueue = mergedQueue;
  dailyQueueVersion++;
  invalidateQuizPracticePool();
  debugDailyQueue('ensureTodayQueueHasActiveCards:after', {
    reason,
    injectedCount: 0,
    resultSize: todayQueue.length
  });
  if (!options.skipSave) {
    persisted = true;
    saveRepairedTodayQueue(reason);
  }
  finishDailyQueuePerf(perf, {
    reason,
    changed,
    persisted,
    activeOpenCount,
    deferredOpenCount,
    activeSlots,
    vocabScanned,
    eligibleNewCount,
    injectedCount: 0
  });
  return true;
}

function shouldPauseTodayStudyForCheckin() {
  return isDefaultGoalDone() && !isDailyCheckinDone();
}

function shouldPauseTodayStudyForGoal() {
  return isCurrentTodayGoalDone();
}

function isDailyCheckinDone() {
  if (isTodayLogCheckedIn()) return true;
  try {
    return localStorage.getItem(dailyCheckinKey()) === '1';
  } catch {
    return false;
  }
}

function isTodayLogCheckedIn() {
  return todayLog?.log_date === getDateKeyFor(new Date()) && todayLog.completed === true;
}

function writeDailyCheckinDone() {
  try {
    localStorage.setItem(dailyCheckinKey(), '1');
  } catch {}
}

function readTodaySeenWords() {
  try {
    return new Set(normalizeWordRoList(JSON.parse(localStorage.getItem(todaySeenWordsKey()) || '[]')));
  } catch {
    return new Set();
  }
}

function writeTodaySeenWords() {
  try {
    localStorage.setItem(todaySeenWordsKey(), JSON.stringify([...todaySeenWords]));
  } catch {}
}

function readTodayIntroducedWords() {
  try {
    return new Set(normalizeWordRoList(JSON.parse(localStorage.getItem(todayIntroducedWordsKey()) || '[]')));
  } catch {
    return new Set();
  }
}

function writeTodayIntroducedWords() {
  try {
    localStorage.setItem(todayIntroducedWordsKey(), JSON.stringify([...todayIntroducedWords]));
  } catch {}
}

function readDailyNewLimit() {
  try {
    return normalizeDailyNewLimitValue(localStorage.getItem(dailyNewLimitKey()), DEFAULT_DAILY_NEW_LIMIT);
  } catch {
    return DEFAULT_DAILY_NEW_LIMIT;
  }
}

function writeDailyNewLimit(value) {
  dailyNewLimit = normalizeDailyNewLimitValue(value, DEFAULT_DAILY_NEW_LIMIT);
  try {
    localStorage.setItem(dailyNewLimitKey(), String(dailyNewLimit));
  } catch {}
  const input = document.getElementById('new-limit-input');
  if (input) input.value = String(dailyNewLimit);
  return dailyNewLimit;
}

function markTodayNewIntroduction(wordRo) {
  const canonicalRo = canonicalWordRo(wordRo);
  if (!canonicalRo || setHasRo(todayIntroducedWords, canonicalRo)) return false;
  setAddRo(todayIntroducedWords, canonicalRo);
  writeTodayIntroducedWords();
  dailyQueueVersion++;
  return true;
}

function mergeTodayIntroductionsFromProgress(wordRefs = []) {
  const todayKey = getDateKeyFor(new Date());
  let changed = false;
  normalizeWordRoList(wordRefs).forEach(ref => {
    const word = getWordByRo(ref);
    const progress = word ? getProgress(word.ro) : null;
    if (!word || !hasWordProgress(progress)) return;
    const scheduler = normalizeScheduler(progress);
    const reviewedToday = getProgressDateKey(scheduler.lastReviewedAt || progress.lastReviewedAt) === todayKey;
    const looksLikeNewLearning = scheduler.cardState === 'learning' &&
      !scheduler.lapses &&
      !progress.wasMasteredAt &&
      !progress.was_mastered_at;
    if (reviewedToday && looksLikeNewLearning && !setHasRo(todayIntroducedWords, word.ro)) {
      setAddRo(todayIntroducedWords, word.ro);
      changed = true;
    }
  });
  if (changed) writeTodayIntroducedWords();
  return changed;
}

function getTodayAttemptStats() {
  const saved = readTodayAccuracyStats();
  return {
    correct: saved.correct + pendingTodayAccuracyStats.correct,
    total: saved.total + pendingTodayAccuracyStats.total
  };
}

function readTodayAccuracyStats(dateKey = activeDailyDateKey) {
  try {
    const raw = JSON.parse(localStorage.getItem(todayAccuracyKey(dateKey)) || '{}');
    return {
      correct: Math.max(0, Number(raw.correct || 0)),
      total: Math.max(0, Number(raw.total || 0))
    };
  } catch {
    return { correct: 0, total: 0 };
  }
}

function writeTodayAccuracyStats(stats, dateKey = activeDailyDateKey) {
  try {
    localStorage.setItem(todayAccuracyKey(dateKey), JSON.stringify({
      correct: Math.max(0, Number(stats.correct || 0)),
      total: Math.max(0, Number(stats.total || 0))
    }));
  } catch {}
}

function queueTodayAccuracyAttempt(correct) {
  pendingTodayAccuracyStats.total += 1;
  if (correct) pendingTodayAccuracyStats.correct += 1;
}

function flushTodayAccuracyStats(dateKey = activeDailyDateKey) {
  if (!pendingTodayAccuracyStats.total) return;
  const pending = pendingTodayAccuracyStats;
  pendingTodayAccuracyStats = { correct: 0, total: 0 };
  const stats = readTodayAccuracyStats(dateKey);
  stats.total += pending.total;
  stats.correct += pending.correct;
  writeTodayAccuracyStats(stats, dateKey);
}

function getTodayCheckinAccuracy() {
  const stats = readTodayAccuracyStats();
  const total = stats.total + pendingTodayAccuracyStats.total;
  const correct = stats.correct + pendingTodayAccuracyStats.correct;
  if (total > 0) return Math.round(correct / total * 100);
  const base = Math.max(1, Number(defaultDailyGoal || dailyGoal || DEFAULT_DAILY_GOAL));
  return Math.min(100, Math.round(Math.min(todayNewWords, base) / base * 100));
}

function wrongbookStreakKey() {
  return `wrongbook_streaks:${currentUser?.id || 'local'}`;
}

function loadWrongbookStreaks() {
  try {
    return JSON.parse(localStorage.getItem(wrongbookStreakKey()) || '{}') || {};
  } catch {
    return {};
  }
}

function saveWrongbookStreaks() {
  try {
    localStorage.setItem(wrongbookStreakKey(), JSON.stringify(wbStreaks));
  } catch {}
}

const SUBJECT_CATEGORIES = TOPICS.filter(item => item.value !== 'unclassified').map(item => item.value);
const CATEGORY_ORDER = ['全部', ...SUBJECT_CATEGORIES, 'unclassified'];

function getCategoryLabel(category) {
  return category === '全部' ? '全部主题' : getTopicLabel(category);
}

const DEXONLINE_VERB_FALLBACK_WORDS = [
  { zh: '去', ro: 'a merge', ipa: 'a merge', hint: '动词 · 零变位 · dexonline', cat: 'verb' },
  { zh: '来', ro: 'a veni', ipa: 'a venI', hint: '动词 · 零变位 · dexonline', cat: 'verb' },
  { zh: '做', ro: 'a face', ipa: 'a face', hint: '动词 · 零变位 · dexonline', cat: 'verb' },
  { zh: '说', ro: 'a spune', ipa: 'a spune', hint: '动词 · 零变位 · dexonline', cat: 'verb' },
  { zh: '看', ro: 'a vedea', ipa: 'a vedea', hint: '动词 · 零变位 · dexonline', cat: 'verb' },
  { zh: '听', ro: 'a auzi', ipa: 'a auzi', hint: '动词 · 零变位 · dexonline', cat: 'verb' },
  { zh: '吃', ro: 'a mânca', ipa: 'a mâncA', hint: '动词 · 零变位 · dexonline', cat: 'verb' },
  { zh: '喝', ro: 'a bea', ipa: 'a beA', hint: '动词 · 零变位 · dexonline', cat: 'verb' },
  { zh: '读', ro: 'a citi', ipa: 'a citi', hint: '动词 · -esc 变位 · dexonline', cat: 'verb' },
  { zh: '写', ro: 'a scrie', ipa: 'a scrie', hint: '动词 · 零变位 · dexonline', cat: 'verb' },
  { zh: '学习', ro: 'a învăța', ipa: 'a învăța', hint: '动词 · 零变位 · dexonline', cat: 'verb' },
  { zh: '工作', ro: 'a lucra', ipa: 'a lucrA', hint: '动词 · 零变位 · dexonline', cat: 'verb' },
  { zh: '买', ro: 'a cumpăra', ipa: 'a cumpăra', hint: '动词 · 零变位 · dexonline', cat: 'verb' },
  { zh: '卖', ro: 'a vinde', ipa: 'a vinde', hint: '动词 · 零变位 · dexonline', cat: 'verb' },
  { zh: '打开', ro: 'a deschide', ipa: 'a deschide', hint: '动词 · 零变位 · dexonline', cat: 'verb' },
  { zh: '关闭', ro: 'a închide', ipa: 'a închide', hint: '动词 · 零变位 · dexonline', cat: 'verb' },
  { zh: '等待', ro: 'a aștepta', ipa: 'a aștepta', hint: '动词 · 零变位 · dexonline', cat: 'verb' },
  { zh: '需要', ro: 'a trebui', ipa: 'a trebui', hint: '动词 · 零变位 · dexonline', cat: 'verb' },
  { zh: '想要', ro: 'a vrea', ipa: 'a vreA', hint: '动词 · 零变位 · dexonline', cat: 'verb' },
  { zh: '能够', ro: 'a putea', ipa: 'a putea', hint: '动词 · 零变位 · dexonline', cat: 'verb' },
  { zh: '知道', ro: 'a ști', ipa: 'a ști', hint: '动词 · 零变位 · dexonline', cat: 'verb' },
  { zh: '理解', ro: 'a înțelege', ipa: 'a înțelege', hint: '动词 · 零变位 · dexonline', cat: 'verb' },
  { zh: '帮助', ro: 'a ajuta', ipa: 'a ajuta', hint: '动词 · 零变位 · dexonline', cat: 'verb' },
  { zh: '开始', ro: 'a începe', ipa: 'a începe', hint: '动词 · 零变位 · dexonline', cat: 'verb' },
  { zh: '结束', ro: 'a termina', ipa: 'a termina', hint: '动词 · 零变位 · dexonline', cat: 'verb' }
];

// 熟练度规则
// unknown  → 从未答题
// learning → 答题次数 ≥ 1，正确率 < 80%
// mastered → 答题次数 ≥ 3，正确率 ≥ 80%，且至少通过一次跨天复习

// ── 入口 ─────────────────────────────────────────────────

async function init() {
  if (localStorage.getItem('offline-mode') === '1') {
    await doOfflineLogin();
    return;
  }
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (session) {
      await onLogin(session.user);
      return;
    }
    if (typeof isFileApp === 'function' && isFileApp()) {
      showAuthMsg('当前是从本地文件打开的页面。请用 http://127.0.0.1:4173/ 打开应用后再登录。', 'error');
    }
  } catch (error) {
    showAuthMsg('初始化登录状态失败：' + authErrorMessage(error), 'error');
  }
}

async function onLogin(user) {
  currentUser = user;
  const profile = await apiGetProfile(user.id);
  userRole = profile?.role || 'pending';

  if (userRole === 'pending') { showPendingScreen(); return; }

  const nickname = profile?.nickname || user.email.split('@')[0];
  defaultDailyGoal = await migrateLegacyDailyGoal(user.id, profile?.daily_goal);
  dailyGoal = defaultDailyGoal;
  dailyNewLimit = readDailyNewLimit();
  learningCollectionId = readLearningCollection();
  todayIntroducedWords = readTodayIntroducedWords();
  progressLoaded = false;

  // 先设置目标输入框
  const goalInput = document.getElementById('goal-input');
  if (goalInput) goalInput.value = defaultDailyGoal;
  const newLimitInput = document.getElementById('new-limit-input');
  if (newLimitInput) newLimitInput.value = dailyNewLimit;

  showAppScreen(nickname, userRole === 'admin');

  // 先加载词库，但不渲染可答卡片；长线进度加载完成后才能判断新词/复习状态。
  await loadWords({ render: false });
  await Promise.all([loadProgress(), loadTodayLog()]);
  await loadDailyQueue();
  setupDailyReminderChecks();
  setupProgressAutoBackup();
  retryPendingProgressAfterLoad();

  if (userRole === 'admin') refreshAdminBadge();
  if (isOfflineMode()) setSyncBadge('本机保存', 'saved');
}

// ── 词库加载 ──────────────────────────────────────────────

function learningCollectionStorageKey() {
  return `learning_collection:${currentUser?.id || 'local'}`;
}

function readLearningCollection() {
  try {
    return normalizeLearningCollection(localStorage.getItem(learningCollectionStorageKey()) || DEFAULT_LEARNING_COLLECTION);
  } catch {
    return DEFAULT_LEARNING_COLLECTION;
  }
}

function writeLearningCollection(value) {
  learningCollectionId = normalizeLearningCollection(value);
  try { localStorage.setItem(learningCollectionStorageKey(), learningCollectionId); } catch {}
  return learningCollectionId;
}

function getLearningCollectionWords(words = W) {
  return (Array.isArray(words) ? words : []).filter(word => wordMatchesLearningCollection(word, learningCollectionId));
}

function populateLearningCollectionControls() {
  const options = LEARNING_COLLECTIONS.map(collection =>
    `<option value="${escapeHtml(collection.value)}">${escapeHtml(collection.label)}</option>`
  ).join('');
  document.querySelectorAll('#learning-collection-select, #list-collection-filter').forEach(select => {
    const previous = select.id === 'learning-collection-select'
      ? learningCollectionId
      : (select.value || 'all');
    select.innerHTML = select.id === 'list-collection-filter'
      ? `<option value="all">全部词书</option>${options}`
      : options;
    if ([...select.options].some(option => option.value === previous)) select.value = previous;
  });
  const note = LEARNING_COLLECTIONS.find(collection => collection.value === learningCollectionId)?.description || '';
  setText('learning-collection-note', `${getLearningCollectionLabel(learningCollectionId)}：${note}`);
}

async function setLearningCollection(value) {
  const next = normalizeLearningCollection(value);
  if (next === learningCollectionId) return;
  const switchVersion = ++learningCollectionSwitchVersion;
  if (todayStateFlushTimer) {
    clearTimeout(todayStateFlushTimer);
    todayStateFlushTimer = null;
  }
  flushFastProgressQueue();
  flushTodayAccuracyStats();
  writeTodaySeenWords();
  const previousQueueSnapshot = buildDailyQueueSaveSnapshot();
  await saveTodayQueue({ payload: previousQueueSnapshot });
  if (switchVersion !== learningCollectionSwitchVersion) return;
  writeLearningCollection(next);
  curCat = '全部';
  flashMode = 'today';
  flashHistory = [];
  flashOverrideRo = null;
  lastCardAnswerSnapshot = null;
  resetQuizSession();
  invalidateQuizPracticePool();
  todayQueue = todayQueue
    .map(ro => getWordByRo(ro))
    .filter(word => word && wordMatchesLearningCollection(word, learningCollectionId))
    .map(word => word.ro);
  todayQueue = buildOpenTodayQueue(dailyGoal);
  appendExplicitTodayQueueCards(dailyGoal);
  populateLearningCollectionControls();
  updateVocabCountLabels();
  buildCats();
  applyFilters();
  renderCard();
  renderList();
  renderDailyGoal();
  const queueSnapshot = buildDailyQueueSaveSnapshot();
  await saveTodayQueue({ forceLocal: true, payload: queueSnapshot });
  if (switchVersion !== learningCollectionSwitchVersion || learningCollectionId !== next) return;
  showToast(`已切换到${getLearningCollectionLabel(learningCollectionId)}，学习进度保持不变`);
}

async function loadWords(options = {}) {
  const shouldRender = options.render !== false;
  const startedAt = Date.now();
  showVocabLoading();

  try {
    W = (await apiLoadWords())
      .map(normalizeWordCategory)
      .filter(word => !looksLikeTemplateWord(word));
    if (!W.length) throw new Error('词库为空');
    rebuildWordRoIndex();
    const exampleBankPromise = loadExampleBank();
    if (shouldRender) applyFilters();

    updateVocabCountLabels();

    populateCategoryDatalist();
    populateLearningCollectionControls();
    buildCats();
    if (shouldRender) renderCard();

    if (shouldRender) showFlashContent();
    console.info(`Words ready: ${W.length} words in ${Date.now() - startedAt}ms`);
    exampleBankPromise.then(() => {
      if (progressLoaded && dailyQueueLoaded) renderCard();
    });
  } catch (error) {
    console.error('Words load failed', error);
    showVocabLoadError(error);
  }
}

function updateVocabCountLabels() {
  const total = document.getElementById('s-total');
  const badge = document.getElementById('topbar-badge');
  const collectionCount = getLearningCollectionWords(W).length;
  if (total) total.textContent = collectionCount;
  if (badge) badge.textContent = `${collectionCount}词 · ${getLearningCollectionLabel(learningCollectionId)}`;
}

function showFlashContent() {
  const loading = document.getElementById('flash-loading');
  const content = document.getElementById('flash-content');
  if (loading) loading.style.display = 'none';
  if (content) content.style.display = 'block';
}

function showVocabLoading() {
  const loading = document.getElementById('flash-loading');
  if (loading) {
    loading.style.display = 'flex';
    loading.innerHTML = `
      <div class="loading-spinner"></div>
      <div class="loading-text">正在加载词库...</div>
    `;
  }
  const content = document.getElementById('flash-content');
  if (content) content.style.display = 'none';
}

function showVocabLoadError(error) {
  window.reportClientIssue?.('words_load_failed', error, { operation: 'load_words' });
  const loading = document.getElementById('flash-loading');
  if (!loading) return;
  loading.style.display = 'flex';
  loading.innerHTML = `
    <div class="loading-text" style="font-weight:800;color:var(--text)">词库加载失败</div>
    <div class="loading-text">网络或云端响应过慢。已避免继续卡住，请重试。</div>
    <button class="btn-sm" onclick="loadWords()">重新加载</button>
  `;
  const topbarBadge = document.getElementById('topbar-badge');
  if (topbarBadge) topbarBadge.textContent = '加载失败';
  showToast('词库加载失败：' + (error?.message || '请稍后重试'));
}

async function loadExampleBank() {
  if (exampleBankLoaded) return exampleBank;
  if (exampleBankLoadPromise) return exampleBankLoadPromise;
  exampleBankLoadPromise = (async () => {
  try {
    const response = await fetch('./data/examples.json?v=20260812-adversarial-v2', { cache: 'reload' });
    if (!response.ok) {
      exampleBank = {};
      return exampleBank;
    }
    const payload = await response.json();
    exampleBank = payload?.examples && typeof payload.examples === 'object' ? payload.examples : {};
  } catch {
    exampleBank = {};
  } finally {
    exampleBankLoaded = true;
    exampleBankLoadPromise = null;
  }
  return exampleBank;
  })();
  return exampleBankLoadPromise;
}

async function loadProgress() {
  if (!isOfflineMode() && typeof readLocalProgressFallback === 'function') {
    const localProgress = readLocalProgressFallback(currentUser.id);
    if (Object.keys(localProgress).length) {
      replaceProgressMap(localProgress);
      progressLoaded = true;
      setSyncBadge(hasPendingProgress(localProgress) ? '本机待同步' : '本机进度', hasPendingProgress(localProgress) ? '' : 'saved');
      if (dailyQueueLoaded) {
        applyFilters();
        renderCard();
      }
      upStats();
      refreshCloudProgressAfterLocalLoad();
      return;
    }
  }
  try {
    const loadedProgress = await apiLoadProgress(currentUser.id);
    const progressSource = loadedProgress.__progressSource || 'cloud';
    const progressError = loadedProgress.__progressError || '';
    replaceProgressMap(loadedProgress);
    progressLoaded = true;
    if (progressSource === 'localFallback') {
      window.reportClientIssue?.('progress_load_fallback', progressError, { operation: 'load_progress' });
      setSyncBadge('本机待同步', '');
      showProgressSaveWarning(`云端进度读取失败，已显示本机保存的进度：${progressError || '请稍后重试'}`);
    } else if (progressSource === 'cloudWithPending') {
      setSyncBadge('本机待同步', '');
    } else {
      setSyncBadge(isOfflineMode() ? '本机保存' : '', isOfflineMode() ? 'saved' : '');
    }
    if (dailyQueueLoaded) {
      applyFilters();
      renderCard();
    }
    upStats();
    if (progressSource === 'cloudWithPending' && typeof apiRetryPendingProgress === 'function') {
      setSyncBadge('本机待同步', '');
    }
  } catch (error) {
    window.reportClientIssue?.('progress_load_failed', error, { operation: 'load_progress' });
    const fallback = typeof readLocalProgressFallback === 'function'
      ? readLocalProgressFallback(currentUser.id)
      : {};
    replaceProgressMap(fallback);
    progressLoaded = true;
    setSyncBadge(Object.keys(fallback).length ? '本机待同步' : '进度读取失败', '');
    showToast(Object.keys(fallback).length
      ? `进度读取失败，已显示本机保存的进度：${error.message || '请稍后重试'}`
      : `进度读取失败：${error.message || '请刷新重试'}`);
    if (dailyQueueLoaded) {
      applyFilters();
      renderCard();
    }
    upStats();
  }
}

function hasPendingProgress(map = progressMap) {
  return Object.values(map || {}).some(progress => progress?.pendingSync);
}

function getPendingSyncSummary() {
  if (!currentUser?.id || typeof apiGetPendingSyncSummary !== 'function') {
    return { progressCount: 0, dailyCount: 0, totalCount: 0, lastError: '' };
  }
  return apiGetPendingSyncSummary(currentUser.id);
}

function hasPendingSync() {
  const summary = getPendingSyncSummary();
  return summary.totalCount > 0 || hasPendingProgress();
}

function reconcileProgressPendingFlags() {
  if (!currentUser?.id || typeof readPendingProgress !== 'function') return getPendingSyncSummary();
  const pending = readPendingProgress(currentUser.id);
  let changed = false;
  Object.keys(progressMap).forEach((key) => {
    const shouldBePending = !!pending[key];
    const isMarkedPending = !!progressMap[key]?.pendingSync;
    if (shouldBePending === isMarkedPending) return;
    progressMap[key] = { ...progressMap[key] };
    if (shouldBePending) progressMap[key].pendingSync = true;
    else delete progressMap[key].pendingSync;
    changed = true;
  });
  if (changed) {
    progressVersion++;
    if (typeof writeLocalProgressSnapshot === 'function') {
      writeLocalProgressSnapshot(currentUser.id, progressMap);
    }
  }
  return getPendingSyncSummary();
}

async function refreshCloudProgressAfterLocalLoad(options = {}) {
  if (isOfflineMode() || !currentUser?.id) return;
  try {
    const refreshKey = `progress_cloud_refresh_at:${currentUser.id}`;
    const lastRefreshAt = Number(localStorage.getItem(refreshKey) || 0);
    if (!options.force && Date.now() - lastRefreshAt < CLOUD_PROGRESS_REFRESH_COOLDOWN_MS) return;
    localStorage.setItem(refreshKey, String(Date.now()));
    if (typeof apiMergeLegacyProgressBaselines === 'function') {
      await apiMergeLegacyProgressBaselines(currentUser.id, progressMap);
    }
    const loadedProgress = await apiLoadProgress(currentUser.id);
    const progressSource = loadedProgress.__progressSource || 'cloud';
    // Cloud is authoritative after durable pending events are overlaid by
    // apiLoadProgress. This allows corrections and undo from another device.
    replaceProgressMap(loadedProgress);
    progressLoaded = true;
    const stillPending = progressSource === 'cloudWithPending' || hasPendingProgress(loadedProgress) || hasPendingSync();
    setSyncBadge(stillPending ? '本机待同步' : '已同步', stillPending ? '' : 'saved');
    if (dailyQueueLoaded) {
      applyFilters();
      renderCard();
    }
    upStats();
    updateReviewBadge();
    if (progressSource === 'cloudWithPending' && typeof apiRetryPendingProgress === 'function') {
      setSyncBadge('本机待同步', '');
    }
  } catch (error) {
    console.warn('Cloud progress refresh after local load failed', error);
    setSyncBadge(hasPendingSync() ? '本机待同步' : '本机进度', hasPendingSync() ? '' : 'saved');
  }
}

async function retryPendingProgressAfterLoad() {
  try {
    const retryKey = `progress_pending_retry_at:${currentUser.id}`;
    const lastRetryAt = Number(localStorage.getItem(retryKey) || 0);
    const hasDailyPending = typeof hasPendingDailyState === 'function' && hasPendingDailyState(currentUser.id);
    if (Date.now() - lastRetryAt < PENDING_PROGRESS_RETRY_COOLDOWN_MS && !hasDailyPending) {
      setSyncBadge('本机待同步', '');
      return;
    }
    const result = await triggerCloudProgressBackup('启动同步', { force: true, limit: 250 });
    localStorage.setItem(retryKey, String(Date.now()));
    const attempted = Number(result?.attempted || 0) + Number(result?.dailyAttempted || 0) + Number(result?.retry?.attempted || 0);
    if (!attempted) return;
    if (result?.failed || result?.remaining || result?.dailyError || result?.syncError || hasPendingSync()) {
      setSyncBadge('本机待同步', '');
      return;
    }
    setSyncBadge('已同步', 'saved');
    applyFilters();
    renderCard();
    upStats();
    updateReviewBadge();
  } catch (error) {
    console.warn('Pending progress retry after load failed', error);
    setSyncBadge('本机待同步', '');
  }
}

function setupProgressAutoBackup() {
  if (setupProgressAutoBackup.bound) return;
  setupProgressAutoBackup.bound = true;
  const activityEvents = ['pointerdown', 'keydown', 'touchstart', 'scroll'];
  activityEvents.forEach(eventName => {
    window.addEventListener(eventName, scheduleIdleProgressBackup, { passive: true });
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      flushPendingFastCardState();
      triggerCloudProgressBackup('页面隐藏', { limit: 100 });
    }
    else {
      scheduleIdleProgressBackup();
      refreshCloudProgressAfterLocalLoad({ force: true });
    }
  });
  window.addEventListener('pagehide', () => {
    flushPendingFastCardState();
    triggerCloudProgressBackup('退出页面', { limit: 100 });
  });
  window.addEventListener('beforeunload', () => {
    flushPendingFastCardState();
    triggerCloudProgressBackup('退出页面', { limit: 100 });
  });
  window.addEventListener('online', () => {
    Promise.resolve(triggerCloudProgressBackup('网络恢复', { force: true, limit: 250 }))
      .finally(() => refreshCloudProgressAfterLocalLoad({ force: true }));
  });
  scheduleIdleProgressBackup();
}

function scheduleIdleProgressBackup() {
  if (progressCloudSyncTimer) clearTimeout(progressCloudSyncTimer);
  progressCloudSyncTimer = setTimeout(() => {
    triggerCloudProgressBackup('空闲备份', { limit: 100 });
  }, IDLE_PROGRESS_BACKUP_MS);
}

async function triggerCloudProgressBackup(reason = '备份', options = {}) {
  if (isOfflineMode() || !currentUser?.id || typeof apiRetryPendingProgress !== 'function') return null;
  if (progressCloudSyncInFlight) return progressCloudSyncInFlight;
  if (!hasPendingSync() && !options.force) return null;
  setSyncBadge(`${reason}中...`, '');
  progressCloudSyncInFlight = (async () => {
    let cloudReadConfirmed = false;
    try {
      const [progressResult, dailyResult] = await Promise.allSettled([
        apiRetryPendingProgress(currentUser.id, options.limit || 100),
        syncDailyStateToCloud()
      ]);
      const result = progressResult.status === 'fulfilled'
        ? progressResult.value
        : { failed: true, error: progressResult.reason };
      if (dailyResult.status === 'rejected') {
        result.failed = true;
        result.dailyError = dailyResult.reason;
      } else if (dailyResult.value?.syncError) {
        result.failed = true;
        result.dailyError = dailyResult.value.syncError;
      }
      if (dailyResult.status === 'fulfilled') {
        result.dailyAttempted = Number(dailyResult.value?.retry?.attempted || 0);
        result.dailyRemaining = Number(dailyResult.value?.retry?.remaining || 0);
      }
      let pendingSummary = reconcileProgressPendingFlags();
      result.pendingSummary = pendingSummary;
      if (!result.failed && pendingSummary.totalCount === 0) {
        const cloudProgress = await apiLoadProgress(currentUser.id);
        if (cloudProgress.__progressSource !== 'localFallback') {
          result.cloudProgress = cloudProgress;
          replaceProgressMap(cloudProgress);
          pendingSummary = reconcileProgressPendingFlags();
          result.pendingSummary = pendingSummary;
        } else {
          result.failed = true;
          result.error = new Error(cloudProgress.__progressError || '云端进度回读失败');
        }
      }
      const stillPending = result.failed || result.remaining || result.dailyRemaining ||
        pendingSummary.totalCount > 0 || hasPendingProgress();
      if (!result.attempted && !result.dailyAttempted) {
        cloudReadConfirmed = !stillPending;
        setSyncBadge(stillPending ? '本机待同步' : '已同步', stillPending ? '' : 'saved');
        return result;
      }
      if (stillPending) {
        setSyncBadge('本机待同步', '');
      } else {
        cloudReadConfirmed = true;
        setSyncBadge('已同步', 'saved');
      }
      return result;
    } catch (error) {
      console.warn('Progress cloud backup failed', reason, error);
      setSyncBadge('本机待同步', '');
      return { failed: true, error };
    } finally {
      progressCloudSyncInFlight = null;
      renderSyncStatus();
      setTimeout(() => {
        if (cloudReadConfirmed && !hasPendingSync()) setSyncBadge('', '');
      }, 2000);
    }
  })();
  return progressCloudSyncInFlight;
}

async function syncDailyStateToCloud() {
  if (isOfflineMode() || !currentUser?.id) return null;
  if (!ensureDailyStateCurrent({ reload: true })) return null;
  const checkinDone = isDailyCheckinDone();
  const queuePayload = {
    collection_id: learningCollectionId,
    goal: dailyGoal,
    word_id: queueIdsToWordIds(todayQueue),
    word_ro: queueIdsToWordRos(todayQueue),
    completed_word_id: queueIdsToWordIds([...todayQueueCompleted]),
    completed_word_ro: queueIdsToWordRos([...todayQueueCompleted]),
    introduced_word_id: queueIdsToWordIds([...todayIntroducedWords]),
    introduced_word_ro: queueIdsToWordRos([...todayIntroducedWords]),
    completed: isCurrentTodayGoalDone()
  };
  const results = await Promise.allSettled([
    apiSaveDailyQueue(currentUser.id, queuePayload),
    apiUpdateTodayLog(currentUser.id, todayNewWords, dailyGoal, defaultDailyGoal, { completed: checkinDone })
  ]);
  const rejected = results.find(result => result.status === 'rejected');
  if (rejected) throw rejected.reason;
  const retryResult = typeof apiRetryPendingDailyState === 'function'
    ? await apiRetryPendingDailyState(currentUser.id)
    : { attempted: 0, failed: 0, remaining: 0 };
  const syncError = results
    .filter(result => result.status === 'fulfilled' && result.value?.syncError)
    .map(result => result.value.syncError)
    .join('；');
  if (syncError || retryResult.failed || retryResult.remaining) {
    return {
      saved: false,
      syncError: syncError || '每日状态仍有待同步项',
      retry: retryResult
    };
  }
  return { saved: true, retry: retryResult };
}

function saveTodayLogBackground(promise, label = '今日记录待同步') {
  return promise.then(result => {
    if (result?.syncError) {
      window.reportClientIssue?.('daily_sync_deferred', result.syncError, { operation: 'save_today_log' });
      console.warn('Today log saved locally; cloud sync pending', result.syncError);
      setSyncBadge(label, '');
      showProgressSaveWarning(`今日记录暂存本机：${result.syncError}`);
    }
    return result;
  }).catch(error => {
    window.reportClientIssue?.('daily_sync_failed', error, { operation: 'save_today_log' });
    console.warn('Today log background save failed', error);
    setSyncBadge(label, '');
    showProgressSaveWarning('今日记录暂存本机，云端同步稍后重试');
    return { saved: 'local', syncError: error.message || String(error) };
  });
}

async function loadTodayLog() {
  const loadDateKey = getDateKeyFor(new Date());
  activeDailyDateKey = loadDateKey;
  todayIntroducedWords = readTodayIntroducedWords();
  let loadedTodayLog = null;
  let loadError = null;
  try {
    loadedTodayLog = await apiGetTodayLog(currentUser.id, dailyGoal);
  } catch (error) {
    loadError = error;
  }
  if (loadDateKey !== getDateKeyFor(new Date())) {
    resetDailyRuntimeState();
    return loadTodayLog();
  }
  if (loadError) {
    todayLog = { new_words: 0, goal: dailyGoal, completed: false, syncError: loadError.message };
    setSyncBadge('今日记录读取失败', '');
    showToast(`今日记录读取失败：${loadError.message || '请刷新重试'}`);
  } else {
    todayLog = loadedTodayLog;
  }
  if (todayLog?.syncError) {
    setSyncBadge('今日记录待同步', '');
    console.warn('Today log loaded from local fallback', todayLog.syncError);
  }
  todayNewWords = todayLog?.new_words || 0;
  if (todayLog?.log_date === getDateKeyFor(new Date()) && todayLog.completed === true) writeDailyCheckinDone();
  const logGoal = normalizeDailyGoalValue(todayLog?.goal, defaultDailyGoal);
  dailyGoal = resolveLoadedDailyGoal({ logGoal, completedCount: todayNewWords });
  setGoalInputValue(defaultDailyGoal);
  invalidateCalendarCache();
  // 全部数据加载完毕，统一渲染
  upStats();
  renderList();
  renderDailyGoal();
  renderCalendar();
  updateReviewBadge();
}

async function loadDailyQueue() {
  const loadDateKey = getDateKeyFor(new Date());
  activeDailyDateKey = loadDateKey;
  todayIntroducedWords = readTodayIntroducedWords();
  dailyQueueLoaded = false;
  const previousTodayCount = todayLog?.new_words || 0;
  const saved = await apiGetDailyQueue(currentUser.id, dailyGoal);
  if (loadDateKey !== getDateKeyFor(new Date())) {
    resetDailyRuntimeState();
    await loadTodayLog();
    return loadDailyQueue();
  }
  let queueChanged = false;
  let forceQueueLocal = false;
  const logGoal = normalizeDailyGoalValue(todayLog?.goal, defaultDailyGoal);
  const localTemporaryGoal = hasTodayTemporaryGoal() ? readTodayTemporaryGoal() : 0;
  handleDailyQueueSyncError(saved, '读取');
  const savedWordRefs = saved?.word_id?.length ? saved.word_id : (saved?.word_ro || []);
  const savedCompletedRefs = saved?.completed_word_id?.length ? saved.completed_word_id : (saved?.completed_word_ro || []);
  const savedIntroducedRefs = saved?.introduced_word_id?.length ? saved.introduced_word_id : (saved?.introduced_word_ro || []);
  const hasSavedQueueState = !!(savedWordRefs.length || savedCompletedRefs.length);
  if (hasSavedQueueState) {
    todayQueueRecord = saved;
    const savedCollection = normalizeLearningCollection(saved.collection_id || DEFAULT_LEARNING_COLLECTION);
    if (savedCollection !== learningCollectionId) {
      forceQueueLocal = true;
      queueChanged = true;
    }
    const savedGoal = normalizeDailyGoalValue(saved.goal, defaultDailyGoal);
    dailyGoal = resolveLoadedDailyGoal({
      logGoal,
      queueGoal: savedGoal,
      completedCount: Math.max(Number(todayLog?.new_words || 0), savedCompletedRefs.length)
    });
    if (savedGoal > dailyGoal || logGoal > dailyGoal) {
      forceQueueLocal = true;
      queueChanged = true;
    }
    setGoalInputValue(defaultDailyGoal);
    const rawSavedCompleted = normalizeWordRoList(savedCompletedRefs);
    const todaySavedCompleted = rawSavedCompleted.filter(ro => wasWordCompletedOnActiveDate(ro));
    if (todaySavedCompleted.length !== rawSavedCompleted.length) {
      forceQueueLocal = true;
      queueChanged = true;
    }
    const savedCompleted = new Set(todaySavedCompleted);
    const originalQueueLength = savedWordRefs.length;
    const uniqueSavedQueue = normalizeWordRoList(savedWordRefs);
    todayQueueCompleted = new Set([...savedCompleted].filter(ro => getWordByRo(ro)));
    todayQueue = uniqueSavedQueue.filter(ro => {
      const word = getWordByRo(ro);
      return word && wordMatchesLearningCollection(word, learningCollectionId) && !setHasRo(todayQueueCompleted, ro);
    });
    todayIntroducedWords = new Set([
      ...readTodayIntroducedWords(),
      ...normalizeWordRoList(savedIntroducedRefs).filter(ref => getWordByRo(ref))
    ]);
    writeTodayIntroducedWords();
    queueChanged = queueChanged || todayQueue.length !== originalQueueLength || todayQueueCompleted.size !== savedCompleted.size;
  } else {
    dailyGoal = resolveLoadedDailyGoal({
      logGoal,
      queueGoal: localTemporaryGoal,
      completedCount: todayLog?.new_words || 0
    });
    setGoalInputValue(defaultDailyGoal);
    todayQueueCompleted = new Set();
    todaySeenWords = readTodaySeenWords();
    todayQueue = buildDailyQueueWords(dailyGoal).map(w => w.ro);
    todayQueueRecord = await apiSaveDailyQueue(currentUser.id, {
      collection_id: learningCollectionId,
      goal: dailyGoal,
      word_id: queueIdsToWordIds(todayQueue),
      word_ro: queueIdsToWordRos(todayQueue),
      completed_word_id: [],
      completed_word_ro: [],
      introduced_word_id: [],
      introduced_word_ro: [],
      completed: false
    });
  }
  debugDailyQueue('loadDailyQueue:after-load', { hasSavedQueueState });
  todaySeenWords = new Set([...readTodaySeenWords(), ...todayQueueCompleted]);
  writeTodaySeenWords();
  repairStartedProgressForCompletedTodayWords();
  mergeTodayIntroductionsFromProgress([...todayQueue, ...todayQueueCompleted]);
  todayNewWords = Math.max(
    todayQueueCompleted.size,
    Number(todayLog?.new_words || 0),
    Number(previousTodayCount || 0)
  );
  const normalizedQueue = buildOpenTodayQueue(dailyGoal);
  if (normalizedQueue.join('|') !== todayQueue.join('|')) {
    todayQueue = normalizedQueue;
    queueChanged = true;
    forceQueueLocal = true;
  }
  if (ensureTodayQueueHasActiveCards('loadDailyQueue:after-build', { skipSave: true })) {
    queueChanged = true;
    forceQueueLocal = true;
  }
  if (queueChanged) await saveTodayQueue({ forceLocal: forceQueueLocal });
  debugDailyQueue('loadDailyQueue:after-normalize', { queueChanged, forceQueueLocal });
  if (todayNewWords !== previousTodayCount || todayLog?.goal !== dailyGoal) {
    await apiUpdateTodayLog(currentUser.id, todayNewWords, dailyGoal, defaultDailyGoal, {
      completed: isDailyCheckinDone(),
      forceLocal: todayNewWords < previousTodayCount || Number(todayLog?.goal || 0) > dailyGoal
    });
    invalidateCalendarCache();
  }
  if (!handleDailyQueueSyncError(todayQueueRecord, '保存') && todayQueueRecord?.local) {
    showToast(getDailyQueueLocalSaveMessage());
  }
  dailyQueueLoaded = true;
  dailyQueueVersion++;
  renderSyncStatus();
  applyFilters();
  renderCard();
  renderDailyGoal();
  renderCalendar();
  updateReviewBadge();
  showFlashContent();
}

function buildDailyQueueWords(goal) {
  const cap = Math.max(1, Number(goal || DEFAULT_DAILY_GOAL));
  return buildReviewFirstDailyPlan(W, cap);
}

function uniqueWordsByRo(words) {
  return window.RomanianVocabDailyPlan.uniqueBy(words, w => roKey(w?.ro));
}

function hasWordProgress(progress) {
  const scheduler = normalizeScheduler(progress || {});
  return !!(progress && (
    progress.seen ||
    progress.known ||
    progress.qt ||
    progress.qr ||
    window.RomanianVocabScheduler.getReviewStage(progress) ||
    scheduler.cardState !== 'new' ||
    scheduler.reps ||
    scheduler.dueAt ||
    (progress.level && progress.level !== 'unknown')
  ));
}

function isDueReviewWord(w) {
  const p = getProgress(w?.ro);
  return !!(hasWordProgress(p) && isReviewDue(p));
}

function getStudyQueuePhase(w) {
  const p = getProgress(w?.ro);
  if (!hasWordProgress(p)) return 'new';
  const scheduler = normalizeScheduler(p);
  const due = isReviewDue(p);
  if (scheduler.cardState === 'learning') return due ? 'learning-due' : 'learning-waiting';
  if (scheduler.cardState === 'reinforcing' || scheduler.needsReinforcement) {
    return due ? 'relearning-due' : 'relearning-waiting';
  }
  if (due) return 'review-due';
  return scheduler.cardState === 'mastered' ? 'mastered' : 'scheduled';
}

function isDueLearningStepWord(w) {
  return getStudyQueuePhase(w) === 'learning-due';
}

function isDueRelearningStepWord(w) {
  return getStudyQueuePhase(w) === 'relearning-due';
}

function isDueGraduatedReviewWord(w) {
  const phase = getStudyQueuePhase(w);
  return phase === 'review-due' || phase === 'relearning-due';
}

function isOverdueLearningOrReinforcingWord(w) {
  return isDueLearningStepWord(w) || isDueRelearningStepWord(w);
}

function getReinforcementWordsDueToday(words = W) {
  return getDifficultWords(getLearningCollectionWords(words)).filter(w => {
    const p = getProgress(w?.ro);
    if (!hasWordProgress(p)) return false;
    const scheduler = normalizeScheduler(p);
    return scheduler.needsReinforcement || scheduler.cardState === 'reinforcing';
  });
}

function getRemainingDailyNewSlots(reservedUnseenCount = 0) {
  return Math.max(
    0,
    Number(getEffectiveDailyNewLimit() || 0) -
      Number(todayIntroducedWords.size || 0) -
      Math.max(0, Number(reservedUnseenCount || 0))
  );
}

function splitCandidatesByNewLimit(words = [], reservedUnseenCount = 0) {
  const continuing = [];
  const unseen = [];
  uniqueWordsByRo(words).forEach(word => {
    if (isUnseenWord(word)) unseen.push(word);
    else continuing.push(word);
  });
  return [
    ...continuing,
    ...unseen.slice(0, getRemainingDailyNewSlots(reservedUnseenCount))
  ];
}

function isPendingLearningRetryWord(w) {
  const p = getProgress(w?.ro);
  if (!hasWordProgress(p) || isReviewDue(p)) return false;
  const scheduler = normalizeScheduler(p);
  return scheduler.cardState === 'learning' || scheduler.cardState === 'reinforcing' || (!p.known && getStoredLevel(p) !== 'mastered');
}

function getRemainingDueReviewWords(words = W) {
  // Completion is a daily quota ledger, not a scheduler override. A card that
  // lapses after completion must become blocking again without double-counting.
  return getLearningCollectionWords(words).filter(isDueReviewWord);
}

function getRemainingDueLearningStepWords(words = W) {
  return getLearningCollectionWords(words).filter(isDueLearningStepWord);
}

function getRemainingGraduatedReviewWords(words = W) {
  return getLearningCollectionWords(words).filter(isDueGraduatedReviewWord);
}

function getRemainingFormalReviewWords(words = W) {
  return getRemainingGraduatedReviewWords(words).filter(w => !isRetryDeferred(w));
}

function getRemainingTodayReviewWords() {
  return getRemainingDueReviewWords(W).filter(w => !isRetryDeferred(w));
}

function isDailyQueueCandidate(w) {
  return isOverdueLearningOrReinforcingWord(w) || isDueReviewWord(w) || isPendingLearningRetryWord(w) || isUnseenWord(w);
}

function getUnseenContentPriority(w) {
  const phraseQuality = String(w?.grammar_data?.phrase_quality || '');
  if (phraseQuality === 'core') return 3;
  const frequencyRank = Number(w?.frequency_rank || 0);
  if (frequencyRank > 0) return 3.1 + Math.min(frequencyRank, 100000) / 1000000;
  const newsDocuments = Number(w?.news_document_count || 0);
  if (newsDocuments > 0) return 3.35 - Math.min(newsDocuments, 3000) / 100000;
  if (phraseQuality === 'needs_review') return 5;
  return 4.8;
}

function getDailyPhasePriority(w) {
  if (!w?.ro) return 9;
  // The user's daily target is review-first: graduated reviews and relearning
  // must reduce the visible review backlog before initial new-card learning
  // steps are allowed to take over the session.
  if (isDueGraduatedReviewWord(w)) return 0;
  if (isDueLearningStepWord(w)) return 1;
  const scheduler = normalizeScheduler(getProgress(w.ro) || {});
  if (scheduler.needsReinforcement || scheduler.cardState === 'reinforcing') return 2;
  if (isUnseenWord(w)) return getUnseenContentPriority(w);
  if (isPendingLearningRetryWord(w)) return 6;
  return 8;
}

function sortDailyPhaseWords(words = []) {
  return window.RomanianVocabDailyPlan.sortByPhase(words, {
    keyOf: w => roKey(w?.ro),
    priorityOf: getDailyPhasePriority,
    dueAtOf: w => normalizeScheduler(getProgress(w?.ro) || {}).dueAt,
    locale: 'ro'
  });
}

function buildReviewFirstDailyPlan(words = W, limit = dailyGoal) {
  const cap = Math.max(1, Number(limit || dailyGoal || DEFAULT_DAILY_GOAL));
  const blocked = new Set([...todaySeenWords, ...todayQueueCompleted].map(roKey));
  const usable = getLearningCollectionWords(words).filter(w => w?.ro && !blocked.has(roKey(w.ro)));
  const due = sortReviewDueWithWeakPriority(usable).filter(isDueGraduatedReviewWord);
  const dueSet = new Set(due.map(w => roKey(w.ro)));
  const overdueLearning = sortReviewDueWithWeakPriority(usable)
    .filter(w => !dueSet.has(roKey(w.ro)) && isDueLearningStepWord(w));
  overdueLearning.forEach(w => dueSet.add(roKey(w.ro)));
  const weak = getReinforcementWordsDueToday(usable).filter(w => !dueSet.has(roKey(w.ro)));
  const weakSet = new Set([...dueSet, ...weak.map(w => roKey(w.ro))]);
  const unseen = getUnseenWords(usable)
    .filter(w => !weakSet.has(roKey(w.ro)))
    .slice(0, getRemainingDailyNewSlots());
  return window.RomanianVocabDailyPlan.buildTieredPlan(
    [due, overdueLearning, weak, unseen],
    { limit: cap, keyOf: w => roKey(w?.ro) }
  );
}

function buildOpenTodayQueue(goal = dailyGoal) {
  debugDailyQueue('buildOpenTodayQueue:before', { goal });
  const cap = Math.max(1, Number(goal || dailyGoal || DEFAULT_DAILY_GOAL));
  const completedKeys = new Set([...todayQueueCompleted].map(roKey));
  const openWords = normalizeWordRoList(todayQueue).map(ro => getWordByRo(ro)).filter(word => {
    if (!word || completedKeys.has(roKey(word.ro))) return false;
    const p = getProgress(word.ro);
    return !hasWordProgress(p) || isReviewDue(p) || isPendingLearningRetryWord(word) || normalizeScheduler(p || {}).needsReinforcement;
  });
  const deferredOpenWords = openWords.filter(isRetryDeferred);
  const rawActiveOpenWords = openWords.filter(w => !isRetryDeferred(w));
  const openUnseenWords = rawActiveOpenWords.filter(isUnseenWord);
  const allowedOpenUnseenWords = openUnseenWords.slice(0, getRemainingDailyNewSlots());
  const allowedOpenUnseenKeys = new Set(allowedOpenUnseenWords.map(w => roKey(w.ro)));
  const activeOpenWords = rawActiveOpenWords.filter(w => !isUnseenWord(w) || allowedOpenUnseenKeys.has(roKey(w.ro)));
  const openSlots = Math.max(0, cap - Number(todayNewWords || 0));
  const reservedUnseenCount = allowedOpenUnseenWords.length;
  const rawCandidates = getLearningCollectionWords(W)
    .filter(w => w?.ro && !completedKeys.has(roKey(w.ro)))
    .filter(w => !setHasRo(todaySeenWords, w.ro))
    .filter(isDailyQueueCandidate)
    .filter(w => !isRetryDeferred(w));
  const plan = window.RomanianVocabDailyPlan.composeOpenQueue({
    active: activeOpenWords,
    deferred: deferredOpenWords,
    candidates: splitCandidatesByNewLimit(rawCandidates, reservedUnseenCount),
    goal: cap,
    completedCount: Number(todayNewWords || 0),
    keyOf: w => roKey(w?.ro),
    sortWords: sortDailyPhaseWords
  });
  if (!openSlots) {
    const closedQueue = plan.deferred.map(w => w.ro);
    debugDailyQueue('buildOpenTodayQueue:no-open-slots', {
      goal,
      resultSize: closedQueue.length,
      deferredKept: plan.deferred.length
    });
    return closedQueue;
  }
  const result = normalizeWordRoList(plan.words.map(w => w.ro));
  debugDailyQueue('buildOpenTodayQueue:after', {
    goal,
    cap,
    openSlots,
    activeOpenCount: activeOpenWords.length,
    deferredOpenCount: deferredOpenWords.length,
    candidateCount: plan.replacements.length,
    introducedToday: todayIntroducedWords.size,
    fixedDailyNewLimit: dailyNewLimit,
    effectiveDailyNewLimit: getEffectiveDailyNewLimit(),
    activeResultCount: plan.active.length,
    resultSize: result.length
  });
  return result;
}

function appendExplicitTodayQueueCards(targetGoal = dailyGoal) {
  const completedCount = todayQueueCompleted.size;
  const targetOpen = Math.max(0, Number(targetGoal || dailyGoal || DEFAULT_DAILY_GOAL) - completedCount);
  const missing = Math.max(0, targetOpen - todayQueue.length);
  const queuedUnseenCount = todayQueue
    .map(ro => getWordByRo(ro))
    .filter(Boolean)
    .filter(isUnseenWord)
    .length;
  const remainingNewSlots = getRemainingDailyNewSlots(queuedUnseenCount);
  if (!missing || !remainingNewSlots) return 0;
  const queuedKeys = new Set([...todayQueue, ...todayQueueCompleted].map(roKey));
  const additions = getUnseenWords(W)
    .filter(w => !queuedKeys.has(roKey(w.ro)))
    .filter(w => !setHasRo(todaySeenWords, w.ro))
    .slice(0, Math.min(missing, remainingNewSlots));
  if (!additions.length) return 0;
  todayQueue = normalizeWordRoList([...todayQueue, ...additions.map(w => w.ro)]);
  dailyQueueVersion++;
  invalidateQuizPracticePool();
  debugDailyQueue('appendExplicitTodayQueueCards', {
    targetGoal,
    missing,
    remainingNewSlots,
    appended: additions.length,
    resultSize: todayQueue.length
  });
  return additions.length;
}

function getDailyWordList(words = W, options = {}) {
  const perf = startDailyQueuePerf('getDailyWordList');
  let resultSize = 0;
  let path = 'unknown';
  if (!progressLoaded) {
    debugDailyQueue('getDailyWordList:blocked-progress-not-loaded', { options });
    finishDailyQueuePerf(perf, {
      path: 'blocked-progress-not-loaded',
      resultSize: 0,
      vocabScanned: 0,
      options
    });
    return [];
  }
  if (!dailyQueueLoaded && !options.allowBeforeQueueLoaded) {
    const hasActiveOpenCards = normalizeWordRoList(todayQueue)
      .filter(ro => !setHasRo(todayQueueCompleted, ro))
      .map(ro => getWordByRo(ro))
      .filter(Boolean)
      .some(isActiveTodayQueueWord);
    if (!hasActiveOpenCards) {
      debugDailyQueue('getDailyWordList:blocked-not-loaded', { options });
      finishDailyQueuePerf(perf, {
        path: 'blocked-not-loaded',
        resultSize: 0,
        vocabScanned: words.length,
        options
      });
      return [];
    }
    debugDailyQueue('getDailyWordList:using-active-queue-before-load', { options });
  }
  if (shouldPauseTodayStudyForCheckin() || shouldPauseTodayStudyForGoal()) {
    debugDailyQueue('getDailyWordList:blocked-paused', { options });
    finishDailyQueuePerf(perf, {
      path: 'blocked-paused',
      resultSize: 0,
      vocabScanned: words.length,
      options
    });
    return [];
  }
  if (!options.skipRepair) ensureTodayQueueHasActiveCards('getDailyWordList');
  const limit = Math.max(1, Number(options.limit || dailyGoal || DEFAULT_DAILY_GOAL));
  const scoped = options.ignoreCategory || curCat === '全部'
    ? words
    : words.filter(w => w.cat === curCat);
  const scopedKeys = options.ignoreCategory || curCat === '全部'
    ? null
    : new Set(scoped.map(w => roKey(w.ro)));
  const globalDueWords = sortDailyPhaseWords(getRemainingTodayReviewWords());
  const scopedDueWords = globalDueWords
    .filter(w => !scopedKeys || scopedKeys.has(roKey(w.ro)));
  const openQueuedRos = todayQueue.filter(ro => !setHasRo(todayQueueCompleted, ro));
  const openWords = openQueuedRos
    .map(ro => getWordByRo(ro))
    .filter(Boolean)
    .filter(w => wordMatchesLearningCollection(w, learningCollectionId))
    .filter(w => !scopedKeys || scopedKeys.has(roKey(w.ro)))
    .filter(w => !isRetryDeferred(w));
  const dueOpenWords = openWords.filter(w => isOverdueLearningOrReinforcingWord(w) || isDueReviewWord(w));
  const allDueWords = uniqueWordsByRo([...scopedDueWords, ...dueOpenWords]);
  if (globalDueWords.length) {
    const result = sortDailyPhaseWords(allDueWords).slice(0, limit);
    resultSize = result.length;
    path = result.length ? 'due-only' : 'due-scope-fallback';
    debugDailyQueue(`getDailyWordList:${path}`, {
      options,
      scopedCount: scoped.length,
      openWordCount: openWords.length,
      globalDueCount: globalDueWords.length,
      dueOpenCount: allDueWords.length,
      resultSize: result.length
    });
    finishDailyQueuePerf(perf, {
      path,
      resultSize,
      vocabScanned: words.length,
      openWordCount: openWords.length,
      options
    });
    return result;
  }
  const result = sortDailyPhaseWords(openWords).slice(0, limit);
  resultSize = result.length;
  path = 'open';
  debugDailyQueue('getDailyWordList:open', {
    options,
    scopedCount: scoped.length,
    openWordCount: openWords.length,
    resultSize: result.length
  });
  finishDailyQueuePerf(perf, {
    path,
    resultSize,
    vocabScanned: words.length,
    openWordCount: openWords.length,
    options
  });
  return result;
}

function getDailyTaskType(w) {
  if (!w) return '';
  return getLevelLabel(w.ro);
}

function getAuxiliaryLabels(w) {
  if (!w) return [];
  const labels = [];
  const queuePhase = getStudyQueuePhase(w);
  if (roListIncludes(todayQueue, w.ro) && !setHasRo(todayQueueCompleted, w.ro)) labels.push('今日任务');
  if (!hasWordProgress(getProgress(w.ro)) && !setHasRo(todaySeenWords, w.ro)) labels.push('新词');
  if (queuePhase === 'learning-due') labels.push('学习步骤到点');
  if (queuePhase === 'review-due' || queuePhase === 'relearning-due') labels.push('到期复习');
  return labels;
}

function getContinueAfterGoalText() {
  if (dailyGoal < DAILY_GOAL_MAX) {
    return '可以再完成 10 个、自定义数量，或先清空剩余复习再进入新词。';
  }
  return '今日任务已到上限，可以继续做智能测验巩固。';
}

function getGoalInputValue() {
  const input = document.getElementById('goal-input');
  return parseInt(input?.value || '', 10);
}

function setGoalInputValue(value) {
  const input = document.getElementById('goal-input');
  if (input) input.value = value;
}

function getNewLimitInputValue() {
  const input = document.getElementById('new-limit-input');
  return Number(input?.value);
}

function setNewLimitInputValue(value) {
  const input = document.getElementById('new-limit-input');
  if (input) input.value = value;
}

async function setDailyGoalAndRebuild(goal, message = '每日通过目标已更新') {
  const nextGoal = normalizeDailyGoalValue(goal, defaultDailyGoal);
  defaultDailyGoal = nextGoal;
  dailyGoal = nextGoal;
  setGoalInputValue(nextGoal);
  clearTodayTemporaryGoal();
  await apiSetDailyGoal(currentUser.id, nextGoal);
  todayQueue = buildOpenTodayQueue(dailyGoal);
  appendExplicitTodayQueueCards(dailyGoal);
  await saveTodayQueue({ forceLocal: true });
  await apiUpdateTodayLog(currentUser.id, todayNewWords, dailyGoal, defaultDailyGoal, {
    completed: isDailyCheckinDone(),
    forceLocal: true
  });
  invalidateCalendarCache();
  applyFilters();
  renderCard();
  renderDailyGoal();
  renderCalendar();
  showToast(message);
}

async function extendTodayGoal(amount) {
  if (isDefaultGoalDone() && !isDailyCheckinDone()) {
    openDailyCheckinModal();
    return;
  }
  const extra = Number(amount || 0);
  if (!extra || extra < 1) return;
  const base = Math.max(dailyGoal, todayNewWords);
  const nextGoal = Math.min(DAILY_GOAL_MAX, base + extra);
  if (nextGoal <= dailyGoal && dailyGoal >= DAILY_GOAL_MAX) {
    showToast(`每日通过目标最高为 ${DAILY_GOAL_MAX}`);
    return;
  }
  dailyGoal = nextGoal;
  setGoalInputValue(defaultDailyGoal);
  writeTodayTemporaryGoal(nextGoal);
  todayQueue = buildOpenTodayQueue(dailyGoal);
  appendExplicitTodayQueueCards(dailyGoal);
  await saveTodayQueue();
  await apiUpdateTodayLog(currentUser.id, todayNewWords, dailyGoal, defaultDailyGoal, { completed: isDailyCheckinDone() });
  invalidateCalendarCache();
  applyFilters();
  renderCard();
  renderDailyGoal();
  renderCalendar();
  showToast(`今天临时扩展到 ${nextGoal} 个，明天仍按 ${defaultDailyGoal} 个`);
}

async function extendTodayGoalCustom() {
  if (isDefaultGoalDone() && !isDailyCheckinDone()) {
    openDailyCheckinModal();
    return;
  }
  const raw = prompt('这次想额外增加多少个任务？', '20');
  if (raw === null) return;
  const extra = parseInt(raw, 10);
  if (!extra || extra < 1) {
    showToast('请输入大于 0 的任务数');
    return;
  }
  await extendTodayGoal(extra);
}

async function saveTodayQueue(options = {}) {
  if (!ensureDailyStateCurrent({ reload: true })) return null;
  if (dailyGoal > defaultDailyGoal) writeTodayTemporaryGoal(dailyGoal);
  const payload = options.payload || buildDailyQueueSaveSnapshot();
  const savePromise = apiSaveDailyQueue(currentUser.id, payload, { forceLocal: !!options.forceLocal });
  if (options.background) {
    if (payload.collection_id === learningCollectionId) {
      todayQueueRecord = { user_id: currentUser.id, queue_date: getLocalDateKey(), ...payload, local: true };
    }
    savePromise.then((record) => {
      if (payload.collection_id !== learningCollectionId) return;
      todayQueueRecord = record;
      handleDailyQueueSyncError(record, '保存');
    }).catch((error) => {
      console.warn('Daily queue background save failed', error);
      setSyncBadge('队列待同步', '');
    });
  } else {
    const record = await savePromise;
    if (payload.collection_id === learningCollectionId) todayQueueRecord = record;
  }
  if (!options.background && payload.collection_id === learningCollectionId) {
    handleDailyQueueSyncError(todayQueueRecord, '保存');
  }
  dailyQueueVersion++;
  invalidateCalendarCache();
  invalidateQuizPracticePool();
  return payload.collection_id === learningCollectionId ? todayQueueRecord : null;
}

function buildDailyQueueSaveSnapshot() {
  return {
    collection_id: learningCollectionId,
    goal: dailyGoal,
    word_id: queueIdsToWordIds(todayQueue),
    word_ro: queueIdsToWordRos(todayQueue),
    completed_word_id: queueIdsToWordIds([...todayQueueCompleted]),
    completed_word_ro: queueIdsToWordRos([...todayQueueCompleted]),
    introduced_word_id: queueIdsToWordIds([...todayIntroducedWords]),
    introduced_word_ro: queueIdsToWordRos([...todayIntroducedWords]),
    completed: isCurrentTodayGoalDone()
  };
}

function showDailyGoalCompletionPrompt(defer = false) {
  const showPrompt = () => {
    showToast('今日目标已完成');
    openDailyCheckinModal();
  };
  if (defer) {
    setTimeout(showPrompt, CARD_FLIP_TRANSITION_MS + 40);
    return;
  }
  showPrompt();
}

function commitTodayWordCompletion(wordRo, options = {}) {
  if (!ensureDailyStateCurrent({ reload: true })) return false;
  const canonicalRo = canonicalWordRo(wordRo);
  if (!canonicalRo || setHasRo(todayQueueCompleted, canonicalRo)) return false;
  commitTodayWordExposure(canonicalRo, { fast: true });
  const wasGoalDone = isCurrentTodayGoalDone();
  const isQueuedWord = roListIncludes(todayQueue, canonicalRo);
  const previousTodayNewWords = Number(todayNewWords || 0);

  setAddRo(todayQueueCompleted, canonicalRo);
  if (isQueuedWord) {
    todayQueue = roListWithout(todayQueue, canonicalRo);
  }
  todayNewWords = Math.max(previousTodayNewWords + 1, todayQueueCompleted.size);
  const reachedGoal = !wasGoalDone && isCurrentTodayGoalDone();
  if (options.fast) {
    return { completed: true, reachedGoal };
  }
  writeTodaySeenWords();
  saveTodayQueue({ background: true }).catch(error => {
    console.warn('Daily queue background save failed', error);
    setSyncBadge('队列待同步', '');
  });

  const checkinDone = isDailyCheckinDone();
  todayLog = { ...(todayLog || {}), user_id: currentUser.id, log_date: getLocalDateKey(), new_words: todayNewWords, goal: dailyGoal, completed: checkinDone };
  saveTodayLogBackground(
    apiUpdateTodayLog(currentUser.id, todayNewWords, dailyGoal, defaultDailyGoal, { completed: checkinDone })
  );
  invalidateCalendarCache();
  renderDailyGoal();
  updateTodayCalendarCell();
  renderReviewPanel();
  updateReviewBadge();
  if (reachedGoal) {
    showDailyGoalCompletionPrompt(!!options.deferGoalPrompt);
  }
  return true;
}

function commitTodayWordExposure(wordRo, options = {}) {
  if (!ensureDailyStateCurrent({ reload: true })) return false;
  const canonicalRo = canonicalWordRo(wordRo);
  if (!canonicalRo) return false;
  const wasSeen = setHasRo(todaySeenWords, canonicalRo);
  setAddRo(todaySeenWords, canonicalRo);
  todayNewWords = Math.max(Number(todayNewWords || 0), todayQueueCompleted.size);
  if (options.fast) {
    return { counted: !wasSeen, reachedGoal: false };
  }
  writeTodaySeenWords();
  const checkinDone = isDailyCheckinDone();
  todayLog = { ...(todayLog || {}), user_id: currentUser.id, log_date: getLocalDateKey(), new_words: todayNewWords, goal: dailyGoal, completed: checkinDone };
  saveTodayLogBackground(
    apiUpdateTodayLog(currentUser.id, todayNewWords, dailyGoal, defaultDailyGoal, { completed: checkinDone })
  );
  invalidateCalendarCache();
  renderDailyGoal();
  updateTodayCalendarCell();
  renderReviewPanel();
  updateReviewBadge();
  return { counted: !wasSeen, reachedGoal: false };
}

async function completeTodayQueueWord(wordRo, options = {}) {
  const canonicalRo = canonicalWordRo(wordRo);
  if (!canonicalRo) return false;
  await ensureStartedProgressForTodayWord(canonicalRo);
  return commitTodayWordCompletion(canonicalRo, options);
}

async function ensureStartedProgressForTodayWord(wordRo) {
  const canonicalRo = canonicalWordRo(wordRo);
  if (!canonicalRo || hasWordProgress(getProgress(canonicalRo))) return;
  await syncProgress(canonicalRo, true, 1, 1, true, { seenViaCard: true, skipDailyQueueReconcile: true });
}

function repairStartedProgressForCompletedTodayWords() {
  const missingProgress = [...todayQueueCompleted].filter(ro => !hasWordProgress(getProgress(ro)));
  const pendingEntries = [];
  for (const ro of missingProgress) {
    const canonicalRo = canonicalWordRo(ro);
    if (!canonicalRo) continue;
    const nowIso = new Date().toISOString();
    const review = getSchedulerReview({}, 'known', { now: nowIso });
    const repairedProgress = {
      seen: true,
      seenViaCard: true,
      known: true,
      qr: 1,
      qt: 1,
      level: 'learning',
      ...review,
      wrongCount: 0,
      errorStreak: 0,
      lastWrongAt: null,
      weakClearedAt: null,
      pendingSync: true
    };
    setProgress(canonicalRo, repairedProgress, { source: 'repairStartedProgressForCompletedTodayWords' });
    const word = getWordByRo(canonicalRo);
    pendingEntries.push([word?.id ?? null, word?.ro || canonicalRo, { ...repairedProgress, word_id: word?.id ?? null, word_ro: word?.ro || canonicalRo }]);
  }
  if (pendingEntries.length && typeof writePendingProgressBatch === 'function') {
    writePendingProgressBatch(currentUser.id, pendingEntries);
  }
  if (missingProgress.length && typeof writeLocalProgressSnapshot === 'function') {
    writeLocalProgressSnapshot(currentUser.id, progressMap);
  }
}

function shouldCompleteQueuedWordFromProgress(wordRo) {
  const p = getProgress(wordRo);
  if (!hasWordProgress(p) || isReviewDue(p)) return false;
  if (!p.seenViaCard) return false;
  return !!(p.known || Number(p.qr || 0) > 0 || getStoredLevel(p) === 'mastered');
}

async function reconcileTodayQueueAfterProgress(wordRo) {
  if (!dailyQueueLoaded) return;
  const canonicalRo = canonicalWordRo(wordRo);
  if (!roListIncludes(todayQueue, canonicalRo) || setHasRo(todayQueueCompleted, canonicalRo)) return;
  if (shouldCompleteQueuedWordFromProgress(canonicalRo)) {
    try {
      await completeTodayQueueWord(canonicalRo);
    } catch (error) {
      console.warn('Daily queue reconciliation failed', error);
    }
  }
}

// ── 熟练度计算 ────────────────────────────────────────────

function hasActiveWeakState(progress = {}, scheduler = normalizeScheduler(progress)) {
  if (scheduler.needsReinforcement || progress.needsReinforcement || progress.needs_reinforcement) return true;
  const wrongCount = Number(progress.wrongCount || progress.wrong_count || 0);
  const errorStreak = Number(progress.errorStreak || progress.error_streak || 0);
  return wrongCount >= REINFORCEMENT_MIN_LEARNING_MISSES && errorStreak > 0;
}

function isMasteredProgress(progress = {}) {
  if (!progress) return false;
  const scheduler = normalizeScheduler(progress);
  if (hasActiveWeakState(progress, scheduler)) return false;
  const qt = Number(progress.qt || progress.quiz_total || 0);
  const qr = Number(progress.qr || progress.quiz_right || 0);
  const reviewStage = window.RomanianVocabScheduler.getReviewStage(progress);
  if (scheduler.cardState === 'mastered') return true;
  if (normalizeStoredProgressLevel(progress.level) === 'mastered') return true;
  if (
    scheduler.cardState === 'review' &&
    scheduler.intervalDays >= 15 &&
    scheduler.memoryStrength >= 75
  ) return true;
  return qt >= 3 && qr / Math.max(qt, 1) >= 0.8 && reviewStage >= 2;
}

/**
 * 根据答题记录计算熟练度
 * unknown  → 没答过题
 * learning → 答过但未达到统一掌握规则
 * mastered → 现代 scheduler 达到稳定复习，或 legacy 记录达到旧掌握规则
 */
function calcLevel(qr, qt, known = false, progress = {}) {
  if (isMasteredProgress({ ...progress, qr, qt, known })) return 'mastered';
  if (!qt) return known ? 'learning' : 'unknown';
  return 'learning';
}

function resolveNextStoredLevel(prev = {}, calculatedLevel = 'unknown', success = true, options = {}) {
  if (!options.preserveLearningLevel || !(prev.qt || prev.known)) return calculatedLevel;
  if (!success) return 'learning';
  return getStoredLevel(prev);
}

function applyMasteryHistory(progress = {}, prev = {}) {
  const wasMasteredAt = prev.wasMasteredAt || progress.wasMasteredAt || null;
  if (getStoredLevel(progress) === 'mastered') {
    return { ...progress, wasMasteredAt: wasMasteredAt || new Date().toISOString() };
  }
  return { ...progress, wasMasteredAt };
}

function buildReviewFromPrev(prev = {}) {
  const nowIso = new Date().toISOString();
  const stage = window.RomanianVocabScheduler.getReviewStage(prev);
  const scheduler = normalizeScheduler(prev);
  return {
    reviewStage: stage,
    reviewCount: stage,
    nextReviewAt: scheduler.dueAt || prev.nextReviewAt || prev.nextReview || nowIso,
    dueAt: scheduler.dueAt || prev.nextReviewAt || prev.nextReview || nowIso,
    lastReviewedAt: scheduler.lastReviewedAt || prev.lastReviewedAt || nowIso,
    ...scheduler
  };
}

function normalizeStoredProgressLevel(level) {
  return ['unknown', 'learning', 'mastered'].includes(level) ? level : 'unknown';
}

function getStoredLevel(progress) {
  if (!progress) return 'unknown';
  const computed = calcLevel(progress.qr, progress.qt, progress.known, progress);
  if (computed !== 'unknown') return computed;
  const stored = normalizeStoredProgressLevel(progress.level);
  if (stored !== 'unknown') return stored;
  if (progress.seen || window.RomanianVocabScheduler.getReviewStage(progress)) return 'learning';
  return 'unknown';
}

function isStartedNotMastered(progress) {
  if (!hasWordProgress(progress)) return false;
  return getStoredLevel(progress) !== 'mastered';
}

const LEVEL_LABEL = { unknown: '未学', queued: '今日待学', learning: '学习中', review: '待复习', reinforcing: '学习中', mastered: '已掌握' };
const LEVEL_COLOR = { unknown: 'var(--text3)', queued: 'var(--blue)', learning: 'var(--yellow)', review: 'var(--red)', reinforcing: 'var(--yellow)', mastered: 'var(--green)' };
const LEVEL_BG    = { unknown: 'var(--bg3)', queued: 'var(--blue-bg)', learning: '#fffbeb', review: 'var(--red-bg)', reinforcing: '#fffbeb', mastered: 'var(--green-bg)' };
const LEVEL_TC    = { unknown: 'var(--text2)', queued: 'var(--blue-text)', learning: 'var(--yellow-text)', review: 'var(--red-text)', reinforcing: 'var(--yellow-text)', mastered: 'var(--green-text)' };
const LEARNING_RETRY_INTERVAL = { label: '10分钟', ms: 10 * 60 * 1000 };
const REINFORCEMENT_MIN_LEARNING_MISSES = 2;
const REVIEW_INTERVALS = [
  { label: '1天', ms: 24 * 60 * 60 * 1000 },
  { label: '3天', ms: 3 * 24 * 60 * 60 * 1000 },
  { label: '7天', ms: 7 * 24 * 60 * 60 * 1000 },
  { label: '15天', ms: 15 * 24 * 60 * 60 * 1000 },
  { label: '30天', ms: 30 * 24 * 60 * 60 * 1000 },
  { label: '60天', ms: 60 * 24 * 60 * 60 * 1000 },
];
const EXAMPLE_CACHE_PREFIX = 'corpus_example:v2:';
const CORPUS_EXAMPLES = {
  'scară': {
    ro: 'Ți-ai lovit capul căzând de pe scară?',
    zh: '你从梯子上摔下来时撞到头了吗？',
    source: 'Tatoeba'
  },
  'scara': {
    ro: 'Ți-ai lovit capul căzând de pe scară?',
    zh: '你从梯子上摔下来时撞到头了吗？',
    source: 'Tatoeba'
  }
};

function applyFilters() {
  const perf = startDailyQueuePerf('applyFilters');
  let path = flashMode;
  const collectionWords = getLearningCollectionWords(W);
  const scoped = curCat === '全部' ? collectionWords : collectionWords.filter(w => w.cat === curCat);
  if (flashMode === 'today') {
    path = 'today';
    debugDailyQueue('applyFilters:today-before', { scopedCount: scoped.length });
    if (dailyQueueLoaded) ensureTodayQueueHasActiveCards('applyFilters:today-before');
    filtered = getDailyWordList(scoped, { includeFallback: true, skipRepair: true });
    debugDailyQueue('applyFilters:today-after-list', { scopedCount: scoped.length });
    if (!filtered.length && curCat !== '全部') {
      const allDailyWords = getDailyWordList(W, { includeFallback: true, ignoreCategory: true, skipRepair: true });
      if (allDailyWords.length) {
        curCat = '全部';
        filtered = allDailyWords;
        buildCats();
        debugDailyQueue('applyFilters:category-fallback', { scopedCount: scoped.length, allDailyWords: allDailyWords.length });
      }
    }
  } else if (flashMode === 'review') {
    path = 'review';
    filtered = sortReviewDueWithWeakPriority(scoped).filter(isDueGraduatedReviewWord);
    debugDailyQueue('applyFilters:review', { scopedCount: scoped.length });
  } else {
    path = 'default';
    filtered = sortByReviewPriority(scoped).filter(w => getReviewBucket(w) !== 2);
    debugDailyQueue('applyFilters:default', { scopedCount: scoped.length });
  }
  idx = Math.min(idx, Math.max(filtered.length - 1, 0));
  debugDailyQueue('applyFilters:final', { scopedCount: scoped.length });
  renderReviewPanel();
  finishDailyQueuePerf(perf, {
    path,
    vocabScanned: scoped.length,
    resultSize: filtered.length
  });
}

function isUnseenWord(w) {
  const p = getProgress(w.ro);
  return !hasWordProgress(p) && !setHasRo(todayQueueCompleted, w.ro) && !setHasRo(todaySeenWords, w.ro);
}

function getUnseenWords(words = W) {
  return getLearningCollectionWords(words)
    .filter(isUnseenWord)
    .sort((a, b) => {
      const verifiedCoreA = a.verification_status === 'verified' && a.grammar_data?.phrase_quality === 'core' ? 0 : 1;
      const verifiedCoreB = b.verification_status === 'verified' && b.grammar_data?.phrase_quality === 'core' ? 0 : 1;
      if (verifiedCoreA !== verifiedCoreB) return verifiedCoreA - verifiedCoreB;
      const reviewedA = ['verified', 'revised'].includes(String(a.naturalness_status || '')) ? 0 : 1;
      const reviewedB = ['verified', 'revised'].includes(String(b.naturalness_status || '')) ? 0 : 1;
      if (reviewedA !== reviewedB) return reviewedA - reviewedB;
      const rankA = Number(a.frequency_rank || Number.MAX_SAFE_INTEGER);
      const rankB = Number(b.frequency_rank || Number.MAX_SAFE_INTEGER);
      if (rankA !== rankB) return rankA - rankB;
      const newsA = Number(a.news_document_count || 0);
      const newsB = Number(b.news_document_count || 0);
      if (newsA !== newsB) return newsB - newsA;
      return String(a.ro).localeCompare(String(b.ro), 'ro');
    });
}

async function addWordToTodayQueue(wordRo) {
  const w = getWordByRo(wordRo);
  if (!w) { showToast('找不到该词条'); return; }
  if (!wordMatchesLearningCollection(w, learningCollectionId)) {
    showToast(`请先切换到${getLearningCollectionLabel(w.learning_track === 'specialist' ? w.specialist_book : w.learning_track)}`);
    return;
  }
  if (!isUnseenWord(w)) { showToast('这个词已经学过，请用智能练习继续巩固'); return; }
  const selectedKeys = new Set([...todayQueue, ...todayQueueCompleted].map(roKey));
  const remainingSlots = Math.max(0, dailyGoal - selectedKeys.size);
  const queuedUnseenCount = todayQueue
    .map(ro => getWordByRo(ro))
    .filter(Boolean)
    .filter(isUnseenWord)
    .length;
  if (!remainingSlots) {
    showToast('今日队列或新词上限已满；调整学习设置后可以继续添加');
    return;
  }
  if (!getRemainingDailyNewSlots(queuedUnseenCount)) {
    const effectiveLimit = getEffectiveDailyNewLimit();
    showToast(`今日可引入新词额度为 ${effectiveLimit} 个；请在学习设置中调整每日新词上限`);
    return;
  }
  if (roListIncludes(todayQueue, w.ro) && !setHasRo(todayQueueCompleted, w.ro)) {
    showToast('这个词已在今日队列中');
    switchPage('flash');
    return;
  }

  const completed = todayQueue.filter(ro => setHasRo(todayQueueCompleted, ro));
  const open = todayQueue.filter(ro => !setHasRo(todayQueueCompleted, ro) && roKey(ro) !== roKey(w.ro));
  todayQueue = normalizeWordRoList([...completed, w.ro, ...open]);
  setDeleteRo(todayQueueCompleted, w.ro);
  await saveTodayQueue();
  flashMode = 'today';
  curCat = '全部';
  idx = completed.length;
  flipped = false;
  flashHistory = [];
  flashOverrideRo = null;
  applyFilters();
  buildCats();
  renderDailyGoal();
  renderList();
  switchPage('flash');
  showToast(`已加入今日队列：${w.zh || w.ro}`);
}

function normalizeCategory(cat) {
  return normalizeTopic(cat);
}

const WORD_TEXT_CORRECTIONS = Object.freeze({
  'poștas': { ro: 'poștaș', ipa: 'poștAș' }
});

function normalizeWordCategory(word) {
  const normalizedRo = normalizeWordText(word.ro);
  const correction = WORD_TEXT_CORRECTIONS[normalizedRo] || {};
  const corrected = {
    ...word,
    ...correction,
    ro: correction.ro || normalizedRo,
    rawCat: word.rawCat ?? word.cat
  };
  const normalized = normalizeTaxonomyWord(corrected);
  return { ...normalized, cat: normalized.topic };
}

function categoryRank(cat) {
  const idx = CATEGORY_ORDER.indexOf(cat);
  return idx >= 0 ? idx : CATEGORY_ORDER.length;
}

function populateCategoryDatalist() {
  const setOptions = (selector, items, blankLabel = '') => {
    document.querySelectorAll(selector).forEach(select => {
      const previous = select.value;
      select.innerHTML = [
        ...(blankLabel ? [`<option value="">${escapeHtml(blankLabel)}</option>`] : []),
        ...items.map(item => `<option value="${escapeHtml(item.value)}">${escapeHtml(item.label)}</option>`)
      ].join('');
      if ([...select.options].some(option => option.value === previous)) select.value = previous;
    });
  };
  setOptions('#em-topic, #aw-topic', TOPICS.filter(item => item.value !== 'unclassified'));
  setOptions('#em-pos, #aw-pos', PARTS_OF_SPEECH.filter(item => item.value !== 'other'));
  setOptions('#em-unit, #aw-unit', UNIT_TYPES);
  setOptions('#em-register, #aw-register', REGISTERS, '未标注，不显示');
  document.querySelectorAll('#em-cefr, #aw-cefr').forEach(select => {
    const previous = select.value;
    select.innerHTML = '<option value="">未核实，不显示</option>' +
      CEFR_LEVELS.map(level => `<option value="${level}">${level}</option>`).join('');
    if (CEFR_LEVELS.includes(previous)) select.value = previous;
  });
}

function isReviewDue(progress) {
  if (!progress) return false;
  const scheduler = normalizeScheduler(progress);
  const dueAt = scheduler.dueAt || progress.nextReviewAt || progress.nextReview;
  if (!dueAt) return false;
  return new Date(dueAt).getTime() <= Date.now();
}

function getReviewBucket(w) {
  const p = getProgress(w.ro);
  if (!hasWordProgress(p)) return 1;
  if (normalizeScheduler(p).needsReinforcement) return 0;
  return isReviewDue(p) ? 0 : 2;
}

function sortByReviewPriority(words) {
  return [...words].sort((a, b) => {
    const ba = getReviewBucket(a);
    const bb = getReviewBucket(b);
    if (ba !== bb) return ba - bb;
    const pa = getProgress(a.ro) || {};
    const pb = getProgress(b.ro) || {};
    const da = normalizeScheduler(pa).dueAt ? new Date(normalizeScheduler(pa).dueAt).getTime() : 0;
    const db = normalizeScheduler(pb).dueAt ? new Date(normalizeScheduler(pb).dueAt).getTime() : 0;
    return da - db || String(a.ro).localeCompare(String(b.ro), 'ro');
  });
}

function getProgressLevel(wordRo) {
  const p = getProgress(wordRo) || {};
  const scheduler = normalizeScheduler(p);
  const word = getWordByRo(wordRo) || { ro: wordRo };
  const queuePhase = getStudyQueuePhase(word);
  if (!hasWordProgress(p) && roListIncludes(todayQueue, wordRo) && !setHasRo(todayQueueCompleted, wordRo)) return 'queued';
  if (queuePhase === 'review-due' || queuePhase === 'relearning-due') return 'review';
  if (queuePhase === 'learning-due' || queuePhase === 'learning-waiting' || queuePhase === 'relearning-waiting') return 'learning';
  if (hasWordProgress(p) && scheduler.cardState === 'mastered') return 'mastered';
  if (hasWordProgress(p) && scheduler.cardState === 'review') return getStoredLevel(p);
  if (!hasWordProgress(p) && setHasRo(todayQueueCompleted, wordRo)) return 'learning';
  if (!hasWordProgress(p) && setHasRo(todaySeenWords, wordRo)) return 'learning';
  return getStoredLevel(p);
}

function getLevelLabel(wordRo) {
  const lv = getProgressLevel(wordRo);
  return LEVEL_LABEL[lv] || LEVEL_LABEL.unknown;
}

function getDifficultScore(w) {
  const p = getProgress(w.ro) || {};
  const qt = p.qt || 0;
  const qr = p.qr || 0;
  const grammarQt = window.RomanianVocabProgressModel.getGrammarTotal(p);
  const grammarQr = window.RomanianVocabProgressModel.getGrammarRight(p);
  const coreWrong = Math.max(0, qt - qr);
  const grammarWrong = Math.max(0, grammarQt - grammarQr);
  const wrong = Math.max(Number(p.wrongCount || 0), coreWrong + grammarWrong);
  const total = qt + grammarQt;
  const rate = total ? wrong / total : 0;
  return {
    wrong,
    rate,
    streak: p.errorStreak || 0,
    lastWrong: p.lastWrongAt ? new Date(p.lastWrongAt).getTime() : 0,
    qt: total
  };
}

function getDifficultWords(words = getLearningCollectionWords(W)) {
  return [...words]
    .filter(w => {
      const s = getDifficultScore(w);
      return s.wrong > 0 || s.streak > 0;
    })
    .sort((a, b) => {
      const sa = getDifficultScore(a);
      const sb = getDifficultScore(b);
      return sb.rate - sa.rate ||
        sb.streak - sa.streak ||
        sb.lastWrong - sa.lastWrong ||
        sb.wrong - sa.wrong ||
        sb.qt - sa.qt ||
        String(a.ro).localeCompare(String(b.ro), 'ro');
    });
}

function isWeakLearningWord(wordRo) {
  const p = getProgress(wordRo) || {};
  const scheduler = normalizeScheduler(p);
  return hasWordProgress(p) && (scheduler.needsReinforcement || getStoredLevel(p) !== 'mastered');
}

function isUnclearedWeakLearningMiss(wordRo) {
  const p = getProgress(wordRo) || {};
  if (!(p.wasMasteredAt || p.level === 'mastered' || getStoredLevel(p) === 'mastered')) return false;
  const qt = p.qt || 0;
  const qr = p.qr || 0;
  const misses = Math.max(0, qt - qr);
  if (!(qt > 0 && misses >= REINFORCEMENT_MIN_LEARNING_MISSES && getStoredLevel(p) !== 'mastered')) return false;
  if (!p.weakClearedAt) return true;
  if (!p.lastWrongAt) return false;
  return new Date(p.lastWrongAt).getTime() > new Date(p.weakClearedAt).getTime();
}

function getWeakLearningWords(words = getLearningCollectionWords(W)) {
  return [...words]
    .filter(w => isWeakLearningWord(w.ro))
    .sort((a, b) => {
      const sa = getDifficultScore(a);
      const sb = getDifficultScore(b);
      return sb.streak - sa.streak ||
        sb.rate - sa.rate ||
        sb.wrong - sa.wrong ||
        sb.qt - sa.qt ||
        String(a.ro).localeCompare(String(b.ro), 'ro');
    });
}

function sortReviewDueWithWeakPriority(words) {
  return [...words].sort((a, b) => {
    const ba = getReviewBucket(a);
    const bb = getReviewBucket(b);
    if (ba !== bb) return ba - bb;
    const pa = getProgress(a.ro) || {};
    const pb = getProgress(b.ro) || {};
    const sa = getDifficultScore(a);
    const sb = getDifficultScore(b);
    const schedulerA = normalizeScheduler(pa);
    const schedulerB = normalizeScheduler(pb);
    const da = schedulerA.dueAt ? new Date(schedulerA.dueAt).getTime() : 0;
    const db = schedulerB.dueAt ? new Date(schedulerB.dueAt).getTime() : 0;
    if (schedulerA.needsReinforcement !== schedulerB.needsReinforcement) return schedulerA.needsReinforcement ? -1 : 1;
    return sb.rate - sa.rate ||
      sb.streak - sa.streak ||
      sb.lastWrong - sa.lastWrong ||
      da - db ||
      String(a.ro).localeCompare(String(b.ro), 'ro');
  });
}

function getFlashModeLabel() {
  return { today: '今日任务', review: '到期复习' }[flashMode] || '卡片记忆';
}

function getNextReview(progress, success) {
  const now = new Date();
  if (!success) {
    const current = window.RomanianVocabScheduler.getReviewStage(progress);
    const fallbackStage = Math.max(0, current - 2);
    const fallbackInterval = fallbackStage > 0
      ? REVIEW_INTERVALS[Math.max(0, fallbackStage - 1)]
      : LEARNING_RETRY_INTERVAL;
    return {
      reviewStage: fallbackStage,
      nextReviewAt: new Date(now.getTime() + fallbackInterval.ms).toISOString(),
      lastReviewedAt: now.toISOString()
    };
  }
  const current = window.RomanianVocabScheduler.getReviewStage(progress);
  const nextStage = Math.min(current + 1, REVIEW_INTERVALS.length);
  const interval = REVIEW_INTERVALS[Math.max(0, nextStage - 1)] || REVIEW_INTERVALS[REVIEW_INTERVALS.length - 1];
  return {
    reviewStage: nextStage,
    nextReviewAt: new Date(now.getTime() + interval.ms).toISOString(),
    lastReviewedAt: now.toISOString()
  };
}

function reviewStageFromIntervalDays(intervalDays) {
  const days = Number(intervalDays || 0);
  if (!days) return 0;
  const index = REVIEW_INTERVALS.findIndex(interval => Math.round(interval.ms / (24 * 60 * 60 * 1000)) >= days);
  return index >= 0 ? index + 1 : REVIEW_INTERVALS.length;
}

function getSchedulerReview(progress = {}, action, options = {}) {
  if (!window.RomanianVocabScheduler?.scheduleCardReview) {
    return getNextReview(progress, action === 'known');
  }
  const scheduler = window.RomanianVocabScheduler.scheduleCardReview(progress, action, options);
  const reviewStage = reviewStageFromIntervalDays(scheduler.intervalDays);
  return {
    ...scheduler,
    reviewStage,
    reviewCount: reviewStage,
    dueAt: scheduler.dueAt,
    nextReviewAt: scheduler.dueAt,
    lastReviewedAt: scheduler.lastReviewedAt
  };
}

function isRetryDeferred(w) {
  const p = getProgress(w?.ro);
  const scheduler = normalizeScheduler(p || {});
  const dueAt = scheduler.dueAt || p?.nextReviewAt || p?.nextReview;
  if (!p || !dueAt || !(p.qt || p.known || scheduler.reps)) return false;
  return new Date(dueAt).getTime() > Date.now();
}

function formatReviewDue(iso) {
  if (!iso) return '未安排';
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return '现在';
  const minutes = Math.ceil(diff / 60000);
  if (minutes < 60) return `${minutes}分钟后`;
  const hours = Math.ceil(minutes / 60);
  if (hours < 24) return `${hours}小时后`;
  return `${Math.ceil(hours / 24)}天后`;
}

function formatCompactReviewDue(iso) {
  return formatReviewDue(iso)
    .replace('分钟后', '分')
    .replace('小时后', '小时')
    .replace('天后', '天');
}

function isGrammarUnverified(w) {
  return /待核对|待补充|未核对/.test(getGrammarInfo(w));
}

function isStressUnverified(w) {
  return getStressDisplay(w).auto;
}

function isWordUnverified(w) {
  return w?.verification_status === 'needs_review' || isGrammarUnverified(w) || isStressUnverified(w);
}

function unverifiedBadgeHtml(w) {
  return isWordUnverified(w) ? '<span class="unverified-badge">未核对</span>' : '';
}

function setStressHtml(id, w) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = stressToHtml(getStressDisplay(w).text);
  const length = [...String(w?.ro || '')].length;
  el.classList.toggle('long-word', length > 28 && length <= 40);
  el.classList.toggle('very-long-word', length > 40);
}

function setGrammarText(id, w, stress = null) {
  const el = document.getElementById(id);
  if (!el) return;
  const grammar = getGrammarInfo(w);
  const autoNote = (stress || getStressDisplay(w)).auto ? ' · 自动重音待校对' : '';
  el.textContent = `${grammar}${autoNote}`;
  el.classList.toggle('unverified-text', isGrammarUnverified(w) || (stress || getStressDisplay(w)).auto);
}

function getCurrentScopeWords() {
  const collectionWords = getLearningCollectionWords(W);
  return curCat === '全部' ? collectionWords : collectionWords.filter(w => w.cat === curCat);
}

function getReviewPanelMetrics(scoped) {
  const perf = startDailyQueuePerf('getReviewPanelMetrics');
  const key = [
    curCat,
    W.length,
    scoped.length,
    dailyGoal,
    todayNewWords,
    defaultDailyGoal,
    dailyNewLimit,
    todaySeenWords.size,
    todayIntroducedWords.size,
    todayQueueCompleted.size,
    todayQueue.join('|'),
    progressVersion,
    dailyQueueVersion
  ].join('|');
  if (reviewPanelMetricsCache.key === key && reviewPanelMetricsCache.metrics) {
    finishDailyQueuePerf(perf, {
      cacheHit: true,
      vocabScanned: 0,
      resultSize: 0
    });
    return reviewPanelMetricsCache.metrics;
  }
  const scopedKeys = new Set(scoped.map(w => roKey(w.ro)));
  const openQueueWords = todayQueue
    .filter(ro => !setHasRo(todayQueueCompleted, ro))
    .map(ro => getWordByRo(ro))
    .filter(Boolean)
    .filter(w => scopedKeys.has(roKey(w.ro)));
  const activeOpenQueueCount = openQueueWords.filter(isActiveTodayQueueWord).length;
  const newOpenQueueCount = openQueueWords.filter(isUnseenWord).length;
  const waitingLearningCount = openQueueWords.filter(w => {
    const phase = getStudyQueuePhase(w);
    return phase === 'learning-waiting' || phase === 'relearning-waiting';
  }).length;
  const dueLearning = getRemainingDueLearningStepWords(scoped).length;
  const dueReview = getRemainingGraduatedReviewWords(scoped).length;
  const due = getRemainingDueReviewWords(scoped).length;
  const rawUnseenRemaining = getUnseenWords(scoped)
    .filter(w => !setHasRo(todaySeenWords, w.ro) && !setHasRo(todayQueueCompleted, w.ro))
    .length;
  const remainingSlots = Math.max(0, dailyGoal - todayNewWords);
  const remainingDueReviews = getRemainingTodayReviewWords().length;
  const availableNewSlots = Math.min(
    Math.max(0, remainingSlots - activeOpenQueueCount),
    getRemainingDailyNewSlots(newOpenQueueCount)
  );
  const unseenRemaining = Math.min(rawUnseenRemaining, availableNewSlots);
  const metrics = {
    due,
    dueLearning,
    dueReview,
    waitingLearningCount,
    newOpenQueueCount,
    remainingSlots,
    remainingDueReviews,
    unseenRemaining
  };
  reviewPanelMetricsCache = { key, metrics };
  finishDailyQueuePerf(perf, {
    cacheHit: false,
    vocabScanned: scoped.length,
    activeOpenQueueCount,
    unseenRemaining,
    dueLearning,
    dueReview,
    waitingLearningCount,
    newOpenQueueCount,
    remainingDueReviews
  });
  return metrics;
}

function renderReviewPanel() {
  const dueEl = document.getElementById('review-due-count');
  if (!dueEl) return;
  const scoped = getCurrentScopeWords();
  const {
    due,
    dueLearning,
    dueReview,
    waitingLearningCount,
    newOpenQueueCount,
    remainingSlots,
    remainingDueReviews,
    unseenRemaining
  } = getReviewPanelMetrics(scoped);
  const current = filtered[idx];
  const effectiveNewLimit = getEffectiveDailyNewLimit();
  const todayNewLimitProgress = getTodayNewLimitProgressText();
  setText('review-due-count', due);
  setText('review-new-count', `${todayNewWords}/${dailyGoal}`);
  setText('review-new-remaining', `${todayIntroducedWords.size}/${effectiveNewLimit}`);
  const nextLearningBatch = Math.min(20, Math.max(0, dueLearning));
  const nextReviewBatch = Math.min(20, Math.max(0, dueReview));
  const currentGoalDone = isCurrentTodayGoalDone();
  const baseGoalDone = isDefaultGoalDone();
  const summaryText = currentGoalDone
    ? `已完成 ${todayNewWords}/${dailyGoal}`
    : (dueReview > 0
      ? `先复习 ${nextReviewBatch} 个`
      : (dueLearning > 0 ? `再做 ${nextLearningBatch} 个学习步骤` : (newOpenQueueCount > 0 ? `学习 ${newOpenQueueCount} 个新词` : '等待学习步骤')));
  setText('flash-control-summary', summaryText);
  const taskType = current ? getDailyTaskType(current) : '';
  const baseNote = currentGoalDone
    ? `今日通过目标已完成：${todayNewWords}/${dailyGoal} 个。${getContinueAfterGoalText()}`
    : (baseGoalDone
      ? `今日固定目标已完成：${todayNewWords}/${defaultDailyGoal} 个；临时加量进度 ${todayNewWords}/${dailyGoal}。`
      : (dueReview > 0
        ? `先完成 ${nextReviewBatch} 个到期复习；正式复习清空后，再处理新词学习步骤。${taskType ? `当前卡片：${taskType}。` : ''}`
        : (dueLearning > 0
          ? `正式复习已清空；再完成 ${nextLearningBatch} 个已到点的学习步骤。${taskType ? `当前卡片：${taskType}。` : ''}`
          : (newOpenQueueCount > 0
            ? `现在可以学习新词；今日已引入 ${todayNewLimitProgress} 个，等待步骤到点后会优先出现。${taskType ? `当前卡片：${taskType}。` : ''}`
            : `今日已引入新词 ${todayNewLimitProgress} 个；没有到期内容时会等待下一学习步骤。${taskType ? `当前卡片：${taskType}。` : ''}`))));
  setText('review-note', lastLearningHint || baseNote);
  renderTodayFocus({
    due,
    dueLearning,
    dueReview,
    waitingLearningCount,
    newOpenQueueCount,
    remainingSlots,
    remainingDueReviews,
    unseenRemaining
  });
  document.querySelectorAll('.study-mode-btn[data-mode]').forEach(btn => btn.classList.toggle('active', btn.dataset.mode === flashMode));
  setText('flash-mode-title', getFlashModeLabel());
}

function renderTodayFocus(metrics = null) {
  const focus = document.getElementById('today-focus');
  if (!focus) return;
  focus.style.display = '';
  const scoped = getCurrentScopeWords();
  const m = metrics || getReviewPanelMetrics(scoped);
  const currentDone = isCurrentTodayGoalDone();
  const learningDueCount = Number(m.dueLearning || 0);
  const reviewDueCount = Number(m.dueReview || 0);
  const waitingLearningCount = Number(m.waitingLearningCount || 0);
  const newOpenQueueCount = Number(m.newOpenQueueCount || 0);
  const attempts = getTodayAttemptStats();
  const todayNewLimitProgress = getTodayNewLimitProgressText();
  const title = `今日通过 ${todayNewWords}/${dailyGoal}`;
  const action = reviewDueCount > 0
    ? `到期复习 ${reviewDueCount}`
    : (learningDueCount > 0 ? `学习步骤 ${learningDueCount}` : (currentDone ? '已完成' : `新词 ${newOpenQueueCount}`));
  const meta = currentDone
    ? `今天已通过目标；共作答 ${attempts.total} 次，已引入新词 ${todayNewLimitProgress}。`
    : (waitingLearningCount > 0 && !learningDueCount && !reviewDueCount
      ? `${waitingLearningCount} 个学习步骤正在等待；已作答 ${attempts.total} 次，新词 ${todayNewLimitProgress}。`
      : `严格先做${reviewDueCount > 0 ? '正式复习' : '已到点内容'}；共作答 ${attempts.total} 次，新词 ${todayNewLimitProgress}。`);
  setText('today-focus-title', title);
  setText('today-focus-action', action);
  setText('today-focus-meta', meta);
}

function setFlashMode(mode) {
  flashMode = mode;
  idx = 0;
  flipped = false;
  flashHistory = [];
  flashOverrideRo = null;
  const card = document.getElementById('main-card');
  if (card) {
    card.classList.remove('flipped');
    setCardFlipAccessibility('main-card', false);
  }
  applyFilters();
  renderCard();
}

// ── 统计 ─────────────────────────────────────────────────

function upStats() {
  const collectionWords = getLearningCollectionWords(W);
  const vals = collectionWords.map(word => getProgress(word.ro)).filter(Boolean);
  const mastered = vals.filter(p => getStoredLevel(p) === 'mastered').length;
  const learning = vals.filter(isStartedNotMastered).length;
  const dueCount = getRemainingFormalReviewWords(W).length;
  const wbCount = getWrongWords().length;

  setText('s-mastered', mastered);
  setText('s-learning', learning);
  setText('s-wrong', dueCount);
  const masteryPct = collectionWords.length > 0 ? Math.round(mastered / collectionWords.length * 100) : 0;
  setText('s-pct', masteryPct + '%');

  const badge = document.getElementById('wb-tab-badge');
  if (badge) { badge.textContent = wbCount; badge.style.display = wbCount > 0 ? 'inline' : 'none'; }
  updateReviewBadge();
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

// ── 进度同步 ──────────────────────────────────────────────

function syncStatusStorageKey() {
  return `cloud_sync_last_success:${currentUser?.id || 'anonymous'}`;
}

function readLastCloudSyncAt() {
  try { return localStorage.getItem(syncStatusStorageKey()) || ''; }
  catch { return ''; }
}

function markCloudSyncSuccess(at = new Date()) {
  const iso = at instanceof Date ? at.toISOString() : String(at || new Date().toISOString());
  try { localStorage.setItem(syncStatusStorageKey(), iso); } catch {}
  syncUiState = { phase: 'saved', message: '', lastError: '' };
  renderSyncStatus();
}

function formatCloudSyncTime(value, includeDate = false) {
  const date = new Date(value || '');
  if (Number.isNaN(date.getTime())) return '';
  const today = getLocalDateKey();
  const dateKey = getDateKeyFor(date);
  const time = date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  if (!includeDate || dateKey === today) return time;
  return `${date.getMonth() + 1}月${date.getDate()}日 ${time}`;
}

function setSyncBadge(txt = '', cls = '') {
  const message = String(txt || '').trim();
  if (message === '已同步') {
    markCloudSyncSuccess();
    return;
  }
  if (/同步中|备份中|保存中/.test(message)) {
    syncUiState = { ...syncUiState, phase: 'syncing', message };
  } else if (/失败|未能|错误/.test(message)) {
    syncUiState = { phase: 'error', message, lastError: message };
  } else if (/待同步|暂存本机/.test(message)) {
    syncUiState = { ...syncUiState, phase: 'pending', message };
  } else if (/本机保存|已存本机|本机进度|本机备份/.test(message)) {
    syncUiState = { ...syncUiState, phase: isOfflineMode() ? 'local' : (hasPendingSync() ? 'pending' : 'ready'), message };
  } else if (!message) {
    if (syncUiState.phase !== 'error') syncUiState = { ...syncUiState, phase: 'idle', message: '' };
  } else {
    syncUiState = { ...syncUiState, phase: cls === 'saved' ? 'ready' : 'idle', message };
  }
  renderSyncStatus();
}

function getSyncViewModel() {
  const summary = getPendingSyncSummary();
  const flaggedPending = hasPendingProgress();
  const pendingCount = summary.totalCount + (flaggedPending && !summary.progressCount ? 1 : 0);
  const lastSuccessAt = readLastCloudSyncAt();
  if (isOfflineMode()) {
    return {
      kind: 'local', short: '本机保存', title: '仅保存在本机',
      detail: '当前是离线模式，不会上传到云端。', pendingCount, lastSuccessAt
    };
  }
  if (!progressLoaded || !dailyQueueLoaded || !todayLog) {
    return {
      kind: 'checking', short: '检查中…', title: '正在加载今日同步状态',
      detail: '今日记录加载完成后即可主动同步。', pendingCount, lastSuccessAt
    };
  }
  if (manualSyncInFlight || progressCloudSyncInFlight || syncUiState.phase === 'syncing') {
    return {
      kind: 'syncing', short: '同步中…', title: '正在同步今日记录',
      detail: '正在提交今日队列、打卡状态和学习进度，请稍候。', pendingCount, lastSuccessAt
    };
  }
  if (pendingCount > 0) {
    const count = pendingCount;
    return {
      kind: 'pending', short: `待同步 ${count > 99 ? '99+' : count}`, title: `有 ${count} 项待同步`,
      detail: summary.lastError || syncUiState.lastError || '数据已安全保存在本机，网络恢复后会自动重试。',
      pendingCount: count, lastSuccessAt
    };
  }
  if (syncUiState.phase === 'error' || syncUiState.phase === 'pending') {
    return {
      kind: 'error', short: '同步未确认', title: '云端同步尚未确认',
      detail: syncUiState.lastError || syncUiState.message || '请点击重新同步。', pendingCount: 0, lastSuccessAt
    };
  }
  if (lastSuccessAt) {
    const time = formatCloudSyncTime(lastSuccessAt);
    return {
      kind: 'saved', short: `已同步 ${time}`, title: '已同步到云端',
      detail: `最近成功同步：${formatCloudSyncTime(lastSuccessAt, true)}`, pendingCount: 0, lastSuccessAt
    };
  }
  return {
    kind: 'ready', short: '同步待确认', title: '尚未确认今日同步',
    detail: '点击“立即同步”可主动确认今日记录已保存到云端。', pendingCount: 0, lastSuccessAt: ''
  };
}

function renderCloudSyncPanel() {
  const vm = getSyncViewModel();
  const title = document.getElementById('account-sync-status');
  const detail = document.getElementById('account-sync-detail');
  const summary = document.getElementById('account-sync-summary');
  const panel = document.getElementById('account-sync-panel');
  const button = document.getElementById('manual-sync-btn');
  if (title) title.textContent = vm.title;
  if (detail) detail.textContent = vm.detail;
  if (summary) {
    const checkinLabel = isDailyCheckinDone() ? '已打卡' : '未打卡';
    summary.textContent = `今日已通过 ${Number(todayNewWords || 0)}/${Number(dailyGoal || defaultDailyGoal || 0)} · 新词 ${todayIntroducedWords.size}/${getEffectiveDailyNewLimit()} · ${checkinLabel}`;
  }
  if (panel) panel.dataset.state = vm.kind;
  if (button) {
    button.disabled = vm.kind === 'syncing' || vm.kind === 'local' || vm.kind === 'checking';
    button.setAttribute('aria-busy', vm.kind === 'syncing' ? 'true' : 'false');
    button.textContent = vm.kind === 'syncing'
      ? '同步中…'
      : (vm.kind === 'local'
        ? '离线模式'
        : (vm.kind === 'checking' ? '加载中…' : (['pending', 'error'].includes(vm.kind) ? '重新同步' : '立即同步')));
  }
}

function renderSyncStatus() {
  const vm = getSyncViewModel();
  const badge = document.getElementById('sync-badge');
  const text = document.getElementById('sync-badge-text');
  if (badge) {
    badge.className = `sync-badge ${vm.kind}`;
    badge.dataset.state = vm.kind;
    badge.title = `${vm.title}。点击查看详情`;
    badge.setAttribute('aria-label', `${vm.title}，点击查看同步详情`);
  }
  if (text) text.textContent = vm.short;
  renderCloudSyncPanel();
}

function buildTodaySyncSnapshot() {
  return {
    date: getLocalDateKey(),
    log: {
      new_words: Number(todayNewWords || 0),
      goal: Number(dailyGoal || defaultDailyGoal || DEFAULT_DAILY_GOAL),
      completed: isDailyCheckinDone()
    },
    queue: {
      collection_id: learningCollectionId,
      goal: Number(dailyGoal || defaultDailyGoal || DEFAULT_DAILY_GOAL),
      word_id: queueIdsToWordIds(todayQueue),
      word_ro: queueIdsToWordRos(todayQueue),
      completed_word_id: queueIdsToWordIds([...todayQueueCompleted]),
      completed_word_ro: queueIdsToWordRos([...todayQueueCompleted]),
      introduced_word_id: queueIdsToWordIds([...todayIntroducedWords]),
      introduced_word_ro: queueIdsToWordRos([...todayIntroducedWords]),
      completed: isCurrentTodayGoalDone()
    }
  };
}

function manualSyncToday() {
  if (manualSyncInFlight) return manualSyncInFlight;
  if (isOfflineMode() || !currentUser?.id) {
    syncUiState = { phase: 'local', message: '本机保存', lastError: '' };
    renderSyncStatus();
    showToast('当前是离线模式，记录已保存在本机');
    return Promise.resolve({ ok: false, offline: true });
  }
  if (!progressLoaded || !dailyQueueLoaded || !todayLog) {
    renderSyncStatus();
    showToast('今日记录仍在加载，请稍后再同步');
    return Promise.resolve({ ok: false, loading: true });
  }

  manualSyncInFlight = (async () => {
    syncUiState = { ...syncUiState, phase: 'syncing', message: '同步今日记录中…', lastError: '' };
    renderSyncStatus();
    try {
      flushFastProgressQueue();
      if (todayStateFlushTimer) {
        clearTimeout(todayStateFlushTimer);
        todayStateFlushTimer = null;
      }
      flushTodayAccuracyStats();
      writeTodaySeenWords();
      const snapshot = buildTodaySyncSnapshot();

      let result = null;
      let pending = getPendingSyncSummary();
      for (let attempt = 0; attempt < 2; attempt++) {
        result = await triggerCloudProgressBackup('同步今日记录', { force: true, limit: 1000 });
        pending = reconcileProgressPendingFlags();
        if (!pending.totalCount && !hasPendingProgress()) break;
      }

      if (pending.totalCount || hasPendingProgress()) {
        throw new Error(result?.dailyError?.message || result?.dailyError || result?.error?.message || '仍有学习数据等待同步');
      }
      const cloudProgress = result?.cloudProgress || await apiLoadProgress(currentUser.id);
      const cloudProgressSource = cloudProgress.__progressSource || 'cloud';
      if (cloudProgressSource === 'localFallback') {
        throw new Error('云端进度回读失败，不能确认同步成功');
      }
      replaceProgressMap(cloudProgress);
      const [verification, progressVerification] = await Promise.all([
        apiVerifyTodayState(currentUser.id, snapshot),
        apiVerifyProgressState(currentUser.id, progressMap)
      ]);
      pending = reconcileProgressPendingFlags();
      if (!verification?.ok) {
        const missing = [!verification?.logOk ? '今日记录' : '', !verification?.queueOk ? '每日队列' : ''].filter(Boolean).join('和');
        throw new Error(`${missing || '今日数据'}尚未通过云端回读确认`);
      }
      if (!progressVerification?.ok) {
        throw new Error(`学习进度尚未通过云端回读确认（${progressVerification?.mismatchCount || 0} 条不一致）`);
      }
      if (pending.totalCount || hasPendingProgress()) {
        throw new Error('同步过程中产生了新的学习记录，请再次同步');
      }

      markCloudSyncSuccess(progressVerification.verifiedAt || verification.verifiedAt || new Date());
      showToast('今日记录已同步到云端');
      return { ok: true, verification, progressVerification };
    } catch (error) {
      const pending = reconcileProgressPendingFlags();
      const message = error?.message || String(error || '同步失败');
      syncUiState = {
        phase: pending.totalCount || hasPendingProgress() ? 'pending' : 'error',
        message,
        lastError: message
      };
      window.reportClientIssue?.('manual_sync_unconfirmed', error, {
        operation: 'manual_sync_today',
        pending_count: pending.totalCount
      });
      renderSyncStatus();
      showToast(pending.totalCount || hasPendingProgress()
        ? `数据已保存在本机，仍有 ${Math.max(1, pending.totalCount)} 项待同步`
        : `同步未确认：${message}`);
      return { ok: false, error, pending };
    } finally {
      manualSyncInFlight = null;
      renderSyncStatus();
    }
  })();
  renderSyncStatus();
  return manualSyncInFlight;
}

window.renderCloudSyncPanel = renderCloudSyncPanel;
window.manualSyncToday = manualSyncToday;

function showProgressSaveWarning(message) {
  const now = Date.now();
  if (now - lastProgressWarningAt < 5000) return;
  lastProgressWarningAt = now;
  showToast(message);
}

function handleProgressSaveStatus(status) {
  if (!status) return false;
  if (status.memoryBackup?.ok === false) {
    window.reportClientIssue?.('local_backup_failed', status.memoryBackup.error || 'Local backup failed', { operation: 'progress_backup' });
    setSyncBadge('本机备份失败', '');
    showProgressSaveWarning('本机加强记录备份保存失败，请导出进度或清理浏览器存储');
    return true;
  }
  if (status.memoryBackedByDb === false) {
    window.reportClientIssue?.('progress_sync_deferred', status.fallbackWarning || 'Progress saved locally', { operation: 'save_progress' });
    setSyncBadge('本机备份', 'saved');
    showProgressSaveWarning('部分学习状态已保存在本设备，云端同步恢复后会自动重试');
    return true;
  }
  return false;
}

function isCoreMemoryExercise(options = {}) {
  return !options.exerciseType || ['translation', 'listening'].includes(options.exerciseType);
}

function buildProgressUpdate(prev = {}, known, qr, qt, success = known, options = {}) {
  const nowIso = new Date().toISOString();
  const coreMemory = isCoreMemoryExercise(options);
  const schedulerAction = options.schedulerAction || (success ? 'known' : 'unknown');
  const review = options.clearWrongbook
    ? buildReviewFromPrev(prev)
    : (coreMemory ? getSchedulerReview(prev, schedulerAction, { now: nowIso }) : buildReviewFromPrev(prev));
  const nextQr = coreMemory ? (qr || 0) : (prev.qr || 0);
  const nextQt = coreMemory ? (qt || 0) : (prev.qt || 0);
  const nextKnown = coreMemory ? known : !!prev.known;
  const grammarQr = coreMemory
    ? window.RomanianVocabProgressModel.getGrammarRight(prev)
    : window.RomanianVocabProgressModel.getGrammarRight(prev) + (success ? 1 : 0);
  const grammarQt = coreMemory
    ? window.RomanianVocabProgressModel.getGrammarTotal(prev)
    : window.RomanianVocabProgressModel.getGrammarTotal(prev) + 1;
  const calculatedLevel = calcLevel(nextQr, nextQt, nextKnown, { ...prev, ...review });
  const level = coreMemory
    ? resolveNextStoredLevel(prev, calculatedLevel, success, options)
    : getStoredLevel(prev);
  const wasMasteredBefore = !!prev.wasMasteredAt || getStoredLevel(prev) === 'mastered';
  const shouldTrackWrongbook = coreMemory && options.trackWrongbook === true && wasMasteredBefore;
  const shouldClearWrongbook = options.clearWrongbook === true;
  const correctStreakSinceWrong = shouldClearWrongbook
    ? 0
    : (success
      ? (Number(prev.correctStreakSinceWrong || 0) + 1)
      : 0);
  const decayedWrongCount = success
    ? Math.max(0, Number(prev.wrongCount || 0) - 1)
    : Number(prev.wrongCount || 0);
  const wrongCount = shouldClearWrongbook
    ? 0
    : decayedWrongCount + (shouldTrackWrongbook && !success ? 1 : 0);
  const errorStreak = shouldClearWrongbook
    ? 0
    : (shouldTrackWrongbook
        ? (success ? 0 : Number(prev.errorStreak || 0) + 1)
        : (success ? 0 : Number(prev.errorStreak || 0)));
  const lastWrongAt = shouldClearWrongbook
    ? null
    : (shouldTrackWrongbook && !success ? nowIso : (prev.lastWrongAt || null));
  const weakClearedAt = shouldClearWrongbook
    ? nowIso
    : (wrongCount === 0 && success ? nowIso : (!success ? null : (prev.weakClearedAt || null)));
  const memory = { wrongCount, errorStreak, lastWrongAt, weakClearedAt };
  const clearedScheduler = shouldClearWrongbook
    ? {
        cardState: 'review',
        needsReinforcement: false,
        forgetCount: 0,
        lapses: 0,
        recentResults: ['known', 'known']
      }
    : {};
  const nextProgress = applyMasteryHistory({
    ...prev,
    seen: true,
    seenViaCard: !!(prev.seenViaCard || options.seenViaCard),
    known: nextKnown,
    qr: nextQr,
    qt: nextQt,
    grammarQr,
    grammarQt,
    level,
    ...review,
    ...memory,
    ...clearedScheduler,
    correctStreakSinceWrong
  }, prev);
  return { review, level, memory, progress: nextProgress };
}

async function syncProgress(wordRo, known, qr, qt, success = known, options = {}) {
  setSyncBadge('保存中...', '');
  const canonicalRo = canonicalWordRo(wordRo);
  const word = getWordByRo(canonicalRo);
  const wordId = word?.id ?? null;
  const prev = getProgress(canonicalRo) || {};
  const { memory, progress: nextProgress } = buildProgressUpdate(prev, known, qr, qt, success, options);
  setProgress(canonicalRo, nextProgress, { source: 'syncProgress:optimistic' });
  const localStatus = typeof queueProgressForSync === 'function'
    ? queueProgressForSync(currentUser.id, wordId, word?.ro || canonicalRo, { ...nextProgress, word_id: wordId, word_ro: word?.ro || canonicalRo, pendingSync: true }, memory, prev)
    : { ok: false };
  if (localStatus.ok) {
    setProgress(canonicalRo, { ...nextProgress, pendingSync: !isOfflineMode() }, { source: 'syncProgress:queued' });
    setSyncBadge(isOfflineMode() ? '已存本机' : '本机待同步', isOfflineMode() ? 'saved' : '');
    if (!options.skipDailyQueueReconcile) await reconcileTodayQueueAfterProgress(canonicalRo);
  } else {
    if (Object.keys(prev).length) {
      setProgress(canonicalRo, prev, { source: 'syncProgress:rollback', replace: true });
    } else {
      deleteProgress(canonicalRo);
    }
    setSyncBadge('本机保存失败', '');
    showProgressSaveWarning('本机保存失败，请导出进度或清理浏览器存储');
  }
  setTimeout(() => {
    if (!hasPendingSync()) setSyncBadge('', '');
  }, 2000);
  applyFilters();
  invalidateQuizPracticePool();
  upStats();
  updateReviewBadge();
}

const INTERACTION_RULES = {
  flashcard_known(prev) {
    return {
      known: true,
      qr: (prev.qr || 0) + 1,
      qt: (prev.qt || 0) + 1,
      success: true,
      options: { seenViaCard: true, schedulerAction: 'known' }
    };
  },
  flashcard_unknown(prev) {
    return {
      known: !!prev.known,
      qr: prev.qr || 0,
      qt: (prev.qt || 0) + 1,
      success: false,
      options: { seenViaCard: true, schedulerAction: 'unknown' }
    };
  },
  flashcard_fuzzy(prev) {
    return {
      known: !!prev.known,
      qr: prev.qr || 0,
      qt: (prev.qt || 0) + 1,
      success: false,
      options: { seenViaCard: true, schedulerAction: 'fuzzy' }
    };
  },
  review_correct(prev) {
    return {
      known: true,
      qr: (prev.qr || 0) + 1,
      qt: (prev.qt || 0) + 1,
      success: true,
      options: { seenViaCard: true, schedulerAction: 'known' }
    };
  },
  review_wrong(prev) {
    return {
      known: !!prev.known,
      qr: prev.qr || 0,
      qt: (prev.qt || 0) + 1,
      success: false,
      options: { seenViaCard: true, preserveLearningLevel: true, trackWrongbook: shouldTrackWrongbookForMiss(prev), schedulerAction: 'unknown' }
    };
  },
  review_fuzzy(prev) {
    return {
      known: !!prev.known,
      qr: prev.qr || 0,
      qt: (prev.qt || 0) + 1,
      success: false,
      options: { seenViaCard: true, preserveLearningLevel: true, trackWrongbook: shouldTrackWrongbookForMiss(prev), schedulerAction: 'fuzzy' }
    };
  },
  quiz_correct(prev) {
    return {
      known: true,
      qr: (prev.qr || 0) + 1,
      qt: (prev.qt || 0) + 1,
      success: true,
      options: { trackWrongbook: true }
    };
  },
  quiz_wrong(prev) {
    return {
      known: !!prev.known,
      qr: prev.qr || 0,
      qt: (prev.qt || 0) + 1,
      success: false,
      options: { preserveLearningLevel: shouldTrackWrongbookForMiss(prev), trackWrongbook: shouldTrackWrongbookForMiss(prev) }
    };
  },
  wrongbook_correct(prev) {
    return {
      known: true,
      qr: (prev.qr || 0) + 1,
      qt: (prev.qt || 0) + 1,
      success: true,
      options: { preserveLearningLevel: true }
    };
  },
  wrongbook_wrong(prev) {
    return {
      known: !!prev.known,
      qr: prev.qr || 0,
      qt: (prev.qt || 0) + 1,
      success: false,
      options: { preserveLearningLevel: true, trackWrongbook: true }
    };
  },
  wrongbook_clear(prev) {
    return {
      known: true,
      qr: prev.qr || 0,
      qt: prev.qt || 0,
      success: true,
      options: { preserveLearningLevel: true, clearWrongbook: true }
    };
  }
};

function shouldTrackWrongbookForMiss(prev = {}) {
  return !!prev.wasMasteredAt || getStoredLevel(prev) === 'mastered';
}

function buildNextProgressForInteraction(wordRo, interactionType, extraOptions = {}) {
  const rule = INTERACTION_RULES[interactionType];
  if (!rule) throw new Error(`Unknown interaction type: ${interactionType}`);
  const canonicalRo = canonicalWordRo(wordRo);
  const prev = getProgress(canonicalRo) || { known: false, qr: 0, qt: 0 };
  const next = rule(prev);
  const options = { ...next.options, ...extraOptions };
  const { memory, progress } = buildProgressUpdate(prev, next.known, next.qr, next.qt, next.success, options);
  return { canonicalRo, prev, next, options, memory, progress };
}

function scheduleIdleTask(task, delay = FAST_PERSIST_DELAY_MS) {
  return setTimeout(() => {
    if ('requestIdleCallback' in window) {
      requestIdleCallback(task, { timeout: delay });
    } else {
      task();
    }
  }, delay);
}

function flushFastProgressQueue() {
  if (fastProgressFlushTimer) {
    clearTimeout(fastProgressFlushTimer);
    fastProgressFlushTimer = null;
  }
  if (!fastProgressQueue.size || !currentUser?.id) return;
  const entries = [...fastProgressQueue.values()];
  fastProgressQueue.clear();
  const localStatus = typeof queueProgressBatchForSync === 'function'
    ? queueProgressBatchForSync(currentUser.id, entries)
    : { ok: false };
  if (localStatus.ok) {
    entries.forEach(entry => {
      setProgress(entry.wordRo, { ...entry.progress, pendingSync: !isOfflineMode() }, { source: 'flushFastProgressQueue' });
    });
    setSyncBadge(isOfflineMode() ? '已存本机' : '本机待同步', isOfflineMode() ? 'saved' : '');
  } else {
    setSyncBadge('本机保存失败', '');
    showProgressSaveWarning('本机保存失败，请导出进度或清理浏览器存储');
  }
  setTimeout(() => {
    if (!hasPendingSync()) setSyncBadge('', '');
  }, 2000);
  invalidateQuizPracticePool();
  renderReviewPanel();
  upStats();
  updateReviewBadge();
}

function persistFastCardAnswer(result) {
  if (!result?.canonicalRo || !currentUser?.id) return;
  const word = getWordByRo(result.canonicalRo);
  const wordId = word?.id ?? null;
  const existing = fastProgressQueue.get(result.canonicalRo);
  const pendingEvent = typeof createProgressPendingEvent === 'function'
    ? createProgressPendingEvent(String(wordId || result.canonicalRo), result.prev || {}, result.progress || {})
    : null;
  fastProgressQueue.set(result.canonicalRo, {
    wordId,
    wordRo: result.canonicalRo,
    progress: { ...result.progress, word_id: wordId, word_ro: word?.ro || result.canonicalRo, pendingSync: true },
    memory: result.memory,
    baseProgress: existing?.baseProgress || result.prev || {},
    pendingEvents: [
      ...(Array.isArray(existing?.pendingEvents) ? existing.pendingEvents : []),
      ...(pendingEvent ? [pendingEvent] : [])
    ]
  });
  if (fastProgressFlushTimer) return;
  fastProgressFlushTimer = scheduleIdleTask(flushFastProgressQueue);
}

function flushPendingFastCardState() {
  flushFastProgressQueue();
  flushTodayStatePersistence();
  flushTodayAccuracyStats();
}

function flushTodayStatePersistence() {
  if (todayStateFlushTimer) {
    clearTimeout(todayStateFlushTimer);
    todayStateFlushTimer = null;
  }
  if (!currentUser?.id || !ensureDailyStateCurrent({ reload: true })) return;
  flushTodayAccuracyStats();
  writeTodaySeenWords();
  saveTodayQueue({ background: true }).catch(error => {
    console.warn('Daily queue background save failed', error);
    setSyncBadge('队列待同步', '');
  });
  const checkinDone = isDailyCheckinDone();
  todayLog = { ...(todayLog || {}), user_id: currentUser.id, log_date: getLocalDateKey(), new_words: todayNewWords, goal: dailyGoal, completed: checkinDone };
  saveTodayLogBackground(
    apiUpdateTodayLog(currentUser.id, todayNewWords, dailyGoal, defaultDailyGoal, { completed: checkinDone })
  );
  invalidateCalendarCache();
  renderDailyGoal();
  updateTodayCalendarCell();
  renderReviewPanel();
  updateReviewBadge();
  if (pendingTodayGoalPrompt) {
    pendingTodayGoalPrompt = false;
    showDailyGoalCompletionPrompt(true);
  }
}

function scheduleTodayStatePersistence(goalReached = false) {
  pendingTodayGoalPrompt = pendingTodayGoalPrompt || goalReached;
  if (todayStateFlushTimer) return;
  todayStateFlushTimer = scheduleIdleTask(flushTodayStatePersistence);
}

async function recordInteraction(wordRo, interactionType, extraOptions = {}) {
  const rule = INTERACTION_RULES[interactionType];
  if (!rule) throw new Error(`Unknown interaction type: ${interactionType}`);
  const prev = getProgress(wordRo) || { known: false, qr: 0, qt: 0 };
  const next = rule(prev);
  await syncProgress(wordRo, next.known, next.qr, next.qt, next.success, { ...next.options, ...extraOptions });
  return getProgress(wordRo) || {};
}

// ── 导航 ─────────────────────────────────────────────────

function isSupportedBilibiliUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    const host = url.hostname.toLocaleLowerCase('en');
    return url.protocol === 'https:' && (host === 'b23.tv' || host === 'bilibili.com' || host.endsWith('.bilibili.com'));
  } catch {
    return false;
  }
}

function getGrammarCourseVideos(course) {
  const configuredVideos = Array.isArray(course?.bilibiliVideos)
    ? course.bilibiliVideos
    : course?.bilibiliUrl
      ? [{ title: course.title, url: course.bilibiliUrl, duration: course.duration }]
      : [];
  return configuredVideos
    .map(video => ({
      title: String(video?.title || course?.title || '配套课程').trim(),
      url: String(video?.url || '').trim(),
      duration: String(video?.duration || '').trim()
    }))
    .filter(video => video.title && isSupportedBilibiliUrl(video.url));
}

function normalizeGrammarSearch(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[şŞ]/g, match => match === 'Ş' ? 'S' : 's')
    .replace(/[ţŢ]/g, match => match === 'Ţ' ? 'T' : 't')
    .toLocaleLowerCase('ro')
    .trim()
    .replace(/\s+/g, ' ');
}

function getVisibleGrammarCourses() {
  const normalizedQuery = normalizeGrammarSearch(grammarSearchQuery);
  if (!normalizedQuery) return grammarCourses;
  const tokens = normalizedQuery.split(' ').filter(Boolean);
  const modules = new Map((Array.isArray(grammarCourseMeta.modules) ? grammarCourseMeta.modules : [])
    .map(module => [String(module?.id || ''), module]));
  return grammarCourses.filter(course => {
    const module = modules.get(String(course.module || '')) || {};
    const content = grammarTopicContent[String(course.id || '')] || {};
    const courseVideos = getGrammarCourseVideos(course);
    const paradigmRows = Array.isArray(content.paradigm?.rows) ? content.paradigm.rows : [];
    const examples = Array.isArray(content.examples) ? content.examples : [];
    const searchableText = normalizeGrammarSearch([
      course.title,
      course.summary,
      course.category,
      ...courseVideos.flatMap(video => [video.title, video.duration]),
      module.title,
      module.summary,
      content.overview,
      ...(Array.isArray(content.keyPoints) ? content.keyPoints : []),
      ...examples.flatMap(example => [example?.ro, example?.zh]),
      content.paradigm?.title,
      content.paradigm?.note,
      ...paradigmRows.flatMap(row => [row?.label, row?.form, row?.example])
    ].filter(Boolean).join(' '));
    return tokens.every(token => searchableText.includes(token));
  });
}

function renderGrammarSearchState() {
  const input = document.getElementById('grammar-search-input');
  const clear = document.getElementById('grammar-search-clear');
  if (input && input.value !== grammarSearchQuery) input.value = grammarSearchQuery;
  if (clear) clear.hidden = !grammarSearchQuery.trim();
}

function renderGrammarCourses() {
  const list = document.getElementById('grammar-course-list');
  if (!list) return;
  renderGrammarSearchState();
  const visible = getVisibleGrammarCourses();
  const visibleCount = document.getElementById('grammar-visible-count');
  const hasQuery = Boolean(grammarSearchQuery.trim());
  if (visibleCount) visibleCount.textContent = hasQuery
    ? `找到 ${visible.length} / ${grammarCourses.length} 个专题`
    : `共 ${grammarCourses.length} 个专题`;
  if (!visible.length) {
    list.innerHTML = `<div class="grammar-empty">没有找到与“${escapeHtml(grammarSearchQuery.trim())}”相关的语法专题。<br><button class="btn-sm" type="button" style="margin-top:10px" data-clear-grammar-search>清除搜索</button></div>`;
    return;
  }
  const configuredModules = (Array.isArray(grammarCourseMeta.modules) ? grammarCourseMeta.modules : [])
    .filter(module => module && typeof module === 'object')
    .sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
  const moduleMap = new Map(configuredModules.map(module => [String(module.id || ''), module]));
  visible.forEach(course => {
    const moduleId = String(course.module || 'other');
    if (!moduleMap.has(moduleId)) moduleMap.set(moduleId, { id: moduleId, title: '其他语法', summary: '', order: 999 });
  });
  const visibleModules = [...moduleMap.values()]
    .map(module => ({ ...module, courses: visible.filter(course => String(course.module || 'other') === String(module.id || '')) }))
    .filter(module => module.courses.length)
    .sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
  const renderCourse = (course, module) => {
    const order = String(Number(course.order || 0)).padStart(2, '0');
    const title = String(course.title || '未命名专题');
    const content = grammarTopicContent[String(course.id || '')] || {};
    const overview = String(content.overview || course.summary || '这个专题的文字内容正在整理。');
    const keyPoints = (Array.isArray(content.keyPoints) ? content.keyPoints : []).filter(Boolean);
    const examples = (Array.isArray(content.examples) ? content.examples : []).filter(example => example?.ro || example?.zh);
    const paradigm = content.paradigm && typeof content.paradigm === 'object' ? content.paradigm : null;
    const paradigmRows = (Array.isArray(paradigm?.rows) ? paradigm.rows : []).filter(row => row?.label || row?.form || row?.example);
    const courseVideos = getGrammarCourseVideos(course);
    const contentMeta = [
      keyPoints.length ? `${keyPoints.length} 条规则` : '',
      examples.length ? `${examples.length} 个例句` : '',
      paradigmRows.length ? '含构成表' : '',
      courseVideos.length ? `${courseVideos.length} 节课程` : ''
    ].filter(Boolean).join(' · ');
    const watchActions = courseVideos.map(video => `
      <a class="grammar-watch" href="${escapeHtml(video.url)}" target="_blank" rel="noopener noreferrer" aria-label="在 Bilibili 观看${escapeHtml(video.title)}">
        <span class="grammar-watch-copy">
          <span class="grammar-watch-title">${escapeHtml(video.title)}</span>
          <span class="grammar-watch-platform">Bilibili 课程 ↗</span>
        </span>
        ${video.duration ? `<span class="grammar-duration">${escapeHtml(video.duration)}</span>` : ''}
      </a>`).join('');
    const footer = watchActions
      ? `<div class="grammar-course-footer"><div class="grammar-detail-label">配套课程</div><div class="grammar-video-list">${watchActions}</div></div>`
      : '';
    return `
        <details class="grammar-course" data-grammar-topic="${escapeHtml(course.id || '')}">
          <summary aria-label="查看${escapeHtml(title)}的文字摘要">
            <span class="grammar-course-top">
              <span class="grammar-course-number">TOPIC ${escapeHtml(order)}</span>
              <span class="grammar-course-tags">
                ${course.category ? `<span class="grammar-course-tag">${escapeHtml(course.category)}</span>` : ''}
              </span>
            </span>
            <h3 class="grammar-course-title">${escapeHtml(title)}</h3>
            ${contentMeta ? `<span class="grammar-content-meta">${escapeHtml(contentMeta)}</span>` : ''}
            <span class="grammar-open-hint">查看规则与例句</span>
          </summary>
          <div class="grammar-course-detail">
            <div class="grammar-detail-block">
              <div class="grammar-detail-label">先看结论</div>
              <p class="grammar-course-summary">${escapeHtml(overview)}</p>
            </div>
            ${keyPoints.length ? `
              <div class="grammar-detail-block">
                <div class="grammar-detail-label">核心规则</div>
                <ul class="grammar-key-points">${keyPoints.map(point => `<li>${escapeHtml(point)}</li>`).join('')}</ul>
              </div>` : ''}
            ${paradigmRows.length ? `
              <div class="grammar-detail-block grammar-paradigm-block">
                <div class="grammar-detail-label">${escapeHtml(paradigm.title || '词缀与构成')}</div>
                ${paradigm.note ? `<p class="grammar-paradigm-note">${escapeHtml(paradigm.note)}</p>` : ''}
                <div class="grammar-paradigm-scroll" tabindex="0" aria-label="${escapeHtml(title)}的变位或构成表">
                  <table class="grammar-paradigm-table">
                    <thead><tr><th scope="col">人称 / 类型</th><th scope="col">词缀 / 构成</th><th scope="col">示例</th></tr></thead>
                    <tbody>${paradigmRows.map(row => `<tr><th scope="row">${escapeHtml(row.label || '')}</th><td>${escapeHtml(row.form || '')}</td><td lang="ro">${escapeHtml(row.example || '')}</td></tr>`).join('')}</tbody>
                  </table>
                </div>
              </div>` : ''}
            ${examples.length ? `
              <div class="grammar-detail-block">
                <div class="grammar-detail-label">放进句子里</div>
                <div class="grammar-example-list">${examples.map(example => `
                  <div class="grammar-example">
                    ${example.ro ? `<div class="grammar-example-ro" lang="ro">${escapeHtml(example.ro)}</div>` : ''}
                    ${example.zh ? `<div class="grammar-example-zh">${escapeHtml(example.zh)}</div>` : ''}
                  </div>`).join('')}</div>
              </div>` : ''}
            ${footer}
          </div>
        </details>`;
  };
  list.innerHTML = visibleModules.map((module, index) => `
    <details class="grammar-module"${hasQuery || index === 0 ? ' open' : ''}>
      <summary>
        <span class="grammar-module-head">
          <span class="grammar-module-title">${escapeHtml(module.title || '语法模块')}</span>
          <span class="grammar-module-meta">${escapeHtml(module.summary || '')}</span>
        </span>
        <span class="grammar-course-tag">${module.courses.length} 个专题</span>
      </summary>
      <div class="grammar-module-body">
        <div class="grammar-course-grid">${module.courses.map(course => renderCourse(course, module)).join('')}</div>
      </div>
    </details>
  `).join('');
}

function setGrammarSearchQuery(value) {
  grammarSearchQuery = String(value || '');
  renderGrammarCourses();
}

document.addEventListener('input', (event) => {
  if (event.target?.id !== 'grammar-search-input') return;
  setGrammarSearchQuery(event.target.value);
});

document.addEventListener('click', (event) => {
  if (!event.target.closest?.('#grammar-search-clear, [data-clear-grammar-search]')) return;
  setGrammarSearchQuery('');
  document.getElementById('grammar-search-input')?.focus();
});

async function loadGrammarCourses() {
  if (grammarCoursesLoaded) {
    renderGrammarCourses();
    return grammarCourses;
  }
  if (grammarCoursesLoadPromise) return grammarCoursesLoadPromise;
  const loading = document.getElementById('grammar-loading');
  const content = document.getElementById('grammar-content');
  if (loading) {
    loading.style.display = 'block';
    loading.textContent = '正在加载课程目录...';
  }
  if (content) content.style.display = 'none';
  grammarCoursesLoadPromise = (async () => {
    try {
      const [courseResponse, contentResponse] = await Promise.all([
        fetch('./data/grammar-courses.json?v=20260716-grammar-content', { cache: 'reload' }),
        fetch('./data/grammar-content.json?v=20260716-grammar-content', { cache: 'reload' })
      ]);
      if (!courseResponse.ok) throw new Error(`Course catalog HTTP ${courseResponse.status}`);
      if (!contentResponse.ok) throw new Error(`Grammar content HTTP ${contentResponse.status}`);
      const [payload, contentPayload] = await Promise.all([courseResponse.json(), contentResponse.json()]);
      grammarCourseMeta = payload && typeof payload === 'object' ? payload : {};
      grammarTopicContent = contentPayload?.topics && typeof contentPayload.topics === 'object' ? contentPayload.topics : {};
      grammarCourses = (Array.isArray(payload?.courses) ? payload.courses : [])
        .filter(course => course && typeof course === 'object')
        .sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
      grammarCoursesLoaded = true;
      const title = document.getElementById('grammar-title');
      const subtitle = document.getElementById('grammar-subtitle');
      const total = document.getElementById('grammar-course-total');
      const moduleTotal = document.getElementById('grammar-module-total');
      const scopeLabel = document.getElementById('grammar-scope-label');
      const modules = Array.isArray(grammarCourseMeta.modules) ? grammarCourseMeta.modules : [];
      if (title) title.textContent = grammarCourseMeta.title || '罗马尼亚语语法知识库';
      if (subtitle) subtitle.textContent = grammarCourseMeta.subtitle || '按照罗马尼亚语自身的语法体系，从词法、句法到书写与语用逐层整理。';
      if (total) total.textContent = `${grammarCourses.length} 个专题`;
      if (moduleTotal) moduleTotal.textContent = `${modules.length} 个模块`;
      if (scopeLabel) scopeLabel.textContent = grammarCourseMeta.scopeLabel || '按词法与句法编排';
      renderGrammarCourses();
      if (loading) loading.style.display = 'none';
      if (content) content.style.display = 'block';
      return grammarCourses;
    } catch (error) {
      console.warn('Grammar courses load failed', error);
      if (loading) loading.innerHTML = '<div>课程目录加载失败，请稍后重试。</div><button class="btn-sm" type="button" style="margin-top:10px" onclick="retryGrammarCourses()">重新加载</button>';
      return [];
    } finally {
      grammarCoursesLoadPromise = null;
    }
  })();
  return grammarCoursesLoadPromise;
}

function retryGrammarCourses() {
  grammarCoursesLoaded = false;
  grammarCoursesLoadPromise = null;
  return loadGrammarCourses();
}

function openPronunciationGuide() {
  switchPage('guide');
  requestAnimationFrame(() => {
    document.getElementById('guide-pronunciation')?.scrollIntoView({ block: 'start' });
  });
}

function switchPage(p) {
  if (p !== 'quiz' && isQuizInProgress()) {
    const answered = qRoundTotal;
    resetQuizSession();
    showToast(answered ? `本轮测验已结束，已作答 ${answered} 题` : '本轮测验已结束');
  }
  if (p !== 'wrongbook' && wbAutoAdvanceTimer) {
    clearTimeout(wbAutoAdvanceTimer);
    wbAutoAdvanceTimer = null;
  }
  const pages = ['flash', 'grammar', 'list', 'wrongbook', 'quiz', 'stats', 'guide', 'admin'];
  const activeNavPage = p;
  pages.forEach((s) => {
    document.querySelectorAll(`.nav-tab[data-page="${s}"]`).forEach(tab => {
      tab.classList.toggle('active', s === activeNavPage);
      tab.setAttribute('aria-selected', s === activeNavPage ? 'true' : 'false');
    });
    const page = document.getElementById('page-' + s);
    if (page) page.classList.toggle('active', s === p);
  });
  closeAccountMenu?.();
  if (p === 'flash') { applyFilters(); renderCard(); renderDailyGoal(); renderCalendar(); }
  if (p === 'quiz') showQuizSetup();
  if (p === 'stats') renderStatsPage();
  if (p === 'list') renderList();
  if (p === 'wrongbook') initWrongbook();
  if (p === 'grammar') loadGrammarCourses();
  if (p === 'admin') { restoreAdminSections(); loadAdminStats(); loadAdminPendingWords(); loadAdminReports(); loadAdminUsers(); loadAdminWeeklySummary(); }
}

function switchStatsPanel(panel = 'personal') {
  const allowed = new Set(['personal', 'leaderboard']);
  const next = allowed.has(panel) ? panel : 'personal';
  const statsPage = document.getElementById('page-stats');
  if (!statsPage) return;
  document.querySelectorAll('#page-stats .stats-subtab').forEach(tab => {
    const active = tab.id === `stats-tab-${next}`;
    tab.classList.toggle('active', active);
    if (tab.id.startsWith('stats-tab-')) tab.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  document.querySelectorAll('#page-stats .stats-pane').forEach(pane => {
    pane.classList.toggle('active', pane.id === `stats-pane-${next}`);
  });
  try { sessionStorage.setItem('stats-active-panel', next); } catch {}
  if (next === 'leaderboard') renderLeaderboard();
  if (next === 'personal') {
    let personalPanel = 'overview';
    try { personalPanel = sessionStorage.getItem('personal-stats-active-panel') || 'overview'; } catch {}
    switchPersonalStatsPanel(personalPanel);
  }
}

function switchPersonalStatsPanel(panel = 'overview') {
  const allowed = new Set(['overview', 'practice', 'words', 'backup']);
  const next = allowed.has(panel) ? panel : 'overview';
  const statsPage = document.getElementById('page-stats');
  if (!statsPage) return;
  document.querySelectorAll('#page-stats .stats-subtab[id^="personal-stats-tab-"]').forEach(tab => {
    const active = tab.id === `personal-stats-tab-${next}`;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  document.querySelectorAll('#page-stats .stats-pane[id^="personal-stats-pane-"]').forEach(pane => {
    pane.classList.toggle('active', pane.id === `personal-stats-pane-${next}`);
  });
  try { sessionStorage.setItem('personal-stats-active-panel', next); } catch {}
}

document.addEventListener('click', (event) => {
  const quizOption = event.target.closest?.('.opt[data-quiz-action]');
  if (quizOption) {
    if (quizOption.style.pointerEvents === 'none') return;
    const action = quizOption.dataset.quizAction;
    const ok = quizOption.dataset.ok === '1';
    if (action === 'answer') {
      answerQ(quizOption, ok, quizOption.dataset.ro || '', quizOption.dataset.zh || '');
    } else if (action === 'exercise') {
      answerExerciseQ(quizOption, ok);
    }
    return;
  }

  const accountMenu = document.getElementById('account-menu-wrap');
  if (accountMenu && !accountMenu.contains(event.target)) accountMenu.classList.remove('open');
});

function getActivePageId() {
  return document.querySelector('.page.active')?.id || '';
}

function isTextEntryTarget(target) {
  if (!target) return false;
  const tag = String(target.tagName || '').toLowerCase();
  return target.isContentEditable || ['input', 'textarea', 'select'].includes(tag);
}

function isNativeActivationKeyOnControl(event) {
  const tag = String(event.target?.tagName || '').toLowerCase();
  return ['button', 'a', 'summary'].includes(tag) && [' ', 'Enter'].includes(getShortcutKey(event));
}

function isAmbiguousStudyActivation(event, key) {
  if (![' ', 'Enter'].includes(key)) return false;
  const page = getActivePageId();
  if (page !== 'page-flash' && page !== 'page-wrongbook') return false;
  const tag = String(event.target?.tagName || '').toLowerCase();
  return ['button', 'a', 'summary'].includes(tag);
}

function isModalOpen() {
  return Array.from(document.querySelectorAll('.modal-overlay')).some(modal => modal.style.display !== 'none');
}

function closeTopModal() {
  const modals = [
    ['add-word-modal', closeAddWordModal],
    ['edit-modal', closeEditModal],
    ['account-modal', closeAccountModal],
    ['daily-checkin-modal', closeDailyCheckinModal],
    ['password-reset-modal', closePasswordResetModal],
    ['report-modal', closeReportModal],
    ['word-detail-modal', closeWordDetail]
  ];
  const open = modals.find(([id]) => {
    const el = document.getElementById(id);
    return el && el.style.display !== 'none';
  });
  if (!open) return false;
  open[1]();
  return true;
}

function clickQuizOption(index) {
  const options = Array.from(document.querySelectorAll('#quiz-area .opt[data-quiz-action]'))
    .filter(btn => btn.style.pointerEvents !== 'none');
  const btn = options[index];
  if (!btn) return false;
  btn.click();
  return true;
}

function activateVisibleButton(selector) {
  const btn = document.querySelector(selector);
  if (!btn || btn.offsetParent === null) return false;
  btn.click();
  return true;
}

function setQuizSizeByShortcut(key) {
  const map = { '1': 20, '2': 50, '3': 100, '4': 0 };
  if (!(key in map)) return false;
  setQSize(map[key]);
  return true;
}

function getShortcutKey(event) {
  if (/^Digit[0-9]$/.test(event.code || '')) return event.code.slice(5);
  if (/^Numpad[0-9]$/.test(event.code || '')) return event.code.slice(6);
  if (/^Digit[0-9]$/.test(event.key || '')) return event.key.slice(5);
  if (/^Numpad[0-9]$/.test(event.key || '')) return event.key.slice(6);
  if (event.key === 'Left') return 'ArrowLeft';
  if (event.key === 'Right') return 'ArrowRight';
  return event.key;
}

function handleNavigationShortcut(event) {
  if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
  const key = getShortcutKey(event);
  const map = {
    '1': 'flash',
    '2': 'quiz',
    '3': 'list',
    '4': 'stats',
    '5': 'grammar'
  };
  const page = map[key];
  if (!page) return false;
  switchPage(page);
  return true;
}

function handleFlashShortcut(key) {
  const card = document.getElementById('main-card');
  if (!card || card.offsetParent === null) return false;
  if (key.toLowerCase() === 'f') { flipCard(); return true; }
  if (key === 'ArrowLeft' || key.toLowerCase() === 'b') { prevCard(); return true; }
  if (key === 'ArrowRight' || key.toLowerCase() === 'n') { nextCard(); return true; }
  if (flipped && key === '1') { markCard('unknown'); return true; }
  if (flipped && key === '2') { markCard('fuzzy'); return true; }
  if (flipped && key === '3') { markCard('known'); return true; }
  if (key.toLowerCase() === 'p') { speak(1); return true; }
  return false;
}

function handleWrongbookShortcut(key) {
  if (!wbList.length) return false;
  if (key.toLowerCase() === 'f') { flipWbCard(); return true; }
  if (key === 'ArrowLeft' || key.toLowerCase() === 'b') { prevWbCard(); return true; }
  if (key === 'ArrowRight' || key.toLowerCase() === 'n') { nextWbCard(); return true; }
  if (wbFlipped && key === '1') { answerWb(false); return true; }
  if (wbFlipped && key === '2') { answerWb(true); return true; }
  if (key.toLowerCase() === 'p') { speakWb(1); return true; }
  return false;
}

function handleQuizShortcut(key) {
  const nextBtn = document.getElementById('qnxt');
  const nextVisible = nextBtn && nextBtn.style.display !== 'none' && nextBtn.offsetParent !== null;
  if (nextVisible && (key === 'Enter' || key === ' ')) {
    nextQ();
    return true;
  }
  if (isQuizInProgress()) {
    if (/^[1-4]$/.test(key)) return clickQuizOption(Number(key) - 1);
    if (qExerciseMode === 'listening' && key.toLowerCase() === 'p') { speakQuizWord(0.9); return true; }
    return false;
  }
  if (/^[1-4]$/.test(key)) return setQuizSizeByShortcut(key);
  if (key === 'Enter') return activateVisibleButton('#quiz-area .btn-primary');
  return false;
}

document.addEventListener('keydown', (event) => {
  if (event.defaultPrevented || isTextEntryTarget(event.target)) return;
  const key = getShortcutKey(event);
  if (isAmbiguousStudyActivation(event, key)) {
    event.preventDefault();
    return;
  }
  if (isNativeActivationKeyOnControl(event)) return;
  if (event.key === 'Escape') {
    const accountMenu = document.getElementById('account-menu-wrap');
    const hadAccountMenu = !!accountMenu?.classList.contains('open');
    if (hadAccountMenu) accountMenu.classList.remove('open');
    const hadCatMenu = Array.from(document.querySelectorAll('.cat-more[open]')).some(el => { el.open = false; return true; });
    const handled = closeTopModal() || hadAccountMenu || hadCatMenu;
    if (handled) event.preventDefault();
    return;
  }
  if (isModalOpen()) return;

  let handled = handleNavigationShortcut(event);
  if (!handled && !event.altKey && !event.ctrlKey && !event.metaKey) {
    const page = getActivePageId();
    if (page === 'page-flash') handled = handleFlashShortcut(key);
    else if (page === 'page-wrongbook') handled = handleWrongbookShortcut(key);
    else if (page === 'page-quiz') handled = handleQuizShortcut(key);
  }
  if (handled) event.preventDefault();
});

function toggleAdminSection(id) {
  const section = document.getElementById(id);
  if (!section) return;
  section.classList.toggle('collapsed');
  section.querySelector(':scope > .admin-section-header')?.setAttribute('aria-expanded', section.classList.contains('collapsed') ? 'false' : 'true');
  saveAdminSectionState();
}

function switchAdminPanel(panel = 'overview') {
  const allowed = new Set(['overview', 'content', 'users']);
  const next = allowed.has(panel) ? panel : 'overview';
  document.querySelectorAll('#page-admin .admin-subtab').forEach(tab => {
    const active = tab.id === `admin-tab-${next}`;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  document.querySelectorAll('#page-admin .admin-pane').forEach(pane => {
    pane.classList.toggle('active', pane.id === `admin-pane-${next}`);
  });
  try { sessionStorage.setItem('admin-active-panel', next); } catch {}
}

function saveAdminSectionState() {
  const state = {};
  document.querySelectorAll('#page-admin .admin-section[id]').forEach(section => {
    state[section.id] = !section.classList.contains('collapsed');
  });
  try { sessionStorage.setItem('admin-section-state', JSON.stringify(state)); } catch {}
}

function restoreAdminSections() {
  let state = null;
  try { state = JSON.parse(sessionStorage.getItem('admin-section-state') || 'null'); } catch {}
  if (state) {
    document.querySelectorAll('#page-admin .admin-section[id]').forEach(section => {
      if (section.id in state) section.classList.toggle('collapsed', !state[section.id]);
    });
  }
  let panel = 'overview';
  try { panel = sessionStorage.getItem('admin-active-panel') || 'overview'; } catch {}
  switchAdminPanel(panel);
}

function updateReviewBadge() {
  const badge = document.getElementById('review-tab-badge') || document.getElementById('flash-tab-badge');
  if (!badge) return;
  // The badge is specifically for graduated review/relearning work. Initial
  // learning steps still block new cards, but remain labelled as learning.
  const count = getRemainingFormalReviewWords(W).length;
  badge.textContent = count;
  badge.style.display = count > 0 ? 'inline' : 'none';
}

// ── 每日任务目标 ──────────────────────────────────────────

function openDailyCheckinModal() {
  if (!ensureDailyStateCurrent({ reload: true })) return;
  if (!isDefaultGoalDone()) return;
  const modal = document.getElementById('daily-checkin-modal');
  if (!modal) return;
  setText('checkin-fixed-goal', defaultDailyGoal);
  setText('checkin-today-count', todayNewWords);
  setText('checkin-accuracy', `${getTodayCheckinAccuracy()}%`);
  const remainingReviews = getRemainingFormalReviewWords(W).length;
  setText('checkin-review-remaining', remainingReviews);
  const finishReviewsButton = document.getElementById('checkin-finish-reviews-btn');
  if (finishReviewsButton) {
    finishReviewsButton.textContent = remainingReviews
      ? `完成剩余 ${remainingReviews} 个复习`
      : '复习已清空，开始新词';
  }
  modal.style.display = 'flex';
}

function closeDailyCheckinModal() {
  const modal = document.getElementById('daily-checkin-modal');
  if (modal) modal.style.display = 'none';
}

function completeDailyCheckin() {
  if (isTodayLogCheckedIn()) {
    closeDailyCheckinModal();
    renderDailyGoal();
    renderCalendar();
    renderReviewPanel();
    return true;
  }
  writeDailyCheckinDone();
  todayLog = { ...(todayLog || {}), user_id: currentUser.id, log_date: getLocalDateKey(), new_words: todayNewWords, goal: dailyGoal, completed: true };
  saveTodayLogBackground(
    apiUpdateTodayLog(currentUser.id, todayNewWords, dailyGoal, defaultDailyGoal, { completed: true }),
    '打卡待同步'
  );
  invalidateCalendarCache();
  closeDailyCheckinModal();
  renderDailyGoal();
  renderCalendar();
  renderReviewPanel();
  showToast(isOfflineMode()
    ? '今日已打卡，记录已保存在本机'
    : '今日已打卡，记录正在同步到云端');
  triggerCloudProgressBackup('打卡同步', { force: true, limit: 250 });
  return true;
}

function stopTodayAfterGoal() {
  completeDailyCheckin();
  closeDailyCheckinModal();
  applyFilters();
  renderCard();
  renderDailyGoal();
}

async function continueTodayAfterGoal(amount = 10) {
  completeDailyCheckin();
  await extendTodayGoal(amount);
}

async function continueTodayCustomAfterGoal() {
  completeDailyCheckin();
  await extendTodayGoalCustom();
}

async function continueRemainingReviewsToday() {
  completeDailyCheckin();
  const remainingReviews = getRemainingFormalReviewWords(W).length;
  const remainingNewCards = getRemainingDailyNewSlots();
  const extra = Math.max(1, remainingReviews + remainingNewCards);
  await extendTodayGoal(extra);
  showToast(remainingReviews > 0
    ? `已安排剩余 ${remainingReviews} 个复习；清空后再进入新词`
    : `复习已清空，接下来按新词上限学习 ${remainingNewCards} 个新词`);
}

function maybePromptDailyCheckin() {
  if (!ensureDailyStateCurrent({ reload: true })) return;
  if (dailyCheckinPromptShown || !isDefaultGoalDone() || isDailyCheckinDone()) return;
  dailyCheckinPromptShown = true;
  openDailyCheckinModal();
}

function renderDailyGoal() {
  const el = document.getElementById('daily-goal-bar');
  if (!el) return;
  ensureDailyStateCurrent({ reload: true });
  const pct = Math.min(100, Math.round(todayNewWords / dailyGoal * 100));
  const baseDone = isDefaultGoalDone();
  const currentDone = isCurrentTodayGoalDone();
  const checkinDone = isDailyCheckinDone();
  const canExtend = currentDone && checkinDone && dailyGoal < DAILY_GOAL_MAX;
  const isTemporaryExtended = dailyGoal > defaultDailyGoal;
  const attempts = getTodayAttemptStats();
  const remainingReviews = getRemainingFormalReviewWords(W).length;
  const todayNewLimitProgress = getTodayNewLimitProgressText();
  const title = currentDone ? '今日通过目标已完成' : (baseDone ? '今日固定通过目标已完成' : '今日通过进度');
  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
      <span style="font-size:13px;font-weight:600;color:var(--text)">
        ${title}
      </span>
      <span style="font-size:13px;color:var(--text2)">${todayNewWords} / ${dailyGoal} 个</span>
    </div>
    <div style="font-size:12px;color:var(--text2);margin-top:6px">共作答 ${attempts.total} 次 · 今日新词 ${todayNewLimitProgress}</div>
    <div style="background:var(--bg3);border-radius:99px;height:10px;overflow:hidden">
      <div style="height:100%;width:${pct}%;background:${baseDone ? 'var(--green)' : 'var(--blue)'};border-radius:99px;transition:width .4s"></div>
    </div>
    ${isTemporaryExtended ? `<div style="font-size:12px;color:var(--text2);margin-top:6px">固定目标 ${defaultDailyGoal} 个${baseDone ? '已达成' : '未达成'}；今天临时加量目标 ${dailyGoal} 个</div>` : ''}
    ${baseDone && !checkinDone ? `
      <div class="goal-extend">
        <span>固定目标已完成，先打卡再继续加量。</span>
        <button class="btn-sm" onclick="openDailyCheckinModal()">去打卡</button>
      </div>` : ''}
    ${canExtend ? `
      <div class="goal-extend">
        <span>继续今天：</span>
        <button class="btn-sm" onclick="extendTodayGoal(10)">再完成 10 个</button>
        ${remainingReviews ? `<button class="btn-sm" onclick="continueRemainingReviewsToday()">完成剩余 ${remainingReviews} 个复习</button>` : ''}
        <button class="btn-sm" onclick="extendTodayGoalCustom()">自定义</button>
      </div>` : ''}`;
  renderDailyReminderSettings();
  maybePromptDailyCheckin();
}

async function saveGoalSetting() {
  const val = getGoalInputValue();
  const newLimit = getNewLimitInputValue();
  if (!val || val < 1 || val > DAILY_GOAL_MAX) {
    showToast(`请输入1-${DAILY_GOAL_MAX}之间的数字`);
    return;
  }
  if (!Number.isFinite(newLimit) || newLimit < 0 || newLimit > DAILY_NEW_LIMIT_MAX) {
    showToast(`每日新词上限请输入0-${DAILY_NEW_LIMIT_MAX}之间的数字`);
    return;
  }
  writeDailyNewLimit(newLimit);
  setNewLimitInputValue(dailyNewLimit);
  await setDailyGoalAndRebuild(val, `每日通过目标已设为 ${val}，新词上限为 ${dailyNewLimit}`);
}

function reminderSettingsKey() {
  return `daily_goal_reminder:${currentUser?.id || 'local'}`;
}

function readReminderSettings() {
  try {
    return { ...DEFAULT_REMINDER_SETTINGS, ...(JSON.parse(localStorage.getItem(reminderSettingsKey()) || '{}') || {}) };
  } catch {
    return { ...DEFAULT_REMINDER_SETTINGS };
  }
}

function writeReminderSettings(settings) {
  localStorage.setItem(reminderSettingsKey(), JSON.stringify({ ...DEFAULT_REMINDER_SETTINGS, ...settings }));
}

function renderDailyReminderSettings() {
  const enabled = document.getElementById('reminder-enabled');
  const time = document.getElementById('reminder-time');
  const status = document.getElementById('reminder-status');
  if (!enabled || !time || !status) return;
  const settings = readReminderSettings();
  enabled.checked = !!settings.enabled;
  time.value = settings.time || DEFAULT_REMINDER_SETTINGS.time;
  const remaining = Math.max(0, dailyGoal - todayNewWords);
  const permission = getNotificationPermissionLabel();
  status.textContent = settings.enabled
    ? (remaining ? `未完成时 ${settings.time} 提醒；当前剩余 ${remaining} 个。${permission}` : `今日已完成。${permission}`)
    : '提醒已关闭';
}

async function saveDailyReminderSettings() {
  const enabled = document.getElementById('reminder-enabled');
  const time = document.getElementById('reminder-time');
  if (!enabled || !time) return;
  const next = {
    ...readReminderSettings(),
    enabled: !!enabled.checked,
    time: time.value || DEFAULT_REMINDER_SETTINGS.time
  };
  if (next.enabled && 'Notification' in window && Notification.permission === 'default') {
    try { await Notification.requestPermission(); } catch {}
  }
  writeReminderSettings(next);
  setupDailyReminderChecks();
  renderDailyReminderSettings();
  showToast(next.enabled ? '每日提醒已开启' : '每日提醒已关闭');
}

function getNotificationPermissionLabel() {
  if (!('Notification' in window)) return '当前设备不支持系统通知。';
  if (Notification.permission === 'granted') return '系统通知已允许。';
  if (Notification.permission === 'denied') return '系统通知被浏览器关闭，将只显示应用内提醒。';
  return '首次提醒前会请求通知权限。';
}

function setupDailyReminderChecks() {
  if (dailyReminderTimer) clearInterval(dailyReminderTimer);
  dailyReminderTimer = setInterval(checkDailyGoalReminder, 60 * 1000);
  checkDailyGoalReminder();
}

function checkDailyGoalReminder() {
  if (!currentUser || userRole === 'pending') return;
  const settings = readReminderSettings();
  if (!settings.enabled || isDefaultGoalDone()) return;
  const now = new Date();
  const today = getDateKeyFor(now);
  if (settings.lastSentDate === today) return;
  const [hour, minute] = String(settings.time || DEFAULT_REMINDER_SETTINGS.time).split(':').map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return;
  const reminderAt = new Date(now);
  reminderAt.setHours(hour, minute, 0, 0);
  if (now < reminderAt) return;
  sendDailyGoalReminder();
  writeReminderSettings({ ...settings, lastSentDate: today });
  renderDailyReminderSettings();
}

function sendDailyGoalReminder() {
  const remaining = Math.max(0, dailyGoal - todayNewWords);
  const message = `今日任务还差 ${remaining} 个，完成后会计入连续学习。`;
  showToast(message);
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification('罗语词汇每日提醒', {
        body: message,
        tag: `romanian-vocab-daily-${currentUser?.id || 'local'}-${getDateKeyFor(new Date())}`
      });
    } catch {}
  }
}

function invalidateCalendarCache() {
  calendarCache = { key: '', logs: null, fetchedAt: 0 };
}

async function getCalendarLogs(days, force = false) {
  const key = `${currentUser?.id || 'local'}:${days}`;
  const now = Date.now();
  if (!force && calendarCache.key === key && calendarCache.logs && now - calendarCache.fetchedAt < CALENDAR_CACHE_TTL_MS) {
    return calendarCache.logs;
  }
  const logs = await apiGetRecentLogs(currentUser.id, days);
  calendarCache = { key, logs, fetchedAt: now };
  return logs;
}

async function renderCalendar(force = false) {
  const el = document.getElementById('calendar-container');
  if (!el) return;
  const logs = await getCalendarLogs(14, force);
  const logMap = {};
  logs.forEach(l => { logMap[l.log_date] = l; });

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setDate(today.getDate() - 13);
  const days = [];
  const weekLabels = ['一', '二', '三', '四', '五', '六', '日'];
  const leadingBlanks = (start.getDay() + 6) % 7;
  for (let i = 0; i < leadingBlanks; i++) {
    days.push('<div class="calendar-cell calendar-empty"></div>');
  }
  for (let i = 0; i < 14; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const dateStr = getDateKeyFor(d);
    const log = logMap[dateStr];
    const isToday = d.getTime() === today.getTime();
    const label = isToday ? '今' : (d.getMonth() + 1) + '/' + d.getDate();

    // 今天用实时数据，历史用数据库
    const completedTasks = isToday ? todayNewWords : (log?.new_words || 0);
    const goal = isToday ? dailyGoal : (log?.goal || dailyGoal);
    const completed = isToday ? isDailyCheckinDone() : isDailyLogCompleted({ ...log, new_words: completedTasks, goal });

    const stateClass = completed ? 'completed' : completedTasks > 0 ? 'started' : '';
    const todayAttr = isToday ? 'data-today="1"' : '';
    days.push(`<div ${todayAttr} class="calendar-cell ${stateClass}${isToday ? ' today' : ''}" title="${label}: ${completedTasks}个任务 / 目标${goal}个">
      <span class="calendar-date">${label}</span>
      <span class="cal-sub">${completedTasks > 0 ? completedTasks : ''}</span>
    </div>`);
  }
  el.innerHTML = `
    <div class="calendar-grid">
      ${weekLabels.map(d => `<div class="calendar-weekday">${d}</div>`).join('')}
      ${days.join('')}
    </div>`;
}

// ── 卡片记忆 ──────────────────────────────────────────────

function buildCats() {
  const present = new Set(getLearningCollectionWords(W).map(w => normalizeCategory(w.cat)).filter(Boolean));
  const cats = CATEGORY_ORDER
    .filter(c => c === '全部' || present.has(c))
    .concat([...present].filter(c => !CATEGORY_ORDER.includes(c)).sort((a, b) => a.localeCompare(b, 'en')));
  const preferred = ['全部', 'daily_life', 'people_society', 'education_language', 'work_management', 'health_medicine', 'science_technology', 'history_culture_arts'];
  let primary = preferred.filter(c => cats.includes(c));
  if (curCat && !primary.includes(curCat) && cats.includes(curCat)) primary.push(curCat);
  primary = primary.slice(0, 9);
  const secondary = cats.filter(c => !primary.includes(c));
  const buttonHtml = (c) =>
    `<button class="cat-chip${c === curCat ? ' active' : ''}" onclick="setCat(decodeURIComponent('${encodedArg(c)}'))">${escapeHtml(getCategoryLabel(c))}</button>`;
  document.getElementById('cat-bar').innerHTML = [
    ...primary.map(buttonHtml),
    secondary.length ? `<details class="cat-more">
      <summary>全部主题</summary>
      <div class="cat-more-list">${secondary.map(buttonHtml).join('')}</div>
    </details>` : ''
  ].join('');
}

function setCat(c) {
  curCat = c;
  invalidateQuizPracticePool();
  flashHistory = [];
  flashOverrideRo = null;
  applyFilters();
  idx = 0; flipped = false;
  document.getElementById('main-card').classList.remove('flipped');
  buildCats();
  renderCard();
}

function getWordByRo(wordRo) {
  const raw = String(wordRo ?? '');
  if (wordIdIndex.has(raw)) return wordIdIndex.get(raw);
  const key = roKey(wordRo);
  return wordByRoIndex.get(key) || null;
}

function getCurrentFlashWord() {
  return flashOverrideRo ? getWordByRo(flashOverrideRo) : filtered[idx];
}

function renderCard() {
  const perf = startDailyQueuePerf('renderCard');
  if (flashCardRenderTimer) {
    clearTimeout(flashCardRenderTimer);
    flashCardRenderTimer = null;
  }
  const overrideWord = flashOverrideRo ? getWordByRo(flashOverrideRo) : null;
  if (flashOverrideRo && !overrideWord) flashOverrideRo = null;

  if (!filtered.length && !overrideWord) {
    if (flashMode === 'today' && ensureTodayQueueHasActiveCards('renderCard:before-empty')) {
      applyFilters();
      if (filtered.length) {
        renderCard();
        return;
      }
    }
    debugDailyQueue('renderCard:empty');
    setText('fc-cat', curCat === '全部' ? '' : getCategoryLabel(curCat));
    setText('fc-cat2', curCat === '全部' ? '' : getCategoryLabel(curCat));
    const frontHint = document.getElementById('fc-front-hint');
    const hasOpenQueue = hasOpenTodayQueue();
    const deferredQueueCount = getDeferredTodayQueueCount();
    const hasDueReview = getRemainingDueReviewWords(W).length > 0;
    const hasNewWords = getUnseenWords(getCurrentScopeWords()).some(w => !setHasRo(todaySeenWords, w.ro) && !setHasRo(todayQueueCompleted, w.ro));
    const eligibleNewCount = getEligibleUnseenWordsForToday(getCurrentScopeWords()).length;
    const currentDone = isCurrentTodayGoalDone();
    const pausedForCheckin = shouldPauseTodayStudyForCheckin();
    const pausedForGoal = shouldPauseTodayStudyForGoal();
    const emptyText = {
      today: pausedForCheckin || pausedForGoal
        ? '今日目标已完成'
        : (currentDone
          ? '今日任务已完成'
          : (deferredQueueCount
            ? '今日队列等待复习'
            : (curCat !== '全部' && (hasDueReview || hasNewWords || hasOpenQueue) ? '当前主题没有今日任务' : '今日没有可安排任务'))),
      review: '当前没有到期复习词',
    }[flashMode] || '当前主题暂无可学词';
    const actionText = {
      today: pausedForCheckin || pausedForGoal
        ? '今天的目标已完成，请选择是否继续。'
        : (currentDone
        ? '已达到今日目标，系统不会继续加入新词。'
        : (deferredQueueCount
          ? (eligibleNewCount > 0
            ? `${deferredQueueCount} 个词正在等待短间隔复习；系统正在安排可学新词。`
            : `${deferredQueueCount} 个词正在等待短间隔复习；当前没有可加入的新词，到复习时间后会继续。`)
          : (hasOpenQueue ? '请切换到全部，继续今天固定队列。' : '可以切换主题、提高今日任务目标或去测验'))),
      review: '没有到期复习时，可以继续学习新词'
    }[flashMode] || 'No words';
    if (frontHint) {
      frontHint.textContent = (currentDone || pausedForCheckin || pausedForGoal) ? actionText : '先在心里说出罗语，再点卡片看答案';
    }
    setText('fc-zh', emptyText);
    setText('fc-ro', actionText);
    setText('fc-ipa', '');
    setText('fc-phint', '');
    renderExampleBlock('fc-example', null);
    renderFrontExampleRecall('fc-front-example', null, null);
    setText('fc-level', '');
    const verifyEl = document.getElementById('fc-verify');
    if (verifyEl) verifyEl.style.display = 'none';
    finishDailyQueuePerf(perf, {
      path: 'empty',
      vocabScanned: W.length,
      resultSize: 0
    });
    return;
  }
  const w = getCardRenderWord();
  if (!w) {
    finishDailyQueuePerf(perf, {
      path: 'no-word',
      vocabScanned: 0,
      resultSize: 0
    });
    return;
  }
  renderCardFront(w);
  renderCardBack(w);
  updateCardHistoryControls();
  renderReviewPanel();
  finishDailyQueuePerf(perf, {
    path: 'card',
    currentRo: w.ro,
    vocabScanned: 0,
    resultSize: filtered.length
  });
}

function updateCardHistoryControls() {
  const card = document.getElementById('main-card');
  const historyButton = document.getElementById('history-nav-btn');
  const undoButton = document.getElementById('undo-last-answer-btn');
  const reviewingHistory = !!flashOverrideRo;
  card?.classList.toggle('history-view', reviewingHistory);
  if (historyButton) {
    historyButton.textContent = reviewingHistory ? '返回当前卡片' : '◀ 回看上一张';
    historyButton.disabled = !reviewingHistory && !flashHistory.length;
  }
  if (undoButton) undoButton.disabled = !lastCardAnswerSnapshot || flashcardAnswerInFlight;
}

function getCardRenderWord() {
  const overrideWord = flashOverrideRo ? getWordByRo(flashOverrideRo) : null;
  if (flashOverrideRo && !overrideWord) flashOverrideRo = null;
  bindFlashcardButtons();
  if (filtered.length) idx = (idx + filtered.length) % filtered.length;
  return overrideWord || filtered[idx] || null;
}

function renderCardFront(w) {
  const frontHint = document.getElementById('fc-front-hint');
  if (frontHint) frontHint.textContent = '先在心里说出罗语，再点卡片看答案';
  document.getElementById('fc-cat').textContent = getTopicLabel(w.topic || w.cat);
  setText('fc-pos', getCardPromptCue(w));
  document.getElementById('fc-zh').textContent = w.zh;
  const verifyEl = document.getElementById('fc-verify');
  if (verifyEl) {
    verifyEl.textContent = isWordUnverified(w) ? '未核对' : '';
    verifyEl.style.display = isWordUnverified(w) ? '' : 'none';
  }
  // 显示熟练度
  const lv = getProgressLevel(w.ro);
  const lvEl = document.getElementById('fc-level');
  if (lvEl) { lvEl.textContent = getLevelLabel(w.ro); lvEl.style.color = LEVEL_TC[lv]; lvEl.style.background = LEVEL_BG[lv]; }
  renderFrontExampleRecall('fc-front-example', w, getSyncExampleSentence(w));
}

function renderCardBack(w) {
  const taskType = flashMode === 'today' ? ` · ${getDailyTaskType(w)}` : '';
  document.getElementById('fc-cat2').textContent = `${getClassificationSummary(w, { includeUnit: true })}${taskType}`;
  document.getElementById('fc-ro').textContent = w.ro;
  const stress = getStressDisplay(w);
  setStressHtml('fc-ipa', w);
  setGrammarText('fc-phint', w, stress);
  const syncExample = getSyncExampleSentence(w);
  renderExampleBlock('fc-example', syncExample);
  if (!syncExample) {
    const requestedRo = w.ro;
    hydrateCorpusExample('fc-example', w, () => roKey(getCardRenderWord()?.ro) === roKey(requestedRo));
  }
  renderAnswerConsequences(w);
}

function getCardPromptCue(w) {
  const explicitPos = normalizePartOfSpeech(w?.part_of_speech, w);
  const grammar = getGrammarInfo(w).toLocaleLowerCase('ro');
  if (/^s\.f\.|阴性名词|名词.*阴/.test(grammar)) return '阴性名词';
  if (/^s\.m\.|阳性名词|名词.*阳/.test(grammar)) return '阳性名词';
  if (/^s\.n\.|中性名词|名词.*中/.test(grammar)) return '中性名词';
  if (/^vb\.|^verb|动词/.test(grammar) || /^a\s+/i.test(String(w?.ro || ''))) return '动词';
  if (/^adj|形容词/.test(grammar)) return '形容词';
  if (/^adv|副词/.test(grammar)) return '副词';
  if (/pron|代词/.test(grammar)) return '代词';
  if (/prep|介词/.test(grammar)) return '介词';
  return getPartOfSpeechLabel(explicitPos) || '词义回忆';
}

function renderAnswerConsequences(w) {
  const current = getProgress(w?.ro) || {};
  const configs = [
    ['unknown', 'mark-unknown-btn', '✕ 不认识', '继续学习'],
    ['fuzzy', 'mark-fuzzy-btn', '≈ 模糊', '继续学习'],
    ['known', 'mark-known-btn', '✓ 准确回忆', '通过今日任务']
  ];
  configs.forEach(([action, id, label, consequence]) => {
    const next = getSchedulerReview(current, action, { now: new Date() });
    const dueAt = next.dueAt || next.nextReviewAt;
    const due = formatReviewDue(dueAt);
    const button = document.getElementById(id);
    setText(id, `${label} · ${formatCompactReviewDue(dueAt)}`);
    if (button) {
      const fullDescription = `${label}，${due}，${consequence}`;
      button.title = fullDescription;
      button.setAttribute('aria-label', fullDescription);
    }
  });
}

// 点卡片：来回翻转
function flipCard() {
  flipped = !flipped;
  document.getElementById('main-card').classList.toggle('flipped', flipped);
  setCardFlipAccessibility('main-card', flipped);
}

function renderFlashCardAfterFrontReset() {
  const card = document.getElementById('main-card');
  if (!card || !card.classList.contains('flipped')) {
    renderCard();
    setFlashcardAnswerButtonsDisabled(false);
    return;
  }
  const nextWord = getCardRenderWord();
  if (nextWord) renderCardFront(nextWord);
  flipped = false;
  card.classList.remove('flipped');
  setCardFlipAccessibility('main-card', false);
  if (flashCardRenderTimer) clearTimeout(flashCardRenderTimer);
  flashCardRenderTimer = setTimeout(() => {
    flashCardRenderTimer = null;
    if (nextWord) {
      renderCardBack(nextWord);
      renderReviewPanel();
    } else {
      renderCard();
    }
    setFlashcardAnswerButtonsDisabled(false);
  }, CARD_FLIP_TRANSITION_MS);
}

function renderNextFlashCardInstantFront() {
  const card = document.getElementById('main-card');
  if (!card) {
    renderCard();
    setFlashcardAnswerButtonsDisabled(false);
    return;
  }
  if (flashCardRenderTimer) {
    clearTimeout(flashCardRenderTimer);
    flashCardRenderTimer = null;
  }
  card.style.transition = 'none';
  flipped = false;
  card.classList.remove('flipped');
  setCardFlipAccessibility('main-card', false);
  renderCard();
  // Force the non-flipped state to commit before restoring the normal answer flip.
  card.offsetHeight;
  requestAnimationFrame(() => {
    card.style.transition = '';
    setFlashcardAnswerButtonsDisabled(false);
  });
}

function canContinueIncrementalTodayPool(words = filtered) {
  const pool = Array.isArray(words) ? words : [];
  if (!pool.length) return false;
  if (pool.every(isDueReviewWord)) return true;
  // A learning step can become due while the learner is working through a
  // cached new-card pool. Reopen the global gate before showing the next card.
  return getRemainingTodayReviewWords().length === 0;
}

function nextCard() {
  if (flashOverrideRo) {
    flashOverrideRo = null;
    renderFlashCardAfterFrontReset();
    return;
  }
  const current = getCurrentFlashWord();
  if (!current) return;
  showToast(flipped
    ? '请先选择“不认识”“模糊”或“准确回忆”，完成当前单词'
    : '请先翻开卡片并完成当前单词，作答后会自动进入下一词');
}

function shouldAutoStartTodayAfterReview() {
  if (flashMode !== 'review') return false;
  if (!dailyQueueLoaded || shouldPauseTodayStudyForCheckin() || shouldPauseTodayStudyForGoal()) return false;
  if (getRemainingDueReviewWords(W).length > 0) return false;
  const hasQueuedUnseen = todayQueue
    .filter(ro => !setHasRo(todayQueueCompleted, ro))
    .map(ro => getWordByRo(ro))
    .filter(Boolean)
    .some(isUnseenWord);
  if (hasQueuedUnseen) return true;
  if (!getRemainingDailyNewSlots()) return false;
  return getEligibleUnseenWordsForToday(W).length > 0;
}

function advanceFlashcardAfterAnswer(currentRo, options = {}) {
  flashOverrideRo = null;
  if (shouldAutoStartTodayAfterReview()) {
    flashMode = 'today';
    curCat = '全部';
    todayQueue = buildOpenTodayQueue(dailyGoal);
    ensureTodayQueueHasActiveCards('advanceFlashcardAfterAnswer:auto-start', { skipSave: true });
    saveTodayQueue({ background: true }).catch(error => {
      console.warn('Daily queue background save failed', error);
      setSyncBadge('队列待同步', '');
    });
    applyFilters();
    idx = 0;
    buildCats();
    showToast('到期复习已完成，继续今日新词');
    return;
  }
  if (options.incrementalToday && flashMode === 'today') {
    const currentKey = roKey(currentRo);
    filtered = filtered.filter(item => roKey(item?.ro) !== currentKey);
    if (canContinueIncrementalTodayPool(filtered)) {
      idx = Math.min(idx, filtered.length - 1);
      return;
    }
  }
  applyFilters();
  const currentKey = roKey(currentRo);
  if (filtered.some(item => roKey(item?.ro) === currentKey)) {
    idx = filtered.findIndex(item => roKey(item?.ro) === currentKey);
    return;
  }
  if (flashMode === 'today' && !filtered.length) {
    const fallback = getNextDailyFallbackWord(currentRo);
    if (fallback) {
      flashOverrideRo = fallback.ro;
      idx = 0;
      return;
    }
  }
  idx = filtered.length ? Math.min(idx, filtered.length - 1) : 0;
}

function getNextDailyFallbackWord(currentRo) {
  if (shouldPauseTodayStudyForCheckin() || shouldPauseTodayStudyForGoal()) return null;
  const currentKey = currentRo ? roKey(currentRo) : '';
  const completed = new Set([...todayQueueCompleted].map(roKey));
  return todayQueue
    .map(ro => getWordByRo(ro))
    .filter(Boolean)
    .filter(w => !isRetryDeferred(w))
    .filter(w => {
      const p = getProgress(w.ro);
      return !hasWordProgress(p) || isReviewDue(p) || isPendingLearningRetryWord(w);
    })
    .filter(w => roKey(w.ro) !== currentKey && !completed.has(roKey(w.ro)))[0] || null;
}

function bindFlashcardButtons() {
  if (flashcardButtonsBound) return;
  const knownBtn = document.getElementById('mark-known-btn');
  const fuzzyBtn = document.getElementById('mark-fuzzy-btn');
  const unknownBtn = document.getElementById('mark-unknown-btn');
  if (!knownBtn || !fuzzyBtn || !unknownBtn) return;

  knownBtn.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    markCard('known');
  });

  fuzzyBtn.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    markCard('fuzzy');
  });

  unknownBtn.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    markCard('unknown');
  });

  flashcardButtonsBound = true;
}

function setFlashcardAnswerButtonsDisabled(disabled) {
  const knownBtn = document.getElementById('mark-known-btn');
  const fuzzyBtn = document.getElementById('mark-fuzzy-btn');
  const unknownBtn = document.getElementById('mark-unknown-btn');
  if (knownBtn) knownBtn.disabled = disabled;
  if (fuzzyBtn) fuzzyBtn.disabled = disabled;
  if (unknownBtn) unknownBtn.disabled = disabled;
}

/**
 * 只更新今天日历格子颜色，不重新请求数据库
 */
function updateTodayCalendarCell() {
  const cells = document.querySelectorAll('#calendar-container [data-today]');
  cells.forEach(cell => {
    const done = isDailyCheckinDone();
    cell.classList.toggle('completed', done);
    cell.classList.toggle('started', !done && todayNewWords > 0);
    const sub = cell.querySelector('.cal-sub');
    if (sub) sub.textContent = todayNewWords;
  });
}

// 「不认识」/「模糊」/「认识」
function markCard(answer) {
  const perf = startDailyQueuePerf('markCard');
  let action = answer === true ? 'known' : (answer === false ? 'unknown' : answer);
  if (flashcardAnswerInFlight) {
    finishDailyQueuePerf(perf, { path: 'in-flight', action, vocabScanned: 0 });
    return;
  }
  if (!progressLoaded) {
    showToast('进度还在加载，请稍等片刻');
    finishDailyQueuePerf(perf, { path: 'blocked-progress-not-loaded', action, vocabScanned: 0 });
    return;
  }
  const w = getCurrentFlashWord();
  if (!w) {
    finishDailyQueuePerf(perf, { path: 'no-word', action, vocabScanned: 0 });
    return;
  }
  if (flashOverrideRo) {
    showToast('历史卡片仅供回看，不会重复计分');
    finishDailyQueuePerf(perf, { path: 'blocked-history', action, vocabScanned: 0 });
    return;
  }
  const isKnownAction = action === 'known';
  const isUnknownAction = action === 'unknown';
  const isFuzzyAction = action === 'fuzzy';
  if (!['unknown', 'fuzzy', 'known'].includes(action)) {
    finishDailyQueuePerf(perf, { path: 'invalid-action', action, vocabScanned: 0 });
    return;
  }
  flashcardAnswerInFlight = true;
  setFlashcardAnswerButtonsDisabled(true);
  let path = 'answer';
  try {
    const p = getProgress(w.ro);
    const schedulerBefore = normalizeScheduler(p || {});
    const queuePhaseBefore = getStudyQueuePhase(w);
    const answerSnapshot = captureCardAnswerSnapshot(w, p, queuePhaseBefore);
    const formalReviewsBeforeAnswer = flashMode === 'today'
      ? getRemainingFormalReviewWords(W).length
      : 0;
    const isReviewTask = queuePhaseBefore === 'review-due' ||
      queuePhaseBefore === 'relearning-due' ||
      schedulerBefore.cardState === 'mastered' ||
      (schedulerBefore.cardState === 'reinforcing' && schedulerBefore.lapses > 0);
    // A learning step for a newly introduced card must not advance a review
    // target while formal reviews remain. Once the review backlog is empty,
    // successful learning/new cards may fill any remaining daily target.
    const completesTodayTask = isKnownAction && (isReviewTask || formalReviewsBeforeAnswer === 0);
    const interaction = isReviewTask
      ? (isKnownAction ? 'review_correct' : (isFuzzyAction ? 'review_fuzzy' : 'review_wrong'))
      : (isKnownAction ? 'flashcard_known' : (isFuzzyAction ? 'flashcard_fuzzy' : 'flashcard_unknown'));
    if (flashMode === 'today') queueTodayAccuracyAttempt(isKnownAction);
    const progressResult = buildNextProgressForInteraction(w.ro, interaction, { skipDailyQueueReconcile: true });
    setProgress(progressResult.canonicalRo, { ...progressResult.progress, pendingSync: !isOfflineMode() }, { source: 'markCard' });
    if (flashMode === 'today' && queuePhaseBefore === 'new') markTodayNewIntroduction(w.ro);
    let dailyStateResult = null;
    const isOpenTodayWord = flashMode === 'today'
      && roListIncludes(todayQueue, w.ro)
      && !setHasRo(todayQueueCompleted, w.ro);
    // This must use the pre-answer classification. The optimistic progress
    // update above moves dueAt into the future, so calling isDueReviewWord here
    // would incorrectly turn every just-completed external review into false.
    const wasTodayBlockingReviewWord = flashMode === 'today' && !isOpenTodayWord && isReviewTask;
    if (flashMode === 'today' && completesTodayTask) {
      lastLearningHint = '';
      dailyStateResult = (isOpenTodayWord || wasTodayBlockingReviewWord)
        ? commitTodayWordCompletion(w.ro, { fast: true, deferGoalPrompt: true })
        : null;
    } else if (flashMode === 'today') {
      dailyStateResult = isOpenTodayWord
        ? commitTodayWordExposure(w.ro, { fast: true, deferGoalPrompt: true })
        : null;
      lastLearningHint = `「${w.zh || w.ro}」仍在学习步骤中；到点后会优先重试，明确认识后才完成今日任务。`;
    } else if (isUnknownAction) {
      showToast(isReviewTask
        ? `已进入重新学习，约 ${LEARNING_RETRY_INTERVAL.label} 后优先复习`
        : `仍在学习中，约 ${LEARNING_RETRY_INTERVAL.label} 后作为学习步骤优先重试`);
    } else if (isFuzzyAction) {
      showToast('已按模糊处理，系统会安排较近的复习');
    }
    const shouldStopForGoal = flashMode === 'today' && !!dailyStateResult?.reachedGoal;
    const shouldStopForCheckin = flashMode === 'today' && (shouldPauseTodayStudyForCheckin() || shouldStopForGoal);
    // 跳下一张，重置为中文面
    if (!shouldStopForCheckin) flashHistory.push(w.ro);
    if (shouldStopForCheckin) {
      filtered = [];
      flashOverrideRo = null;
      idx = 0;
    } else {
      advanceFlashcardAfterAnswer(w.ro, {
        incrementalToday: flashMode === 'today'
      });
    }
    renderNextFlashCardInstantFront();
    persistFastCardAnswer(progressResult);
    lastCardAnswerSnapshot = answerSnapshot;
    if (flashMode === 'today') {
      scheduleTodayStatePersistence(!!dailyStateResult?.reachedGoal);
      if (shouldStopForCheckin && dailyStateResult?.reachedGoal) {
        pendingTodayGoalPrompt = false;
        showDailyGoalCompletionPrompt(true);
      }
    }
    path = shouldStopForCheckin ? 'stop-for-checkin' : 'answered';
  } catch (error) {
    path = 'error';
    console.warn('Flashcard answer failed', error);
    setFlashcardAnswerButtonsDisabled(false);
    showToast('保存失败，请稍后重试');
  } finally {
    flashcardAnswerInFlight = false;
    updateCardHistoryControls();
    finishDailyQueuePerf(perf, {
      path,
      action,
      vocabScanned: 0,
      resultSize: filtered.length
    });
  }
}

function cloneCardState(value) {
  if (value === null || value === undefined) return value;
  return JSON.parse(JSON.stringify(value));
}

function captureCardAnswerSnapshot(w, progress, queuePhaseBefore) {
  return {
    dailyDateKey: activeDailyDateKey,
    collectionId: learningCollectionId,
    wordRo: w.ro,
    wordId: w.id ?? null,
    queuePhaseBefore,
    hadProgress: !!progress,
    progress: cloneCardState(progress),
    fastProgressEntry: cloneCardState(fastProgressQueue.get(w.ro) || null),
    todayQueue: [...todayQueue],
    todayQueueCompleted: [...todayQueueCompleted],
    todaySeenWords: [...todaySeenWords],
    todayIntroducedWords: [...todayIntroducedWords],
    todayNewWords,
    todayLog: cloneCardState(todayLog),
    accuracySaved: readTodayAccuracyStats(),
    accuracyPending: { ...pendingTodayAccuracyStats },
    flashHistory: [...flashHistory],
    flashMode,
    curCat,
    lastLearningHint
  };
}

async function undoLastCardAnswer() {
  const snapshot = lastCardAnswerSnapshot;
  if (!snapshot || flashcardAnswerInFlight) {
    showToast('没有可撤销的作答');
    return;
  }
  const currentDateKey = getDateKeyFor(new Date());
  if (snapshot.dailyDateKey && snapshot.dailyDateKey !== currentDateKey) {
    lastCardAnswerSnapshot = null;
    ensureDailyStateCurrent({ reload: true });
    updateCardHistoryControls();
    showToast('日期已切换，不能撤销前一天的作答');
    return;
  }
  if (snapshot.collectionId !== learningCollectionId) {
    lastCardAnswerSnapshot = null;
    updateCardHistoryControls();
    showToast('切换词书后不能撤销上一词书的作答');
    return;
  }
  flashcardAnswerInFlight = true;
  updateCardHistoryControls();
  try {
    if (todayStateFlushTimer) {
      clearTimeout(todayStateFlushTimer);
      todayStateFlushTimer = null;
    }
    const bufferedAfterAnswer = fastProgressQueue.get(snapshot.wordRo) || null;
    const bufferedEventCount = Array.isArray(bufferedAfterAnswer?.pendingEvents) ? bufferedAfterAnswer.pendingEvents.length : 0;
    const snapshotEventCount = Array.isArray(snapshot.fastProgressEntry?.pendingEvents) ? snapshot.fastProgressEntry.pendingEvents.length : 0;
    const answerExistsOnlyInFastBuffer = bufferedEventCount > snapshotEventCount;
    fastProgressQueue.delete(snapshot.wordRo);
    if (snapshot.fastProgressEntry) fastProgressQueue.set(snapshot.wordRo, snapshot.fastProgressEntry);
    if (snapshot.hadProgress) {
      setProgress(snapshot.wordRo, snapshot.progress, { replace: true, source: 'undoLastCardAnswer' });
    } else {
      deleteProgress(snapshot.wordRo);
    }
    if (!answerExistsOnlyInFastBuffer) {
      const correctionStatus = queueProgressCorrectionForSync(
        currentUser.id,
        snapshot.wordId,
        snapshot.wordRo,
        snapshot.hadProgress ? snapshot.progress : null,
        snapshot.progress || {}
      );
      if (!correctionStatus.ok) throw correctionStatus.error || new Error('撤销进度写入失败');
    }
    if (currentUser?.id && typeof writeLocalProgressSnapshot === 'function') {
      writeLocalProgressSnapshot(currentUser.id, progressMap);
    }

    todayQueue = [...snapshot.todayQueue];
    todayQueueCompleted = new Set(snapshot.todayQueueCompleted);
    todaySeenWords = new Set(snapshot.todaySeenWords);
    todayIntroducedWords = new Set(snapshot.todayIntroducedWords);
    todayNewWords = snapshot.todayNewWords;
    todayLog = cloneCardState(snapshot.todayLog);
    pendingTodayAccuracyStats = { ...snapshot.accuracyPending };
    writeTodayAccuracyStats(snapshot.accuracySaved);
    writeTodaySeenWords();
    writeTodayIntroducedWords();
    dailyQueueVersion++;
    invalidateCalendarCache();
    invalidateQuizPracticePool();

    const checkinDone = isDailyCheckinDone();
    await Promise.all([
      saveTodayQueue({ forceLocal: true }),
      apiUpdateTodayLog(currentUser.id, todayNewWords, dailyGoal, defaultDailyGoal, {
        completed: checkinDone,
        forceLocal: true
      })
    ]);

    flashMode = snapshot.flashMode;
    curCat = snapshot.curCat;
    flashHistory = [...snapshot.flashHistory];
    flashOverrideRo = null;
    flipped = false;
    lastLearningHint = snapshot.lastLearningHint;
    lastCardAnswerSnapshot = null;
    applyFilters();
    const restoredIndex = filtered.findIndex(word => roKey(word.ro) === roKey(snapshot.wordRo));
    if (restoredIndex >= 0) idx = restoredIndex;
    buildCats();
    renderCard();
    renderDailyGoal();
    updateTodayCalendarCell();
    upStats();
    updateReviewBadge();
    setSyncBadge(isOfflineMode() ? '已撤销并存本机' : '撤销待同步', isOfflineMode() ? 'saved' : '');
    showToast(`已撤销「${getWordByRo(snapshot.wordRo)?.zh || snapshot.wordRo}」的上次作答`);
  } catch (error) {
    console.warn('Undo card answer failed', error);
    showToast('撤销失败，请稍后重试');
  } finally {
    flashcardAnswerInFlight = false;
    updateCardHistoryControls();
  }
}

// 「回看上一张」只读展示，不改变学习状态
function prevCard() {
  if (flashOverrideRo) {
    flashOverrideRo = null;
    renderFlashCardAfterFrontReset();
    return;
  }
  const previousRo = flashHistory[flashHistory.length - 1];
  if (!previousRo) {
    showToast('还没有可回看的上一张卡片');
    return;
  }
  flashOverrideRo = previousRo;
  flipped = true;
  document.getElementById('main-card')?.classList.add('flipped', 'history-view');
  renderCard();
}

function bindCardGesture(cardId, handlers) {
  const card = document.getElementById(cardId);
  if (!card) return;

  const threshold = 42;
  const axisBias = 1.2;
  let startX = 0;
  let startY = 0;
  let pointerId = null;
  let swiped = false;

  card.addEventListener('pointerdown', (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    if (event.target.closest('button,a,input,textarea,select')) return;
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    swiped = false;
    card.setPointerCapture?.(event.pointerId);
  });

  card.addEventListener('pointerup', (event) => {
    if (pointerId !== event.pointerId) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    pointerId = null;
    card.releasePointerCapture?.(event.pointerId);

    const absX = Math.abs(dx);
    const absY = Math.abs(dy);
    if (absX < threshold && absY < threshold) return;

    if (absX > absY * axisBias) {
      swiped = true;
      if (dx < 0) handlers.next?.();
      else handlers.prev?.();
    } else if (absY > absX * axisBias) {
      swiped = true;
      handlers.flip?.();
    }
  });

  card.addEventListener('pointercancel', (event) => {
    if (pointerId !== event.pointerId) return;
    pointerId = null;
  });

  card.addEventListener('click', (event) => {
    if (!swiped) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    swiped = false;
  }, true);
}

function bindCardGestures() {
  if (cardGesturesBound) return;
  bindCardGesture('main-card', {
    prev: prevCard,
    next: nextCard,
    flip: flipCard
  });
  bindCardGesture('wb-card', {
    prev: prevWbCard,
    next: nextWbCard,
    flip: flipWbCard
  });
  cardGesturesBound = true;
}

function setCardFlipAccessibility(cardId, isFlipped) {
  const card = document.getElementById(cardId);
  if (!card) return;
  card.setAttribute('aria-expanded', isFlipped ? 'true' : 'false');
  card.setAttribute('aria-label', isFlipped ? '翻回题目' : '翻转查看答案');
  const faces = card.querySelectorAll('.card-face');
  faces[0]?.setAttribute('aria-hidden', isFlipped ? 'true' : 'false');
  faces[1]?.setAttribute('aria-hidden', isFlipped ? 'false' : 'true');
  if (cardId === 'main-card') {
    const answerRow = card.nextElementSibling;
    if (answerRow?.classList.contains('card-answer-row')) {
      answerRow.setAttribute('aria-hidden', isFlipped && !card.classList.contains('history-view') ? 'false' : 'true');
    }
  }
}

async function speak(rate) {
  const w = getCurrentFlashWord();
  if (!w || !String(w.ro || '').trim()) return;
  if (!window.speechSynthesis || typeof SpeechSynthesisUtterance === 'undefined') {
    showToast('当前浏览器不支持发音播放');
    return;
  }
  const voices = await waitForSpeechVoices();
  const rv = voices.find(v => String(v.lang || '').toLocaleLowerCase('en').startsWith('ro'));
  if (!rv) {
    showToast('当前设备没有罗马尼亚语语音，请先在系统中安装');
    return;
  }
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(w.ro);
  u.lang = 'ro-RO'; u.rate = rate;
  u.voice = rv;
  speechSynthesis.speak(u);
}

let guidePronunciationText = '';
let guidePronunciationLabel = '';
let guidePronunciationTts = '';
let guidePronunciationLang = 'ro-RO';

function waitForSpeechVoices(timeoutMs = 700) {
  const current = speechSynthesis.getVoices();
  if (current.length) return Promise.resolve(current);
  return new Promise((resolve) => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      speechSynthesis.removeEventListener?.('voiceschanged', finish);
      resolve(speechSynthesis.getVoices());
    };
    speechSynthesis.addEventListener?.('voiceschanged', finish, { once: true });
    setTimeout(finish, timeoutMs);
  });
}

async function speakGuidePronunciation(text, label, sourceEl = null, ttsText = '', ttsLang = 'ro-RO') {
  const value = String(text || '').trim();
  if (!value) return;
  const ttsValue = String(ttsText || value).trim();
  const lang = String(ttsLang || 'ro-RO').trim();
  guidePronunciationText = value;
  guidePronunciationLabel = String(label || value).trim();
  guidePronunciationTts = ttsValue;
  guidePronunciationLang = lang;
  document.querySelectorAll('.alphabet-item.active,.ph-item.active').forEach(el => el.classList.remove('active'));
  if (sourceEl) sourceEl.classList.add('active');
  const status = document.getElementById('pronunciation-status');
  if (status) status.innerHTML = `正在播放 <strong>${escapeHtml(guidePronunciationLabel)}</strong> · ${escapeHtml(value)}`;
  const repeat = document.getElementById('pronunciation-repeat');
  if (repeat) repeat.disabled = false;
  if (!('speechSynthesis' in window)) {
    showToast('当前浏览器不支持发音播放');
    return;
  }
  speechSynthesis.cancel();
  const voices = await waitForSpeechVoices();
  const preferredVoice = voices.find(v => v.lang.toLowerCase() === lang.toLowerCase()) ||
    voices.find(v => v.lang.toLowerCase().startsWith(lang.split('-')[0].toLowerCase()));
  if (lang.startsWith('ro') && !preferredVoice) {
    if (status) status.innerHTML = `<strong>${escapeHtml(guidePronunciationLabel)}</strong> · 未检测到罗马尼亚语语音，已停止播放以免误导`;
    showToast('请先在系统语音设置中安装罗马尼亚语语音');
    return;
  }
  const utterance = new SpeechSynthesisUtterance(ttsValue);
  utterance.lang = lang;
  utterance.rate = 0.8;
  if (preferredVoice) utterance.voice = preferredVoice;
  utterance.onend = () => {
    if (status) status.innerHTML = `已播放 <strong>${escapeHtml(guidePronunciationLabel)}</strong> · ${escapeHtml(value)}`;
  };
  utterance.onerror = () => {
    if (status) status.innerHTML = `<strong>${escapeHtml(guidePronunciationLabel)}</strong> · 播放失败，请检查系统语音设置`;
  };
  speechSynthesis.speak(utterance);
}

function repeatGuidePronunciation() {
  speakGuidePronunciation(guidePronunciationText, guidePronunciationLabel, document.querySelector('.alphabet-item.active,.ph-item.active'), guidePronunciationTts, guidePronunciationLang);
}

function initGuidePronunciation() {
  document.querySelectorAll('.alphabet-item[data-speak],.ph-item[data-speak]').forEach((el) => {
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    const label = el.querySelector('.alphabet-letter,.ph-letter')?.textContent?.trim() || el.dataset.speak || '发音';
    el.setAttribute('aria-label', `播放 ${label} 的发音`);
  });
}

function initAccessibleModals() {
  const focusReturn = new WeakMap();
  document.querySelectorAll('.modal-overlay').forEach((overlay) => {
    const dialog = overlay.querySelector('.modal');
    if (!dialog) return;
    overlay.setAttribute('aria-hidden', overlay.style.display === 'none' ? 'true' : 'false');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    if (!dialog.hasAttribute('tabindex')) dialog.setAttribute('tabindex', '-1');
    dialog.querySelectorAll('.form-group label:not([for])').forEach((label) => {
      const control = label.parentElement?.querySelector('input:not([type="hidden"]),select,textarea');
      if (control?.id) label.setAttribute('for', control.id);
    });
    let wasOpen = overlay.style.display !== 'none';
    new MutationObserver(() => {
      const isOpen = overlay.style.display !== 'none';
      overlay.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
      if (isOpen && !wasOpen) {
        focusReturn.set(overlay, document.activeElement);
        requestAnimationFrame(() => {
          const first = dialog.querySelector('.modal-close,input:not([type="hidden"]),select,textarea,button');
          (first || dialog).focus();
        });
      } else if (!isOpen && wasOpen) {
        const previous = focusReturn.get(overlay);
        if (previous?.isConnected) previous.focus();
      }
      wasOpen = isOpen;
    }).observe(overlay, { attributes: true, attributeFilter: ['style'] });
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    const overlay = Array.from(document.querySelectorAll('.modal-overlay')).find(el => el.style.display !== 'none');
    const dialog = overlay?.querySelector('.modal');
    if (!dialog) return;
    const focusable = Array.from(dialog.querySelectorAll('button,input:not([type="hidden"]),select,textarea,[tabindex]:not([tabindex="-1"])'))
      .filter(el => !el.disabled && el.offsetParent !== null);
    if (!focusable.length) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
}

function initAccessibleControls() {
  document.querySelectorAll('.admin-section-header').forEach((header) => {
    const section = header.closest('.admin-section');
    header.setAttribute('role', 'button');
    header.setAttribute('tabindex', '0');
    header.setAttribute('aria-expanded', section?.classList.contains('collapsed') ? 'false' : 'true');
    header.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      header.click();
    });
  });
  document.querySelectorAll('.logout-link').forEach((link) => {
    link.setAttribute('role', 'button');
    link.setAttribute('tabindex', '0');
    link.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      link.click();
    });
  });
}

document.addEventListener('click', (event) => {
  const item = event.target.closest?.('.alphabet-item[data-speak],.ph-item[data-speak]');
  if (!item) return;
  const label = item.querySelector('.alphabet-letter,.ph-letter')?.textContent?.trim() || item.dataset.speak;
  const ttsText = item.dataset.tts || '';
  speakGuidePronunciation(item.dataset.speak, label, item, ttsText, item.dataset.ttsLang || 'ro-RO');
});

document.addEventListener('keydown', (event) => {
  const item = event.target.closest?.('.alphabet-item[data-speak],.ph-item[data-speak]');
  if (!item || (event.key !== 'Enter' && event.key !== ' ')) return;
  event.preventDefault();
  const label = item.querySelector('.alphabet-letter,.ph-letter')?.textContent?.trim() || item.dataset.speak;
  const ttsText = item.dataset.tts || '';
  speakGuidePronunciation(item.dataset.speak, label, item, ttsText, item.dataset.ttsLang || 'ro-RO');
});

// ── 需加强 ────────────────────────────────────────────────

/**
 * 需加强只收曾经掌握、后来又不稳定的词；初学阶段的错题留在学习/复习队列。
 */
function isWrongWord(wordRo) {
  const p = getProgress(wordRo);
  const wasMastered = !!(p?.wasMasteredAt || p?.level === 'mastered' || getStoredLevel(p) === 'mastered');
  return wasMastered && ((p.wrongCount || 0) > 0 || (p.errorStreak || 0) > 0 || isUnclearedWeakLearningMiss(wordRo));
}

/**
 * 获取当前需加强列表
 */
function getWrongWords() {
  return getDifficultWords(getLearningCollectionWords(W)).filter(w => isWrongWord(w.ro));
}

/**
 * 初始化/刷新需加强列表
 */
function initWrongbook() {
  if (wbAutoAdvanceTimer) {
    clearTimeout(wbAutoAdvanceTimer);
    wbAutoAdvanceTimer = null;
  }
  wbList = getWrongWords();
  wbIdx = 0;
  wbFlipped = false;
  wbStreaks = loadWrongbookStreaks();
  wbGraduated = 0;
  renderWrongbookStats();
  renderWrongbookCard();
}

function renderWrongbookStats() {
  const total = getWrongWords().length;
  document.getElementById('wb-total').textContent = total;
  document.getElementById('wb-graduated').textContent = wbGraduated;
  const tabBadge = document.getElementById('wb-tab-badge');
  if (tabBadge) {
    tabBadge.textContent = total;
    tabBadge.style.display = total > 0 ? 'inline' : 'none';
  }
}

function getWrongbookReason(progress = {}) {
  const wrongCount = Number(progress.wrongCount || 0);
  const errorStreak = Number(progress.errorStreak || 0);
  const qt = Number(progress.qt || 0);
  const qr = Number(progress.qr || 0);
  const missed = Math.max(0, qt - qr);
  if (errorStreak >= 2) return `已掌握后连续答错 ${errorStreak} 次，先短轮修复。`;
  if (wrongCount > 0) return `已掌握后最近答错过 ${wrongCount} 次，需要重新确认。`;
  if (missed >= REINFORCEMENT_MIN_LEARNING_MISSES) return `已掌握词累计错 ${missed} 次，需要重新巩固。`;
  return '这个已掌握词最近不够稳定，先单独修复。';
}

function renderWrongbookCard() {
  if (wrongbookCardRenderTimer) {
    clearTimeout(wrongbookCardRenderTimer);
    wrongbookCardRenderTimer = null;
  }
  const empty = document.getElementById('wb-empty');
  const content = document.getElementById('wb-content');

  if (!wbList.length) {
    empty.style.display = 'flex';
    content.style.display = 'none';
    return;
  }

  empty.style.display = 'none';
  content.style.display = 'block';

  const w = wbList[wbIdx];
  const stress = getStressDisplay(w);
  const p = getProgress(w.ro) || {};
  const wrongCount = p.wrongCount || 0;
  const streak = wbStreaks[w.ro] || 0;
  const remainingToGraduate = Math.max(0, WB_GRADUATE - streak);

  document.getElementById('wb-cat').textContent = getTopicLabel(w.topic || w.cat);
  document.getElementById('wb-cat2').textContent = getClassificationSummary(w, { includeUnit: true });
  document.getElementById('wb-zh').textContent = w.zh;
  document.getElementById('wb-ro').textContent = w.ro;
  setStressHtml('wb-ipa', w);
  setGrammarText('wb-phint', w, stress);
  document.getElementById('wb-count').textContent = (wbIdx + 1) + ' / ' + wbList.length;
  const missed = Math.max(0, Number(p.qt || 0) - Number(p.qr || 0));
  document.getElementById('wb-wrong-count').textContent = `累计错 ${Math.max(wrongCount, missed)} 次`;
  document.getElementById('wb-streak').textContent = streak > 0 ? `连续答对 ${streak}/${WB_GRADUATE}` : '';
  document.getElementById('wb-streak').style.color = streak > 0 ? 'var(--green-text)' : '';
  setText('wb-repair-title', `${w.zh || w.ro} · 修复目标`);
  setText('wb-repair-reason', getWrongbookReason(p));
  setText('wb-repair-target', streak > 0
    ? `再连续答对 ${remainingToGraduate} 次，会移出需加强。`
    : `连续答对 ${WB_GRADUATE} 次后，会移出需加强。`);

  // 重置卡片翻转
  wbFlipped = false;
  document.getElementById('wb-card').classList.remove('flipped');
  setCardFlipAccessibility('wb-card', false);
}

function flipWbCard() {
  wbFlipped = !wbFlipped;
  document.getElementById('wb-card').classList.toggle('flipped', wbFlipped);
  setCardFlipAccessibility('wb-card', wbFlipped);
}

function renderWrongbookCardAfterFrontReset() {
  const card = document.getElementById('wb-card');
  if (!card || !card.classList.contains('flipped')) {
    renderWrongbookCard();
    return;
  }
  wbFlipped = false;
  card.classList.remove('flipped');
  setCardFlipAccessibility('wb-card', false);
  if (wrongbookCardRenderTimer) clearTimeout(wrongbookCardRenderTimer);
  wrongbookCardRenderTimer = setTimeout(() => {
    wrongbookCardRenderTimer = null;
    renderWrongbookCard();
  }, CARD_CONTENT_SWAP_DELAY_MS);
}

function nextWbCard() {
  if (wbAutoAdvanceTimer) {
    clearTimeout(wbAutoAdvanceTimer);
    wbAutoAdvanceTimer = null;
  }
  if (!wbList.length) return;
  wbIdx = (wbIdx + 1) % wbList.length;
  renderWrongbookCardAfterFrontReset();
}

function prevWbCard() {
  if (wbAutoAdvanceTimer) {
    clearTimeout(wbAutoAdvanceTimer);
    wbAutoAdvanceTimer = null;
  }
  if (!wbList.length) return;
  wbIdx = (wbIdx - 1 + wbList.length) % wbList.length;
  renderWrongbookCardAfterFrontReset();
}

function speakWb(rate) {
  const w = wbList[wbIdx];
  if (!w || !String(w.ro || '').trim()) return;
  if (!('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(w.ro);
  u.lang = 'ro-RO'; u.rate = rate;
  const rv = speechSynthesis.getVoices().find(v => v.lang.startsWith('ro'));
  if (rv) u.voice = rv;
  speechSynthesis.speak(u);
}

function speakQuizWord(rate = 0.9) {
  const w = qList[qIdx];
  if (!w || !String(w.ro || '').trim()) return;
  if (!('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(w.ro);
  u.lang = 'ro-RO';
  u.rate = rate;
  const rv = speechSynthesis.getVoices().find(v => v.lang.startsWith('ro'));
  if (rv) u.voice = rv;
  speechSynthesis.speak(u);
}

function startWrongbookQuiz() {
  qPracticeScope = 'wrong';
  qExerciseMode = 'translation';
  qMode = 'zh';
  qSize = 20;
  qStarted = false;
  invalidateQuizPracticePool();
  document.querySelectorAll('#quiz-scope-bar .study-mode-btn').forEach(b => b.classList.toggle('active', b.dataset.scope === 'wrong'));
  document.querySelectorAll('.exercise-btn').forEach(b => b.classList.toggle('active', b.dataset.exercise === 'translation'));
  document.getElementById('m-zh')?.classList.toggle('active', true);
  document.getElementById('m-ro')?.classList.toggle('active', false);
  switchPage('quiz');
  startQuiz();
}

function startWrongbookTranslationQuiz() {
  qPracticeScope = 'wrong';
  qExerciseMode = 'translation';
  qStarted = false;
  invalidateQuizPracticePool();
  document.querySelectorAll('#quiz-scope-bar .study-mode-btn').forEach(b => b.classList.toggle('active', b.dataset.scope === 'wrong'));
  document.querySelectorAll('.exercise-btn').forEach(b => b.classList.toggle('active', b.dataset.exercise === 'translation'));
  switchPage('quiz');
}

/**
 * 在需加强列表中答题
 * @param {boolean} correct
 */
async function answerWb(correct) {
  const w = wbList[wbIdx];
  await recordInteraction(w.ro, correct ? 'wrongbook_correct' : 'wrongbook_wrong');

  if (correct) {
    // 连击+1
    wbStreaks[w.ro] = (wbStreaks[w.ro] || 0) + 1;
    if (wbStreaks[w.ro] >= WB_GRADUATE) {
      // 毕业！移出需加强列表
      wbGraduated++;
      await recordInteraction(w.ro, 'wrongbook_clear');
      delete wbStreaks[w.ro];
      saveWrongbookStreaks();
      showToast(`🎓 "${w.zh}" 已从需加强列表移出！`);
      wbList.splice(wbIdx, 1);
      if (wbList.length === 0) { renderWrongbookCard(); renderWrongbookStats(); return; }
      wbIdx = wbIdx % wbList.length;
      renderWrongbookStats();
      renderWrongbookCardAfterFrontReset();
      return;
    } else {
      saveWrongbookStreaks();
      showToast(`✓ 正确！连续答对 ${wbStreaks[w.ro]}/${WB_GRADUATE}`);
    }
  } else {
    // 答错重置连击
    wbStreaks[w.ro] = 0;
    saveWrongbookStreaks();
    showToast('✗ 再来一次，加油！');
  }

  renderWrongbookStats();
  // 自动跳下一张
  if (wbAutoAdvanceTimer) clearTimeout(wbAutoAdvanceTimer);
  wbAutoAdvanceTimer = setTimeout(() => {
    wbAutoAdvanceTimer = null;
    if (!wbList.length) return;
    wbIdx = (wbIdx + 1) % wbList.length;
    renderWrongbookCardAfterFrontReset();
  }, 800);
}

// ── 测验模式 ──────────────────────────────────────────────

let qSize = 20; // 每轮题目数，默认20

function isQuizInProgress() {
  return qStarted && qList.length > 0 && qIdx < qList.length;
}

function resetQuizSession() {
  qStarted = false;
  qList = [];
  qIdx = 0;
  qRoundRight = 0;
  qRoundTotal = 0;
  qRoundWrong = 0;
}

function invalidateQuizPracticePool() {
  qScopedPracticePool = null;
  qScopedPracticePoolKey = '';
}

function setQMode(m) {
  qMode = m;
  qStarted = false;
  invalidateQuizPracticePool();
  document.getElementById('m-zh').classList.toggle('active', m === 'zh');
  document.getElementById('m-ro').classList.toggle('active', m === 'ro');
  showQuizSetup();
}

function setExerciseMode(mode) {
  qExerciseMode = mode;
  qStarted = false;
  invalidateQuizPracticePool();
  document.querySelectorAll('.exercise-btn').forEach(b => b.classList.toggle('active', b.dataset.exercise === mode));
  showQuizSetup();
}

function setPracticeScope(scope) {
  qPracticeScope = scope;
  qStarted = false;
  invalidateQuizPracticePool();
  document.querySelectorAll('#quiz-scope-bar .study-mode-btn').forEach(b => b.classList.toggle('active', b.dataset.scope === scope));
  showQuizSetup();
}

function setQSize(n) {
  qSize = n;
  document.querySelectorAll('.qsize-btn').forEach(b =>
    b.classList.toggle('active', parseInt(b.dataset.n) === n)
  );
}

function startDefaultSmartQuiz() {
  qPracticeScope = 'smart';
  qExerciseMode = 'translation';
  qMode = 'zh';
  qStarted = false;
  invalidateQuizPracticePool();
  document.querySelectorAll('#quiz-scope-bar .study-mode-btn').forEach(b => b.classList.toggle('active', b.dataset.scope === qPracticeScope));
  document.querySelectorAll('.exercise-btn').forEach(b => b.classList.toggle('active', b.dataset.exercise === qExerciseMode));
  document.getElementById('m-zh')?.classList.toggle('active', true);
  document.getElementById('m-ro')?.classList.toggle('active', false);
  showQuizSetup();
  startQuiz();
}

function getScopedPracticePool() {
  const collectionWords = getLearningCollectionWords(W);
  const scoped = curCat === '全部' ? collectionWords : collectionWords.filter(w => w.cat === curCat);
  if (qPracticeScope === 'today') {
    const todaySet = new Set([...todayQueue, ...todayQueueCompleted].map(roKey));
    return sortByReviewPriority(scoped.filter(w => todaySet.has(roKey(w.ro))));
  }
  if (qPracticeScope === 'weak') return getWeakLearningWords(scoped);
  if (qPracticeScope === 'wrong') return getWrongWords().filter(w => curCat === '全部' || w.cat === curCat);
  if (qPracticeScope === 'due') {
    return sortReviewDueWithWeakPriority(scoped).filter(w => {
      const p = getProgress(w.ro);
      return p && (p.qt || p.known) && isReviewDue(p);
    });
  }
  if (qPracticeScope === 'new') return getUnseenWords(scoped);
  if (qPracticeScope === 'all') return sortByReviewPriority(scoped);
  return uniqueWordsByRo([
    ...sortReviewDueWithWeakPriority(scoped).filter(w => {
      const p = getProgress(w.ro);
      return p && (p.qt || p.known) && isReviewDue(p);
    }),
    ...getWrongWords().filter(w => curCat === '全部' || w.cat === curCat),
    ...getWeakLearningWords(scoped),
    ...getUnseenWords(scoped),
    ...sortByReviewPriority(scoped)
  ]);
}

function getCachedScopedPracticePool() {
  const key = [
    currentUser?.id || 'local',
    learningCollectionId,
    curCat,
    qPracticeScope,
    qExerciseMode,
    W.length,
    todayQueue.length,
    todayQueueCompleted.size,
    todaySeenWords.size,
    progressVersion,
    dailyQueueVersion
  ].join('|');
  if (qScopedPracticePool && qScopedPracticePoolKey === key) return qScopedPracticePool;
  qScopedPracticePool = getScopedPracticePool();
  qScopedPracticePoolKey = key;
  return qScopedPracticePool;
}

function getPracticeScopeLabel() {
  return {
    smart: '智能练习',
    today: '今日任务',
    weak: '学习中',
    wrong: '需加强',
    due: '到期复习',
    new: '未学',
    all: '全部'
  }[qPracticeScope] || '智能练习';
}

function shuffleGroup(words) {
  return [...words].sort(() => Math.random() - 0.5);
}

function buildReviewPriorityPool(words) {
  return [
    ...shuffleGroup(words.filter(w => getReviewBucket(w) === 0)),
    ...shuffleGroup(words.filter(w => getReviewBucket(w) === 1)),
    ...shuffleGroup(words.filter(w => getReviewBucket(w) === 2)),
  ];
}

function parseNounPlural(w) {
  if (isGrammarUnverified(w)) return null;
  const grammar = getGrammarInfo(w);
  const appMatch = grammar.match(/名词\s*·\s*复数\s*:\s*([^·]+)/);
  if (appMatch) return appMatch[1].trim();

  const dexMatch = grammar.match(/^s\.(?:m|f|n)(?:\.pl)?\.\s*:\s*(.+)$/i);
  if (!dexMatch) return null;
  const plural = dexMatch[1]
    .replace(/\([^)]*fără plural[^)]*\)/gi, '')
    .split(/[;,]/)[0]
    .trim();
  return plural || null;
}

function parseVerbClass(w) {
  if (isGrammarUnverified(w)) return null;
  const grammar = getGrammarInfo(w);
  const m = grammar.match(/动词\s*·\s*(.+)$/);
  return m ? m[1].replace(/\s*·\s*dexonline\s*$/i, '').trim() : null;
}

function getStressGroupsForWord(ro) {
  const groups = [];
  const text = String(ro || '').toLocaleLowerCase('ro');
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    if (isRoVowel(text[i])) {
      if (start === -1) start = i;
    } else if (start !== -1) {
      groups.push({ start, end: i });
      start = -1;
    }
  }
  if (start !== -1) groups.push({ start, end: text.length });
  return groups;
}

function stressVariant(ro, group) {
  const lower = String(ro || '').toLocaleLowerCase('ro');
  return lower.slice(0, group.start) + lower.slice(group.start, group.end).toLocaleUpperCase('ro') + lower.slice(group.end);
}

function getVerifiedStressValue(w) {
  const stress = getStressDisplay(w);
  if (stress.auto || !stress.text) return null;
  const source = normalizeStressText(stress.text);
  const sourceLetters = source.replace(/[^A-Za-zĂÂÎȘȚăâîșț]/g, '').toLocaleLowerCase('ro');
  const wordLetters = String(w.ro || '').replace(/[^A-Za-zĂÂÎȘȚăâîșț]/g, '').toLocaleLowerCase('ro');
  return sourceLetters === wordLetters ? source : null;
}

function getStressAnswerVariant(w, options) {
  const source = getVerifiedStressValue(w);
  if (!source) return null;
  const clean = source.replace(/[^A-Za-zĂÂÎȘȚăâîșț]/g, '');
  const upperVowelIndex = [...clean].findIndex(ch => /[A-ZĂÂÎȘȚ]/.test(ch) && isRoVowel(ch));
  if (upperVowelIndex < 0) return null;
  const groups = getStressGroupsForWord(w.ro);
  const target = groups.findIndex(g => upperVowelIndex >= g.start && upperVowelIndex < g.end);
  return target >= 0 ? options[target] : null;
}

function buildFeedbackHtml(w, ok, context = {}) {
  if (!w) return '';
  const grammar = getGrammarInfo(w);
  const stress = stressToHtml(getStressDisplay(w).text);
  const parts = [];
  if (context.type === 'translation') {
    parts.push(`答案：${escapeHtml(w.zh || '')} · ${escapeHtml(w.ro || '')}`);
  } else if (context.type === 'listening') {
    parts.push(`听力词：${escapeHtml(w.ro || '')} · ${escapeHtml(w.zh || '')}`);
  } else if (context.type === 'nounPlural') {
    parts.push(`复数：${escapeHtml(context.answer || parseNounPlural(w) || '')}`);
  } else if (context.type === 'verbConj') {
    parts.push(`变位类型：${escapeHtml(context.answer || parseVerbClass(w) || '')}`);
  } else if (context.type === 'stress') {
    parts.push(`重音：${stress}`);
  }
  if (grammar) parts.push(`语法：${escapeHtml(grammar)}`);
  const tip = ok ? '这题已记录为正确。' : getMistakeTip(w, context);
  return `<div style="font-weight:700;margin-bottom:4px">${ok ? '正确' : '错误，答案已标出'}</div>
    <div style="font-weight:500">${parts.filter(Boolean).join('<br>')}</div>
    <div style="font-size:12px;color:var(--text2);margin-top:6px;line-height:1.45">${escapeHtml(tip)}</div>`;
}

function getMistakeTip(w, context = {}) {
  if (context.type === 'listening') return '再听一遍正常速度和慢速，重点记住词首、重音和结尾。';
  if (context.type === 'nounPlural') return '名词题优先看性别和复数尾缀；同一尾缀的词可以一起练。';
  if (context.type === 'verbConj') return '动词题先识别不定式结尾，再记是否带 -ez 或 -esc。';
  if (context.type === 'stress') return '重音题看下划线音节；不确定时先慢速朗读，再回到词卡。';
  if (isWordUnverified(w)) return '这个词仍有未核对信息，建议打开详情或报错让管理员检查。';
  return '系统已经记录这次错误，并会在智能练习里提高这个词的优先级。';
}

function buildExercisePool() {
  const scoped = getScopedPracticePool();
  if (qExerciseMode === 'nounPlural') {
    const verified = scoped.map(w => ({ w, answer: parseNounPlural(w) })).filter(x => x.answer);
    const answers = [...new Set(verified.map(x => x.answer))];
    return verified.map(({ w, answer }) => ({
      word: w,
      type: 'nounPlural',
      question: w.ro,
      sub: '选择这个名词的复数形式',
      answer,
      options: [answer, ...shuffleGroup(answers.filter(a => a !== answer)).slice(0, 3)]
    })).filter(x => x.options.length >= 2);
  }
  if (qExerciseMode === 'verbConj') {
    const verbScoped = curCat === '全部' || curCat === 'verb'
      ? [
          ...scoped,
          ...DEXONLINE_VERB_FALLBACK_WORDS.filter(fallback =>
            !scoped.some(w => lowerRo(w.ro).replace(/^a\s+/, '') === lowerRo(fallback.ro).replace(/^a\s+/, '')))
        ]
      : scoped;
    const verified = verbScoped.map(w => ({ w, answer: parseVerbClass(w) })).filter(x => x.answer);
    const answers = [...new Set(verified.map(x => x.answer))];
    return verified.map(({ w, answer }) => ({
      word: w,
      type: 'verbConj',
      question: w.ro,
      sub: '选择这个动词的变位类型',
      answer,
      options: [answer, ...shuffleGroup(answers.filter(a => a !== answer)).slice(0, 3)]
    })).filter(x => x.options.length >= 2);
  }
  if (qExerciseMode === 'stress') {
    return scoped.map(w => {
      const groups = getStressGroupsForWord(w.ro);
      const options = groups.map(g => stressVariant(w.ro, g));
      const finalAnswer = getStressAnswerVariant(w, options);
      if (!finalAnswer || groups.length < 2) return null;
      return {
        word: w,
        type: 'stress',
        question: w.ro,
        sub: '选择应重读的音节',
        answer: finalAnswer,
        options
      };
    }).filter(Boolean);
  }
  return buildReviewPriorityPool(scoped);
}

function showQuizSetup() {
  const pool = qExerciseMode === 'translation' || qExerciseMode === 'listening' ? getCachedScopedPracticePool() : buildExercisePool();
  const qmodeBar = document.querySelector('.qmode-bar');
  const directionSection = document.getElementById('quiz-direction-section');
  if (qmodeBar) qmodeBar.style.display = qExerciseMode === 'translation' ? 'flex' : 'none';
  if (directionSection) directionSection.style.display = qExerciseMode === 'translation' ? 'block' : 'none';
  const modeName = {
    translation: '翻译测验',
    listening: '听力测验',
    nounPlural: '名词复数',
    verbConj: '动词变位',
    stress: '重音选择'
  }[qExerciseMode];
  const isDefaultSmart = qPracticeScope === 'smart' && qExerciseMode === 'translation' && qMode === 'zh';
  const primaryTitle = isDefaultSmart ? '开始智能练习' : `开始${modeName}`;
  const primarySub = isDefaultSmart
    ? '系统会优先抽到期、近期答错和学习中的词，适合每天完成任务后检查记忆。'
    : `${getPracticeScopeLabel()} · ${modeName}${qExerciseMode === 'translation' ? ` · ${qMode === 'zh' ? '中文到罗语' : '罗语到中文'}` : ''}`;
  document.getElementById('quiz-area').innerHTML = `
    <div class="quiz-section quiz-start-panel">
      <div class="quiz-start-meta">${curCat !== '全部' ? getCategoryLabel(curCat) : '全部主题'} · ${getPracticeScopeLabel()} · ${modeName} · ${pool.length} 题</div>
      <div class="quiz-start-title">${escapeHtml(primaryTitle)}</div>
      <div class="quiz-start-sub">${escapeHtml(primarySub)}</div>
      <div style="font-size:13px;font-weight:750;margin-bottom:.8rem;color:var(--text2)">本轮题目数</div>
      <div class="quiz-size-row">
        <button class="qsize-btn${qSize===20?' active':''}" aria-pressed="${qSize===20}" data-n="20" onclick="setQSize(20)">20题</button>
        <button class="qsize-btn${qSize===50?' active':''}" aria-pressed="${qSize===50}" data-n="50" onclick="setQSize(50)">50题</button>
        <button class="qsize-btn${qSize===100?' active':''}" aria-pressed="${qSize===100}" data-n="100" onclick="setQSize(100)">100题</button>
        <button class="qsize-btn${qSize===0?' active':''}" aria-pressed="${qSize===0}" data-n="0" onclick="setQSize(0)">全部(${pool.length}题)</button>
      </div>
      ${qSize === 0 ? `<div class="quiz-all-warning">全部题量较大，建议先完成 20–100 题的短测验。</div>` : ''}
      ${pool.length ? `<button class="btn-primary" style="max-width:220px;margin:0 auto" onclick="startQuiz()">${escapeHtml(primaryTitle)}</button>` : '<div class="empty-state">当前模式没有足够的已核对数据。请先由管理员核对词条。</div>'}
    </div>`;
}

function startQuiz() {
  invalidateQuizPracticePool();
  const activePool = qExerciseMode === 'translation' || qExerciseMode === 'listening' ? getCachedScopedPracticePool() : buildExercisePool();
  if (!activePool.length) { showToast('当前模式没有可测验的词'); return; }
  const pool = qExerciseMode === 'translation' || qExerciseMode === 'listening' ? buildReviewPriorityPool(activePool) : shuffleGroup(activePool);
  qList = qSize > 0 ? pool.slice(0, qSize) : pool;
  qIdx = 0;
  qRoundRight = 0;
  qRoundTotal = 0;
  qRoundWrong = 0;
  qStarted = true;
  renderQuiz();
}

function renderQuizAnswerButton(option, answerWord, label) {
  const ok = option.ro === answerWord.ro;
  return `<button class="opt" data-quiz-action="answer" data-ok="${ok ? '1' : '0'}" data-ro="${escapeHtml(answerWord.ro)}" data-zh="${escapeHtml(answerWord.zh)}" data-option-ro="${escapeHtml(option.ro)}">${escapeHtml(label)}</button>`;
}

function renderExerciseAnswerButton(option, answer, label) {
  const ok = option === answer;
  return `<button class="opt" data-quiz-action="exercise" data-ok="${ok ? '1' : '0'}" data-option="${escapeHtml(option)}">${label}</button>`;
}

function renderQuizSessionTools() {
  return `<div class="quiz-session-tools">
    <span>快捷键：1–4 选择 · Enter 下一题</span>
    <button class="quiz-exit-btn" type="button" onclick="endQuizEarly()">结束本轮</button>
  </div>`;
}

function endQuizEarly() {
  if (!isQuizInProgress()) {
    showQuizSetup();
    return;
  }
  showResult({ endedEarly: true });
}

function renderQuiz() {
  if (qIdx >= qList.length) { showResult(); return; }
  const pct = Math.round(qIdx / qList.length * 100);
  const livePct = qRoundTotal > 0 ? Math.round(qRoundRight / qRoundTotal * 100) : 0;
  if (qExerciseMode === 'listening') {
    const w = qList[qIdx];
    const optionPool = getCachedScopedPracticePool().filter(x => roKey(x.ro) !== roKey(w.ro));
    const optionPoolKeys = new Set(optionPool.map(o => roKey(o.ro)));
    const fallbackPool = W.filter(x => roKey(x.ro) !== roKey(w.ro) && !optionPoolKeys.has(roKey(x.ro)));
    const wrongs = [...optionPool, ...fallbackPool].sort(() => Math.random() - 0.5).slice(0, 3);
    const opts = [w, ...wrongs].sort(() => Math.random() - 0.5);
    document.getElementById('quiz-area').innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;font-size:13px;color:var(--text2)">
        <span>第 ${qIdx + 1} / ${qList.length} 题</span>
        <span style="color:${livePct>=60?'var(--green-text)':'var(--red-text)'}">答对 ${qRoundRight}/${qRoundTotal}${qRoundTotal>0?' ('+livePct+'%)':''}</span>
      </div>
      <div style="background:var(--bg3);border-radius:99px;height:6px;margin-bottom:1rem;overflow:hidden">
        <div style="height:100%;width:${pct}%;background:var(--blue);border-radius:99px;transition:width .3s"></div>
      </div>
      ${renderQuizSessionTools()}
      <div class="quiz-q">听音选择中文</div>
      <div class="quiz-sub">先听罗马尼亚语，再选择对应中文</div>
      <button class="btn-primary" style="max-width:180px;margin:0 auto 1rem;display:block" onclick="speakQuizWord(0.9)">播放</button>
      <div class="opts">${opts.map(o => {
        return renderQuizAnswerButton(o, w, o.zh);
      }).join('')}</div>
      <div class="quiz-fb" id="qfb"></div>
      <button class="next-btn" id="qnxt" onclick="nextQ()" style="display:none">下一题 →</button>`;
    setTimeout(() => speakQuizWord(0.9), 150);
    return;
  }
  if (qExerciseMode !== 'translation') {
    const ex = qList[qIdx];
    const opts = shuffleGroup(ex.options);
    document.getElementById('quiz-area').innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;font-size:13px;color:var(--text2)">
        <span>第 ${qIdx + 1} / ${qList.length} 题</span>
        <span style="color:${livePct>=60?'var(--green-text)':'var(--red-text)'}">答对 ${qRoundRight}/${qRoundTotal}${qRoundTotal>0?' ('+livePct+'%)':''}</span>
      </div>
      <div style="background:var(--bg3);border-radius:99px;height:6px;margin-bottom:1rem;overflow:hidden">
        <div style="height:100%;width:${pct}%;background:var(--blue);border-radius:99px;transition:width .3s"></div>
      </div>
      ${renderQuizSessionTools()}
      <div class="quiz-q">${escapeHtml(ex.question)}</div>
      <div class="quiz-sub">${escapeHtml(ex.sub)}</div>
      <div class="opts">${opts.map(o => {
        const label = ex.type === 'stress' ? stressToHtml(o) : escapeHtml(o);
        return renderExerciseAnswerButton(o, ex.answer, label);
      }).join('')}</div>
      <div class="quiz-fb" id="qfb"></div>
      <button class="next-btn" id="qnxt" onclick="nextQ()" style="display:none">下一题 →</button>`;
    return;
  }

  const w = qList[qIdx];
  const optionPool = getCachedScopedPracticePool().filter(x => roKey(x.ro) !== roKey(w.ro));
  const optionPoolKeys = new Set(optionPool.map(o => roKey(o.ro)));
  const fallbackPool = W.filter(x => roKey(x.ro) !== roKey(w.ro) && !optionPoolKeys.has(roKey(x.ro)));
  const wrongs = [...optionPool, ...fallbackPool].sort(() => Math.random() - 0.5).slice(0, 3);
  const opts = [w, ...wrongs].sort(() => Math.random() - 0.5);
  if (opts.length < 2) {
    document.getElementById('quiz-area').innerHTML = `
      <div class="result-box">
        <div class="result-label">当前词库太少，至少需要 2 个词才能测验</div>
        <button class="restart-btn" onclick="switchPage('flash')">返回学习</button>
      </div>`;
    return;
  }
  const qText = qMode === 'zh' ? w.zh : w.ro;
  document.getElementById('quiz-area').innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;font-size:13px;color:var(--text2)">
      <span>第 ${qIdx + 1} / ${qList.length} 题</span>
      <span style="color:${livePct>=60?'var(--green-text)':'var(--red-text)'}">答对 ${qRoundRight}/${qRoundTotal}${qRoundTotal>0?' ('+livePct+'%)':''}</span>
    </div>
    <div style="background:var(--bg3);border-radius:99px;height:6px;margin-bottom:1rem;overflow:hidden">
      <div style="height:100%;width:${pct}%;background:var(--blue);border-radius:99px;transition:width .3s"></div>
    </div>
    ${renderQuizSessionTools()}
    <div class="quiz-q">${escapeHtml(qText)}</div>
    <div class="quiz-sub">${qMode === 'zh' ? '选择对应的罗马尼亚语' : '选择对应的中文'}</div>
    <div class="opts">${opts.map(o => {
      const label = qMode === 'zh' ? o.ro : o.zh;
      return renderQuizAnswerButton(o, w, label);
    }).join('')}</div>
    <div class="quiz-fb" id="qfb"></div>
    <button class="next-btn" id="qnxt" onclick="nextQ()" style="display:none">下一题 →</button>`;
}

async function answerQ(btn, ok, ro, zh) {
  btn.parentElement.querySelectorAll('.opt').forEach(b => b.style.pointerEvents = 'none');
  qTotal++;
  qRoundTotal++;
  if (ok) {
    btn.classList.add('correct');
    document.getElementById('qfb').style.color = 'var(--green-text)';
    qRight++;
    qRoundRight++;
  } else {
    btn.classList.add('wrong');
    qRoundWrong++;
    btn.parentElement.querySelectorAll('.opt').forEach(b => {
      if (b.dataset.optionRo === ro) b.classList.add('correct');
    });
    document.getElementById('qfb').style.color = 'var(--red-text)';
  }
  const w = qList[qIdx];
  document.getElementById('qfb').innerHTML = buildFeedbackHtml(w, ok, { type: qExerciseMode === 'listening' ? 'listening' : 'translation' });
  await recordInteraction(w.ro, ok ? 'quiz_correct' : 'quiz_wrong', { exerciseType: qExerciseMode });
  upStats();
  document.getElementById('qnxt').style.display = 'block';
}

async function answerExerciseQ(btn, ok) {
  btn.parentElement.querySelectorAll('.opt').forEach(b => b.style.pointerEvents = 'none');
  qTotal++;
  qRoundTotal++;
  if (ok) {
    btn.classList.add('correct');
    document.getElementById('qfb').style.color = 'var(--green-text)';
    qRight++;
    qRoundRight++;
  } else {
    btn.classList.add('wrong');
    qRoundWrong++;
    const ex = qList[qIdx];
    btn.parentElement.querySelectorAll('.opt').forEach(b => {
      if (b.dataset.option === ex.answer) b.classList.add('correct');
    });
    document.getElementById('qfb').style.color = 'var(--red-text)';
  }
  const ex = qList[qIdx];
  const w = ex.word;
  document.getElementById('qfb').innerHTML = buildFeedbackHtml(w, ok, { type: ex.type, answer: ex.answer });
  await recordInteraction(w.ro, ok ? 'quiz_correct' : 'quiz_wrong', { exerciseType: qExerciseMode });
  upStats();
  document.getElementById('qnxt').style.display = 'block';
}

function nextQ() { qIdx++; renderQuiz(); }

function showResult(options = {}) {
  const endedEarly = !!options.endedEarly;
  qStarted = false;
  const pct = qRoundTotal > 0 ? Math.round(qRoundRight / qRoundTotal * 100) : 0;
  const dueCount = getRemainingDueReviewWords(W).length;
  const nextTitle = endedEarly
    ? `本轮已完成 ${qRoundTotal}/${qList.length} 题`
    : qRoundWrong > 0
    ? `本轮错了 ${qRoundWrong} 题`
    : (dueCount > 0 ? `还有 ${dueCount} 个到期词` : '本轮状态稳定');
  const nextText = qRoundWrong > 0
    ? '建议马上再做一轮智能练习，系统会优先安排近期答错的词。'
    : (dueCount > 0
      ? '先完成到期复习，再继续新词或专项练习。'
      : '可以再做一轮智能练习，或回到今日任务继续扩大词量。');
  const primaryAction = qRoundWrong > 0
    ? `<button class="restart-btn" style="border-color:var(--blue);color:var(--blue-text)" onclick="startDefaultSmartQuiz()">继续智能练习</button>`
    : (dueCount > 0
      ? `<button class="restart-btn" style="border-color:var(--blue);color:var(--blue-text)" onclick="setPracticeScope('due');switchPage('quiz')">复习到期词</button>`
      : `<button class="restart-btn" style="border-color:var(--blue);color:var(--blue-text)" onclick="startDefaultSmartQuiz()">再做智能练习</button>`);
  document.getElementById('quiz-area').innerHTML = `
    <div class="result-box">
      <div class="result-score">${qRoundRight}/${qRoundTotal}</div>
      <div class="result-label">${qRoundTotal ? `本轮正确率 ${pct}% · ${pct >= 80 ? '稳定' : pct >= 60 ? '还需巩固' : '需要加强'}` : '本轮尚未作答'}</div>
      <div class="result-next">
        <div class="result-next-title">${escapeHtml(nextTitle)}</div>
        <div class="result-next-text">${escapeHtml(nextText)}</div>
      </div>
      <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap">
        ${primaryAction}
        <button class="restart-btn" onclick="switchPage('flash')">返回学习</button>
      </div>
    </div>`;
}

// ── 学习统计 / 排行榜 ─────────────────────────────────────

function getDateKeyFor(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getDateKey(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return getDateKeyFor(d);
}

function isDailyLogCompleted(log) {
  if (!log) return false;
  if (typeof log.completed === 'boolean') return log.completed;
  const completedTasks = Number(log.new_words || 0);
  const goal = Number(log.goal || dailyGoal || DEFAULT_DAILY_GOAL);
  return goal > 0 && completedTasks >= goal;
}

function buildRecentDays(days) {
  const arr = [];
  for (let i = days - 1; i >= 0; i--) arr.push(getDateKey(-i));
  return arr;
}

function fillDailyLogs(logs, days) {
  const map = {};
  (logs || []).forEach(l => { map[l.log_date] = l; });
  return buildRecentDays(days).map(date => {
    const log = map[date];
    const filled = {
      log_date: date,
      new_words: log?.new_words || 0,
      goal: log?.goal || dailyGoal,
      completed: log?.completed || false
    };
    return { ...filled, completed: isDailyLogCompleted(filled) };
  });
}

function calcStreak(logs) {
  const learned = new Set((logs || []).filter(isDailyLogCompleted).map(l => l.log_date));
  let streak = 0;
  for (let i = 0; i < 365; i++) {
    if (!learned.has(getDateKey(-i))) break;
    streak++;
  }
  return streak;
}

function calcProgressSummary(map) {
  const vals = Object.values(map || {});
  const mastered = vals.filter(isMasteredProgress).length;
  const learning = vals.filter(isStartedNotMastered).length;
  const known = vals.filter(p => p.known).length;
  const qr = vals.reduce((sum, p) => sum + (p.qr || 0), 0);
  const qt = vals.reduce((sum, p) => sum + (p.qt || 0), 0);
  return { mastered, learning, known, qr, qt, accuracy: qt ? Math.round(qr / qt * 100) : 0 };
}

function calcCurrentCollectionProgressSummary() {
  const scopedProgress = {};
  getLearningCollectionWords(W).forEach(word => {
    const progress = getProgress(word.ro);
    if (progress) scopedProgress[word.ro] = progress;
  });
  return calcProgressSummary(scopedProgress);
}

async function renderStatsPage() {
  let activePanel = 'personal';
  try { activePanel = sessionStorage.getItem('stats-active-panel') || 'personal'; } catch {}
  switchStatsPanel(activePanel);
  const dailyEl = document.getElementById('daily-chart');
  const catEl = document.getElementById('cat-mastery');
  const hardEl = document.getElementById('hardest-words');
  dailyEl.innerHTML = '<div class="empty-state">加载中...</div>';
  catEl.innerHTML = '<div class="empty-state">加载中...</div>';
  if (hardEl) hardEl.innerHTML = '<div class="empty-state">加载中...</div>';

  try {
    const logs = await apiGetRecentLogs(currentUser.id, 30);
    const filled14 = fillDailyLogs(logs, 14);
    const summary = calcCurrentCollectionProgressSummary();
    const tasks30 = fillDailyLogs(logs, 30).reduce((sum, l) => sum + (l.new_words || 0), 0);

    setText('stat-streak', calcStreak(logs));
    setText('stat-30days', tasks30);
    setText('stat-accuracy', summary.accuracy + '%');
    renderStudyCoach(summary, logs);
    renderDailyChart(filled14);
    await renderCalendar();
    renderCategoryMastery();
    renderHardestWords();
    renderAchievements(summary, logs);
  } catch (e) {
    dailyEl.innerHTML = '<div class="empty-state">学习记录暂时无法读取</div>';
    catEl.innerHTML = '<div class="empty-state">主题统计暂时无法读取</div>';
    if (hardEl) hardEl.innerHTML = '<div class="empty-state">错词统计暂时无法读取</div>';
  }
}

function renderStudyCoach(summary, logs = []) {
  const el = document.getElementById('study-coach');
  if (!el) return;
  const dueCount = getRemainingDueReviewWords(W).length;
  const weakCount = getWeakLearningWords(getLearningCollectionWords(W)).length;
  const weakCat = getWeakestCategory();
  const todayOpen = todayQueue.filter(ro => !setHasRo(todayQueueCompleted, ro)).length;
  const items = [];
  if (dueCount) items.push({ title: `先复习 ${dueCount} 个到期词`, meta: '这是今天最该优先完成的任务', kind: 'due' });
  if (weakCount) items.push({ title: `继续练 ${weakCount} 个学习中词`, meta: '还没稳定掌握，适合短轮测验', kind: 'weak' });
  if (todayOpen) items.push({ title: `完成今日剩余 ${todayOpen} 个任务`, meta: `${todayNewWords}/${dailyGoal} 已完成`, kind: 'today' });
  if (weakCat) items.push({ title: `掌握较少：${getCategoryLabel(weakCat.cat)}`, meta: `当前掌握率 ${weakCat.pct}%，可以按主题练习`, kind: 'cat', arg: weakCat.cat });
  if (!items.length) items.push({ title: `做一轮智能测验`, meta: `当前正确率 ${summary.accuracy}%，用测验检查是否真的记住`, kind: 'quiz' });
  const actionLabels = { due: '开始复习', weak: '开始练习', today: '继续任务', cat: '主题练习', quiz: '开始测验' };
  el.innerHTML = items.slice(0, 4).map(item => `
    <div class="hard-row">
      <div class="hard-main">
        <div class="hard-word">${escapeHtml(item.title)}</div>
        <div class="hard-meta">${escapeHtml(item.meta || '')}</div>
      </div>
      <button class="btn-sm" onclick="startCoachAction(decodeURIComponent('${encodedArg(item.kind)}'),decodeURIComponent('${encodedArg(item.arg || '')}'))">${actionLabels[item.kind] || '开始'}</button>
    </div>`).join('');
}

function startCoachAction(kind, arg = '') {
  if (kind === 'due') { setPracticeScope('due'); switchPage('quiz'); return; }
  if (kind === 'weak') { setPracticeScope('weak'); switchPage('quiz'); return; }
  if (kind === 'today') { setFlashMode('today'); switchPage('flash'); return; }
  if (kind === 'cat') { setCat(arg); switchPage('flash'); return; }
  switchPage('quiz');
  startDefaultSmartQuiz();
}

function getWeakestCategory() {
  const groups = {};
  getLearningCollectionWords(W).forEach(w => {
    const cat = normalizeCategory(w.cat);
    if (!groups[cat]) groups[cat] = { cat, total: 0, mastered: 0 };
    groups[cat].total++;
    if (getStoredLevel(getProgress(w.ro)) === 'mastered') groups[cat].mastered++;
  });
  return Object.values(groups)
    .filter(g => g.total >= 10)
    .map(g => ({ ...g, pct: Math.round(g.mastered / g.total * 100) }))
    .sort((a, b) => a.pct - b.pct || b.total - a.total)[0] || null;
}

function renderAchievements(summary, logs = []) {
  const el = document.getElementById('achievement-list');
  if (!el) return;
  const dueCount = getRemainingFormalReviewWords(W).length;
  const wrongCount = getWrongWords().length;
  const tasks30 = fillDailyLogs(logs, 30).reduce((sum, l) => sum + (l.new_words || 0), 0);
  const badges = [
    { name: '入门 100', done: summary.mastered >= 100, meta: `${summary.mastered}/100 已掌握` },
    { name: '稳定 7 天', done: calcStreak(logs) >= 7, meta: `${calcStreak(logs)} 天连续` },
    { name: '今日清空', done: dueCount === 0, meta: `${dueCount} 个到期` },
    { name: '记忆稳定', done: wrongCount === 0, meta: `${wrongCount} 个近期错词` },
    { name: '近月 300', done: tasks30 >= 300, meta: `${tasks30}/300 近30天任务` }
  ];
  el.innerHTML = `<div class="manual-grid">${badges.map(b => `
    <div class="manual-item" style="border-color:${b.done ? 'var(--green)' : 'var(--border)'};background:${b.done ? 'var(--green-bg)' : 'var(--bg2)'}">
      <div class="manual-title">${b.done ? '✓ ' : ''}${escapeHtml(b.name)}</div>
      <div class="manual-text">${escapeHtml(b.meta)}</div>
    </div>`).join('')}</div>`;
}

function exportProgressBackup() {
  const payload = {
    app: 'romanian-vocab',
    version: 2,
    exportedAt: new Date().toISOString(),
    user: { id: currentUser?.id || null, email: currentUser?.email || null },
    dailyGoal: defaultDailyGoal,
    todayGoal: dailyGoal,
    dailyNewLimit,
    progress: progressMap,
    dailyQueue: {
      collection_id: learningCollectionId,
      word_id: queueIdsToWordIds(todayQueue),
      word_ro: queueIdsToWordRos(todayQueue),
      completed_word_id: queueIdsToWordIds([...todayQueueCompleted]),
      completed_word_ro: queueIdsToWordRos([...todayQueueCompleted]),
      introduced_word_id: queueIdsToWordIds([...todayIntroducedWords]),
      introduced_word_ro: queueIdsToWordRos([...todayIntroducedWords]),
      new_words: todayNewWords
    }
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `romanian-vocab-progress-${getDateKeyFor(new Date())}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showToast('进度备份已导出');
}

function resolveQueueRefsToRos(refs = []) {
  return normalizeWordRoList(Array.isArray(refs) ? refs : [])
    .map(ref => getWordByRo(ref))
    .filter(Boolean)
    .map(word => word.ro);
}

async function restoreDailyQueueFromBackup(dailyQueuePayload = null) {
  if (!dailyQueuePayload || typeof dailyQueuePayload !== 'object') return { restored: false };
  const backupCollection = normalizeLearningCollection(dailyQueuePayload.collection_id || DEFAULT_LEARNING_COLLECTION);
  const restoredQueue = resolveQueueRefsToRos([
    ...(dailyQueuePayload.word_id || []),
    ...(dailyQueuePayload.word_ro || [])
  ]);
  const restoredCompleted = resolveQueueRefsToRos([
    ...(dailyQueuePayload.completed_word_id || []),
    ...(dailyQueuePayload.completed_word_ro || [])
  ]);
  const restoredIntroduced = resolveQueueRefsToRos([
    ...(dailyQueuePayload.introduced_word_id || []),
    ...(dailyQueuePayload.introduced_word_ro || [])
  ]);
  if (!restoredQueue.length && !restoredCompleted.length) return { restored: false };
  const allowed = ro => {
    const word = getWordByRo(ro);
    return word && wordMatchesLearningCollection(word, backupCollection);
  };
  writeLearningCollection(backupCollection);
  populateLearningCollectionControls();
  todayQueueCompleted = new Set(restoredCompleted.filter(allowed));
  todayQueue = restoredQueue.filter(ro => allowed(ro) && !setHasRo(todayQueueCompleted, ro));
  todaySeenWords = new Set([...readTodaySeenWords(), ...todayQueueCompleted]);
  todayIntroducedWords = new Set(restoredIntroduced);
  writeTodaySeenWords();
  writeTodayIntroducedWords();
  todayNewWords = todayQueueCompleted.size;
  dailyQueueVersion++;
  await saveTodayQueue();
  await apiUpdateTodayLog(currentUser.id, todayNewWords, dailyGoal, defaultDailyGoal, {
    completed: isDailyCheckinDone(),
    forceLocal: true
  });
  return { restored: true, queued: todayQueue.length, completed: todayQueueCompleted.size };
}

async function importProgressBackup(file) {
  if (!file) return;
  try {
    const payload = JSON.parse(await file.text());
    if (!payload || payload.app !== 'romanian-vocab' || !payload.progress) throw new Error('文件格式不正确');
    const incoming = payload.progress || {};
    replaceProgressMap(mergeProgressMaps(progressMap, incoming));
    const rows = Object.entries(incoming);
    let importWarningShown = false;
    let importedRows = 0;
    let failedRows = 0;
    for (const [wordRo, p] of rows) {
      try {
        const word = resolveWordFromProgressKey(wordRo, p);
        const displayRo = word?.ro || canonicalWordRo(p?.word_ro || p?.wordRo || wordRo);
        const saveStatus = await apiSaveProgress(
          currentUser.id,
          word?.id ?? p?.word_id ?? p?.wordId ?? null,
          displayRo,
          !!p.known,
          p.qr || 0,
          p.qt || 0,
          p.level || getStoredLevel(p),
          {
            reviewStage: window.RomanianVocabScheduler.getReviewStage(p),
            nextReviewAt: p.nextReviewAt || p.next_review_at || p.dueAt || p.due_at || new Date().toISOString(),
            dueAt: p.dueAt || p.due_at || p.nextReviewAt || p.next_review_at || new Date().toISOString(),
            intervalDays: p.intervalDays || p.interval_days || 0,
            memoryStrength: p.memoryStrength || p.memory_strength || 0,
            cardState: p.cardState || p.card_state || 'new',
            reps: p.reps || p.qt || 0,
            correctCount: p.correctCount || p.correct_count || p.qr || 0,
            fuzzyCount: p.fuzzyCount || p.fuzzy_count || 0,
            forgetCount: p.forgetCount || p.forget_count || Math.max(0, Number(p.qt || 0) - Number(p.qr || 0)),
            lapses: p.lapses || 0,
            recentResults: p.recentResults || p.recent_results || [],
            needsReinforcement: !!(p.needsReinforcement || p.needs_reinforcement),
            lastReviewedAt: p.lastReviewedAt || p.last_reviewed_at || new Date().toISOString()
          },
          null,
          {
            wrongCount: p.wrongCount || 0,
            errorStreak: p.errorStreak || 0,
            lastWrongAt: p.lastWrongAt || null,
            weakClearedAt: p.weakClearedAt || null
          },
          {
            progress: p
          }
        );
        importedRows++;
        if (!importWarningShown && handleProgressSaveStatus(saveStatus)) importWarningShown = true;
      } catch (rowError) {
        failedRows++;
        console.warn('Progress backup row import failed', wordRo, rowError);
      }
    }
    if (payload.dailyGoal) {
      defaultDailyGoal = normalizeDailyGoalValue(payload.dailyGoal, defaultDailyGoal);
      dailyGoal = defaultDailyGoal;
      const input = document.getElementById('goal-input');
      if (input) input.value = defaultDailyGoal;
      await apiSetDailyGoal(currentUser.id, defaultDailyGoal);
    }
    if (payload.dailyNewLimit !== undefined) {
      writeDailyNewLimit(payload.dailyNewLimit);
      setNewLimitInputValue(dailyNewLimit);
    }
    const queueRestore = await restoreDailyQueueFromBackup(payload.dailyQueue);
    applyFilters();
    upStats();
    renderDailyGoal();
    renderStatsPage();
    renderList();
    const queueText = queueRestore.restored ? `，今日队列 ${queueRestore.queued} 个待学 / ${queueRestore.completed} 个已完成` : '';
    const failText = failedRows ? `，${failedRows} 条失败` : '';
    showToast(`已导入 ${importedRows}/${rows.length} 条进度${failText}${queueText}`);
  } catch (e) {
    showToast('导入失败：' + (e.message || '无法读取文件'));
  }
}

function renderDailyChart(logs) {
  const max = Math.max(1, ...logs.map(l => l.new_words || 0));
  document.getElementById('daily-chart').innerHTML = `
    <div class="bar-chart">
      ${logs.map(l => {
        const h = Math.max(3, Math.round((l.new_words || 0) / max * 120));
        const d = new Date(l.log_date + 'T00:00:00');
        const label = (d.getMonth() + 1) + '/' + d.getDate();
        return `<div class="day-bar" title="${label}: ${l.new_words || 0}个任务">
          <div style="font-size:10px;color:var(--text2)">${l.new_words || ''}</div>
          <div class="day-fill" style="height:${h}px;background:${l.completed ? 'var(--green)' : 'var(--blue)'}"></div>
          <div class="day-label">${label}</div>
        </div>`;
      }).join('')}
    </div>`;
}

function renderCategoryMastery() {
  const groups = {};
  getLearningCollectionWords(W).forEach(w => {
    const cat = normalizeCategory(w.cat);
    if (!groups[cat]) groups[cat] = { total: 0, mastered: 0, learning: 0 };
    groups[cat].total++;
    const lv = getStoredLevel(getProgress(w.ro));
    if (lv === 'mastered') groups[cat].mastered++;
    if (lv === 'learning') groups[cat].learning++;
  });

  const rows = Object.entries(groups)
    .map(([cat, v]) => ({ cat, ...v, pct: v.total ? Math.round(v.mastered / v.total * 100) : 0 }))
    .sort((a, b) => categoryRank(a.cat) - categoryRank(b.cat) || b.pct - a.pct || b.mastered - a.mastered)
    .slice(0, 16);

  document.getElementById('cat-mastery').innerHTML = rows.length ? rows.map(r => `
    <div class="cat-row">
      <div style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(getCategoryLabel(r.cat))}</div>
      <div class="cat-meter"><div class="cat-fill" style="width:${r.pct}%"></div></div>
      <div style="text-align:right;color:var(--text2)">${r.pct}%</div>
    </div>`).join('') : '<div class="empty-state">还没有主题数据</div>';
}

function renderHardestWords() {
  const el = document.getElementById('hardest-words');
  if (!el) return;
  const rows = getDifficultWords(getLearningCollectionWords(W)).slice(0, 8);
  el.innerHTML = rows.length ? rows.map(w => {
    const s = getDifficultScore(w);
    const rate = Math.round(s.rate * 100);
    const p = getProgress(w.ro) || {};
    return `<div class="hard-row">
      <div class="hard-main">
        <div class="hard-word">${escapeHtml(w.zh || '')} · ${escapeHtml(w.ro || '')}</div>
        <div class="hard-meta">${escapeHtml(getClassificationSummary(w, { includeUnit: true }))} · 累计答错 ${s.wrong} 次 · 连续答错 ${s.streak}</div>
      </div>
      <div class="hard-score">错误率 ${rate}%</div>
    </div>`;
  }).join('') : '<div class="empty-state">暂时没有薄弱词记录</div>';
}

async function renderLeaderboard() {
  const el = document.getElementById('leaderboard-list');
  if (isOfflineMode()) {
    el.innerHTML = '<div class="empty-state">班级排行需要登录后查看；本机学习数据不会参与排名。</div>';
    return;
  }
  el.innerHTML = '<div class="empty-state">加载中...</div>';

  try {
    const [usersResult, rowsResult, logsResult] = await Promise.allSettled([
      apiLoadLeaderboardUsers(),
      apiLoadAllProgress(),
      apiGetClassRecentLogs(30)
    ]);
    const failures = [];
    if (usersResult.status === 'rejected') failures.push('profiles: ' + usersResult.reason.message);
    if (rowsResult.status === 'rejected') failures.push('progress: ' + rowsResult.reason.message);
    if (logsResult.status === 'rejected') failures.push('daily_log: ' + logsResult.reason.message);
    if (usersResult.status === 'rejected' || rowsResult.status === 'rejected') {
      throw new Error(failures.join('；'));
    }

    const users = usersResult.value;
    const rows = rowsResult.value;
    const logs = logsResult.status === 'fulfilled' ? logsResult.value : [];
    const byUser = {};
    rows.forEach(r => {
      if (!byUser[r.user_id]) byUser[r.user_id] = {};
      const key = r.word_id ? String(r.word_id) : progressFallbackKey(r.word_ro, r);
      byUser[r.user_id][key] = rowToProgress(r);
    });
    const logsByUser = {};
    logs.forEach(l => {
      if (!logsByUser[l.user_id]) logsByUser[l.user_id] = [];
      logsByUser[l.user_id].push(l);
    });

    const leaderboard = users.map(u => {
      const s = calcProgressSummary(byUser[u.id] || {});
      return {
        id: u.id,
        email: u.email || '',
        isFounder: typeof isFounderAccount === 'function' && isFounderAccount(u),
        name: u.nickname || (u.email ? u.email.split('@')[0] : '同学'),
        ...s,
        streak: calcStreak(logsByUser[u.id] || [])
      };
    }).sort((a, b) =>
      b.mastered - a.mastered ||
      b.accuracy - a.accuracy ||
      b.known - a.known ||
      b.qt - a.qt
    );

    el.innerHTML = leaderboard.length ? leaderboard.map((u, i) => `
      <div class="rank-row${u.id === currentUser.id ? ' me' : ''}">
        <div class="rank-no">${i + 1}</div>
        <div>
          <div class="rank-name">${escapeHtml(u.name)}${u.id === currentUser.id ? ' · 我' : ''}${u.isFounder && typeof founderBadgeHtml === 'function' ? ' ' + founderBadgeHtml() : ''}</div>
          <div class="rank-meta">正确率 ${u.accuracy}% · 连续 ${u.streak} 天 · 练习 ${u.qt} 次</div>
        </div>
        <div class="rank-score"><strong>${u.mastered}</strong>已掌握</div>
      </div>`).join('') : '<div class="empty-state">暂时没有排行榜数据</div>';
    if (leaderboard.length) {
      el.innerHTML += `<div class="empty-state" style="padding:10px;font-size:12px">已刷新：${new Date().toLocaleTimeString('zh', { hour: '2-digit', minute: '2-digit' })} · 读取 ${rows.length} 条练习记录</div>`;
    }
    if (logsResult.status === 'rejected') {
      el.innerHTML += `<div class="empty-state">连续学习天数暂时无法读取：${escapeHtml(logsResult.reason.message)}</div>`;
    }
  } catch (e) {
    el.innerHTML = `<div class="empty-state">排行榜暂时无法读取：${escapeHtml(e.message || '未知错误')}</div>`;
  }
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

function encodedArg(s) {
  return encodeURIComponent(String(s || '')).replace(/'/g, '%27');
}

function openCurrentWordDetail() {
  const w = getCurrentFlashWord();
  if (w) openWordDetail(w.ro);
}

function openWordDetail(wordRo) {
  const w = getWordByRo(wordRo);
  if (!w) { showToast('找不到该词条'); return; }
  detailWordRo = w.ro;
  renderWordDetail(w);
  document.getElementById('word-detail-modal').style.display = 'flex';
}

function closeWordDetail() {
  document.getElementById('word-detail-modal').style.display = 'none';
  detailWordRo = null;
}

function renderWordDetail(w) {
  const p = getProgress(w.ro) || {};
  const s = getDifficultScore(w);
  const stress = getStressDisplay(w);
  const example = getSyncExampleSentence(w);
  const canQueue = isUnseenWord(w) && !(roListIncludes(todayQueue, w.ro) && !setHasRo(todayQueueCompleted, w.ro));
  const hasProgress = hasWordProgress(p);
  const grammar = getGrammarInfo(w);
  const auxiliaryLabels = getAuxiliaryLabels(w);
  const detailCells = [
    ['主题', getTopicLabel(w.topic || w.cat)],
    ['词性', getPartOfSpeechLabel(normalizePartOfSpeech(w.part_of_speech, w))],
    ['词汇单位', getUnitTypeLabel(normalizeUnitType(w.unit_type, w, w.part_of_speech))],
    ['语法', `${grammar}${stress.auto ? ' · 自动重音待校对' : ''}`],
    ...(w.cefr ? [['CEFR', w.cefr]] : []),
    ...(w.register ? [['语域', getRegisterLabel(w.register)]] : []),
    ...(hasProgress
      ? [
          ['学习状态', getLevelLabel(w.ro)],
          ...(p.nextReviewAt ? [['下次复习', formatReviewDue(p.nextReviewAt)]] : []),
          ...((p.qt || 0) > 0 ? [['练习记录', `正确 ${p.qr || 0}/${p.qt || 0}${s.wrong ? ` · 答错 ${s.wrong}` : ''}${s.streak ? ` · 连错 ${s.streak}` : ''}`]] : [])
        ]
      : [['学习状态', '尚未开始学习']]),
    ...(auxiliaryLabels.length ? [['当前任务', auxiliaryLabels.join(' · ')]] : [])
  ];
  document.getElementById('word-detail-body').innerHTML = `
    <div class="detail-head">
      <div class="detail-zh">${escapeHtml(w.zh || '')}</div>
      <div class="detail-ro">${escapeHtml(w.ro || '')}</div>
      <div class="detail-label" style="margin-top:6px">重音标记</div>
      <div class="card-stress-word" style="font-size:24px">${stressToHtml(stress.text)}</div>
      ${isWordUnverified(w) ? '<span class="unverified-badge" style="width:max-content">未核对</span>' : ''}
    </div>
    <div class="detail-grid">
      ${detailCells.map(([label, value]) => `<div class="detail-chip"><div class="detail-label">${escapeHtml(label)}</div><div class="detail-value">${escapeHtml(value)}</div></div>`).join('')}
    </div>
    <div class="detail-chip" style="${example ? '' : 'display:none'}">
      <div class="detail-label">例句</div>
      <div class="detail-value" id="detail-example">${exampleHtml(example)}</div>
    </div>
    <div class="detail-actions">
      <button class="btn-sm" onclick="speakDetailWord(1)">正常播放</button>
      <button class="btn-sm" onclick="speakDetailWord(0.45)">慢速播放</button>
      ${canQueue ? `<button class="btn-sm" style="border-color:var(--blue);color:var(--blue-text)" onclick="closeWordDetail();addWordToTodayQueue(decodeURIComponent('${encodedArg(w.ro)}'))">加入今日</button>` : ''}
      <button class="btn-sm" onclick="closeWordDetail();switchPage('quiz')">去测验</button>
    </div>`;
}

function buildExampleSentence(w) {
  const ro = String(w?.ro || '').trim();
  const zh = String(w?.zh || '').trim();
  const savedRo = String(w?.example_ro || w?.exampleRo || w?.sentence_ro || '').trim();
  const savedZh = String(w?.example_zh || w?.exampleZh || w?.sentence_zh || '').trim();
  if (savedRo) return { ro: savedRo, zh: savedZh };
  return null;
}

function getSyncExampleSentence(w) {
  return getPrimaryExampleSentence(w);
}

function getPrimaryExampleSentence(w) {
  return getPrimaryLocalExample(w) || buildExampleSentence(w) || getDirectCorpusExample(w?.ro);
}

function renderFrontExampleRecall(id, w, example) {
  const el = document.getElementById(id);
  if (!el) return;
  if (!w || !example?.zh) {
    el.style.display = 'none';
    el.innerHTML = '';
    return;
  }
  const cloze = buildChineseCloze(example.zh, w.zh);
  if (!cloze) {
    el.style.display = 'none';
    el.innerHTML = '';
    return;
  }
  el.style.display = '';
  el.innerHTML = `
    <div class="front-recall-label">语境提示</div>
    <div class="front-recall-zh">${escapeHtml(cloze)}</div>
    <div class="front-recall-cloze">请用罗语补全空格</div>`;
}

function buildChineseCloze(sentence, gloss) {
  const text = String(sentence || '').trim();
  const candidates = String(gloss || '')
    .split(/[；;、/，,（）()]+/)
    .map(value => value.trim())
    .filter(value => value.length >= 1)
    .sort((a, b) => b.length - a.length);
  const match = candidates.find(candidate => text.includes(candidate));
  if (!text || !match) return '';
  return text.replace(match, '____');
}

function hashText(value) {
  return [...String(value || '')].reduce((hash, ch) => ((hash << 5) - hash + ch.charCodeAt(0)) | 0, 0);
}

function getLocalExample(w) {
  const ro = String(w?.ro || '').trim();
  const examples = getExampleBankEntries(ro);
  if (!Array.isArray(examples) || !examples.length) return null;
  const selected = examples[Math.abs(hashText(`${ro}:${idx}:${flashMode}`)) % examples.length];
  if (!selected?.ro) return null;
  return {
    ro: selected.ro,
    zh: selected.zh || '',
    source: selected.source || 'local corpus'
  };
}

function getPrimaryLocalExample(w) {
  const ro = String(w?.ro || '').trim();
  const examples = getExampleBankEntries(ro);
  const selected = Array.isArray(examples) ? examples.find(item => item?.ro) : null;
  if (!selected?.ro) return null;
  return {
    ro: selected.ro,
    zh: selected.zh || '',
    source: selected.source || 'local corpus'
  };
}

function getDirectCorpusExample(wordRo) {
  for (const key of getRoAliasKeys(wordRo)) {
    const example = CORPUS_EXAMPLES[key] || CORPUS_EXAMPLES[lowerRo(key)];
    if (example) return example;
  }
  return null;
}

function getExampleBankEntries(wordRo) {
  const keys = getRoAliasKeys(wordRo);
  for (const key of keys) {
    const direct = exampleBank[key] || exampleBank[lowerRo(key)];
    if (Array.isArray(direct) && direct.length) return direct;
  }
  return null;
}

function renderExampleBlock(id, example) {
  const el = document.getElementById(id);
  if (!el) return;
  const block = el.closest('.card-example');
  if (block) block.style.display = example ? '' : 'none';
  el.innerHTML = example ? exampleHtml(example) : '';
}

function exampleHtml(example) {
  if (!example) return '';
  const source = example.source ? `<div class="example-source">来源：${escapeHtml(example.source)}</div>` : '';
  const zh = example.zh ? `<div class="example-zh">${escapeHtml(example.zh)}</div>` : '<div class="example-zh">暂无中文翻译</div>';
  return `<div class="example-ro">${escapeHtml(example.ro || '')}</div>
    ${zh}
    ${source}`;
}

async function hydrateCorpusExample(id, w, stillCurrent) {
  const example = await getCorpusExample(w);
  if (!example || (stillCurrent && !stillCurrent())) return;
  renderExampleBlock(id, example);
}

async function getCorpusExample(w) {
  const ro = String(w?.ro || '').trim();
  if (!ro) return null;
  const local = getLocalExample(w);
  if (local) return local;
  const direct = getDirectCorpusExample(ro);
  if (direct) return direct;
  const key = EXAMPLE_CACHE_PREFIX + lowerRo(ro);
  const cached = readCachedExample(key);
  if (cached) return cached;
  const fetched = await fetchTatoebaExample(ro, w?.zh);
  if (fetched) {
    try { localStorage.setItem(key, JSON.stringify(fetched)); } catch {}
    return fetched;
  }
  return null;
}

function readCachedExample(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.ro ? parsed : null;
  } catch {
    return null;
  }
}

async function fetchTatoebaExample(wordRo, zh) {
  if (!/^https?:|^file:/.test(location.protocol)) return null;
  try {
    const query = encodeURIComponent(wordRo.replace(/^a\s+/i, '').trim());
    const response = await fetch(`https://tatoeba.org/en/api_v0/search?from=ron&query=${query}`, {
      headers: { accept: 'application/json' }
    });
    if (!response.ok) return null;
    const payload = await response.json();
    const rows = Array.isArray(payload?.results) ? payload.results : [];
    const selected = rows
      .map(row => ({ row, score: scoreCorpusSentence(row?.text, wordRo) }))
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score)[0]?.row;
    if (!selected?.text) return null;
    return {
      ro: selected.text,
      zh: getChineseCorpusTranslation(selected),
      source: `Tatoeba #${selected.id || ''}`.trim()
    };
  } catch {
    return null;
  }
}

function scoreCorpusSentence(text, wordRo) {
  const sentence = String(text || '').trim();
  if (!sentence) return 0;
  const words = sentence.split(/\s+/).length;
  const lower = lowerRo(sentence);
  const needle = lowerRo(wordRo).replace(/^a\s+/, '').trim();
  if (!needle || !lower.includes(needle)) return 0;
  if (/^(aceasta|acesta|este|sunt)\b/i.test(sentence)) return 0;
  let score = 10;
  if (words >= 6 && words <= 15) score += 5;
  if (/[?!]$/.test(sentence)) score += 2;
  if (/\b(Ana|Mihai|Radu|Elena|Maria|Marika|noi|voi|ei|ele)\b/i.test(sentence)) score += 3;
  return score;
}

function getChineseCorpusTranslation(row) {
  const groups = Array.isArray(row?.translations) ? row.translations : [];
  for (const group of groups) {
    const direct = (group || []).find(t => ['cmn', 'zho'].includes(t.lang));
    if (direct?.text) return direct.text;
  }
  return '';
}

function speakDetailWord(rate) {
  const w = detailWordRo ? getWordByRo(detailWordRo) : null;
  if (!w || !('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(w.ro);
  u.lang = 'ro-RO';
  u.rate = rate;
  const rv = speechSynthesis.getVoices().find(v => v.lang.startsWith('ro'));
  if (rv) u.voice = rv;
  speechSynthesis.speak(u);
}

function openEditById(id) {
  const word = W.find(w => String(w.id) === String(id));
  if (!word) { showToast('找不到该词条'); return; }
  openEditModal(word);
}

function deleteWordById(id) {
  const word = W.find(w => String(w.id) === String(id));
  if (!word) { showToast('找不到该词条'); return; }
  deleteWord(word.id, word.zh || word.ro || '');
}

// ── 词汇表 ────────────────────────────────────────────────

function listQueueAction(w) {
  if (!isUnseenWord(w)) return '';
  if (!wordMatchesLearningCollection(w, learningCollectionId)) {
    const collection = w.learning_track === 'specialist' ? w.specialist_book : w.learning_track;
    return `<span class="word-queued">请先切换到${escapeHtml(getLearningCollectionLabel(collection))}</span>`;
  }
  if (roListIncludes(todayQueue, w.ro) && !setHasRo(todayQueueCompleted, w.ro)) {
    return '<span class="word-queued">今日队列</span>';
  }
  return `<button class="queue-btn" onclick="addWordToTodayQueue(decodeURIComponent('${encodedArg(w.ro)}'))">加入学习</button>`;
}

function ensureListTaxonomyFilters() {
  const topicSelect = document.getElementById('list-topic-filter');
  const posSelect = document.getElementById('list-pos-filter');
  if (!topicSelect || !posSelect) return;
  const topics = [...new Set(W.map(w => normalizeTopic(w.topic || w.cat)).filter(Boolean))]
    .sort((a, b) => categoryRank(a) - categoryRank(b) || String(a).localeCompare(String(b), 'zh'));
  const partsOfSpeech = [...new Set(W.map(w => normalizePartOfSpeech(w.part_of_speech, w)).filter(Boolean))]
    .sort((a, b) => PARTS_OF_SPEECH.findIndex(item => item.value === a) - PARTS_OF_SPEECH.findIndex(item => item.value === b));
  const signature = `${topics.join('|')}::${partsOfSpeech.join('|')}`;
  if (topicSelect.dataset.signature === signature && posSelect.dataset.signature === signature) return;
  const selectedTopic = topicSelect.value || 'all';
  const selectedPos = posSelect.value || 'all';
  topicSelect.innerHTML = '<option value="all">全部主题</option>' + topics.map(topic =>
    `<option value="${escapeHtml(topic)}">${escapeHtml(getTopicLabel(topic))}</option>`
  ).join('');
  posSelect.innerHTML = '<option value="all">全部词性</option>' + partsOfSpeech.map(pos =>
    `<option value="${escapeHtml(pos)}">${escapeHtml(getPartOfSpeechLabel(pos))}</option>`
  ).join('');
  topicSelect.value = topics.includes(selectedTopic) ? selectedTopic : 'all';
  posSelect.value = partsOfSpeech.includes(selectedPos) ? selectedPos : 'all';
  topicSelect.dataset.signature = signature;
  posSelect.dataset.signature = signature;
}

function scheduleRenderList() {
  listVisibleLimit = 40;
  if (listRenderTimer) clearTimeout(listRenderTimer);
  listRenderTimer = setTimeout(() => {
    listRenderTimer = null;
    renderList();
  }, 120);
}

function resetListPageAndRender() {
  listVisibleLimit = 40;
  renderList();
}

function resetListFilters() {
  const search = document.getElementById('search-input');
  const status = document.getElementById('list-status-filter');
  const collection = document.getElementById('list-collection-filter');
  const topic = document.getElementById('list-topic-filter');
  const pos = document.getElementById('list-pos-filter');
  if (search) search.value = '';
  if (status) status.value = 'all';
  if (collection) collection.value = 'all';
  if (topic) topic.value = 'all';
  if (pos) pos.value = 'all';
  resetListPageAndRender();
  search?.focus();
}

function loadMoreWords() {
  listVisibleLimit += 40;
  renderList();
}

function renderList() {
  const list = document.getElementById('word-list');
  if (!list) return;
  if (!W.length) {
    list.innerHTML = '<div class="empty-state">词库正在加载，请稍候…</div>';
    return;
  }
  ensureListTaxonomyFilters();
  const q = String(document.getElementById('search-input')?.value || '').trim().toLocaleLowerCase('ro');
  const status = document.getElementById('list-status-filter')?.value || 'all';
  const collection = document.getElementById('list-collection-filter')?.value || 'all';
  const topic = document.getElementById('list-topic-filter')?.value || 'all';
  const pos = document.getElementById('list-pos-filter')?.value || 'all';
  const f = W.filter(w => {
    const normalizedTopic = normalizeTopic(w.topic || w.cat);
    const normalizedPos = normalizePartOfSpeech(w.part_of_speech, w);
    const topicLabel = getTopicLabel(normalizedTopic).toLocaleLowerCase('zh');
    const posLabel = getPartOfSpeechLabel(normalizedPos).toLocaleLowerCase('zh');
    const unitLabel = getUnitTypeLabel(normalizeUnitType(w.unit_type, w, normalizedPos)).toLocaleLowerCase('zh');
    const matchesText = !q ||
      String(w.zh || '').toLocaleLowerCase('zh').includes(q) ||
      String(w.ro || '').toLocaleLowerCase('ro').includes(q) ||
      normalizedTopic.toLocaleLowerCase('en').includes(q) ||
      normalizedPos.toLocaleLowerCase('en').includes(q) ||
      topicLabel.includes(q) ||
      posLabel.includes(q) ||
      unitLabel.includes(q);
    const level = getProgressLevel(w.ro);
    const matchesStatus = status === 'all' || level === status || (status === 'learning' && level === 'reinforcing');
    const matchesCollection = collection === 'all' || wordMatchesLearningCollection(w, collection);
    const matchesTopic = topic === 'all' || normalizedTopic === topic;
    const matchesPos = pos === 'all' || normalizedPos === pos;
    return matchesText && matchesStatus && matchesCollection && matchesTopic && matchesPos;
  });
  const editBtns = (w) => userRole === 'admin'
    ? `<details class="word-actions">
         <summary aria-label="词条操作">⋯</summary>
         <div class="word-action-menu">
           <button class="admin-btn edit" onclick="openEditById(${Number(w.id)})">编辑</button>
           <button class="admin-btn revoke" onclick="deleteWordById(${Number(w.id)})">删除</button>
         </div>
       </details>`
    : '';
  const visible = f.slice(0, listVisibleLimit);
  list.innerHTML = visible.map(w => {
    const lv = getProgressLevel(w.ro);
    const stress = getStressDisplay(w);
    const grammar = getGrammarInfo(w);
    return `<div class="word-row">
      <div style="min-width:0">
        <div class="word-zh">${escapeHtml(w.zh)}</div>
        <div class="word-ro">${escapeHtml(w.ro)}</div>
        <div class="word-ipa${isWordUnverified(w) ? ' unverified-text' : ''}">${stressToHtml(stress.text)} · ${escapeHtml(grammar)}${stress.auto ? ' · 自动重音' : ''} ${unverifiedBadgeHtml(w)}</div>
      </div>
      <div class="word-meta">
        <div class="word-cat">${escapeHtml(getTopicLabel(w.topic || w.cat))}</div>
        <div class="word-cat">${escapeHtml(getLearningCollectionLabel(w.learning_track === 'specialist' ? w.specialist_book : w.learning_track))}</div>
        <div class="word-cat">${escapeHtml(getPartOfSpeechLabel(normalizePartOfSpeech(w.part_of_speech, w)))}</div>
        <span style="font-size:10px;padding:2px 7px;border-radius:99px;background:${LEVEL_BG[lv]};color:${LEVEL_TC[lv]};white-space:nowrap">${getLevelLabel(w.ro)}</span>
        <button class="queue-btn" onclick="openWordDetail(decodeURIComponent('${encodedArg(w.ro)}'))">详情</button>
        ${listQueueAction(w)}
        ${editBtns(w)}
      </div>
    </div>`;
  }).join('');
  if (!f.length) {
    list.innerHTML = `<div class="empty-state">没有找到匹配的词汇。<button class="btn-sm" type="button" onclick="resetListFilters()" style="margin-top:10px">清空搜索与筛选</button></div>`;
  }
  const summary = document.getElementById('list-summary');
  if (summary) summary.textContent = f.length ? `找到 ${f.length} 个 · 已显示 ${visible.length}` : '找到 0 个';
  const loadMore = document.getElementById('list-load-more');
  if (loadMore) {
    loadMore.style.display = visible.length < f.length ? 'block' : 'none';
    loadMore.textContent = `再显示 ${Math.min(40, f.length - visible.length)} 条`;
  }
}

function getMissingIpaWords() {
  return W
    .filter(w => !String(w.ipa || '').trim())
    .sort((a, b) => {
      const sa = getDifficultScore(a);
      const sb = getDifficultScore(b);
      return sb.wrong - sa.wrong || sb.streak - sa.streak || String(a.ro).localeCompare(String(b.ro), 'ro');
    });
}

function getVocabularyQualityAudit() {
  const rowsById = new Map();
  const duplicateKeys = new Map();
  W.forEach(word => {
    const key = roKey(word.ro);
    if (!duplicateKeys.has(key)) duplicateKeys.set(key, []);
    duplicateKeys.get(key).push(word);
    const issues = getTaxonomyQualityIssues(word);
    if (issues.length) rowsById.set(String(word.id), { word, issues: [...issues] });
  });
  duplicateKeys.forEach(words => {
    if (words.length < 2) return;
    words.forEach(word => {
      const entry = rowsById.get(String(word.id)) || { word, issues: [] };
      if (!entry.issues.includes('normalized_duplicate')) entry.issues.push('normalized_duplicate');
      rowsById.set(String(word.id), entry);
    });
  });
  const rows = [...rowsById.values()];
  const counts = {};
  rows.forEach(row => row.issues.forEach(issue => { counts[issue] = (counts[issue] || 0) + 1; }));
  return { rows, counts, clean: W.length - rows.length };
}

const QUALITY_ISSUE_LABELS = Object.freeze({
  missing_ro: '缺少罗语',
  missing_zh: '缺少中文',
  missing_stress: '缺少重音',
  missing_grammar: '缺少语法',
  missing_example_ro: '缺少罗语例句',
  missing_example_zh: '缺少中文例句',
  template_row: '模板内容',
  unclassified_topic: '主题待归类',
  unclassified_pos: '词性待核对',
  plural_contradiction: '单复数矛盾',
  needs_review: '待人工核对',
  normalized_duplicate: '规范化重复'
});

function renderVocabularyQualityPanel() {
  const el = document.getElementById('quality-audit-container');
  if (!el) return;
  const audit = getVocabularyQualityAudit();
  if (!audit.rows.length) {
    el.innerHTML = `<div class="admin-chart">
      <div class="admin-chart-title">词库质量门</div>
      <div class="empty-state" style="color:var(--green-text)">已通过：${W.length} 个词条均无模板、主题、词性、重复、格式或例句完整性问题</div>
    </div>`;
    return;
  }
  const summary = Object.entries(audit.counts)
    .sort((a, b) => b[1] - a[1])
    .map(([issue, count]) => `${QUALITY_ISSUE_LABELS[issue] || issue} ${count}`)
    .join(' · ');
  el.innerHTML = `<div class="admin-chart">
    <div class="admin-chart-title">词库质量门 <span style="font-weight:400;color:var(--red-text)">${audit.rows.length} 个词条待处理</span></div>
    <div style="padding:0 0 10px;font-size:12px;color:var(--text2)">${escapeHtml(summary)}</div>
    ${audit.rows.slice(0, 30).map(({ word, issues }) => `<div class="admin-word-row">
      <div>
        <div class="admin-word-name">${escapeHtml(word.zh || word.ro)}</div>
        <div class="admin-word-meta">${escapeHtml(word.ro)} · ${escapeHtml(issues.map(issue => QUALITY_ISSUE_LABELS[issue] || issue).join('、'))}</div>
      </div>
      <button class="admin-btn edit" onclick="openEditById(${Number(word.id)})">修复</button>
    </div>`).join('')}
  </div>`;
}

function getPendingGrammarWords() {
  return W
    .filter(w => /待核对|待补充/.test(getGrammarInfo(w)))
    .sort((a, b) => {
      const sa = getDifficultScore(a);
      const sb = getDifficultScore(b);
      return sb.wrong - sa.wrong || sb.streak - sa.streak || String(a.ro).localeCompare(String(b.ro), 'ro');
    });
}

// ── 报错弹窗（用户） ──────────────────────────────────────

function openReportModal() {
  const w = getCurrentFlashWord();
  if (!w) return;
  document.getElementById('rm-word-zh').textContent = w.zh;
  document.getElementById('rm-word-ro').textContent = w.ro;
  document.getElementById('rm-note').value = '';
  document.getElementById('rm-type').value = 'wrong_zh';
  document.getElementById('report-modal').style.display = 'flex';
}

function closeReportModal() {
  document.getElementById('report-modal').style.display = 'none';
}

async function submitReport() {
  const w = getCurrentFlashWord();
  if (!w) return;
  const btn = document.getElementById('rm-submit');
  btn.disabled = true; btn.textContent = '提交中...';
  try {
    await apiSubmitReport({
      wordId: w.id, wordRo: w.ro, wordZh: w.zh,
      reporterId: currentUser.id, reporterEmail: currentUser.email,
      issueType: document.getElementById('rm-type').value,
      note: document.getElementById('rm-note').value.trim()
    });
    closeReportModal();
    showToast('✅ 报错已提交，感谢反馈！');
  } catch (e) {
    showToast('提交失败：' + e.message);
  }
  btn.disabled = false; btn.textContent = '提交报错';
}

// ── 编辑弹窗（管理员） ────────────────────────────────────

function openEditModal(word, reportId = null) {
  editingWordId = word.id;
  editingReportId = reportId;
  document.getElementById('em-zh').value = word.zh || '';
  document.getElementById('em-ro').value = word.ro || '';
  document.getElementById('em-ipa').value = word.ipa || '';
  document.getElementById('em-hint').value = word.hint || '';
  populateCategoryDatalist();
  document.getElementById('em-topic').value = normalizeTopic(word.topic || word.cat);
  document.getElementById('em-pos').value = normalizePartOfSpeech(word.part_of_speech, word);
  document.getElementById('em-unit').value = normalizeUnitType(word.unit_type, word, word.part_of_speech);
  document.getElementById('em-cefr').value = normalizeCefr(word.cefr);
  document.getElementById('em-register').value = normalizeRegister(word.register);
  const example = getPrimaryExampleSentence(word);
  const roEl = document.getElementById('em-example-ro');
  const zhEl = document.getElementById('em-example-zh');
  const sourceEl = document.getElementById('em-example-source');
  const submitBtn = document.getElementById('em-submit');
  roEl.value = example?.ro || '';
  zhEl.value = example?.zh || '';
  if (sourceEl) {
    sourceEl.textContent = example?.ro
      ? '例句来自云端词库缓存；修改后点击保存，会写回云端词库。'
      : '当前词条还没有例句；填写后点击保存，会写入云端词库。';
  }
  if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '保存修改'; }
  document.getElementById('edit-modal').style.display = 'flex';
  if (!example?.ro && !exampleBankLoaded) {
    const modalWordId = word.id;
    if (sourceEl) sourceEl.textContent = '正在读取云端例句缓存，读取完成后再保存。';
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = '读取例句...'; }
    loadExampleBank().then(() => {
      if (editingWordId !== modalWordId) return;
      const refreshed = getPrimaryExampleSentence(word);
      if (refreshed?.ro && roEl && !roEl.value.trim()) roEl.value = refreshed.ro;
      if (refreshed?.zh && zhEl && !zhEl.value.trim()) zhEl.value = refreshed.zh;
      if (sourceEl) {
        sourceEl.textContent = refreshed?.ro
          ? '例句来自云端词库缓存；修改后点击保存，会写回云端词库。'
          : '当前词条还没有例句；填写后点击保存，会写入云端词库。';
      }
    }).finally(() => {
      if (editingWordId !== modalWordId) return;
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '保存修改'; }
    });
  }
}

function closeEditModal() {
  document.getElementById('edit-modal').style.display = 'none';
  editingWordId = null; editingReportId = null;
}

function hasCjkText(value) {
  return /[\u3400-\u9fff]/.test(String(value || ''));
}

function hasLatinLetter(value) {
  return /[A-Za-zÀ-ž]/.test(String(value || ''));
}

function validateEditUpdates(updates, wordId) {
  const problems = [];
  if (!updates.zh) problems.push('中文不能为空');
  if (!updates.ro) problems.push('罗马尼亚语不能为空');
  if (updates.zh && hasLatinLetter(updates.zh) && !hasCjkText(updates.zh)) {
    problems.push('中文字段看起来不是中文');
  }
  if (updates.ro && hasCjkText(updates.ro)) {
    problems.push('罗马尼亚语字段不能包含中文');
  }
  if (looksLikeTemplateWord(updates)) {
    problems.push('检测到表头或示例模板，请填写真实词条');
  }
  if (updates.topic === 'unclassified') problems.push('请选择明确的语义主题');
  if (updates.part_of_speech === 'other') problems.push('请选择明确的词性');
  if (!updates.unit_type) problems.push('请选择词汇单位');
  if (updates.zh && updates.ro && roKey(updates.zh) === roKey(updates.ro)) {
    problems.push('中文和罗马尼亚语不能相同');
  }
  const duplicate = W.find(w => Number(w.id) !== Number(wordId) && roKey(w.ro) === roKey(updates.ro));
  if (duplicate) problems.push(`罗马尼亚语已存在：${duplicate.zh || duplicate.ro}`);
  if (updates.example_zh && !updates.example_ro) {
    problems.push('填写中文例句时也要填写罗语例句');
  }
  if (updates.example_ro && !updates.example_zh) {
    problems.push('填写罗语例句时也要填写中文例句');
  }
  if (updates.example_ro && hasCjkText(updates.example_ro)) {
    problems.push('罗语例句不能包含中文');
  }
  if (updates.example_ro && !hasLatinLetter(updates.example_ro)) {
    problems.push('罗语例句看起来不是罗马尼亚语句子');
  }
  if (updates.example_zh && hasLatinLetter(updates.example_zh) && !hasCjkText(updates.example_zh)) {
    problems.push('中文例句看起来不是中文');
  }
  return problems;
}

async function saveEdit() {
  const btn = document.getElementById('em-submit');
  btn.disabled = true; btn.textContent = '保存中...';
  const base = {
    zh: document.getElementById('em-zh').value.trim(),
    ro: document.getElementById('em-ro').value.trim(),
    ipa: document.getElementById('em-ipa').value.trim(),
    hint: document.getElementById('em-hint').value.trim(),
    example_ro: document.getElementById('em-example-ro').value.trim(),
    example_zh: document.getElementById('em-example-zh').value.trim(),
  };
  const topic = normalizeTopic(document.getElementById('em-topic').value);
  const partOfSpeech = normalizePartOfSpeech(document.getElementById('em-pos').value, base);
  const unitType = normalizeUnitType(document.getElementById('em-unit').value, base, partOfSpeech);
  const updates = {
    ...base,
    cat: topic,
    topic,
    part_of_speech: partOfSpeech,
    unit_type: unitType,
    grammar_data: normalizeGrammarData(null, base, partOfSpeech),
    cefr: normalizeCefr(document.getElementById('em-cefr').value) || null,
    register: normalizeRegister(document.getElementById('em-register').value) || null,
    verification_status: 'verified',
    source: 'admin_edit'
  };
  const validationProblems = validateEditUpdates(updates, editingWordId);
  if (validationProblems.length) {
    showToast(validationProblems[0]);
    btn.disabled = false; btn.textContent = '保存修改';
    return;
  }
  try {
    await apiUpdateWord(editingWordId, updates);
    if (editingReportId) await apiResolveReport(editingReportId);
    // 更新本地缓存
    const wi = W.findIndex(w => w.id === editingWordId);
    if (wi >= 0) W[wi] = { ...W[wi], ...updates };
    if (updates.ro && updates.example_ro) {
      exampleBank[roKey(updates.ro)] = [{
        ro: updates.example_ro,
        zh: updates.example_zh,
        source: '云端词库例句'
      }];
    }
    rebuildWordRoIndex();
    applyFilters();
    buildCats(); renderCard(); renderList();
    closeEditModal();
    showToast('✅ 修改已保存');
    loadAdminStats();
    if (editingReportId) loadAdminReports();
  } catch (e) {
    showToast('保存失败：' + e.message);
  }
  btn.disabled = false; btn.textContent = '保存修改';
}

// ── 管理员：词库管理 ──────────────────────────────────────

function openAddWordModal() {
  editingPendingWordId = null;
  document.getElementById('aw-title').textContent = '📚 添加词汇';
  document.getElementById('aw-tabs').style.display = 'flex';
  document.getElementById('aw-mode').value = 'single';
  document.getElementById('aw-single').style.display = 'block';
  document.getElementById('aw-bulk').style.display = 'none';
  document.getElementById('aw-zh').value = '';
  document.getElementById('aw-ro').value = '';
  document.getElementById('aw-ipa').value = '';
  document.getElementById('aw-hint').value = '';
  populateCategoryDatalist();
  document.getElementById('aw-topic').value = 'daily_life';
  document.getElementById('aw-pos').value = 'noun';
  document.getElementById('aw-unit').value = 'word';
  document.getElementById('aw-cefr').value = '';
  document.getElementById('aw-register').value = '';
  document.getElementById('aw-example-ro').value = '';
  document.getElementById('aw-example-zh').value = '';
  document.getElementById('aw-bulk-text').value = '';
  document.getElementById('aw-result').textContent = '';
  document.getElementById('aw-submit').textContent = '提交审核';
  document.getElementById('add-word-modal').style.display = 'flex';
}

function closeAddWordModal() {
  document.getElementById('add-word-modal').style.display = 'none';
  editingPendingWordId = null;
  document.getElementById('aw-title').textContent = '📚 添加词汇';
  document.getElementById('aw-tabs').style.display = 'flex';
  document.getElementById('aw-submit').disabled = false;
  document.getElementById('aw-submit').textContent = '提交审核';
}

function switchAddMode(mode) {
  document.getElementById('aw-mode').value = mode;
  document.getElementById('aw-single').style.display = mode === 'single' ? 'block' : 'none';
  document.getElementById('aw-bulk').style.display = mode === 'bulk' ? 'block' : 'none';
  document.querySelectorAll('.aw-tab').forEach((b, i) =>
    b.classList.toggle('active', (i === 0 && mode === 'single') || (i === 1 && mode === 'bulk'))
  );
  document.getElementById('aw-result').textContent = '';
}

async function submitAddWord() {
  const mode = document.getElementById('aw-mode').value;
  const btn = document.getElementById('aw-submit');
  populateCategoryDatalist();
  const editingPending = editingPendingWordId !== null;
  btn.disabled = true; btn.textContent = editingPending ? '保存中...' : '提交中...';

  try {
    let words = [];
    if (mode === 'single') {
      const zh = document.getElementById('aw-zh').value.trim();
      const ro = document.getElementById('aw-ro').value.trim();
      const exampleRo = document.getElementById('aw-example-ro').value.trim();
      const exampleZh = document.getElementById('aw-example-zh').value.trim();
      if (!ro || (!zh && !exampleRo)) { showToast('请填写罗语；新词需要中文，已有词补例句需要罗语例句'); btn.disabled = false; btn.textContent = editingPending ? '保存修改' : '提交审核'; return; }
      const base = {
        zh, ro,
        ipa: document.getElementById('aw-ipa').value.trim(),
        hint: document.getElementById('aw-hint').value.trim(),
        example_ro: exampleRo,
        example_zh: exampleZh
      };
      const topic = normalizeTopic(document.getElementById('aw-topic').value);
      const partOfSpeech = normalizePartOfSpeech(document.getElementById('aw-pos').value, base);
      const unitType = normalizeUnitType(document.getElementById('aw-unit').value, base, partOfSpeech);
      words = [{
        ...base,
        cat: topic,
        topic,
        part_of_speech: partOfSpeech,
        unit_type: unitType,
        grammar_data: normalizeGrammarData(null, base, partOfSpeech),
        cefr: normalizeCefr(document.getElementById('aw-cefr').value) || null,
        register: normalizeRegister(document.getElementById('aw-register').value) || null,
        verification_status: 'needs_review',
        source: 'admin_submission'
      }];
    } else {
      // 新格式：中文|罗马尼亚语|重音|语法原文|主题|词性|词汇单位|罗语例句|中文例句
      // 仍兼容旧 7 列格式，但会把旧分类仅映射到主题，词性和单位由内容推导。
      const lines = document.getElementById('aw-bulk-text').value.trim().split('\n')
        .map(l => l.trim())
        .filter(l => l && !l.startsWith('#'));
      words = lines.map(line => {
        const parts = line.split('|').map(s => s.trim());
        const modern = parts.length >= 9;
        const exampleIndex = modern ? 7 : 5;
        const existingExampleOnly = parts[0] && !parts[1] && !parts[2] && !parts[3] && !parts[4] && parts[exampleIndex];
        const base = {
          zh: existingExampleOnly ? '' : (parts[0] || ''),
          ro: existingExampleOnly ? parts[0] : (parts[1] || ''),
          ipa: parts[2] || '',
          hint: parts[3] || '',
          example_ro: parts[exampleIndex] || '',
          example_zh: parts[exampleIndex + 1] || ''
        };
        const topic = normalizeTopic(parts[4], base);
        const partOfSpeech = normalizePartOfSpeech(modern ? parts[5] : '', { ...base, rawCat: modern ? '' : parts[4] });
        const unitType = normalizeUnitType(modern ? parts[6] : '', base, partOfSpeech);
        return {
          ...base,
          cat: topic,
          topic,
          part_of_speech: partOfSpeech,
          unit_type: unitType,
          grammar_data: normalizeGrammarData(null, base, partOfSpeech),
          cefr: null,
          register: null,
          verification_status: 'needs_review',
          source: 'admin_bulk_submission'
        };
      }).filter(w => w.ro && (w.zh || w.example_ro));
      if (!words.length) { showToast('没有解析到有效词汇，请检查格式'); btn.disabled = false; btn.textContent = editingPending ? '保存修改' : '提交审核'; return; }
    }

    const invalid = words.flatMap((word, index) => {
      const exampleOnly = !word.zh && !!word.example_ro;
      const problems = [];
      if (looksLikeTemplateWord(word)) problems.push('检测到表头或模板内容');
      if (!exampleOnly && word.topic === 'unclassified') problems.push('缺少明确主题');
      if (!exampleOnly && word.part_of_speech === 'other') problems.push('缺少明确词性');
      if (!exampleOnly && !word.ipa) problems.push('缺少重音标记');
      if (!exampleOnly && !word.hint) problems.push('缺少语法信息');
      if (word.example_ro && !word.example_zh) problems.push('罗语例句缺少中文翻译');
      if (word.example_zh && !word.example_ro) problems.push('中文例句缺少罗语原句');
      if (word.ro && hasCjkText(word.ro)) problems.push('罗语字段包含中文');
      return problems.map(problem => `第 ${index + 1} 条：${problem}`);
    });
    if (invalid.length) {
      showToast(invalid[0]);
      document.getElementById('aw-result').textContent = `❌ ${invalid.slice(0, 3).join('；')}`;
      document.getElementById('aw-result').style.color = 'var(--red-text)';
      btn.disabled = false;
      btn.textContent = editingPending ? '保存修改' : '提交审核';
      return;
    }

    if (editingPending) {
      await apiUpdatePendingWord(editingPendingWordId, words[0]);
      document.getElementById('aw-result').textContent = '✅ 已保存到当前审核项';
      document.getElementById('aw-result').style.color = 'var(--green-text)';
      showToast('✅ 已修改当前审核项');
      closeAddWordModal();
      await loadAdminPendingWords();
      await refreshAdminBadge();
      loadAdminStats();
      return;
    }

    const { submitted } = await apiSubmitWordsForReview(words, currentUser);

    const msg = `✅ 已提交 ${submitted} 个词，等待审核通过后进入正式词库`;
    const missingIpa = words.filter(w => !String(w.ipa || '').trim()).length;
    document.getElementById('aw-result').textContent = msg;
    document.getElementById('aw-result').style.color = 'var(--green-text)';
    showToast(missingIpa ? `${msg}；其中 ${missingIpa} 个缺少音标` : msg);
    await loadAdminPendingWords();
    await refreshAdminBadge();
    loadAdminStats();

    if (mode === 'single') {
      // 单条模式清空表单，方便继续添加
      document.getElementById('aw-zh').value = '';
      document.getElementById('aw-ro').value = '';
      document.getElementById('aw-ipa').value = '';
      document.getElementById('aw-hint').value = '';
      document.getElementById('aw-example-ro').value = '';
      document.getElementById('aw-example-zh').value = '';
    }
  } catch (e) {
    document.getElementById('aw-result').textContent = '❌ 失败：' + e.message;
    document.getElementById('aw-result').style.color = 'var(--red-text)';
  }
  btn.disabled = false; btn.textContent = editingPending ? '保存修改' : '提交审核';
}

// 从词汇表删除词条（管理员）
async function deleteWord(wordId, wordZh) {
  if (!confirm(`确定删除「${wordZh}」吗？此操作不可撤销。`)) return;
  try {
    await apiDeleteWord(wordId);
    W = W.filter(w => w.id !== wordId);
    rebuildWordRoIndex();
    applyFilters();
    updateVocabCountLabels();
    buildCats(); renderCard(); renderList(); loadAdminStats();
    showToast(`✅ 已删除「${wordZh}」`);
  } catch (e) {
    showToast('删除失败：' + e.message);
  }
}

// ── 管理员：词库统计 ──────────────────────────────────────

async function loadAdminStats() {
  const el = document.getElementById('admin-stats-container');
  if (!el) return;
  el.innerHTML = '<div class="empty-state">加载中...</div>';

  try {
    const [reportsResult, progressResult, pendingWordsResult, clientEventsResult] = await Promise.allSettled([
      apiLoadReports(),
      apiLoadAllProgress(),
      apiLoadPendingWords(),
      apiLoadClientEventSummary(7)
    ]);
    const reports = reportsResult.status === 'fulfilled' ? reportsResult.value : [];
    const allProgress = progressResult.status === 'fulfilled' ? progressResult.value : [];
    const pendingWords = pendingWordsResult.status === 'fulfilled' ? pendingWordsResult.value : [];
    const clientEvents = clientEventsResult.status === 'fulfilled' ? clientEventsResult.value : [];
    const categoryStats = getAdminCategoryStats();
    const reportStats = getAdminReportStats(reports);
    const wrongStats = getAdminWrongStats(allProgress);
    const missingIpaWords = getMissingIpaWords();
    const qualityAudit = getVocabularyQualityAudit();
    const pendingGrammarWords = getPendingGrammarWords();
    const pendingReports = reports.filter(r => r.status === 'pending').length;
    const pendingWordCount = pendingWords.filter(r => r.status === 'pending').length;
    const totalAnswers = allProgress.reduce((sum, r) => sum + (r.quiz_total || 0), 0);

    el.innerHTML = `
      <div class="admin-stat-grid">
        <div class="admin-stat"><div class="admin-stat-n">${W.length}</div><div class="admin-stat-l">词库总量</div></div>
        <div class="admin-stat"><div class="admin-stat-n">${categoryStats.length}</div><div class="admin-stat-l">主题数量</div></div>
        <div class="admin-stat"><div class="admin-stat-n">${pendingWordCount}</div><div class="admin-stat-l">待审核新词</div></div>
        <div class="admin-stat"><div class="admin-stat-n">${pendingReports}</div><div class="admin-stat-l">待处理报错</div></div>
        <div class="admin-stat"><div class="admin-stat-n">${missingIpaWords.length}</div><div class="admin-stat-l">待校对音标</div></div>
        <div class="admin-stat"><div class="admin-stat-n">${qualityAudit.rows.length}</div><div class="admin-stat-l">质量问题词条</div></div>
      </div>
      <div class="admin-chart">
        <div class="admin-chart-title">各主题词汇数量</div>
        ${renderAdminCategoryRows(categoryStats)}
      </div>
      <div class="admin-chart">
        <div class="admin-chart-title">被报错最多的词</div>
        ${reportsResult.status === 'fulfilled' ? renderAdminReportRows(reportStats) : `<div class="empty-state">报错记录无法读取：${escapeHtml(reportsResult.reason.message)}</div>`}
      </div>
      <div class="admin-chart">
        <div class="admin-chart-title">答错率最高的词 <span style="font-weight:400;color:var(--text2)">共 ${totalAnswers} 次练习记录</span></div>
        ${progressResult.status === 'fulfilled' ? renderAdminWrongRows(wrongStats) : `<div class="empty-state">答题记录无法读取：${escapeHtml(progressResult.reason.message)}</div>`}
      </div>
      <div class="admin-chart">
        <div class="admin-chart-title">最近 7 天客户端故障</div>
        ${clientEventsResult.status === 'fulfilled' ? renderClientEventRows(clientEvents) : `<div class="empty-state">故障汇总无法读取：${escapeHtml(clientEventsResult.reason.message)}</div>`}
      </div>`;
    renderVocabularyQualityPanel();
    renderMissingIpaPanel();
    renderPendingWordsPanel(pendingWords);
    renderPendingGrammarPanel();
  } catch (e) {
    el.innerHTML = `<div class="empty-state">词库统计加载失败：${escapeHtml(e.message || '未知错误')}</div>`;
    renderVocabularyQualityPanel();
    renderMissingIpaPanel();
    loadAdminPendingWords();
    renderPendingGrammarPanel();
  }
}

function renderClientEventRows(rows = []) {
  if (!rows.length) return '<div class="empty-state">最近 7 天没有收到客户端故障</div>';
  return rows.slice(0, 12).map(row => {
    const lastSeen = row.last_seen ? new Date(row.last_seen).toLocaleString('zh') : '未知';
    return `<div class="admin-word-row">
      <div>
        <div class="admin-word-name">${escapeHtml(row.event_type)}</div>
        <div class="admin-word-meta">影响 ${Number(row.affected_users || 0)} 位用户 · 最近 ${escapeHtml(lastSeen)} · ${escapeHtml(row.app_version || 'unknown')}</div>
      </div>
      <div class="admin-word-score">${Number(row.event_count || 0)}次</div>
    </div>`;
  }).join('');
}

function renderMissingIpaPanel() {
  const el = document.getElementById('missing-ipa-container');
  if (!el) return;
  const rows = getMissingIpaWords();
  if (!rows.length) {
    el.innerHTML = '<div class="empty-state">暂无待校对音标</div>';
    return;
  }
  el.innerHTML = `
    <div class="admin-chart">
      <div class="admin-chart-title">待校对音标 <span style="font-weight:400;color:var(--text2)">显示前 20 个 / 共 ${rows.length} 个</span></div>
      ${rows.slice(0, 20).map(w => {
        const stress = getStressDisplay(w);
        return `<div class="admin-word-row">
          <div>
            <div class="admin-word-name">${escapeHtml(w.zh || w.ro)}</div>
            <div class="admin-word-meta">${escapeHtml(w.ro)} · 自动推测：${stressToHtml(stress.text)} · ${escapeHtml(getGrammarInfo(w))} · ${escapeHtml(getClassificationSummary(w))}</div>
          </div>
          <div class="admin-word-actions">
            <button class="admin-btn edit" onclick="openEditById(${Number(w.id)})">补音标</button>
          </div>
        </div>`;
      }).join('')}
    </div>`;
}

async function loadAdminPendingWords() {
  const el = document.getElementById('pending-words-container');
  if (!el) return;
  el.innerHTML = '<div class="empty-state">加载中...</div>';
  try {
    const rows = await apiLoadPendingWords();
    renderPendingWordsPanel(rows);
  } catch (e) {
    const badge = document.getElementById('pending-word-count-badge');
    const approveAllBtn = document.getElementById('pending-approve-all-btn');
    if (badge) badge.textContent = '';
    if (approveAllBtn) approveAllBtn.style.display = 'none';
    el.innerHTML = `<div class="empty-state">词汇审核加载失败：${escapeHtml(e.message || '未知错误')}<br><span style="font-size:12px">如果还没建表，请在 Supabase 运行 tools/pending_words_schema.sql。</span></div>`;
  }
}

function renderPendingWordsPanel(rows = []) {
  const el = document.getElementById('pending-words-container');
  const badge = document.getElementById('pending-word-count-badge');
  const approveAllBtn = document.getElementById('pending-approve-all-btn');
  if (!el) return;
  const pending = rows.filter(r => r.status === 'pending');
  const reviewed = rows.filter(r => r.status && r.status !== 'pending').slice(0, 20);
  if (badge) badge.textContent = pending.length ? `(${pending.length}条待审核)` : '';
  if (approveAllBtn) approveAllBtn.style.display = pending.length ? '' : 'none';
  if (!rows.length) {
    el.innerHTML = '<div class="empty-state">暂无词汇审核记录</div>';
    return;
  }
  el.innerHTML = [...pending, ...reviewed].map(row => renderPendingWordRow(row)).join('');
}

function renderPendingWordRow(row) {
  const isPending = row.status === 'pending';
  const statusText = { pending: '待审核', approved: '已通过', rejected: '已拒绝' }[row.status] || row.status || '待审核';
  const submittedAt = row.created_at ? new Date(row.created_at).toLocaleDateString('zh') : '';
  return `
    <div class="report-row" style="${isPending ? '' : 'opacity:0.55'}">
      <div class="report-word">${escapeHtml(row.zh || '补例句')} → ${escapeHtml(row.ro || '')}
        <span class="issue-tag">${escapeHtml(statusText)}</span>
      </div>
      <div class="report-meta">提交：${escapeHtml(row.submitted_email || '未知管理员')}${submittedAt ? ` · ${submittedAt}` : ''}</div>
      <div class="pending-word-grid">
        <div class="pending-word-cell"><div class="pending-word-label">重音</div><div class="pending-word-value">${escapeHtml(row.ipa || '未填写')}</div></div>
        <div class="pending-word-cell"><div class="pending-word-label">主题</div><div class="pending-word-value">${escapeHtml(getTopicLabel(normalizeTopic(row.topic || row.cat)))}</div></div>
        <div class="pending-word-cell"><div class="pending-word-label">词性</div><div class="pending-word-value">${escapeHtml(getPartOfSpeechLabel(normalizePartOfSpeech(row.part_of_speech, row)))}</div></div>
        <div class="pending-word-cell"><div class="pending-word-label">词汇单位</div><div class="pending-word-value">${escapeHtml(getUnitTypeLabel(normalizeUnitType(row.unit_type, row, row.part_of_speech)))}</div></div>
        <div class="pending-word-cell"><div class="pending-word-label">语法</div><div class="pending-word-value">${escapeHtml(row.hint || '未填写')}</div></div>
        <div class="pending-word-cell"><div class="pending-word-label">例句</div><div class="pending-word-value">${escapeHtml(row.example_ro || '未填写')}${row.example_zh ? `<br>${escapeHtml(row.example_zh)}` : ''}</div></div>
      </div>
      ${isPending ? `<div class="report-actions">
        <button class="admin-btn approve" onclick="approvePendingWord(${Number(row.id)})">✓ 通过并入库</button>
        <button class="admin-btn edit" onclick="editPendingWord(${Number(row.id)})">修改</button>
        <button class="admin-btn revoke" onclick="rejectPendingWord(${Number(row.id)})">拒绝</button>
      </div>` : ''}
    </div>`;
}

async function approvePendingWord(rowId) {
  try {
    const rows = await apiLoadPendingWords();
    const row = rows.find(r => Number(r.id) === Number(rowId));
    if (!row) { showToast('找不到待审核词汇'); return; }
    const result = await apiApprovePendingWord(row);
    W = (await apiLoadWords({ preferCloud: true })).map(normalizeWordCategory).filter(word => !looksLikeTemplateWord(word));
    rebuildWordRoIndex();
    applyFilters();
    updateVocabCountLabels();
    buildCats(); renderCard(); renderList();
    await loadAdminPendingWords();
    await refreshAdminBadge();
    loadAdminStats();
    const schemaMsg = result.exampleSchemaMissing ? '；例句字段还没建，例句未保存' : '';
    const duplicateMsg = result.inserted
      ? ''
      : (result.updatedExamples ? '；重复词已补充例句' : '；重复词已保留原词库内容');
    showToast(`✅ 已通过「${row.zh || row.ro}」${duplicateMsg}${schemaMsg}`);
  } catch (e) {
    showToast('审核失败：' + e.message);
  }
}

async function approveAllPendingWords() {
  try {
    const rows = await apiLoadPendingWords();
    const pending = rows.filter(r => r.status === 'pending');
    if (!pending.length) { showToast('没有待审核词汇'); return; }
    if (!confirm(`确定一次通过 ${pending.length} 条待审核词汇吗？通过后会进入正式词库。`)) return;
    const btn = document.getElementById('pending-approve-all-btn');
    if (btn) { btn.disabled = true; btn.textContent = '处理中...'; }
    const result = await apiApprovePendingWords(pending);
    W = (await apiLoadWords({ preferCloud: true })).map(normalizeWordCategory).filter(word => !looksLikeTemplateWord(word));
    rebuildWordRoIndex();
    applyFilters();
    updateVocabCountLabels();
    buildCats(); renderCard(); renderList();
    await loadAdminPendingWords();
    await refreshAdminBadge();
    loadAdminStats();
    const schemaMsg = result.exampleSchemaMissing ? '；例句字段还没建，部分例句未保存' : '';
    const parts = [`新增 ${result.inserted || 0}`];
    if (result.updatedExamples) parts.push(`补例句 ${result.updatedExamples}`);
    const unchanged = Math.max(0, (result.approved || 0) - (result.inserted || 0) - (result.updatedExamples || 0));
    if (unchanged) parts.push(`重复保留 ${unchanged}`);
    showToast(`✅ 已通过 ${result.approved} 条：${parts.join('，')}${schemaMsg}`);
  } catch (e) {
    showToast('批量审核失败：' + e.message);
  } finally {
    const btn = document.getElementById('pending-approve-all-btn');
    if (btn) { btn.disabled = false; btn.textContent = '全部通过'; }
  }
}

async function rejectPendingWord(rowId) {
  if (!confirm('确定拒绝这条词汇提交吗？')) return;
  try {
    await apiRejectPendingWord(rowId);
    await loadAdminPendingWords();
    await refreshAdminBadge();
    loadAdminStats();
    showToast('已拒绝该词汇提交');
  } catch (e) {
    showToast('拒绝失败：' + e.message);
  }
}

async function editPendingWord(rowId) {
  try {
    const rows = await apiLoadPendingWords();
    const row = rows.find(r => Number(r.id) === Number(rowId));
    if (!row) { showToast('找不到待审核词汇'); return; }
    editingPendingWordId = Number(row.id);
    document.getElementById('aw-title').textContent = '📝 修改审核词汇';
    document.getElementById('aw-tabs').style.display = 'none';
    document.getElementById('aw-mode').value = 'single';
    switchAddMode('single');
    document.getElementById('aw-tabs').style.display = 'none';
    document.getElementById('aw-zh').value = row.zh || '';
    document.getElementById('aw-ro').value = row.ro || '';
    document.getElementById('aw-ipa').value = row.ipa || '';
    document.getElementById('aw-hint').value = row.hint || '';
    populateCategoryDatalist();
    document.getElementById('aw-topic').value = normalizeTopic(row.topic || row.cat);
    document.getElementById('aw-pos').value = normalizePartOfSpeech(row.part_of_speech, row);
    document.getElementById('aw-unit').value = normalizeUnitType(row.unit_type, row, row.part_of_speech);
    document.getElementById('aw-cefr').value = normalizeCefr(row.cefr);
    document.getElementById('aw-register').value = normalizeRegister(row.register);
    document.getElementById('aw-example-ro').value = row.example_ro || '';
    document.getElementById('aw-example-zh').value = row.example_zh || '';
    document.getElementById('aw-result').textContent = '保存后会直接修改当前审核项，不会生成新的申请。';
    document.getElementById('aw-result').style.color = 'var(--yellow-text)';
    document.getElementById('aw-submit').textContent = '保存修改';
    document.getElementById('add-word-modal').style.display = 'flex';
  } catch (e) {
    showToast('打开编辑失败：' + e.message);
  }
}

function renderPendingGrammarPanel() {
  const el = document.getElementById('pending-grammar-container');
  if (!el) return;
  const rows = getPendingGrammarWords();
  if (!rows.length) {
    el.innerHTML = '<div class="empty-state">暂无语法待核对词</div>';
    return;
  }
  const nouns = rows.filter(w => getGrammarInfo(w).startsWith('名词'));
  const verbs = rows.filter(w => getGrammarInfo(w).startsWith('动词'));
  const adjectives = rows.filter(w => getGrammarInfo(w).startsWith('形容词'));
  el.innerHTML = `
    <div class="admin-chart">
      <div class="admin-chart-title">待核对队列 <span style="font-weight:400;color:var(--text2)">名词 ${nouns.length} · 动词 ${verbs.length} · 形容词 ${adjectives.length} · 共 ${rows.length}</span></div>
      ${rows.slice(0, 30).map(w => {
        const grammar = getGrammarInfo(w);
        const stress = getStressDisplay(w);
        return `<div class="admin-word-row">
          <div>
            <div class="admin-word-name">${escapeHtml(w.zh || w.ro)}</div>
            <div class="admin-word-meta">${escapeHtml(w.ro)} · ${stressToHtml(stress.text)} · ${escapeHtml(grammar)} · ${escapeHtml(getClassificationSummary(w))}</div>
          </div>
          <div class="admin-word-actions">
            <button class="admin-btn edit" onclick="openEditById(${Number(w.id)})">核对</button>
          </div>
        </div>`;
      }).join('')}
      ${rows.length > 30 ? `<div class="empty-state" style="padding:12px">当前显示前 30 个，保存一个后列表会继续向后补。</div>` : ''}
    </div>`;
}

async function applyStressGrammarPatch() {
  if (userRole !== 'admin') { showToast('只有管理员可以执行补全'); return; }
  const rows = Array.isArray(window.STRESS_GRAMMAR_PATCH) ? window.STRESS_GRAMMAR_PATCH : [];
  const status = document.getElementById('grammar-patch-status');
  if (!rows.length) {
    if (status) status.textContent = '没有找到补全数据文件 stress_grammar_patch.js';
    return;
  }
  const patchById = new Map(rows.map(row => [row.id, row]));
  const pendingRows = W
    .filter(w => patchById.has(w.id))
    .filter(w => {
      const patch = patchById.get(w.id);
      return w.ipa !== patch.ipa || w.hint !== patch.hint;
    })
    .map(w => {
      const patch = patchById.get(w.id);
      const merged = { ...w, ...patch };
      const partOfSpeech = normalizePartOfSpeech(merged.part_of_speech, merged);
      return {
        ...patch,
        grammar_data: normalizeGrammarData(null, merged, partOfSpeech)
      };
    });

  if (!pendingRows.length) {
    if (status) status.textContent = '补全数据已经全部应用。';
    showToast('补全数据已经全部应用');
    return;
  }

  if (status) status.textContent = `准备写入 ${pendingRows.length} 条...`;
  try {
    const done = await apiApplyStressGrammarPatch(pendingRows, (n, total) => {
      if (status) status.textContent = `正在写入 ${n} / ${total} 条...`;
    });
    const byId = new Map(pendingRows.map(row => [row.id, row]));
    W = W.map(w => byId.has(w.id) ? {
      ...w,
      ipa: byId.get(w.id).ipa,
      hint: byId.get(w.id).hint,
      grammar_data: byId.get(w.id).grammar_data
    } : w);
    rebuildWordRoIndex();
    applyFilters();
    renderCard();
    renderList();
    loadAdminStats();
    if (status) status.textContent = `已写入 ${done} 条。现在可以逐条核对“待核对”项。`;
    showToast(`已写入 ${done} 条补全数据`);
  } catch (e) {
    if (status) status.textContent = `写入失败：${e.message}`;
    showToast('写入失败：' + e.message);
  }
}

function getAdminCategoryStats() {
  const map = {};
  W.forEach(w => {
    const cat = normalizeCategory(w.cat);
    map[cat] = (map[cat] || 0) + 1;
  });
  return Object.entries(map)
    .map(([cat, count]) => ({ cat, count }))
    .sort((a, b) => categoryRank(a.cat) - categoryRank(b.cat) || b.count - a.count || a.cat.localeCompare(b.cat, 'en'));
}

function getAdminReportStats(reports) {
  const map = {};
  (reports || []).forEach(r => {
    const key = r.word_ro || r.word_zh || String(r.word_id || '');
    if (!key) return;
    if (!map[key]) map[key] = { ro: r.word_ro || '', zh: r.word_zh || '', count: 0, pending: 0 };
    map[key].count++;
    if (r.status === 'pending') map[key].pending++;
  });
  return Object.values(map).sort((a, b) => b.count - a.count || b.pending - a.pending).slice(0, 8);
}

function getAdminWrongStats(rows) {
  const map = {};
  (rows || []).forEach(r => {
    if (!r.word_ro) return;
    const word = wordIdIndex.get(String(r.word_id || '')) || getWordByRo(r.word_ro) || {};
    const key = r.word_id ? String(r.word_id) : r.word_ro;
    if (!map[key]) map[key] = { ro: word.ro || r.word_ro, qt: 0, qr: 0 };
    map[key].qt += r.quiz_total || 0;
    map[key].qr += r.quiz_right || 0;
  });
  return Object.values(map)
    .map(s => {
      const word = getWordByRo(s.ro) || {};
      const wrong = Math.max(0, s.qt - s.qr);
      return { ...s, zh: word.zh || '', cat: word.cat || '', wrong, rate: s.qt ? Math.round(wrong / s.qt * 100) : 0 };
    })
    .filter(s => s.qt >= 3 && s.wrong > 0)
    .sort((a, b) => b.rate - a.rate || b.wrong - a.wrong || b.qt - a.qt)
    .slice(0, 8);
}

function renderAdminCategoryRows(rows) {
  if (!rows.length) return '<div class="empty-state">暂无主题数据</div>';
  const max = Math.max(...rows.map(r => r.count), 1);
  return rows.slice(0, 12).map(r => `
    <div class="admin-mini-row">
      <div style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(getTopicLabel(r.cat))}</div>
      <div class="admin-mini-meter"><div class="admin-mini-fill" style="width:${Math.round(r.count / max * 100)}%"></div></div>
      <div style="color:var(--text2)">${r.count}词</div>
    </div>`).join('');
}

function renderAdminReportRows(rows) {
  if (!rows.length) return '<div class="empty-state">暂无用户报错</div>';
  return rows.map(r => `
    <div class="admin-word-row">
      <div>
        <div class="admin-word-name">${escapeHtml(r.zh || r.ro)}</div>
        <div class="admin-word-meta">${escapeHtml(r.ro)}${r.pending ? ` · ${r.pending} 条待处理` : ''}</div>
      </div>
      <div class="admin-word-score">${r.count}次</div>
    </div>`).join('');
}

function renderAdminWrongRows(rows) {
  if (!rows.length) return '<div class="empty-state">暂无足够答题数据</div>';
  return rows.map(r => `
    <div class="admin-word-row">
      <div>
        <div class="admin-word-name">${escapeHtml(r.zh || r.ro)}</div>
        <div class="admin-word-meta">${escapeHtml(r.ro)}${r.cat ? ` · ${escapeHtml(r.cat)}` : ''} · 错 ${r.wrong}/${r.qt} 次</div>
      </div>
      <div class="admin-word-score">${r.rate}%</div>
    </div>`).join('');
}

// ── 管理员：报错管理 ──────────────────────────────────────

const ISSUE_LABELS = {
  wrong_zh: '中文有误', wrong_ro: '罗语有误', wrong_ipa: '音标有误',
  wrong_hint: '提示有误', wrong_cat: '主题或词性有误', other: '其他'
};

async function refreshAdminBadge() {
  const [reports, words] = await Promise.allSettled([
    apiPendingReportCount(),
    apiPendingWordSubmissionCount()
  ]);
  const count = (reports.status === 'fulfilled' ? reports.value : 0) + (words.status === 'fulfilled' ? words.value : 0);
  const tab = document.getElementById('admin-tab');
  if (!tab) return;
  let badge = tab.querySelector('.badge');
  if (count > 0) {
    if (!badge) { badge = document.createElement('span'); badge.className = 'badge'; tab.appendChild(badge); }
    badge.textContent = count;
  } else {
    if (badge) badge.remove();
  }
}

async function loadAdminReports() {
  document.getElementById('reports-container').innerHTML = '<div class="empty-state">加载中...</div>';
  try {
    const data = await apiLoadReports();
    const pending = data.filter(r => r.status === 'pending');
    const resolved = data.filter(r => r.status === 'resolved');
    document.getElementById('report-count-badge').textContent = pending.length ? `(${pending.length}条待处理)` : '';
    if (!data.length) {
      document.getElementById('reports-container').innerHTML = '<div class="empty-state">暂无报错记录 🎉</div>';
      return;
    }
    document.getElementById('reports-container').innerHTML = [...pending, ...resolved].map(r => `
      <div class="report-row" style="${r.status === 'resolved' ? 'opacity:0.5' : ''}">
        <div class="report-word">${escapeHtml(r.word_zh)} → ${escapeHtml(r.word_ro)}
          <span class="issue-tag">${escapeHtml(ISSUE_LABELS[r.issue_type] || r.issue_type)}</span>
          ${r.status === 'resolved' ? '<span style="font-size:11px;color:var(--green-text);font-weight:600">✓ 已解决</span>' : ''}
        </div>
        <div class="report-meta">来自：${escapeHtml(r.reporter_email || '未知')} · ${new Date(r.created_at).toLocaleDateString('zh')}</div>
        ${r.note ? `<div class="report-note">"${escapeHtml(r.note)}"</div>` : ''}
        <div class="report-actions">
          <button class="admin-btn edit" onclick="openEditFromReport(${Number(r.id)},decodeURIComponent('${encodedArg(r.word_ro)}'))">✏️ 编辑词条</button>
          ${r.status === 'pending' ? `<button class="admin-btn resolve" onclick="resolveReport(${r.id})">✓ 标记已解决</button>` : ''}
        </div>
      </div>`).join('');
  } catch (e) {
    document.getElementById('reports-container').innerHTML = '<div class="empty-state">加载失败</div>';
  }
}

function openEditFromReport(reportId, wordRo) {
  const word = getWordByRo(wordRo);
  if (!word) { showToast('找不到该词条'); return; }
  openEditModal(word, reportId);
}

async function resolveReport(id) {
  await apiResolveReport(id);
  showToast('已标记为解决');
  loadAdminReports();
  refreshAdminBadge();
}

// ── 管理员：用户管理 ──────────────────────────────────────

async function loadAdminUsers() {
  document.getElementById('users-container').innerHTML = '<div class="empty-state">加载中...</div>';
  try {
    const data = await apiLoadUsers();
    adminWatchSettings = await apiLoadUserWatchSettings(data.map(u => u.id));
    document.getElementById('users-container').innerHTML = data.map(u => `
      <div class="user-row">
        <div style="flex:1;min-width:0">
          <div class="user-email">${escapeHtml(u.email || '')}${typeof isFounderAccount === 'function' && isFounderAccount(u) && typeof founderBadgeHtml === 'function' ? ' ' + founderBadgeHtml() : ''}</div>
          <div class="user-nickname">${escapeHtml(u.nickname || '未设昵称')} · ${new Date(u.created_at).toLocaleDateString('zh')} · ${adminWatchSettings[u.id] === false ? '未关注' : '关注对象'}</div>
        </div>
        <span class="role-badge role-${escapeHtml(u.role)}">${escapeHtml({ admin: '管理员', user: '已通过', pending: '待审批' }[u.role] || u.role)}</span>
        ${['user', 'admin'].includes(u.role) ? `<button class="admin-btn ${adminWatchSettings[u.id] === false ? 'approve' : 'revoke'}" onclick="toggleUserWatch(decodeURIComponent('${encodedArg(u.id)}'),${adminWatchSettings[u.id] === false ? 'true' : 'false'})">${adminWatchSettings[u.id] === false ? '设为关注' : '取消关注'}</button>` : ''}
        ${u.email && u.role !== 'pending' ? `<button class="admin-btn edit" onclick="sendUserPasswordReset(decodeURIComponent('${encodedArg(u.email)}'))">重置密码邮件</button>` : ''}
        ${u.role === 'pending' ? `<button class="admin-btn approve" onclick="setUserRole(decodeURIComponent('${encodedArg(u.id)}'),'user')">✓ 通过</button><button class="admin-btn revoke" onclick="rejectUserProfile(decodeURIComponent('${encodedArg(u.id)}'),decodeURIComponent('${encodedArg(u.email || u.nickname || '')}'))">拒绝</button>` : ''}
        ${u.role === 'user' ? `<button class="admin-btn revoke" onclick="setUserRole(decodeURIComponent('${encodedArg(u.id)}'),'pending')">撤销</button>` : ''}
      </div>`).join('');
  } catch (e) {
    document.getElementById('users-container').innerHTML = '<div class="empty-state">加载失败</div>';
  }
}

async function toggleUserWatch(userId, watched) {
  if (userRole !== 'admin') { showToast('只有管理员可以设置关注对象'); return; }
  try {
    const result = await apiSetUserWatch(userId, watched);
    showToast(watched ? '已设为关注对象' : '已取消关注');
    if (result.warning) showToast('已在本设备保存；如需多设备同步，请运行 tools/user_watch_schema.sql');
    await loadAdminUsers();
    await loadAdminWeeklySummary();
  } catch (e) {
    showToast('设置失败：' + (e.message || '未知错误'));
  }
}

async function sendUserPasswordReset(email) {
  if (userRole !== 'admin') { showToast('只有管理员可以发送重置邮件'); return; }
  if (!confirm(`向 ${email} 发送重置密码邮件？`)) return;
  try {
    await sendPasswordResetEmail(email);
    showToast('重置密码邮件已发送');
  } catch (e) {
    showToast('发送失败：' + (e.message || '未知错误'));
  }
}

async function setUserRole(uid, role) {
  await apiSetUserRole(uid, role);
  showToast(role === 'user' ? '✅ 已通过审批' : '已撤销权限');
  await loadAdminUsers();
}

async function rejectUserProfile(uid, label) {
  if (!confirm(`确定拒绝并删除「${label || '该用户'}」的待审批记录吗？`)) return;
  try {
    const result = await apiDeleteUserProfile(uid);
    showToast(result === 'hidden' ? '已从当前管理列表隐藏；若其他设备仍显示，请检查 Supabase 删除权限' : '已拒绝并清除记录');
    await loadAdminUsers();
  } catch (e) {
    showToast('拒绝失败：' + e.message);
  }
}

// ── 管理员：用户周报 ──────────────────────────────────────

async function loadAdminWeeklySummary() {
  const el = document.getElementById('admin-weekly-summary-container');
  if (!el) return;
  el.innerHTML = '<div class="empty-state">加载中...</div>';
  try {
    const [usersResult, progressResult, logsResult] = await Promise.allSettled([
      apiLoadLeaderboardUsers(),
      apiLoadAllProgress(),
      apiGetClassRecentLogs(30)
    ]);
    if (usersResult.status === 'rejected') throw usersResult.reason;
    const users = (usersResult.value || []).filter(u => ['user', 'admin'].includes(u.role));
    const progressRows = progressResult.status === 'fulfilled' ? progressResult.value : [];
    const logs = logsResult.status === 'fulfilled' ? logsResult.value : [];
    adminWatchSettings = await apiLoadUserWatchSettings(users.map(u => u.id));
    const rows = buildWeeklyUserRows(users, progressRows, logs, adminWatchSettings);
    const weeklyWrongWords = buildWeeklyWrongWords(users, progressRows, adminWatchSettings);
    adminWeeklySummaryText = buildWeeklySummaryText(rows, weeklyWrongWords);
    renderAdminWeeklySummaryRows(rows, { progressFailed: progressResult.status === 'rejected', logsFailed: logsResult.status === 'rejected', weeklyWrongWords });
    maybeShowAdminWeeklyNudge(rows);
  } catch (e) {
    el.innerHTML = `<div class="empty-state">周报暂时无法读取：${escapeHtml(e.message || '未知错误')}</div>`;
  }
}

function buildWeeklyUserRows(users, progressRows, logs, watchSettings = {}) {
  const progressByUser = {};
  (progressRows || []).forEach(r => {
    if (!progressByUser[r.user_id]) progressByUser[r.user_id] = {};
    const key = r.word_id ? String(r.word_id) : progressFallbackKey(r.word_ro, r);
    progressByUser[r.user_id][key] = rowToProgress(r);
  });
  const logsByUser = {};
  (logs || []).forEach(l => {
    if (!logsByUser[l.user_id]) logsByUser[l.user_id] = [];
    logsByUser[l.user_id].push(l);
  });
  const recentDates = buildRecentDays(7);
  return users.map(u => {
    const userLogs = logsByUser[u.id] || [];
    const logByDate = {};
    userLogs.forEach(l => { logByDate[l.log_date] = l; });
    const filled = recentDates.map(date => {
      const raw = logByDate[date];
      const goal = Number(raw?.goal || u.daily_goal || DEFAULT_DAILY_GOAL);
      const newWords = Number(raw?.new_words || 0);
      const completed = isDailyLogCompleted({ ...raw, new_words: newWords, goal });
      return { log_date: date, new_words: newWords, goal, completed };
    });
    const summary = calcProgressSummary(progressByUser[u.id] || {});
    const tasks7 = filled.reduce((sum, l) => sum + Number(l.new_words || 0), 0);
    const completedDays = filled.filter(l => l.completed).length;
    const activeDays = filled.filter(l => Number(l.new_words || 0) > 0).length;
    const missedDays = filled.filter(l => !l.completed).length;
    const today = filled[filled.length - 1];
    const yesterday = filled[filled.length - 2];
    const followUpReason = getWeeklyFollowUpReason({ completedDays, missedDays, today, yesterday });
    const watched = watchSettings[u.id] !== false;
    return {
      id: u.id,
      name: u.nickname || (u.email ? u.email.split('@')[0] : '同学'),
      email: u.email || '',
      role: u.role,
      dailyGoal: u.daily_goal || DEFAULT_DAILY_GOAL,
      tasks7,
      completedDays,
      activeDays,
      missedDays,
      streak: calcStreak(userLogs),
      accuracy: summary.accuracy,
      mastered: summary.mastered,
      qt: summary.qt,
      watched,
      followUpReason,
      risk: watched && !!followUpReason
    };
  }).sort((a, b) =>
    Number(b.watched) - Number(a.watched) ||
    Number(b.risk) - Number(a.risk) ||
    a.completedDays - b.completedDays ||
    b.tasks7 - a.tasks7 ||
    b.mastered - a.mastered
  );
}

function getWeeklyFollowUpReason({ completedDays, missedDays, today, yesterday }) {
  if (!today?.completed && !yesterday?.completed) return '连续2天未达标';
  if (missedDays >= 5) return '7天内5天未达标';
  if (completedDays < 3) return '本周达标少于3天';
  return '';
}

function buildWeeklyWrongWords(users, progressRows, watchSettings = {}) {
  const watchedUserIds = new Set(users.filter(u => watchSettings[u.id] !== false).map(u => u.id));
  const wordMap = new Map(W.map(w => [w.ro, w]));
  const start = new Date(`${buildRecentDays(7)[0]}T00:00:00`).getTime();
  const byWord = {};
  (progressRows || []).forEach((row) => {
    if (!watchedUserIds.has(row.user_id)) return;
    const updated = row.updated_at ? new Date(row.updated_at).getTime() : 0;
    const lastWrong = row.last_wrong_at ? new Date(row.last_wrong_at).getTime() : 0;
    if (Math.max(updated, lastWrong) < start) return;
    const p = rowToProgress(row);
    const qt = Number(p.qt || 0);
    const qr = Number(p.qr || 0);
    const misses = Math.max(Number(p.wrongCount || 0), Math.max(0, qt - qr));
    if (!qt || misses <= 0) return;
    const word = wordIdIndex.get(String(row.word_id || '')) || wordMap.get(row.word_ro) || {};
    const key = row.word_id ? String(row.word_id) : row.word_ro;
    if (!byWord[key]) {
      byWord[key] = {
        ro: word.ro || row.word_ro,
        zh: word.zh || '',
        cat: word.cat || '',
        misses: 0,
        attempts: 0,
        users: new Set()
      };
    }
    byWord[key].misses += misses;
    byWord[key].attempts += qt;
    byWord[key].users.add(row.user_id);
  });
  return Object.values(byWord)
    .map(item => ({ ...item, users: item.users.size, rate: item.attempts ? Math.round(item.misses / item.attempts * 100) : 0 }))
    .sort((a, b) => b.users - a.users || b.misses - a.misses || b.rate - a.rate || String(a.ro).localeCompare(String(b.ro), 'ro'))
    .slice(0, 8);
}

function renderAdminWeeklySummaryRows(rows, state = {}) {
  const el = document.getElementById('admin-weekly-summary-container');
  if (!el) return;
  const watchedRows = rows.filter(r => r.watched);
  const active = watchedRows.filter(r => r.activeDays > 0).length;
  const needsAttention = watchedRows.filter(r => r.risk).length;
  const totalTasks = watchedRows.reduce((sum, r) => sum + r.tasks7, 0);
  const avgCompletedDays = watchedRows.length ? (watchedRows.reduce((sum, r) => sum + r.completedDays, 0) / watchedRows.length).toFixed(1) : '0.0';
  const topRows = [...watchedRows].sort((a, b) => b.completedDays - a.completedDays || b.tasks7 - a.tasks7).slice(0, 5);
  const attentionRows = watchedRows.filter(r => r.risk || r.completedDays < 3).slice(0, 8);
  const weeklyWrongWords = state.weeklyWrongWords || [];
  const ignored = rows.length - watchedRows.length;
  el.innerHTML = `
    <div class="admin-stat-grid">
      <div class="admin-stat"><div class="admin-stat-n">${watchedRows.length}</div><div class="admin-stat-l">关注对象</div></div>
      <div class="admin-stat"><div class="admin-stat-n">${active}</div><div class="admin-stat-l">本周活跃</div></div>
      <div class="admin-stat"><div class="admin-stat-n">${totalTasks}</div><div class="admin-stat-l">本周任务</div></div>
      <div class="admin-stat"><div class="admin-stat-n">${avgCompletedDays}</div><div class="admin-stat-l">平均达标天</div></div>
      <div class="admin-stat"><div class="admin-stat-n">${needsAttention}</div><div class="admin-stat-l">需关注</div></div>
    </div>
    ${ignored ? `<div class="empty-state" style="padding:10px;font-size:12px">已排除 ${ignored} 个未关注用户；可在“用户管理”里切换关注状态。</div>` : ''}
    <div class="admin-chart">
      <div class="admin-chart-title">需要关注的用户</div>
      ${attentionRows.length ? attentionRows.map(renderWeeklyUserRow).join('') : '<div class="empty-state">本周没有明显掉队用户</div>'}
    </div>
    <div class="admin-chart">
      <div class="admin-chart-title">本周完成度最高</div>
      ${topRows.length ? topRows.map(renderWeeklyUserRow).join('') : '<div class="empty-state">暂时没有用户数据</div>'}
    </div>
    <div class="admin-chart">
      <div class="admin-chart-title">本周高错词</div>
      ${weeklyWrongWords.length ? weeklyWrongWords.map(renderWeeklyWrongWordRow).join('') : '<div class="empty-state">本周暂无明显高错词</div>'}
    </div>
    ${(state.progressFailed || state.logsFailed) ? `<div class="empty-state">部分数据暂时无法读取：${state.logsFailed ? 'daily_log ' : ''}${state.progressFailed ? 'progress' : ''}</div>` : ''}`;
}

function renderWeeklyUserRow(row) {
  const tag = row.followUpReason ? `<span class="issue-tag">${escapeHtml(row.followUpReason)}</span>` : '';
  return `<div class="admin-word-row">
    <div>
      <div class="admin-word-name">${tag}${escapeHtml(row.name)}</div>
      <div class="admin-word-meta">${escapeHtml(row.email)} · 达标 ${row.completedDays}/7 天 · 活跃 ${row.activeDays} 天 · 连续 ${row.streak} 天 · 正确率 ${row.accuracy}%</div>
    </div>
    <div class="admin-word-score">${row.tasks7}个</div>
  </div>`;
}

function renderWeeklyWrongWordRow(row) {
  const title = row.zh ? `${row.zh} → ${row.ro}` : row.ro;
  return `<div class="admin-word-row">
    <div>
      <div class="admin-word-name">${escapeHtml(title)}</div>
      <div class="admin-word-meta">${row.cat ? `${escapeHtml(row.cat)} · ` : ''}${row.users} 人出错 · 错 ${row.misses}/${row.attempts} 次 · 错误率 ${row.rate}%</div>
    </div>
    <div class="admin-word-score">${row.misses}错</div>
  </div>`;
}

function buildWeeklySummaryText(rows, weeklyWrongWords = []) {
  const watchedRows = rows.filter(r => r.watched);
  const totalTasks = watchedRows.reduce((sum, r) => sum + r.tasks7, 0);
  const active = watchedRows.filter(r => r.activeDays > 0).length;
  const attention = watchedRows.filter(r => r.risk || r.completedDays < 3).slice(0, 8);
  const top = [...watchedRows].sort((a, b) => b.completedDays - a.completedDays || b.tasks7 - a.tasks7).slice(0, 5);
  return [
    `罗语词汇用户周报（${buildRecentDays(7)[0]} 至 ${buildRecentDays(7)[6]}）`,
    `关注对象：${watchedRows.length}；本周活跃：${active}；本周任务总数：${totalTasks}`,
    '',
    '需要关注：',
    ...(attention.length ? attention.map(r => `- ${r.name}${r.followUpReason ? `（${r.followUpReason}）` : ''}：达标 ${r.completedDays}/7 天，完成 ${r.tasks7} 个，连续 ${r.streak} 天，正确率 ${r.accuracy}%`) : ['- 暂无']),
    '',
    '完成度最高：',
    ...(top.length ? top.map(r => `- ${r.name}：达标 ${r.completedDays}/7 天，完成 ${r.tasks7} 个，已掌握 ${r.mastered} 个`) : ['- 暂无']),
    '',
    '本周高错词：',
    ...(weeklyWrongWords.length ? weeklyWrongWords.map(w => `- ${w.zh ? `${w.zh} → ` : ''}${w.ro}：${w.users} 人出错，错 ${w.misses}/${w.attempts} 次，错误率 ${w.rate}%`) : ['- 暂无'])
  ].join('\n');
}

async function copyAdminWeeklySummary() {
  if (!adminWeeklySummaryText) await loadAdminWeeklySummary();
  try {
    await navigator.clipboard.writeText(adminWeeklySummaryText);
    showToast('周报已复制');
  } catch {
    showToast('复制失败，请刷新后重试');
  }
}

function maybeShowAdminWeeklyNudge(rows) {
  if (userRole !== 'admin' || !rows.length) return;
  const now = new Date();
  const weekKey = `${now.getFullYear()}-W${getWeekNumber(now)}`;
  const key = `admin_weekly_summary_seen:${currentUser?.id || 'admin'}`;
  if (localStorage.getItem(key) === weekKey) return;
  if (now.getDay() !== 1) return;
  localStorage.setItem(key, weekKey);
  showToast('本周用户周报已更新，可复制给管理员留档');
}

function getWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

// ── Toast 提示 ────────────────────────────────────────────

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

// ── 启动 ─────────────────────────────────────────────────
if (window.speechSynthesis) { speechSynthesis.onvoiceschanged = () => {}; }
window.repeatGuidePronunciation = repeatGuidePronunciation;
window.speakGuidePronunciation = speakGuidePronunciation;
bindCardGestures();
initGuidePronunciation();
initAccessibleModals();
initAccessibleControls();
setCardFlipAccessibility('main-card', false);
setCardFlipAccessibility('wb-card', false);
init();
