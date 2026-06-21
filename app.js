// ============================================================
//  app.js — 主应用逻辑
//  卡片记忆 / 测验 / 词汇表 / 管理员 / 报错弹窗 / 编辑弹窗
//  如需修改界面功能，只改这个文件
// ============================================================

// ── 全局状态 ─────────────────────────────────────────────
let currentUser = null;
let userRole = null;
let progressMap = {};
let W = [];           // 全部词汇（从数据库加载）
let wordRoIndex = new Map();
let filtered = [];    // 当前分类筛选后的词汇
let idx = 0;          // 卡片当前索引
let flipped = false;
let flashHistory = [];
let flashOverrideRo = null;
let curCat = '全部';
let flashMode = 'today'; // today | review
let todayQueue = [];
let todayQueueCompleted = new Set();
let todayQueueRecord = null;
let dailyQueueLoaded = false;
let exampleBank = {};
let exampleBankLoaded = false;
let exampleBankLoadPromise = null;

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
let pendingTodayGoalPrompt = false;
let pendingTodayAccuracyStats = { correct: 0, total: 0 };
const fastProgressQueue = new Map();
const CARD_FLIP_TRANSITION_MS = 180;
const CARD_CONTENT_SWAP_DELAY_MS = 95;
const FAST_PERSIST_DELAY_MS = 900;

// 需加强列表状态（内部仍沿用 wrongbook 命名以兼容本地数据）
let wbList = [];
let wbIdx = 0;
let wbFlipped = false;
let wbStreaks = {};
let wbGraduated = 0;
let wbAutoAdvanceTimer = null;
const WB_GRADUATE = 3;
const DAILY_GOAL_MAX = 5000;
const PENDING_PROGRESS_RETRY_COOLDOWN_MS = 5 * 60 * 1000;
const CLOUD_PROGRESS_REFRESH_COOLDOWN_MS = 60 * 1000;
const IDLE_PROGRESS_BACKUP_MS = 150 * 1000;

// 每日任务目标状态
let dailyGoal = 20;        // 今天实际任务量，允许临时扩展
let defaultDailyGoal = 20; // 用户主动保存的每日固定目标
let todayNewWords = 0;      // 今日已完成任务数；字段名兼容 legacy daily_log.new_words
let todaySeenWords = new Set(); // 今天已经见过的词 ro 集合
let todayLog = null;
let activeDailyDateKey = getDateKeyFor(new Date());
let dailyDateReloadInFlight = null;
const CALENDAR_CACHE_TTL_MS = 5 * 60 * 1000;
let calendarCache = { key: '', logs: null, fetchedAt: 0 };
let lastProgressWarningAt = 0;
let progressCloudSyncInFlight = null;
let progressCloudSyncTimer = null;
let dailyReminderTimer = null;
let dailyCheckinPromptShown = false;
let adminWeeklySummaryText = '';
let adminWatchSettings = {};

const DEFAULT_REMINDER_SETTINGS = {
  enabled: false,
  time: '20:30',
  lastSentDate: ''
};

function normalizeDailyGoalValue(value, fallback = 20) {
  return Math.max(1, Math.min(DAILY_GOAL_MAX, Number(value) || fallback || 20));
}

function normalizeWordText(value) {
  return String(value || '').normalize('NFC').trim().replace(/\s+/g, ' ');
}

function roKey(value) {
  return normalizeWordText(value).toLocaleLowerCase('ro');
}

function getRoAliasKeys(wordRo) {
  const key = roKey(wordRo);
  return key ? [key] : [];
}

function rebuildWordRoIndex() {
  wordRoIndex = new Map();
  W.forEach(word => {
    const canonical = normalizeWordText(word?.ro);
    if (!canonical) return;
    const exactKey = roKey(canonical);
    if (exactKey) wordRoIndex.set(exactKey, canonical);
  });
}

function getProgressReviewStage(progress = {}) {
  return Number(
    progress.reviewStage ??
    progress.reviewCount ??
    progress.review_stage ??
    progress.review_count ??
    0
  ) || 0;
}

function getProgressGrammarQr(progress = {}) {
  return Number(progress.grammarQr || progress.grammar_qr || 0) || 0;
}

function getProgressGrammarQt(progress = {}) {
  return Number(progress.grammarQt || progress.grammar_qt || 0) || 0;
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

function mergeRecentResults(existing = [], incoming = []) {
  const results = [...(Array.isArray(existing) ? existing : []), ...(Array.isArray(incoming) ? incoming : [])]
    .map(String)
    .filter(Boolean);
  return results.slice(-5);
}

function mergeProgressEntry(existing = null, incoming = {}) {
  if (!existing) return incoming;
  const existingQt = Number(existing.qt || 0);
  const incomingQt = Number(incoming.qt || 0);
  const base = incomingQt >= existingQt ? incoming : existing;
  const other = base === incoming ? existing : incoming;
  const reviewStage = Math.max(getProgressReviewStage(existing), getProgressReviewStage(incoming));
  const nextReviewAt = newerIsoLike(existing.nextReviewAt || existing.nextReview, incoming.nextReviewAt || incoming.nextReview);
  const lastReviewedAt = newerIsoLike(existing.lastReviewedAt, incoming.lastReviewedAt);
  const wasMasteredAt = newerIsoLike(existing.wasMasteredAt, incoming.wasMasteredAt);
  const existingScheduler = normalizeScheduler(existing);
  const incomingScheduler = normalizeScheduler(incoming);
  const schedulerBase = new Date(incomingScheduler.lastReviewedAt || incomingScheduler.dueAt || 0).getTime() >=
    new Date(existingScheduler.lastReviewedAt || existingScheduler.dueAt || 0).getTime()
      ? incomingScheduler
      : existingScheduler;
  const schedulerFields = {
    cardState: schedulerBase.cardState,
    dueAt: schedulerBase.dueAt || null,
    intervalDays: Number(schedulerBase.intervalDays || 0),
    memoryStrength: Number(schedulerBase.memoryStrength || 0),
    reps: Math.max(Number(existingScheduler.reps || 0), Number(incomingScheduler.reps || 0)),
    correctCount: Math.max(Number(existingScheduler.correctCount || 0), Number(incomingScheduler.correctCount || 0)),
    fuzzyCount: Math.max(Number(existingScheduler.fuzzyCount || 0), Number(incomingScheduler.fuzzyCount || 0)),
    forgetCount: Math.max(Number(existingScheduler.forgetCount || 0), Number(incomingScheduler.forgetCount || 0)),
    lapses: Math.max(Number(existingScheduler.lapses || 0), Number(incomingScheduler.lapses || 0)),
    recentResults: Array.isArray(schedulerBase.recentResults) ? schedulerBase.recentResults : mergeRecentResults(existingScheduler.recentResults, incomingScheduler.recentResults),
    needsReinforcement: !!schedulerBase.needsReinforcement,
    lastReviewedAt: lastReviewedAt || schedulerBase.lastReviewedAt || null
  };
  return {
    ...other,
    ...base,
    qr: Math.max(Number(existing.qr || 0), Number(incoming.qr || 0)),
    qt: Math.max(existingQt, incomingQt),
    known: !!(existing.known || incoming.known),
    seen: !!(existing.seen || incoming.seen || existing.known || incoming.known || existingQt || incomingQt || reviewStage),
    seenViaCard: !!(existing.seenViaCard || incoming.seenViaCard),
    reviewStage,
    reviewCount: reviewStage,
    nextReviewAt: nextReviewAt || base.nextReviewAt || other.nextReviewAt,
    lastReviewedAt: lastReviewedAt || base.lastReviewedAt || other.lastReviewedAt,
    ...schedulerFields,
    grammarQr: Math.max(getProgressGrammarQr(existing), getProgressGrammarQr(incoming)),
    grammarQt: Math.max(getProgressGrammarQt(existing), getProgressGrammarQt(incoming)),
    wasMasteredAt: wasMasteredAt || null,
    wrongCount: Math.max(Number(existing.wrongCount || 0), Number(incoming.wrongCount || 0)),
    errorStreak: Math.max(Number(existing.errorStreak || 0), Number(incoming.errorStreak || 0)),
    correctStreakSinceWrong: Math.max(Number(existing.correctStreakSinceWrong || 0), Number(incoming.correctStreakSinceWrong || 0)),
    lastWrongAt: newerIsoLike(existing.lastWrongAt, incoming.lastWrongAt) || null,
    weakClearedAt: newerIsoLike(existing.weakClearedAt, incoming.weakClearedAt) || null
  };
}

function newerIsoLike(a, b) {
  if (!a) return b || null;
  if (!b) return a || null;
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
}

function normalizeProgressMap(map = {}) {
  const normalized = {};
  Object.entries(map || {}).forEach(([wordRo, progress]) => {
    const canonical = canonicalWordRo(wordRo);
    const key = roKey(canonical);
    if (!key) return;
    normalized[key] = mergeProgressEntry(normalized[key], progress);
  });
  return normalized;
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

function getProgress(wordRo) {
  const canonical = canonicalWordRo(wordRo);
  return progressMap[roKey(canonical)] || null;
}

function setProgress(wordRo, progress) {
  const canonical = canonicalWordRo(wordRo);
  const key = roKey(canonical);
  if (key) {
    progressMap[key] = progress;
    progressVersion++;
  }
}

function deleteProgress(wordRo) {
  delete progressMap[roKey(wordRo)];
  progressVersion++;
}

function canonicalWordRo(wordRo) {
  const key = roKey(wordRo);
  return wordRoIndex.get(key) || normalizeWordText(wordRo);
}

function normalizeWordRoList(list = []) {
  const seen = new Set();
  const normalized = [];
  (Array.isArray(list) ? list : []).forEach(ro => {
    const canonical = canonicalWordRo(ro);
    const key = roKey(canonical);
    if (!key || seen.has(key)) return;
    seen.add(key);
    normalized.push(canonical);
  });
  return normalized;
}

function setHasRo(set, wordRo) {
  const key = roKey(wordRo);
  return [...set].some(ro => roKey(ro) === key);
}

function setAddRo(set, wordRo) {
  const canonical = canonicalWordRo(wordRo);
  const key = roKey(canonical);
  [...set].forEach(ro => {
    if (roKey(ro) === key) set.delete(ro);
  });
  if (key) set.add(canonical);
}

function setDeleteRo(set, wordRo) {
  const key = roKey(wordRo);
  [...set].forEach(ro => {
    if (roKey(ro) === key) set.delete(ro);
  });
}

function roListIncludes(list, wordRo) {
  const key = roKey(wordRo);
  return (list || []).some(ro => roKey(ro) === key);
}

function roListWithout(list, wordRo) {
  const key = roKey(wordRo);
  return (list || []).filter(ro => roKey(ro) !== key);
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

function todayAccuracyKey() {
  return `daily_accuracy:${currentUser?.id || 'local'}:${getDateKeyFor(new Date())}`;
}

function isDailyStateCurrent() {
  return activeDailyDateKey === getDateKeyFor(new Date());
}

function resetDailyRuntimeState(dateKey = getDateKeyFor(new Date())) {
  activeDailyDateKey = dateKey;
  todayLog = null;
  todayNewWords = 0;
  todayQueue = [];
  todayQueueCompleted = new Set();
  todaySeenWords = readTodaySeenWords();
  todayQueueRecord = null;
  dailyGoal = Math.max(defaultDailyGoal, readTodayTemporaryGoal());
  dailyCheckinPromptShown = false;
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

function readTodayAccuracyStats() {
  try {
    const raw = JSON.parse(localStorage.getItem(todayAccuracyKey()) || '{}');
    return {
      correct: Math.max(0, Number(raw.correct || 0)),
      total: Math.max(0, Number(raw.total || 0))
    };
  } catch {
    return { correct: 0, total: 0 };
  }
}

function writeTodayAccuracyStats(stats) {
  try {
    localStorage.setItem(todayAccuracyKey(), JSON.stringify({
      correct: Math.max(0, Number(stats.correct || 0)),
      total: Math.max(0, Number(stats.total || 0))
    }));
  } catch {}
}

function recordTodayAccuracyAttempt(correct) {
  const stats = readTodayAccuracyStats();
  stats.total += 1;
  if (correct) stats.correct += 1;
  writeTodayAccuracyStats(stats);
  return stats;
}

function queueTodayAccuracyAttempt(correct) {
  pendingTodayAccuracyStats.total += 1;
  if (correct) pendingTodayAccuracyStats.correct += 1;
}

function flushTodayAccuracyStats() {
  if (!pendingTodayAccuracyStats.total) return;
  const pending = pendingTodayAccuracyStats;
  pendingTodayAccuracyStats = { correct: 0, total: 0 };
  const stats = readTodayAccuracyStats();
  stats.total += pending.total;
  stats.correct += pending.correct;
  writeTodayAccuracyStats(stats);
}

function getTodayCheckinAccuracy() {
  const stats = readTodayAccuracyStats();
  const total = stats.total + pendingTodayAccuracyStats.total;
  const correct = stats.correct + pendingTodayAccuracyStats.correct;
  if (total > 0) return Math.round(correct / total * 100);
  const base = Math.max(1, Number(defaultDailyGoal || dailyGoal || 20));
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

const SUBJECT_CATEGORIES = [
  'Daily Life',
  'Philosophy',
  'Economics',
  'Law',
  'Education',
  'Literature',
  'History',
  'Science',
  'Engineering',
  'Agriculture',
  'Medicine',
  'Military Science',
  'Management',
  'Art'
];

const GRAMMAR_CATEGORIES = [
  'verb',
  'adjective',
  'adverb',
  'conjunction',
  'preposition',
  'pronoun',
  'numeral',
  'interjection'
];

const CATEGORY_ORDER = ['全部', ...SUBJECT_CATEGORIES, ...GRAMMAR_CATEGORIES];

const CATEGORY_ALIASES = {
  '日常': 'Daily Life',
  '日常生活': 'Daily Life',
  '生活': 'Daily Life',
  'daily life': 'Daily Life',
  '城市': 'Daily Life',
  '地理': 'Daily Life',
  '方向': 'Daily Life',
  '环境': 'Science',
  '季节': 'Science',
  '家居': 'Daily Life',
  '饮食': 'Daily Life',
  '购物': 'Economics',
  '商业': 'Economics',
  '金融': 'Economics',
  '经济': 'Economics',
  '法律': 'Law',
  '学习': 'Education',
  '教育': 'Education',
  '文学': 'Literature',
  '历史': 'History',
  '科技': 'Engineering',
  '技术': 'Engineering',
  '科学': 'Science',
  '农业': 'Agriculture',
  '健康': 'Medicine',
  '医疗': 'Medicine',
  '医学': 'Medicine',
  '军事': 'Military Science',
  '军队': 'Military Science',
  '职场': 'Management',
  '管理': 'Management',
  '艺术': 'Art',
  '运动': 'Daily Life',
  '人际': 'Daily Life',
  '社会': 'Philosophy',
  '自然': 'Science',
  '情感': 'Philosophy',
  '时间': 'Daily Life',
  '时间2': 'Daily Life',
  '数量': 'numeral',
  '颜色2': 'adjective',
  '交通': 'Daily Life',
  '文化': 'Literature',
  '旅行': 'Daily Life',
  '旅游': 'Daily Life',
  '天气': 'Science',
  '烹饪': 'Daily Life',
  '身体': 'Medicine',
  '游戏': 'Daily Life',
  '哲学': 'Philosophy',
  '动词': 'verb',
  '动词2': 'verb',
  'verb': 'verb',
  '形容词': 'adjective',
  '形容词2': 'adjective',
  'adjective': 'adjective',
  '副词': 'adverb',
  'adverb': 'adverb',
  '连词': 'conjunction',
  '连接词': 'conjunction',
  'conjunction': 'conjunction',
  '介词': 'preposition',
  'preposition': 'preposition',
  '代词': 'pronoun',
  'pronoun': 'pronoun',
  '数词': 'numeral',
  'numeral': 'numeral',
  '感叹词': 'interjection',
  'interjection': 'interjection',
  '其他': 'Daily Life'
};

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
  defaultDailyGoal = normalizeDailyGoalValue(profile?.daily_goal, 20);
  dailyGoal = defaultDailyGoal;

  // 先设置目标输入框
  const goalInput = document.getElementById('goal-input');
  if (goalInput) goalInput.value = defaultDailyGoal;

  showAppScreen(nickname, userRole === 'admin');

  // 词库先加载；进度和今日记录互不依赖，可以并行。
  await loadWords();
  await Promise.all([loadProgress(), loadTodayLog()]);
  await loadDailyQueue();
  setupDailyReminderChecks();
  setupProgressAutoBackup();

  if (userRole === 'admin') refreshAdminBadge();
  if (isOfflineMode()) setSyncBadge('本机保存', 'saved');
}

// ── 词库加载 ──────────────────────────────────────────────

async function loadWords() {
  const startedAt = Date.now();
  showVocabLoading();

  try {
    W = (await apiLoadWords()).map(normalizeWordCategory);
    if (!W.length) throw new Error('词库为空');
    rebuildWordRoIndex();
    const exampleBankPromise = loadExampleBank();
    applyFilters();

    document.getElementById('s-total').textContent = W.length;
    document.getElementById('topbar-badge').textContent = W.length + '词 · A1-B2';

    populateCategoryDatalist();
    buildCats();
    renderCard();

    document.getElementById('flash-loading').style.display = 'none';
    document.getElementById('flash-content').style.display = 'block';
    console.info(`Words ready: ${W.length} words in ${Date.now() - startedAt}ms`);
    exampleBankPromise.then(() => renderCard());
  } catch (error) {
    console.error('Words load failed', error);
    showVocabLoadError(error);
  }
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
    const response = await fetch('./data/examples.json?v=20260620-cloud-examples', { cache: 'reload' });
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
      setSyncBadge(hasPendingProgress(localProgress) ? '本机待同步' : '本机进度', hasPendingProgress(localProgress) ? '' : 'saved');
      applyFilters();
      renderCard();
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
    if (progressSource === 'localFallback') {
      setSyncBadge('本机待同步', '');
      showProgressSaveWarning(`云端进度读取失败，已显示本机保存的进度：${progressError || '请稍后重试'}`);
    } else if (progressSource === 'cloudWithPending') {
      setSyncBadge('本机待同步', '');
    } else {
      setSyncBadge(isOfflineMode() ? '本机保存' : '', isOfflineMode() ? 'saved' : '');
    }
    applyFilters();
    renderCard();
    upStats();
    if (progressSource === 'cloudWithPending' && typeof apiRetryPendingProgress === 'function') {
      setSyncBadge('本机待同步', '');
    }
  } catch (error) {
    const fallback = typeof readLocalProgressFallback === 'function'
      ? readLocalProgressFallback(currentUser.id)
      : {};
    replaceProgressMap(fallback);
    setSyncBadge(Object.keys(fallback).length ? '本机待同步' : '进度读取失败', '');
    showToast(Object.keys(fallback).length
      ? `进度读取失败，已显示本机保存的进度：${error.message || '请稍后重试'}`
      : `进度读取失败：${error.message || '请刷新重试'}`);
    applyFilters();
    renderCard();
    upStats();
  }
}

function hasPendingProgress(map = progressMap) {
  return Object.values(map || {}).some(progress => progress?.pendingSync);
}

async function refreshCloudProgressAfterLocalLoad() {
  try {
    const refreshKey = `progress_cloud_refresh_at:${currentUser.id}`;
    const lastRefreshAt = Number(localStorage.getItem(refreshKey) || 0);
    if (Date.now() - lastRefreshAt < CLOUD_PROGRESS_REFRESH_COOLDOWN_MS) return;
    localStorage.setItem(refreshKey, String(Date.now()));
    const loadedProgress = await apiLoadProgress(currentUser.id);
    const progressSource = loadedProgress.__progressSource || 'cloud';
    replaceProgressMap(loadedProgress);
    const stillPending = progressSource === 'cloudWithPending' || hasPendingProgress(loadedProgress);
    setSyncBadge(stillPending ? '本机待同步' : '已同步', stillPending ? '' : 'saved');
    applyFilters();
    renderCard();
    upStats();
    updateReviewBadge();
    if (progressSource === 'cloudWithPending' && typeof apiRetryPendingProgress === 'function') {
      setSyncBadge('本机待同步', '');
    }
  } catch (error) {
    console.warn('Cloud progress refresh after local load failed', error);
    setSyncBadge(hasPendingProgress() ? '本机待同步' : '本机进度', hasPendingProgress() ? '' : 'saved');
  }
}

async function retryPendingProgressAfterLoad() {
  try {
    const retryKey = `progress_pending_retry_at:${currentUser.id}`;
    const lastRetryAt = Number(localStorage.getItem(retryKey) || 0);
    if (Date.now() - lastRetryAt < PENDING_PROGRESS_RETRY_COOLDOWN_MS) {
      setSyncBadge('本机待同步', '');
      return;
    }
    localStorage.setItem(retryKey, String(Date.now()));
    const result = await apiRetryPendingProgress(currentUser.id);
    if (!result.attempted) return;
    if (result.failed || result.remaining) {
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
    else scheduleIdleProgressBackup();
  });
  window.addEventListener('pagehide', () => {
    flushPendingFastCardState();
    triggerCloudProgressBackup('退出页面', { limit: 100 });
  });
  window.addEventListener('beforeunload', () => {
    flushPendingFastCardState();
    triggerCloudProgressBackup('退出页面', { limit: 100 });
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
  if (!hasPendingProgress() && !options.force) return syncDailyStateToCloud();
  if (progressCloudSyncInFlight) return progressCloudSyncInFlight;
  setSyncBadge(`${reason}中...`, '');
  progressCloudSyncInFlight = (async () => {
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
      }
      if (!result.attempted) {
        setSyncBadge(result.failed ? '本机待同步' : '已同步', result.failed ? '' : 'saved');
        return result;
      }
      if (result.failed || result.remaining) {
        setSyncBadge('本机待同步', '');
      } else {
        Object.keys(progressMap).forEach((wordRo) => {
          if (progressMap[wordRo]?.pendingSync) {
            progressMap[wordRo] = { ...progressMap[wordRo] };
            delete progressMap[wordRo].pendingSync;
          }
        });
        if (typeof writeLocalProgressSnapshot === 'function') writeLocalProgressSnapshot(currentUser.id, progressMap);
        progressVersion++;
        setSyncBadge('已同步', 'saved');
      }
      return result;
    } catch (error) {
      console.warn('Progress cloud backup failed', reason, error);
      setSyncBadge('本机待同步', '');
      return { failed: true, error };
    } finally {
      progressCloudSyncInFlight = null;
      setTimeout(() => {
        if (!hasPendingProgress()) setSyncBadge('', '');
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
    goal: dailyGoal,
    word_ro: todayQueue,
    completed_word_ro: [...todayQueueCompleted],
    completed: isCurrentTodayGoalDone()
  };
  const results = await Promise.allSettled([
    apiSaveDailyQueue(currentUser.id, queuePayload),
    apiUpdateTodayLog(currentUser.id, todayNewWords, dailyGoal, defaultDailyGoal, { completed: checkinDone })
  ]);
  const rejected = results.find(result => result.status === 'rejected');
  if (rejected) throw rejected.reason;
  return { saved: true };
}

async function loadTodayLog() {
  activeDailyDateKey = getDateKeyFor(new Date());
  try {
    todayLog = await apiGetTodayLog(currentUser.id, dailyGoal);
  } catch (error) {
    todayLog = { new_words: 0, goal: dailyGoal, completed: false, syncError: error.message };
    setSyncBadge('今日记录读取失败', '');
    showToast(`今日记录读取失败：${error.message || '请刷新重试'}`);
  }
  todayNewWords = todayLog?.new_words || 0;
  if (todayLog?.log_date === getDateKeyFor(new Date()) && todayLog.completed === true) writeDailyCheckinDone();
  const logGoal = normalizeDailyGoalValue(todayLog?.goal, defaultDailyGoal);
  const localTemporaryGoal = readTodayTemporaryGoal();
  dailyGoal = Math.max(defaultDailyGoal, logGoal, localTemporaryGoal);
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
  activeDailyDateKey = getDateKeyFor(new Date());
  dailyQueueLoaded = false;
  const previousTodayCount = todayLog?.new_words || 0;
  const saved = await apiGetDailyQueue(currentUser.id, dailyGoal);
  let queueChanged = false;
  let forceQueueLocal = false;
  const logGoal = normalizeDailyGoalValue(todayLog?.goal, defaultDailyGoal);
  const localTemporaryGoal = readTodayTemporaryGoal();
  if (saved?.syncError) {
    showToast(`每日队列未能云端同步：${saved.syncError}`);
    setSyncBadge('队列同步失败', '');
  }
  const hasSavedQueueState = !!(saved?.word_ro?.length || saved?.completed_word_ro?.length);
  if (hasSavedQueueState) {
    todayQueueRecord = saved;
    const savedGoal = normalizeDailyGoalValue(saved.goal, defaultDailyGoal);
    dailyGoal = Math.max(savedGoal, logGoal, localTemporaryGoal, defaultDailyGoal);
    setGoalInputValue(defaultDailyGoal);
    const rawSavedCompleted = normalizeWordRoList(saved.completed_word_ro || []);
    const todaySavedCompleted = rawSavedCompleted.filter(ro => wasWordCompletedOnActiveDate(ro));
    if (todaySavedCompleted.length !== rawSavedCompleted.length) {
      forceQueueLocal = true;
      queueChanged = true;
    }
    const savedCompleted = new Set(todaySavedCompleted);
    const originalQueueLength = saved.word_ro.length;
    const uniqueSavedQueue = normalizeWordRoList(saved.word_ro);
    todayQueueCompleted = new Set([...savedCompleted].filter(ro => getWordByRo(ro)));
    todayQueue = uniqueSavedQueue.filter(ro => getWordByRo(ro) && !setHasRo(todayQueueCompleted, ro));
    queueChanged = todayQueue.length !== originalQueueLength || todayQueueCompleted.size !== savedCompleted.size;
  } else {
    dailyGoal = Math.max(logGoal, localTemporaryGoal, defaultDailyGoal);
    setGoalInputValue(defaultDailyGoal);
    todayQueueCompleted = new Set();
    todaySeenWords = readTodaySeenWords();
    todayQueue = buildDailyQueueWords(dailyGoal).map(w => w.ro);
    todayQueueRecord = await apiSaveDailyQueue(currentUser.id, {
      goal: dailyGoal,
      word_ro: todayQueue,
      completed_word_ro: [],
      completed: false
    });
  }
  todaySeenWords = new Set([...readTodaySeenWords(), ...todayQueueCompleted]);
  writeTodaySeenWords();
  repairStartedProgressForCompletedTodayWords();
  todayNewWords = hasSavedQueueState
    ? todayQueueCompleted.size
    : Math.max(todayQueueCompleted.size, Number(todayLog?.new_words || 0));
  const normalizedQueue = buildOpenTodayQueue(dailyGoal);
  if (normalizedQueue.join('|') !== todayQueue.join('|')) {
    todayQueue = normalizedQueue;
    queueChanged = true;
  }
  if (queueChanged) await saveTodayQueue({ forceLocal: forceQueueLocal });
  if (todayNewWords !== previousTodayCount || todayLog?.goal !== dailyGoal) {
    await apiUpdateTodayLog(currentUser.id, todayNewWords, dailyGoal, defaultDailyGoal, {
      completed: isDailyCheckinDone(),
      forceLocal: todayNewWords < previousTodayCount
    });
    invalidateCalendarCache();
  }
  if (todayQueueRecord?.syncError) {
    showToast(`每日队列未能云端保存：${todayQueueRecord.syncError}`);
    setSyncBadge('队列同步失败', '');
  } else if (todayQueueRecord?.local) {
    showToast('每日队列暂存在本设备；请应用 daily_queue 数据库表以支持多设备同步');
  }
  dailyQueueLoaded = true;
  dailyQueueVersion++;
  applyFilters();
  renderCard();
  renderDailyGoal();
  renderCalendar();
  updateReviewBadge();
}

function buildDailyQueueWords(goal) {
  const cap = Math.max(1, Number(goal || 20));
  return getUnseenWords(W).slice(0, cap);
}

function uniqueWordsByRo(words) {
  const seen = new Set();
  return words.filter(w => {
    const key = roKey(w?.ro);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildSmartDailyPlan(words = W, limit = dailyGoal) {
  const cap = Math.max(1, Number(limit || dailyGoal || 20));
  const blocked = new Set([...todaySeenWords, ...todayQueueCompleted].map(roKey));
  const usable = words.filter(w => w?.ro && !blocked.has(roKey(w.ro)));
  const overdueLearning = sortReviewDueWithWeakPriority(usable).filter(isOverdueLearningOrReinforcingWord);
  const overdueSet = new Set(overdueLearning.map(w => roKey(w.ro)));
  const due = sortReviewDueWithWeakPriority(usable).filter(w => !overdueSet.has(roKey(w.ro)) && isDueReviewWord(w));
  const dueSet = new Set([...overdueSet, ...due.map(w => roKey(w.ro))]);
  const weak = getReinforcementWordsDueToday(usable).filter(w => !dueSet.has(roKey(w.ro)));
  const weakSet = new Set([...dueSet, ...weak.map(w => roKey(w.ro))]);
  const unseen = getUnseenWords(usable);
  return uniqueWordsByRo([...overdueLearning, ...due, ...weak, ...unseen.filter(w => !weakSet.has(roKey(w.ro)))]).slice(0, cap);
}

function hasWordProgress(progress) {
  const scheduler = normalizeScheduler(progress || {});
  return !!(progress && (
    progress.seen ||
    progress.known ||
    progress.qt ||
    progress.qr ||
    getProgressReviewStage(progress) ||
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

function isOverdueLearningOrReinforcingWord(w) {
  const p = getProgress(w?.ro);
  if (!hasWordProgress(p) || !isReviewDue(p)) return false;
  const scheduler = normalizeScheduler(p);
  return scheduler.cardState === 'learning' || scheduler.cardState === 'reinforcing' || scheduler.needsReinforcement;
}

function getReinforcementWordsDueToday(words = W) {
  return getDifficultWords(words).filter(w => {
    const p = getProgress(w?.ro);
    if (!hasWordProgress(p)) return false;
    const scheduler = normalizeScheduler(p);
    return scheduler.needsReinforcement || scheduler.cardState === 'reinforcing';
  });
}

function isPendingLearningRetryWord(w) {
  const p = getProgress(w?.ro);
  if (!hasWordProgress(p) || isReviewDue(p)) return false;
  const scheduler = normalizeScheduler(p);
  return scheduler.cardState === 'learning' || scheduler.cardState === 'reinforcing' || (!p.known && getStoredLevel(p) !== 'mastered');
}

function getRemainingDueReviewWords(words = W) {
  return words.filter(w => !setHasRo(todayQueueCompleted, w.ro) && isDueReviewWord(w));
}

function getRemainingTodayReviewWords() {
  if (!dailyQueueLoaded) return getRemainingDueReviewWords(W);
  return todayQueue
    .filter(ro => !setHasRo(todayQueueCompleted, ro))
    .map(ro => getWordByRo(ro))
    .filter(Boolean)
    .filter(w => isDueReviewWord(w) && !isRetryDeferred(w));
}

function isDailyQueueCandidate(w) {
  return isOverdueLearningOrReinforcingWord(w) || isDueReviewWord(w) || isPendingLearningRetryWord(w) || isUnseenWord(w);
}

function getDailyPhasePriority(w) {
  if (!w?.ro) return 9;
  if (isOverdueLearningOrReinforcingWord(w)) return 0;
  if (isDueReviewWord(w)) return 1;
  const scheduler = normalizeScheduler(getProgress(w.ro) || {});
  if (scheduler.needsReinforcement || scheduler.cardState === 'reinforcing') return 2;
  if (isUnseenWord(w)) return 3;
  if (isPendingLearningRetryWord(w)) return 4;
  return 8;
}

function sortDailyPhaseWords(words = []) {
  return uniqueWordsByRo(words).sort((a, b) => {
    const pa = getDailyPhasePriority(a);
    const pb = getDailyPhasePriority(b);
    if (pa !== pb) return pa - pb;
    const sa = normalizeScheduler(getProgress(a.ro) || {});
    const sb = normalizeScheduler(getProgress(b.ro) || {});
    const da = sa.dueAt ? new Date(sa.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
    const db = sb.dueAt ? new Date(sb.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
    return da - db || String(a.ro).localeCompare(String(b.ro), 'ro');
  });
}

function buildReviewFirstDailyPlan(words = W, limit = dailyGoal) {
  const cap = Math.max(1, Number(limit || dailyGoal || 20));
  const blocked = new Set([...todaySeenWords, ...todayQueueCompleted].map(roKey));
  const usable = words.filter(w => w?.ro && !blocked.has(roKey(w.ro)));
  const overdueLearning = sortReviewDueWithWeakPriority(usable).filter(isOverdueLearningOrReinforcingWord);
  const overdueSet = new Set(overdueLearning.map(w => roKey(w.ro)));
  const due = sortReviewDueWithWeakPriority(usable).filter(w => !overdueSet.has(roKey(w.ro)) && isDueReviewWord(w));
  const dueSet = new Set([...overdueSet, ...due.map(w => roKey(w.ro))]);
  const weak = getReinforcementWordsDueToday(usable).filter(w => !dueSet.has(roKey(w.ro)));
  const weakSet = new Set([...dueSet, ...weak.map(w => roKey(w.ro))]);
  const unseen = getUnseenWords(usable).filter(w => !weakSet.has(roKey(w.ro)));
  return uniqueWordsByRo([...overdueLearning, ...due, ...weak, ...unseen]).slice(0, cap);
}

function buildOpenTodayQueue(goal = dailyGoal) {
  const cap = Math.max(1, Number(goal || dailyGoal || 20));
  const completedKeys = new Set([...todayQueueCompleted].map(roKey));
  const openWords = normalizeWordRoList(todayQueue).map(ro => getWordByRo(ro)).filter(word => {
    if (!word || completedKeys.has(roKey(word.ro))) return false;
    const p = getProgress(word.ro);
    return !hasWordProgress(p) || isReviewDue(p) || isPendingLearningRetryWord(word) || normalizeScheduler(p || {}).needsReinforcement;
  });
  const openSlots = Math.max(0, cap - completedKeys.size);
  if (!openSlots) return [];
  const blocked = new Set([...completedKeys, ...todaySeenWords].map(roKey));
  const candidates = buildReviewFirstDailyPlan(W, Math.max(openSlots + openWords.length, dailyGoal))
    .filter(w => !completedKeys.has(roKey(w.ro)))
    .filter(w => !blocked.has(roKey(w.ro)) || openWords.some(open => roKey(open.ro) === roKey(w.ro)));
  return sortDailyPhaseWords([...candidates, ...openWords]).slice(0, openSlots).map(w => w.ro);
}

function getDailyWordList(words = W, options = {}) {
  if (!dailyQueueLoaded && !options.allowBeforeQueueLoaded) return [];
  if (shouldPauseTodayStudyForCheckin() || shouldPauseTodayStudyForGoal()) return [];
  const limit = Math.max(1, Number(options.limit || dailyGoal || 20));
  const scoped = options.ignoreCategory || curCat === '全部'
    ? words
    : words.filter(w => w.cat === curCat);
  const openQueuedRos = todayQueue.filter(ro => !setHasRo(todayQueueCompleted, ro));
  const openWords = openQueuedRos
    .map(ro => scoped.find(w => roKey(w.ro) === roKey(ro)))
    .filter(Boolean)
    .filter(w => !isRetryDeferred(w));
  const allDueToday = getRemainingDueReviewWords(W).length > 0;
  if (allDueToday) {
    const dueOpenWords = openWords.filter(w => isOverdueLearningOrReinforcingWord(w) || isDueReviewWord(w));
    if (dueOpenWords.length >= limit) return sortDailyPhaseWords(dueOpenWords).slice(0, limit);
    const nonDueOpenWords = openWords.filter(w => !dueOpenWords.some(due => roKey(due.ro) === roKey(w.ro)));
    return sortDailyPhaseWords([...dueOpenWords, ...nonDueOpenWords]).slice(0, limit);
  }
  return sortDailyPhaseWords(openWords).slice(0, limit);
}

function getDailyTaskType(w) {
  if (!w) return '';
  return getLevelLabel(w.ro);
}

function getAuxiliaryLabels(w) {
  if (!w) return [];
  const labels = [];
  const scheduler = normalizeScheduler(getProgress(w.ro) || {});
  if (roListIncludes(todayQueue, w.ro) && !setHasRo(todayQueueCompleted, w.ro)) labels.push('今日任务');
  if (!hasWordProgress(getProgress(w.ro)) && !setHasRo(todaySeenWords, w.ro)) labels.push('新词');
  if (isDueReviewWord(w)) labels.push('到期复习');
  if ((scheduler.needsReinforcement || scheduler.cardState === 'reinforcing' || isWrongWord(w.ro)) && !labels.includes('需加强')) labels.push('需加强');
  return labels;
}

function getAuxiliaryLabelText(w) {
  const labels = getAuxiliaryLabels(w);
  return labels.length ? labels.join(' · ') : '无';
}

function getContinueAfterGoalText() {
  if (dailyGoal < DAILY_GOAL_MAX) {
    return '想继续学习，可以点下方 +30、+50，或自定义扩展今天的任务量。';
  }
  return '今日任务已到上限，可以继续做测验或打开需加强列表巩固。';
}

function getGoalInputValue() {
  const input = document.getElementById('goal-input');
  return parseInt(input?.value || '', 10);
}

function setGoalInputValue(value) {
  const input = document.getElementById('goal-input');
  if (input) input.value = value;
}

async function setDailyGoalAndRebuild(goal, message = '每日任务目标已更新') {
  const nextGoal = normalizeDailyGoalValue(goal, defaultDailyGoal);
  defaultDailyGoal = nextGoal;
  dailyGoal = nextGoal;
  setGoalInputValue(nextGoal);
  clearTodayTemporaryGoal();
  await apiSetDailyGoal(currentUser.id, nextGoal);
  todayQueue = buildOpenTodayQueue(dailyGoal);
  await saveTodayQueue();
  await apiUpdateTodayLog(currentUser.id, todayNewWords, dailyGoal, defaultDailyGoal, { completed: isDailyCheckinDone() });
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
    showToast(`每日任务目标最高为 ${DAILY_GOAL_MAX}`);
    return;
  }
  dailyGoal = nextGoal;
  setGoalInputValue(defaultDailyGoal);
  writeTodayTemporaryGoal(nextGoal);
  todayQueue = buildOpenTodayQueue(dailyGoal);
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
  if (dailyGoal > defaultDailyGoal) writeTodayTemporaryGoal(dailyGoal);
  const payload = {
    goal: dailyGoal,
    word_ro: todayQueue,
    completed_word_ro: [...todayQueueCompleted],
    completed: isCurrentTodayGoalDone()
  };
  const savePromise = apiSaveDailyQueue(currentUser.id, payload, { forceLocal: !!options.forceLocal });
  if (options.background) {
    todayQueueRecord = { user_id: currentUser.id, queue_date: getLocalDateKey(), ...payload, local: true };
    savePromise.then((record) => {
      todayQueueRecord = record;
      if (record?.syncError) {
        setSyncBadge('队列同步失败', '');
        showProgressSaveWarning(`每日队列未能云端保存：${record.syncError}`);
      }
    }).catch((error) => {
      console.warn('Daily queue background save failed', error);
      setSyncBadge('队列待同步', '');
    });
  } else {
    todayQueueRecord = await savePromise;
  }
  if (todayQueueRecord?.syncError) {
    setSyncBadge('队列同步失败', '');
    showProgressSaveWarning(`每日队列未能云端保存：${todayQueueRecord.syncError}`);
  }
  dailyQueueVersion++;
  invalidateCalendarCache();
  invalidateQuizPracticePool();
  return todayQueueRecord;
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

  setAddRo(todayQueueCompleted, canonicalRo);
  if (isQueuedWord) {
    todayQueue = roListWithout(todayQueue, canonicalRo);
  }
  todayNewWords = todayQueueCompleted.size;
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
  apiUpdateTodayLog(currentUser.id, todayNewWords, dailyGoal, defaultDailyGoal, { completed: checkinDone }).catch(error => {
    console.warn('Today log background save failed', error);
    setSyncBadge('今日记录待同步', '');
  });
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
  todayNewWords = todayQueueCompleted.size;
  if (options.fast) {
    return { counted: !wasSeen, reachedGoal: false };
  }
  writeTodaySeenWords();
  const checkinDone = isDailyCheckinDone();
  todayLog = { ...(todayLog || {}), user_id: currentUser.id, log_date: getLocalDateKey(), new_words: todayNewWords, goal: dailyGoal, completed: checkinDone };
  apiUpdateTodayLog(currentUser.id, todayNewWords, dailyGoal, defaultDailyGoal, { completed: checkinDone }).catch(error => {
    console.warn('Today log background save failed', error);
    setSyncBadge('今日记录待同步', '');
  });
  invalidateCalendarCache();
  renderDailyGoal();
  updateTodayCalendarCell();
  renderReviewPanel();
  updateReviewBadge();
  return { counted: !wasSeen, reachedGoal: false };
}

async function recordTodayWord(wordRo, options = {}) {
  const canonicalRo = canonicalWordRo(wordRo);
  if (!canonicalRo) return false;
  await ensureStartedProgressForTodayWord(canonicalRo);
  return commitTodayWordExposure(canonicalRo, options);
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
    setProgress(canonicalRo, repairedProgress);
    pendingEntries.push([canonicalRo, repairedProgress]);
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

/**
 * 根据答题记录计算熟练度
 * unknown  → 没答过题
 * learning → 答过但正确率 < 80% 或答题次数 < 3
 * mastered → 答题次数 ≥ 3、正确率 ≥ 80%，且 reviewStage >= 2
 */
function calcLevel(qr, qt, known = false, progress = {}) {
  const scheduler = normalizeScheduler(progress);
  if (scheduler.cardState === 'mastered') return 'mastered';
  if (!qt) return known ? 'learning' : 'unknown';
  const pct = qr / qt;
  if (
    scheduler.cardState === 'review' &&
    scheduler.intervalDays >= 15 &&
    scheduler.memoryStrength >= 75 &&
    !scheduler.needsReinforcement
  ) return 'mastered';
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
  const stage = getProgressReviewStage(prev);
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
  if (progress.seen || getProgressReviewStage(progress)) return 'learning';
  return 'unknown';
}

function isStartedNotMastered(progress) {
  if (!hasWordProgress(progress)) return false;
  return getStoredLevel(progress) !== 'mastered';
}

const LEVEL_LABEL = { unknown: '未学', queued: '今日待学', learning: '学习中', review: '待复习', reinforcing: '需加强', mastered: '已掌握' };
const LEVEL_COLOR = { unknown: 'var(--text3)', queued: 'var(--blue)', learning: 'var(--yellow)', review: 'var(--red)', reinforcing: 'var(--red)', mastered: 'var(--green)' };
const LEVEL_BG    = { unknown: 'var(--bg3)', queued: 'var(--blue-bg)', learning: '#fffbeb', review: 'var(--red-bg)', reinforcing: 'var(--red-bg)', mastered: 'var(--green-bg)' };
const LEVEL_TC    = { unknown: 'var(--text2)', queued: 'var(--blue-text)', learning: 'var(--yellow-text)', review: 'var(--red-text)', reinforcing: 'var(--red-text)', mastered: 'var(--green-text)' };
const RO_VOWELS = 'aeiouăâîAEIOUĂÂÎ';
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
  const scoped = curCat === '全部' ? W : W.filter(w => w.cat === curCat);
  if (flashMode === 'today') {
    filtered = getDailyWordList(scoped, { includeFallback: true });
    if (!filtered.length && curCat !== '全部') {
      const allDailyWords = getDailyWordList(W, { includeFallback: true, ignoreCategory: true });
      if (allDailyWords.length) {
        curCat = '全部';
        filtered = allDailyWords;
        buildCats();
      }
    }
  } else if (flashMode === 'review') {
    filtered = sortReviewDueWithWeakPriority(scoped).filter(isDueReviewWord);
  } else {
    filtered = sortByReviewPriority(scoped).filter(w => getReviewBucket(w) !== 2);
  }
  idx = Math.min(idx, Math.max(filtered.length - 1, 0));
  renderReviewPanel();
}

function isUnseenWord(w) {
  const p = getProgress(w.ro);
  return !hasWordProgress(p) && !setHasRo(todayQueueCompleted, w.ro) && !setHasRo(todaySeenWords, w.ro);
}

function getUnseenWords(words = W) {
  return words
    .filter(isUnseenWord)
    .sort((a, b) => String(a.ro).localeCompare(String(b.ro), 'ro'));
}

async function addWordToTodayQueue(wordRo) {
  const w = getWordByRo(wordRo);
  if (!w) { showToast('找不到该词条'); return; }
  if (!isUnseenWord(w)) { showToast('这个词已经学过，请用智能练习或需加强列表巩固'); return; }
  const selectedKeys = new Set([...todayQueue, ...todayQueueCompleted].map(roKey));
  const remainingSlots = Math.max(0, dailyGoal - selectedKeys.size);
  if (!remainingSlots) {
    showToast('今日新词名额已用完；提高今日任务目标后可以继续添加新词');
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
  const raw = String(cat || '').trim();
  if (!raw) return 'Daily Life';
  const key = raw.toLocaleLowerCase('en');
  const direct = [...SUBJECT_CATEGORIES, ...GRAMMAR_CATEGORIES].find(c => c.toLocaleLowerCase('en') === key);
  return direct || CATEGORY_ALIASES[raw] || CATEGORY_ALIASES[key] || raw;
}

function normalizeWordCategory(word) {
  return { ...word, ro: normalizeWordText(word.ro), rawCat: word.rawCat ?? word.cat, cat: normalizeCategory(word.cat) };
}

function categoryRank(cat) {
  const idx = CATEGORY_ORDER.indexOf(cat);
  return idx >= 0 ? idx : CATEGORY_ORDER.length;
}

function populateCategoryDatalist() {
  const options = [...SUBJECT_CATEGORIES, ...GRAMMAR_CATEGORIES]
    .map(c => `<option value="${escapeHtml(c)}"></option>`)
    .join('');
  document.querySelectorAll('#cat-list, #edit-cat-list').forEach(el => { el.innerHTML = options; });
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
  if (!hasWordProgress(p) && roListIncludes(todayQueue, wordRo) && !setHasRo(todayQueueCompleted, wordRo)) return 'queued';
  if (hasWordProgress(p) && (scheduler.needsReinforcement || scheduler.cardState === 'reinforcing')) return 'reinforcing';
  if (hasWordProgress(p) && scheduler.cardState === 'mastered') return 'mastered';
  if (hasWordProgress(p) && isReviewDue(p)) return 'review';
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
  const grammarQt = getProgressGrammarQt(p);
  const grammarQr = getProgressGrammarQr(p);
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

function getDifficultWords(words = W) {
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

function getWeakLearningWords(words = W) {
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
    const current = getProgressReviewStage(progress);
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
  const current = getProgressReviewStage(progress);
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

function isRoVowel(ch) {
  return RO_VOWELS.includes(ch);
}

function autoStressToken(token) {
  const groups = [];
  let start = -1;

  for (let i = 0; i < token.length; i++) {
    if (isRoVowel(token[i])) {
      if (start === -1) start = i;
    } else if (start !== -1) {
      groups.push({ start, end: i });
      start = -1;
    }
  }
  if (start !== -1) groups.push({ start, end: token.length });
  if (!groups.length) return token;

  const target = groups[Math.max(0, groups.length - 2)];
  return token
    .split('')
    .map((ch, i) => (i >= target.start && i < target.end ? ch.toUpperCase() : ch))
    .join('');
}

function autoStressWord(value) {
  return String(value || '')
    .split(/([\s-]+)/)
    .map(part => (/^[\s-]+$/.test(part) ? part : autoStressToken(part)))
    .join('');
}

function getStressDisplay(w) {
  const manual = String(w?.ipa || '').trim();
  if (manual) return { text: manual, auto: false };
  return { text: autoStressWord(w?.ro || ''), auto: true };
}

function isGrammarUnverified(w) {
  return /待核对|待补充|未核对/.test(getGrammarInfo(w));
}

function isStressUnverified(w) {
  return getStressDisplay(w).auto;
}

function isWordUnverified(w) {
  return isGrammarUnverified(w) || isStressUnverified(w);
}

function unverifiedBadgeHtml(w) {
  return isWordUnverified(w) ? '<span class="unverified-badge">未核对</span>' : '';
}

function normalizeStressText(value) {
  return String(value || '')
    .replace(/^\/|\/$/g, '')
    .replace(/[ˌ']/g, '')
    .trim();
}

function lowerRo(value) {
  return String(value || '').toLocaleLowerCase('ro');
}

function underlineTokenByUppercase(token) {
  const chars = [...token];
  const upperIndexes = chars
    .map((ch, i) => (/[A-ZĂÂÎȘȚ]/.test(ch) ? i : -1))
    .filter(i => i >= 0);
  if (!upperIndexes.length) return escapeHtml(lowerRo(token));

  const start = upperIndexes[0];
  const end = upperIndexes[upperIndexes.length - 1] + 1;
  return `${escapeHtml(lowerRo(chars.slice(0, start).join('')))}<span class="stress-mark">${escapeHtml(lowerRo(chars.slice(start, end).join('')))}</span>${escapeHtml(lowerRo(chars.slice(end).join('')))}`;
}

function underlineTokenByStressMark(token) {
  const idx = token.indexOf('ˈ');
  if (idx < 0) return underlineTokenByUppercase(token);
  const clean = token.replace('ˈ', '');
  const chars = [...clean];
  const start = [...token.slice(0, idx)].length;
  let end = chars.length;
  for (let i = start + 1; i < chars.length; i++) {
    if (/[-.\s/]/.test(chars[i])) { end = i; break; }
  }
  return `${escapeHtml(lowerRo(chars.slice(0, start).join('')))}<span class="stress-mark">${escapeHtml(lowerRo(chars.slice(start, end).join('')))}</span>${escapeHtml(lowerRo(chars.slice(end).join('')))}`;
}

function stressToHtml(text) {
  const normalized = normalizeStressText(text);
  if (!normalized) return '';
  return normalized
    .split(/(\s+)/)
    .map(part => (/^\s+$/.test(part) ? part : underlineTokenByStressMark(part)))
    .join('');
}

function setStressHtml(id, w) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = stressToHtml(getStressDisplay(w).text);
}

function inferGrammarInfo(w) {
  const cat = String(w?.cat || '');
  const ro = String(w?.ro || '').toLocaleLowerCase('ro');
  if (cat.includes('动词')) return '动词 · 变位待补充';
  if (cat.includes('形容词')) return '形容词';
  if (cat.includes('副词')) return '副词';
  if (cat.includes('介词')) return '介词';
  if (cat.includes('连词') || cat.includes('连接词')) return '连词';
  if (cat.includes('代词')) return '代词';
  if (cat.includes('数词')) return '数词';
  if (cat.includes('感叹')) return '感叹词';
  if (/(a|ea|e|i|î)$/.test(ro) && cat.includes('动')) return '动词 · 变位待补充';
  return '名词 · 复数待补充';
}

function getGrammarInfo(w) {
  return String(w?.grammar_note || w?.grammar || w?.forms || w?.hint || '').trim() || inferGrammarInfo(w);
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
  return curCat === '全部' ? W : W.filter(w => w.cat === curCat);
}

function getReviewPanelMetrics(scoped) {
  const key = [
    curCat,
    W.length,
    scoped.length,
    dailyGoal,
    todayNewWords,
    defaultDailyGoal,
    progressVersion,
    dailyQueueVersion
  ].join('|');
  if (reviewPanelMetricsCache.key === key && reviewPanelMetricsCache.metrics) {
    return reviewPanelMetricsCache.metrics;
  }
  const due = getRemainingDueReviewWords(scoped).length;
  const rawUnseenRemaining = getUnseenWords(scoped)
    .filter(w => !setHasRo(todaySeenWords, w.ro) && !setHasRo(todayQueueCompleted, w.ro))
    .length;
  const remainingSlots = Math.max(0, dailyGoal - todayNewWords);
  const queuedKeys = new Set([...todayQueue, ...todayQueueCompleted].map(roKey));
  const remainingDueReviews = getRemainingTodayReviewWords().length;
  const availableNewSlots = Math.max(0, dailyGoal - queuedKeys.size);
  const unseenRemaining = Math.min(rawUnseenRemaining, availableNewSlots);
  const metrics = { due, remainingSlots, remainingDueReviews, unseenRemaining };
  reviewPanelMetricsCache = { key, metrics };
  return metrics;
}

function renderReviewPanel() {
  const dueEl = document.getElementById('review-due-count');
  if (!dueEl) return;
  const scoped = getCurrentScopeWords();
  const { due, remainingSlots, remainingDueReviews, unseenRemaining } = getReviewPanelMetrics(scoped);
  const current = filtered[idx];
  setText('review-due-count', due);
  setText('review-new-count', `${todayNewWords}/${dailyGoal}`);
  setText('review-new-remaining', unseenRemaining);
  const nextBatch = Math.min(20, Math.max(0, remainingDueReviews || remainingSlots));
  const currentGoalDone = isCurrentTodayGoalDone();
  const baseGoalDone = isDefaultGoalDone();
  const summaryText = currentGoalDone
    ? `已完成 ${todayNewWords}/${dailyGoal}`
    : (remainingDueReviews > 0 ? `先复习 ${nextBatch} 个` : `继续 ${Math.min(20, remainingSlots)} 个任务`);
  setText('flash-control-summary', summaryText);
  const taskType = current ? getDailyTaskType(current) : '';
  const baseNote = currentGoalDone
    ? `今日任务已完成：${todayNewWords}/${dailyGoal} 个。${getContinueAfterGoalText()}`
    : (baseGoalDone
      ? `今日固定目标已完成：${todayNewWords}/${defaultDailyGoal} 个；临时加量进度 ${todayNewWords}/${dailyGoal}。`
      : (remainingDueReviews > 0
        ? `先完成一组 ${nextBatch} 个到期复习，再学习新词。${taskType ? `当前卡片：${taskType}。` : ''}`
        : `继续完成今日任务，建议一次做 ${Math.min(20, remainingSlots)} 个。${taskType ? `当前卡片：${taskType}。` : ''}`));
  setText('review-note', lastLearningHint || baseNote);
  renderTodayFocus({ due, remainingSlots, remainingDueReviews, unseenRemaining });
  document.querySelectorAll('.study-mode-btn[data-mode]').forEach(btn => btn.classList.toggle('active', btn.dataset.mode === flashMode));
  setText('flash-mode-title', getFlashModeLabel());
}

function setStepState(id, state) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.toggle('active', state === 'active');
  el.classList.toggle('done', state === 'done');
}

function renderTodayFocus(metrics = null) {
  const focus = document.getElementById('today-focus');
  if (!focus) return;
  focus.style.display = '';
  const scoped = getCurrentScopeWords();
  const m = metrics || getReviewPanelMetrics(scoped);
  const currentDone = isCurrentTodayGoalDone();
  const dueCount = m.remainingDueReviews ?? getRemainingDueReviewWords(W).length;
  const wrongCount = getWrongWords().length;
  const remainingTasks = Math.max(0, dailyGoal - todayNewWords);
  const reviewState = dueCount > 0 ? 'active' : 'done';
  const learnState = dueCount > 0 ? '' : (currentDone ? 'done' : 'active');
  const quizState = dueCount === 0 && currentDone ? 'active' : '';
  setStepState('today-step-review', reviewState);
  setStepState('today-step-learn', learnState);
  setStepState('today-step-quiz', quizState);
  setText('today-step-review-meta', dueCount > 0 ? `${dueCount} 个到期` : '已清空');
  setText('today-step-learn-meta', currentDone ? `${todayNewWords} / ${dailyGoal}` : `还差 ${remainingTasks} 个`);
  setText('today-step-quiz-meta', wrongCount > 0 ? `${wrongCount} 个需加强` : '智能练习');
  const title = dueCount > 0
    ? `今日路径：先复习 ${dueCount} 个`
    : (currentDone ? '今日路径：做一轮智能测验' : `今日路径：继续 ${Math.min(20, remainingTasks)} 个任务`);
  const action = dueCount > 0 ? '复习优先' : (currentDone ? '巩固检查' : '继续学习');
  setText('today-focus-title', title);
  setText('today-focus-action', action);
}

function setFlashMode(mode) {
  flashMode = mode;
  idx = 0;
  flipped = false;
  flashHistory = [];
  flashOverrideRo = null;
  const card = document.getElementById('main-card');
  if (card) card.classList.remove('flipped');
  applyFilters();
  renderCard();
}

// ── 统计 ─────────────────────────────────────────────────

function upStats() {
  const vals = Object.values(progressMap);
  const mastered = vals.filter(p => getStoredLevel(p) === 'mastered').length;
  const learning = vals.filter(isStartedNotMastered).length;
  const dueCount = getRemainingDueReviewWords(W).length;
  const wbCount = getWrongWords().length;

  setText('s-mastered', mastered);
  setText('s-learning', learning);
  setText('s-wrong', dueCount);
  const masteryPct = W.length > 0 ? Math.round(mastered / W.length * 100) : 0;
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

function setSyncBadge(txt, cls) {
  const el = document.getElementById('sync-badge');
  el.textContent = txt;
  el.className = 'sync-badge ' + (cls || '');
}

function showProgressSaveWarning(message) {
  const now = Date.now();
  if (now - lastProgressWarningAt < 5000) return;
  lastProgressWarningAt = now;
  showToast(message);
}

function handleProgressSaveStatus(status) {
  if (!status) return false;
  if (status.memoryBackup?.ok === false) {
    setSyncBadge('本机备份失败', '');
    showProgressSaveWarning('本机加强记录备份保存失败，请导出进度或清理浏览器存储');
    return true;
  }
  if (status.memoryBackedByDb === false) {
    setSyncBadge('本机备份', 'saved');
    showProgressSaveWarning('需加强记录暂存在本机；数据库缺少新进度字段');
    return true;
  }
  return false;
}

async function apiSaveProgressWithSessionRetry(userId, wordRo, known, qr, qt, level, review, memory) {
  try {
    return await apiSaveProgress(userId, wordRo, known, qr, qt, level, review, null, memory);
  } catch (firstError) {
    if (isOfflineMode()) throw firstError;
    try {
      const { data, error } = await sb.auth.refreshSession();
      if (error) throw error;
      if (data?.user) currentUser = data.user;
      return await apiSaveProgress(currentUser.id, wordRo, known, qr, qt, level, review, null, memory);
    } catch (retryError) {
      retryError.firstError = firstError;
      throw retryError;
    }
  }
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
  const grammarQr = coreMemory ? getProgressGrammarQr(prev) : getProgressGrammarQr(prev) + (success ? 1 : 0);
  const grammarQt = coreMemory ? getProgressGrammarQt(prev) : getProgressGrammarQt(prev) + 1;
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
  const prev = getProgress(canonicalRo) || {};
  const { memory, progress: nextProgress } = buildProgressUpdate(prev, known, qr, qt, success, options);
  setProgress(canonicalRo, nextProgress);
  const localStatus = typeof queueProgressForSync === 'function'
    ? queueProgressForSync(currentUser.id, canonicalRo, { ...nextProgress, pendingSync: true }, memory)
    : { ok: false };
  if (localStatus.ok) {
    setProgress(canonicalRo, { ...nextProgress, pendingSync: !isOfflineMode() });
    setSyncBadge(isOfflineMode() ? '已存本机' : '本机待同步', isOfflineMode() ? 'saved' : '');
    if (!options.skipDailyQueueReconcile) await reconcileTodayQueueAfterProgress(canonicalRo);
  } else {
    if (Object.keys(prev).length) {
      setProgress(canonicalRo, prev);
    } else {
      deleteProgress(canonicalRo);
    }
    setSyncBadge('本机保存失败', '');
    showProgressSaveWarning('本机保存失败，请导出进度或清理浏览器存储');
  }
  setTimeout(() => setSyncBadge('', ''), 2000);
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

function runAfterCardSwap(task) {
  setTimeout(task, CARD_CONTENT_SWAP_DELAY_MS + 20);
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
      setProgress(entry.wordRo, { ...entry.progress, pendingSync: !isOfflineMode() });
    });
    setSyncBadge(isOfflineMode() ? '已存本机' : '本机待同步', isOfflineMode() ? 'saved' : '');
  } else {
    setSyncBadge('本机保存失败', '');
    showProgressSaveWarning('本机保存失败，请导出进度或清理浏览器存储');
  }
  setTimeout(() => setSyncBadge('', ''), 2000);
  invalidateQuizPracticePool();
  renderReviewPanel();
  upStats();
  updateReviewBadge();
}

function persistFastCardAnswer(result) {
  if (!result?.canonicalRo || !currentUser?.id) return;
  fastProgressQueue.set(result.canonicalRo, {
    wordRo: result.canonicalRo,
    progress: { ...result.progress, pendingSync: true },
    memory: result.memory
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
  apiUpdateTodayLog(currentUser.id, todayNewWords, dailyGoal, defaultDailyGoal, { completed: checkinDone }).catch(error => {
    console.warn('Today log background save failed', error);
    setSyncBadge('今日记录待同步', '');
  });
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

function switchPage(p) {
  if (p !== 'quiz' && isQuizInProgress()) resetQuizSession();
  if (p !== 'wrongbook' && wbAutoAdvanceTimer) {
    clearTimeout(wbAutoAdvanceTimer);
    wbAutoAdvanceTimer = null;
  }
  const pages = ['flash', 'list', 'wrongbook', 'quiz', 'stats', 'guide', 'admin'];
  pages.forEach((s) => {
    document.querySelectorAll(`.nav-tab[data-page="${s}"]`).forEach(tab => tab.classList.toggle('active', s === p));
    const page = document.getElementById('page-' + s);
    if (page) page.classList.toggle('active', s === p);
  });
  closeAccountMenu?.();
  if (p === 'flash') { applyFilters(); renderCard(); renderDailyGoal(); renderCalendar(); }
  if (p === 'quiz') showQuizSetup();
  if (p === 'stats') renderStatsPage();
  if (p === 'list') renderList();
  if (p === 'wrongbook') initWrongbook();
  if (p === 'admin') { restoreAdminSections(); loadAdminStats(); loadAdminPendingWords(); loadAdminReports(); loadAdminUsers(); loadAdminWeeklySummary(); }
}

function switchStatsPanel(panel = 'personal') {
  const allowed = new Set(['personal', 'leaderboard']);
  const next = allowed.has(panel) ? panel : 'personal';
  const statsPage = document.getElementById('page-stats');
  if (!statsPage) return;
  document.querySelectorAll('#page-stats .stats-subtab').forEach(tab => {
    tab.classList.toggle('active', tab.id === `stats-tab-${next}`);
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
    tab.classList.toggle('active', tab.id === `personal-stats-tab-${next}`);
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
    '5': 'wrongbook'
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
  saveAdminSectionState();
}

function switchAdminPanel(panel = 'overview') {
  const allowed = new Set(['overview', 'content', 'users']);
  const next = allowed.has(panel) ? panel : 'overview';
  document.querySelectorAll('#page-admin .admin-subtab').forEach(tab => {
    tab.classList.toggle('active', tab.id === `admin-tab-${next}`);
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
  // Nav badge is scoped to due review inside today's queue; overview cards show all-bank due review.
  const count = getRemainingTodayReviewWords().length;
  badge.textContent = count;
  badge.style.display = count > 0 ? 'inline' : 'none';
}

// ── 每日任务目标 ──────────────────────────────────────────

function openDailyCheckinModal() {
  if (!ensureDailyStateCurrent({ reload: true })) return;
  if (!isCurrentTodayGoalDone()) return;
  const modal = document.getElementById('daily-checkin-modal');
  if (!modal) return;
  setText('checkin-fixed-goal', defaultDailyGoal);
  setText('checkin-today-count', todayNewWords);
  setText('checkin-accuracy', `${getTodayCheckinAccuracy()}%`);
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
  apiUpdateTodayLog(currentUser.id, todayNewWords, dailyGoal, defaultDailyGoal, { completed: true }).catch(error => {
    console.warn('Daily check-in log save failed', error);
    setSyncBadge('打卡待同步', '');
  });
  invalidateCalendarCache();
  closeDailyCheckinModal();
  renderDailyGoal();
  renderCalendar();
  renderReviewPanel();
  showToast('今日已打卡，可以临时加量继续学习');
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

async function continueTodayWithoutLimit() {
  completeDailyCheckin();
  const nextGoal = DAILY_GOAL_MAX;
  dailyGoal = nextGoal;
  setGoalInputValue(defaultDailyGoal);
  writeTodayTemporaryGoal(nextGoal);
  todayQueue = buildOpenTodayQueue(dailyGoal);
  await saveTodayQueue();
  await apiUpdateTodayLog(currentUser.id, todayNewWords, dailyGoal, defaultDailyGoal, { completed: isDailyCheckinDone() });
  invalidateCalendarCache();
  applyFilters();
  renderCard();
  renderDailyGoal();
  renderCalendar();
  showToast('今天已切换为不限量继续；明天仍按固定目标');
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
  const title = currentDone ? '今日任务已完成' : (baseDone ? '今日固定目标已完成' : '今日任务');
  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
      <span style="font-size:13px;font-weight:600;color:var(--text)">
        ${title}
      </span>
      <span style="font-size:13px;color:var(--text2)">${todayNewWords} / ${dailyGoal} 个</span>
    </div>
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
        <button class="btn-sm" onclick="extendTodayGoal(30)">+30</button>
        <button class="btn-sm" onclick="extendTodayGoal(50)">+50</button>
        <button class="btn-sm" onclick="extendTodayGoalCustom()">自定义</button>
      </div>` : ''}`;
  renderDailyReminderSettings();
  maybePromptDailyCheckin();
}

async function saveGoalSetting() {
  const val = getGoalInputValue();
  if (!val || val < 1 || val > DAILY_GOAL_MAX) {
    showToast(`请输入1-${DAILY_GOAL_MAX}之间的数字`);
    return;
  }
  await setDailyGoalAndRebuild(val);
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
  const present = new Set(W.map(w => normalizeCategory(w.cat)).filter(Boolean));
  if (DEXONLINE_VERB_FALLBACK_WORDS.length) present.add('verb');
  const cats = CATEGORY_ORDER
    .filter(c => c === '全部' || present.has(c))
    .concat([...present].filter(c => !CATEGORY_ORDER.includes(c)).sort((a, b) => a.localeCompare(b, 'en')));
  const preferred = ['全部', 'Daily Life', 'verb', 'adjective', 'Medicine', 'Law', 'Education', 'Science'];
  let primary = preferred.filter(c => cats.includes(c));
  if (curCat && !primary.includes(curCat) && cats.includes(curCat)) primary.push(curCat);
  primary = primary.slice(0, 9);
  const secondary = cats.filter(c => !primary.includes(c));
  const buttonHtml = (c) =>
    `<button class="cat-chip${c === curCat ? ' active' : ''}" onclick="setCat(decodeURIComponent('${encodedArg(c)}'))">${escapeHtml(c)}</button>`;
  document.getElementById('cat-bar').innerHTML = [
    ...primary.map(buttonHtml),
    secondary.length ? `<details class="cat-more">
      <summary>全部分类</summary>
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
  const key = roKey(wordRo);
  return W.find(w => roKey(w.ro) === key) || null;
}

function getCurrentFlashWord() {
  return flashOverrideRo ? getWordByRo(flashOverrideRo) : filtered[idx];
}

function renderCard() {
  if (flashCardRenderTimer) {
    clearTimeout(flashCardRenderTimer);
    flashCardRenderTimer = null;
  }
  const overrideWord = flashOverrideRo ? getWordByRo(flashOverrideRo) : null;
  if (flashOverrideRo && !overrideWord) flashOverrideRo = null;

  if (!filtered.length && !overrideWord) {
    setText('fc-cat', curCat === '全部' ? '' : curCat);
    setText('fc-cat2', curCat === '全部' ? '' : curCat);
    const frontHint = document.getElementById('fc-front-hint');
    const hasOpenQueue = hasOpenTodayQueue();
    const deferredQueueCount = getDeferredTodayQueueCount();
    const hasDueReview = getRemainingDueReviewWords(W).length > 0;
    const hasNewWords = getUnseenWords(getCurrentScopeWords()).some(w => !setHasRo(todaySeenWords, w.ro) && !setHasRo(todayQueueCompleted, w.ro));
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
            : (curCat !== '全部' && (hasDueReview || hasNewWords || hasOpenQueue) ? '当前分类没有今日任务' : '今日没有可安排任务'))),
      review: '当前没有到期复习词',
    }[flashMode] || '当前分类暂无可学词';
    const actionText = {
      today: pausedForCheckin || pausedForGoal
        ? '今天的目标已完成，请选择是否继续。'
        : (currentDone
        ? '已达到今日目标，系统不会继续加入新词。'
        : (deferredQueueCount
          ? `${deferredQueueCount} 个词刚标记不认识，系统会按短间隔复习；不会加入新词。`
          : (hasOpenQueue ? '请切换到全部，继续今天固定队列。' : '可以切换分类、提高今日任务目标或去测验'))),
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
    return;
  }
  const w = getCardRenderWord();
  if (!w) return;
  renderCardFront(w);
  renderCardBack(w);
  renderReviewPanel();
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
  const taskType = flashMode === 'today' ? ` · ${getDailyTaskType(w)}` : '';
  document.getElementById('fc-cat').textContent = `${w.cat || ''}${taskType}`;
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
  document.getElementById('fc-cat2').textContent = `${w.cat || ''}${taskType}`;
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
}

// 点卡片：来回翻转
function flipCard() {
  flipped = !flipped;
  document.getElementById('main-card').classList.toggle('flipped', flipped);
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
  renderCard();
  // Force the non-flipped state to commit before restoring the normal answer flip.
  card.offsetHeight;
  requestAnimationFrame(() => {
    card.style.transition = '';
    setFlashcardAnswerButtonsDisabled(false);
  });
}

function nextCard() {
  const current = getCurrentFlashWord();
  if (flashMode === 'today' && (!filtered.length || filtered.length <= 1)) {
    const fallback = getNextDailyFallbackWord(current?.ro);
    if (fallback) {
      if (current) flashHistory.push(current.ro);
      flashOverrideRo = fallback.ro;
      renderFlashCardAfterFrontReset();
      return;
    }
  }
  if (!filtered.length) return;
  if (current && !flashOverrideRo) flashHistory.push(current.ro);
  flashOverrideRo = null;
  idx = (idx + 1) % filtered.length;
  renderFlashCardAfterFrontReset();
}

function shouldAutoStartTodayAfterReview() {
  if (flashMode !== 'review') return false;
  if (!dailyQueueLoaded || shouldPauseTodayStudyForCheckin() || shouldPauseTodayStudyForGoal()) return false;
  if (getRemainingDueReviewWords(W).length > 0) return false;
  return getUnseenWords(W).some(w => !setHasRo(todaySeenWords, w.ro) && !setHasRo(todayQueueCompleted, w.ro));
}

function advanceFlashcardAfterAnswer(currentRo) {
  flashOverrideRo = null;
  if (shouldAutoStartTodayAfterReview()) {
    flashMode = 'today';
    curCat = '全部';
    todayQueue = buildOpenTodayQueue(dailyGoal);
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
 * 记录当前卡片为「今日已完成任务」
 */
async function recordDailyWord() {
  const w = getCurrentFlashWord();
  if (!w) return;
  await completeTodayQueueWord(w.ro);
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
  if (flashcardAnswerInFlight) return;
  const w = getCurrentFlashWord();
  if (!w) return;
  const action = answer === true ? 'known' : (answer === false ? 'unknown' : answer);
  const isKnownAction = action === 'known';
  const isUnknownAction = action === 'unknown';
  const isFuzzyAction = action === 'fuzzy';
  const completesTodayTask = isKnownAction || isFuzzyAction;
  if (!['unknown', 'fuzzy', 'known'].includes(action)) return;
  flashcardAnswerInFlight = true;
  setFlashcardAnswerButtonsDisabled(true);
  try {
    const wasReviewingHistory = !!flashOverrideRo;
    const p = getProgress(w.ro);
    const isReviewTask = flashMode === 'review' || (flashMode === 'today' && p && (p.qt || p.known));
    const interaction = flashMode === 'review'
      ? (isKnownAction ? 'review_correct' : (isFuzzyAction ? 'review_fuzzy' : 'review_wrong'))
      : (isReviewTask
        ? (isKnownAction ? 'review_correct' : (isFuzzyAction ? 'review_fuzzy' : 'review_wrong'))
        : (isKnownAction ? 'flashcard_known' : (isFuzzyAction ? 'flashcard_fuzzy' : 'flashcard_unknown')));
    if (flashMode === 'today') queueTodayAccuracyAttempt(isKnownAction);
    const progressResult = buildNextProgressForInteraction(w.ro, interaction, { skipDailyQueueReconcile: true });
    setProgress(progressResult.canonicalRo, { ...progressResult.progress, pendingSync: !isOfflineMode() });
    let dailyStateResult = null;
    const isOpenTodayWord = flashMode === 'today'
      && roListIncludes(todayQueue, w.ro)
      && !setHasRo(todayQueueCompleted, w.ro);
    if (flashMode === 'today' && completesTodayTask) {
      lastLearningHint = isFuzzyAction
        ? `已按模糊完成今日任务；「${w.zh || w.ro}」明天会继续复习。`
        : '';
      dailyStateResult = isOpenTodayWord
        ? commitTodayWordCompletion(w.ro, { fast: true, deferGoalPrompt: true })
        : null;
    } else if (flashMode === 'today') {
      dailyStateResult = isOpenTodayWord
        ? commitTodayWordExposure(w.ro, { fast: true, deferGoalPrompt: true })
        : null;
      lastLearningHint = dailyStateResult?.counted
        ? `已计入今日新词；「${w.zh || w.ro}」会留在今日任务里继续巩固。`
        : `已保留「${w.zh || w.ro}」在今日任务里；稳定认识后才会完成这个词。`;
    } else if (isUnknownAction) {
      showToast(`这个词会在约 ${LEARNING_RETRY_INTERVAL.label} 后重新出现；如果之后仍答错，会进入需加强列表`);
    } else if (isFuzzyAction) {
      showToast('已按模糊处理，系统会安排较近的复习');
    }
    const shouldStopForGoal = flashMode === 'today' && !!dailyStateResult?.reachedGoal;
    const shouldStopForCheckin = flashMode === 'today' && (shouldPauseTodayStudyForCheckin() || shouldStopForGoal);
    // 跳下一张，重置为中文面
    if (!wasReviewingHistory && !shouldStopForCheckin) flashHistory.push(w.ro);
    if (shouldStopForCheckin) {
      filtered = [];
      flashOverrideRo = null;
      idx = 0;
    } else {
      advanceFlashcardAfterAnswer(w.ro);
    }
    renderNextFlashCardInstantFront();
    persistFastCardAnswer(progressResult);
    if (flashMode === 'today') {
      scheduleTodayStatePersistence(!!dailyStateResult?.reachedGoal);
      if (shouldStopForCheckin && dailyStateResult?.reachedGoal) {
        pendingTodayGoalPrompt = false;
        showDailyGoalCompletionPrompt(true);
      }
    }
  } catch (error) {
    console.warn('Flashcard answer failed', error);
    setFlashcardAnswerButtonsDisabled(false);
    showToast('保存失败，请稍后重试');
  } finally {
    flashcardAnswerInFlight = false;
  }
}

// 「上一个」— 回到上一张的罗语面
function prevCard() {
  const previousRo = flashHistory.pop();
  if (previousRo) {
    const previousIdx = filtered.findIndex(item => item.ro === previousRo);
    if (previousIdx >= 0) idx = previousIdx;
    flashOverrideRo = previousRo;
    flipped = true;
    document.getElementById('main-card').classList.add('flipped');
    renderCard();
    return;
  }
  if (!filtered.length) return;
  flashOverrideRo = null;
  idx = (idx - 1 + filtered.length) % filtered.length;
  flipped = true;
  document.getElementById('main-card').classList.add('flipped');
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

function speak(rate) {
  const w = getCurrentFlashWord();
  if (!w || !String(w.ro || '').trim()) return;
  if (!('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(w.ro);
  u.lang = 'ro-RO'; u.rate = rate;
  const rv = speechSynthesis.getVoices().find(v => v.lang.startsWith('ro'));
  if (rv) u.voice = rv;
  speechSynthesis.speak(u);
}

let guidePronunciationText = '';
let guidePronunciationLabel = '';
let guidePronunciationTts = '';
let guidePronunciationLang = 'ro-RO';

function speakGuidePronunciation(text, label, sourceEl = null, ttsText = '', ttsLang = 'ro-RO') {
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
  const utterance = new SpeechSynthesisUtterance(ttsValue);
  utterance.lang = lang;
  utterance.rate = 0.8;
  const voices = speechSynthesis.getVoices();
  const preferredVoice = voices.find(v => v.lang === lang) || voices.find(v => v.lang.startsWith(lang.split('-')[0]));
  if (preferredVoice) utterance.voice = preferredVoice;
  if (lang.startsWith('ro') && !preferredVoice) {
    const status = document.getElementById('pronunciation-status');
    if (status) status.innerHTML += ' <span style="font-size:12px;color:var(--yellow-text)">未检测到罗马尼亚语语音，系统发音可能偏差</span>';
  }
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

document.addEventListener('click', (event) => {
  const item = event.target.closest?.('.alphabet-item[data-speak],.ph-item[data-speak]');
  if (!item) return;
  const label = item.querySelector('.alphabet-letter,.ph-letter')?.textContent?.trim() || item.dataset.speak;
  const ttsText = item.dataset.ttsMode === 'override' ? item.dataset.tts : '';
  speakGuidePronunciation(item.dataset.speak, label, item, ttsText, item.dataset.ttsLang || 'ro-RO');
});

document.addEventListener('keydown', (event) => {
  const item = event.target.closest?.('.alphabet-item[data-speak],.ph-item[data-speak]');
  if (!item || (event.key !== 'Enter' && event.key !== ' ')) return;
  event.preventDefault();
  const label = item.querySelector('.alphabet-letter,.ph-letter')?.textContent?.trim() || item.dataset.speak;
  const ttsText = item.dataset.ttsMode === 'override' ? item.dataset.tts : '';
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
  return getDifficultWords(W).filter(w => isWrongWord(w.ro));
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
  document.getElementById('wb-tab-badge').textContent = total;
  document.getElementById('wb-tab-badge').style.display = total > 0 ? 'inline' : 'none';
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

  document.getElementById('wb-cat').textContent = w.cat || '';
  document.getElementById('wb-cat2').textContent = w.cat || '';
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
}

function flipWbCard() {
  wbFlipped = !wbFlipped;
  document.getElementById('wb-card').classList.toggle('flipped', wbFlipped);
}

function renderWrongbookCardAfterFrontReset() {
  const card = document.getElementById('wb-card');
  if (!card || !card.classList.contains('flipped')) {
    renderWrongbookCard();
    return;
  }
  wbFlipped = false;
  card.classList.remove('flipped');
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

function getActiveStudyPool() {
  const scoped = curCat === '全部' ? W : W.filter(w => w.cat === curCat);
  return sortByReviewPriority(scoped);
}

function getScopedPracticePool() {
  const scoped = curCat === '全部' ? W : W.filter(w => w.cat === curCat);
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
  return '把这个词加入需加强列表后，系统会在智能练习里提高它的优先级。';
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
    ? '系统会优先抽到期、需加强和学习中的词，适合每天完成任务后检查记忆。'
    : `${getPracticeScopeLabel()} · ${modeName}${qExerciseMode === 'translation' ? ` · ${qMode === 'zh' ? '中文到罗语' : '罗语到中文'}` : ''}`;
  document.getElementById('quiz-area').innerHTML = `
    <div class="quiz-section quiz-start-panel">
      <div class="quiz-start-meta">${curCat !== '全部' ? curCat : '全部分类'} · ${getPracticeScopeLabel()} · ${modeName} · ${pool.length} 题</div>
      <div class="quiz-start-title">${escapeHtml(primaryTitle)}</div>
      <div class="quiz-start-sub">${escapeHtml(primarySub)}</div>
      <div style="font-size:13px;font-weight:750;margin-bottom:.8rem;color:var(--text2)">本轮题目数</div>
      <div class="quiz-size-row">
        <button class="qsize-btn${qSize===20?' active':''}" data-n="20" onclick="setQSize(20)">20题</button>
        <button class="qsize-btn${qSize===50?' active':''}" data-n="50" onclick="setQSize(50)">50题</button>
        <button class="qsize-btn${qSize===100?' active':''}" data-n="100" onclick="setQSize(100)">100题</button>
        <button class="qsize-btn${qSize===0?' active':''}" data-n="0" onclick="setQSize(0)">全部(${pool.length}题)</button>
      </div>
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

function showResult() {
  qStarted = false;
  const pct = qRoundTotal > 0 ? Math.round(qRoundRight / qRoundTotal * 100) : 0;
  const wrongCount = getWrongWords().length;
  const dueCount = getRemainingDueReviewWords(W).length;
  const nextTitle = qRoundWrong > 0
    ? `本轮错了 ${qRoundWrong} 题`
    : (dueCount > 0 ? `还有 ${dueCount} 个到期词` : '本轮状态稳定');
  const nextText = qRoundWrong > 0
    ? '建议马上练需加强列表，趁错误记忆还新鲜，把薄弱词修掉。'
    : (dueCount > 0
      ? '先完成到期复习，再继续新词或专项练习。'
      : '可以再做一轮智能练习，或回到今日任务继续扩大词量。');
  const primaryAction = qRoundWrong > 0 && wrongCount > 0
    ? `<button class="restart-btn" style="border-color:var(--red);color:var(--red-text)" onclick="switchPage('wrongbook')">练需加强</button>`
    : (dueCount > 0
      ? `<button class="restart-btn" style="border-color:var(--blue);color:var(--blue-text)" onclick="setPracticeScope('due');switchPage('quiz')">复习到期词</button>`
      : `<button class="restart-btn" style="border-color:var(--blue);color:var(--blue-text)" onclick="startDefaultSmartQuiz()">再做智能练习</button>`);
  document.getElementById('quiz-area').innerHTML = `
    <div class="result-box">
      <div class="result-score">${qRoundRight}/${qRoundTotal}</div>
      <div class="result-label">本轮正确率 ${pct}% · ${pct >= 80 ? '稳定' : pct >= 60 ? '还需巩固' : '需要加强'}</div>
      <div class="result-next">
        <div class="result-next-title">${escapeHtml(nextTitle)}</div>
        <div class="result-next-text">${escapeHtml(nextText)}</div>
      </div>
      ${wrongCount > 0 ? `<div style="font-size:13px;color:var(--red-text);margin-bottom:16px">需加强列表有 ${wrongCount} 个词待练习</div>` : ''}
      <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap">
        ${primaryAction}
        <button class="restart-btn" onclick="startQuiz()">再来一轮</button>
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
  const goal = Number(log.goal || dailyGoal || 20);
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
  const mastered = vals.filter(p => getStoredLevel(p) === 'mastered').length;
  const learning = vals.filter(isStartedNotMastered).length;
  const known = vals.filter(p => p.known).length;
  const qr = vals.reduce((sum, p) => sum + (p.qr || 0), 0);
  const qt = vals.reduce((sum, p) => sum + (p.qt || 0), 0);
  return { mastered, learning, known, qr, qt, accuracy: qt ? Math.round(qr / qt * 100) : 0 };
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
    const summary = calcProgressSummary(progressMap);
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
    catEl.innerHTML = '<div class="empty-state">分类统计暂时无法读取</div>';
    if (hardEl) hardEl.innerHTML = '<div class="empty-state">错词统计暂时无法读取</div>';
  }
}

function renderStudyCoach(summary, logs = []) {
  const el = document.getElementById('study-coach');
  if (!el) return;
  const dueCount = getRemainingDueReviewWords(W).length;
  const wrongCount = getWrongWords().length;
  const weakCount = getWeakLearningWords(W).length;
  const weakCat = getWeakestCategory();
  const todayOpen = todayQueue.filter(ro => !setHasRo(todayQueueCompleted, ro)).length;
  const items = [];
  if (dueCount) items.push({ title: `先复习 ${dueCount} 个到期词`, meta: '这是今天最该优先完成的任务', kind: 'due' });
  if (wrongCount) items.push({ title: `再练 ${wrongCount} 个需加强词`, meta: '把最近答错的词单独修掉', kind: 'wrong' });
  if (weakCount) items.push({ title: `继续练 ${weakCount} 个学习中词`, meta: '还没稳定掌握，适合短轮测验', kind: 'weak' });
  if (todayOpen) items.push({ title: `完成今日剩余 ${todayOpen} 个任务`, meta: `${todayNewWords}/${dailyGoal} 已完成`, kind: 'today' });
  if (weakCat) items.push({ title: `薄弱分类：${weakCat.cat}`, meta: `掌握率 ${weakCat.pct}%，建议按分类补强`, kind: 'cat', arg: weakCat.cat });
  if (!items.length) items.push({ title: `做一轮智能测验`, meta: `当前正确率 ${summary.accuracy}%，用测验检查是否真的记住`, kind: 'quiz' });
  el.innerHTML = items.slice(0, 4).map(item => `
    <div class="hard-row">
      <div class="hard-main">
        <div class="hard-word">${escapeHtml(item.title)}</div>
        <div class="hard-meta">${escapeHtml(item.meta || '')}</div>
      </div>
      <button class="btn-sm" onclick="startCoachAction(decodeURIComponent('${encodedArg(item.kind)}'),decodeURIComponent('${encodedArg(item.arg || '')}'))">开始</button>
    </div>`).join('');
}

function startCoachAction(kind, arg = '') {
  if (kind === 'due') { setPracticeScope('due'); switchPage('quiz'); return; }
  if (kind === 'wrong') { switchPage('wrongbook'); return; }
  if (kind === 'weak') { setPracticeScope('weak'); switchPage('quiz'); return; }
  if (kind === 'today') { setFlashMode('today'); switchPage('flash'); return; }
  if (kind === 'cat') { setCat(arg); switchPage('flash'); return; }
  switchPage('quiz');
  startDefaultSmartQuiz();
}

function getWeakestCategory() {
  const groups = {};
  W.forEach(w => {
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
  const dueCount = getRemainingDueReviewWords(W).length;
  const wrongCount = getWrongWords().length;
  const tasks30 = fillDailyLogs(logs, 30).reduce((sum, l) => sum + (l.new_words || 0), 0);
  const badges = [
    { name: '入门 100', done: summary.mastered >= 100, meta: `${summary.mastered}/100 已掌握` },
    { name: '稳定 7 天', done: calcStreak(logs) >= 7, meta: `${calcStreak(logs)} 天连续` },
    { name: '今日清空', done: dueCount === 0, meta: `${dueCount} 个到期` },
    { name: '加强清零', done: wrongCount === 0, meta: `${wrongCount} 个需加强` },
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
    version: 1,
    exportedAt: new Date().toISOString(),
    user: { id: currentUser?.id || null, email: currentUser?.email || null },
    dailyGoal: defaultDailyGoal,
    todayGoal: dailyGoal,
    progress: progressMap,
    dailyQueue: {
      word_ro: todayQueue,
      completed_word_ro: [...todayQueueCompleted],
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

async function importProgressBackup(file) {
  if (!file) return;
  try {
    const payload = JSON.parse(await file.text());
    if (!payload || payload.app !== 'romanian-vocab' || !payload.progress) throw new Error('文件格式不正确');
    const incoming = payload.progress || {};
    replaceProgressMap({ ...progressMap, ...incoming });
    const rows = Object.entries(incoming).slice(0, 1000);
    let importWarningShown = false;
    for (const [wordRo, p] of rows) {
      const saveStatus = await apiSaveProgress(
        currentUser.id,
        canonicalWordRo(wordRo),
        !!p.known,
        p.qr || 0,
        p.qt || 0,
        p.level || getStoredLevel(p),
        {
          reviewStage: getProgressReviewStage(p),
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
        }
      );
      if (!importWarningShown && handleProgressSaveStatus(saveStatus)) importWarningShown = true;
    }
    if (payload.dailyGoal) {
      defaultDailyGoal = normalizeDailyGoalValue(payload.dailyGoal, defaultDailyGoal);
      dailyGoal = defaultDailyGoal;
      const input = document.getElementById('goal-input');
      if (input) input.value = defaultDailyGoal;
      await apiSetDailyGoal(currentUser.id, defaultDailyGoal);
    }
    applyFilters();
    upStats();
    renderDailyGoal();
    renderStatsPage();
    renderList();
    showToast(`已导入 ${rows.length} 条进度`);
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
  W.forEach(w => {
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
      <div style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.cat}</div>
      <div class="cat-meter"><div class="cat-fill" style="width:${r.pct}%"></div></div>
      <div style="text-align:right;color:var(--text2)">${r.pct}%</div>
    </div>`).join('') : '<div class="empty-state">还没有分类数据</div>';
}

function renderHardestWords() {
  const el = document.getElementById('hardest-words');
  if (!el) return;
  const rows = getDifficultWords(W).slice(0, 8);
  el.innerHTML = rows.length ? rows.map(w => {
    const s = getDifficultScore(w);
    const rate = Math.round(s.rate * 100);
    const p = getProgress(w.ro) || {};
    const stage = getProgressReviewStage(p);
    return `<div class="hard-row">
      <div class="hard-main">
        <div class="hard-word">${escapeHtml(w.zh || '')} · ${escapeHtml(w.ro || '')}</div>
        <div class="hard-meta">${escapeHtml(w.cat || '')} · 复习阶段 ${stage} · 连错 ${s.streak}</div>
      </div>
      <div class="hard-score">${s.wrong}错 · ${rate}%</div>
    </div>`;
  }).join('') : '<div class="empty-state">还没有需加强记录</div>';
}

async function renderLeaderboard() {
  const el = document.getElementById('leaderboard-list');
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
      byUser[r.user_id][r.word_ro] = {
        known: r.known,
        qr: r.quiz_right || 0,
        qt: r.quiz_total || 0,
        level: r.level || 'unknown'
      };
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
  const nextReview = p.nextReviewAt ? formatReviewDue(p.nextReviewAt) : '未安排';
  const example = getSyncExampleSentence(w);
  const canQueue = isUnseenWord(w) && !(roListIncludes(todayQueue, w.ro) && !setHasRo(todayQueueCompleted, w.ro));
  document.getElementById('word-detail-body').innerHTML = `
    <div class="detail-head">
      <div class="detail-zh">${escapeHtml(w.zh || '')}</div>
      <div class="detail-ro">${escapeHtml(w.ro || '')}</div>
      <div class="card-stress-word" style="font-size:24px">${stressToHtml(stress.text)}</div>
      ${isWordUnverified(w) ? '<span class="unverified-badge" style="width:max-content">未核对</span>' : ''}
    </div>
    <div class="detail-grid">
      <div class="detail-chip"><div class="detail-label">分类</div><div class="detail-value">${escapeHtml(w.cat || '')}</div></div>
      <div class="detail-chip"><div class="detail-label">熟练度</div><div class="detail-value">${escapeHtml(getLevelLabel(w.ro))}</div></div>
      <div class="detail-chip"><div class="detail-label">语法</div><div class="detail-value">${escapeHtml(getGrammarInfo(w))}${stress.auto ? ' · 自动重音待校对' : ''}</div></div>
      <div class="detail-chip"><div class="detail-label">复习</div><div class="detail-value">下次：${escapeHtml(nextReview)} · 阶段 ${getProgressReviewStage(p)}</div></div>
      <div class="detail-chip"><div class="detail-label">练习记录</div><div class="detail-value">正确 ${p.qr || 0}/${p.qt || 0} · 答错 ${s.wrong} · 连错 ${s.streak}</div></div>
      <div class="detail-chip"><div class="detail-label">辅助标签</div><div class="detail-value">${escapeHtml(getAuxiliaryLabelText(w))}</div></div>
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
  return buildExampleSentence(w) || getLocalExample(w) || getDirectCorpusExample(w?.ro);
}

function getPrimaryExampleSentence(w) {
  return buildExampleSentence(w) || getPrimaryLocalExample(w) || getDirectCorpusExample(w?.ro);
}

function renderFrontExampleRecall(id, w, example) {
  const el = document.getElementById(id);
  if (!el) return;
  if (!w || !example?.zh) {
    el.style.display = 'none';
    el.innerHTML = '';
    return;
  }
  const zh = String(w.zh || '').trim();
  el.style.display = '';
  el.innerHTML = `
    <div class="front-recall-label">例句回忆</div>
    <div class="front-recall-zh">${escapeHtml(example.zh)}</div>
    <div class="front-recall-cloze">空格处先回忆罗语：____${zh ? `（${escapeHtml(zh)}）` : ''}</div>`;
}

function pickExampleTemplate(templates, seed) {
  if (!Array.isArray(templates) || !templates.length) return null;
  return templates[Math.abs(hashText(seed)) % templates.length];
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

function inferPartOfSpeech(w, grammar = '') {
  const cat = normalizeCategory(w?.cat);
  const ro = String(w?.ro || '').trim().toLocaleLowerCase('ro');
  if (ro.startsWith('a ') || grammar.includes('verb') || grammar.includes('动词') || cat === 'verb') return 'verb';
  if (grammar.includes('adj') || grammar.includes('形容词') || cat === 'adjective') return 'adjective';
  if (grammar.includes('adv') || grammar.includes('副词') || cat === 'adverb') return 'adverb';
  if (grammar.includes('prep') || grammar.includes('介词') || cat === 'preposition') return 'preposition';
  if (grammar.includes('pron') || grammar.includes('代词') || cat === 'pronoun') return 'pronoun';
  return 'noun';
}

function getVerbInfinitiveForSentence(ro) {
  const value = String(ro || '').trim();
  const reflexive = /^a\s+se\s+/i.test(value);
  const text = value.replace(/^a\s+se\s+/i, '').replace(/^a\s+/i, '').trim();
  return text ? { text, reflexive } : null;
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
  if (roListIncludes(todayQueue, w.ro) && !setHasRo(todayQueueCompleted, w.ro)) {
    return '<span class="word-queued">今日队列</span>';
  }
  return `<button class="queue-btn" onclick="addWordToTodayQueue(decodeURIComponent('${encodedArg(w.ro)}'))">加入学习</button>`;
}

function renderList() {
  if (!W.length) return;
  const q = (document.getElementById('search-input') || { value: '' }).value.toLowerCase();
  const f = W.filter(w => !q || w.zh.includes(q) || w.ro.toLowerCase().includes(q) || (w.cat || '').includes(q));
  const editBtns = (w) => userRole === 'admin'
    ? `<details class="word-actions">
         <summary aria-label="词条操作">⋯</summary>
         <div class="word-action-menu">
           <button class="admin-btn edit" onclick="openEditById(${Number(w.id)})">编辑</button>
           <button class="admin-btn revoke" onclick="deleteWordById(${Number(w.id)})">删除</button>
         </div>
       </details>`
    : '';
  document.getElementById('word-list').innerHTML = f.slice(0, 200).map(w => {
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
        <div class="word-cat">${escapeHtml(w.cat || '')}</div>
        <span style="font-size:10px;padding:2px 7px;border-radius:99px;background:${LEVEL_BG[lv]};color:${LEVEL_TC[lv]};white-space:nowrap">${getLevelLabel(w.ro)}</span>
        <button class="queue-btn" onclick="openWordDetail(decodeURIComponent('${encodedArg(w.ro)}'))">详情</button>
        ${listQueueAction(w)}
        ${editBtns(w)}
      </div>
    </div>`;
  }).join('') + (f.length > 200 ? `<div style="text-align:center;padding:12px;font-size:13px;color:var(--text3)">显示前200条，请搜索缩小范围</div>` : '');
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
  document.getElementById('em-cat').value = normalizeCategory(word.cat);
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
  if (updates.zh && updates.ro && roKey(updates.zh) === roKey(updates.ro)) {
    problems.push('中文和罗马尼亚语不能相同');
  }
  const duplicate = W.find(w => Number(w.id) !== Number(wordId) && roKey(w.ro) === roKey(updates.ro));
  if (duplicate) problems.push(`罗马尼亚语已存在：${duplicate.zh || duplicate.ro}`);
  if (updates.example_zh && !updates.example_ro) {
    problems.push('填写中文例句时也要填写罗语例句');
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
  const updates = {
    zh: document.getElementById('em-zh').value.trim(),
    ro: document.getElementById('em-ro').value.trim(),
    ipa: document.getElementById('em-ipa').value.trim(),
    hint: document.getElementById('em-hint').value.trim(),
    cat: normalizeCategory(document.getElementById('em-cat').value),
    example_ro: document.getElementById('em-example-ro').value.trim(),
    example_zh: document.getElementById('em-example-zh').value.trim(),
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
  document.getElementById('aw-cat').value = '';
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
      words = [{
        zh, ro,
        ipa: document.getElementById('aw-ipa').value.trim(),
        hint: document.getElementById('aw-hint').value.trim(),
        cat: normalizeCategory(document.getElementById('aw-cat').value),
        example_ro: exampleRo,
        example_zh: exampleZh
      }];
    } else {
      // 批量模式：每行 中文|罗马尼亚语|重音标记|语法信息|分类|罗语例句|中文例句
      const lines = document.getElementById('aw-bulk-text').value.trim().split('\n')
        .map(l => l.trim())
        .filter(l => l && !l.startsWith('#'));
      words = lines.map(line => {
        const parts = line.split('|').map(s => s.trim());
        const existingExampleOnly = parts[0] && !parts[1] && !parts[2] && !parts[3] && !parts[4] && parts[5];
        return {
          zh: existingExampleOnly ? '' : (parts[0] || ''),
          ro: existingExampleOnly ? parts[0] : (parts[1] || ''),
          ipa: parts[2] || '',
          hint: parts[3] || '',
          cat: normalizeCategory(parts[4]),
          example_ro: parts[5] || '',
          example_zh: parts[6] || ''
        };
      }).filter(w => w.ro && (w.zh || w.example_ro));
      if (!words.length) { showToast('没有解析到有效词汇，请检查格式'); btn.disabled = false; btn.textContent = editingPending ? '保存修改' : '提交审核'; return; }
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
    document.getElementById('s-total').textContent = W.length;
    document.getElementById('topbar-badge').textContent = W.length + '词 · A1-B2';
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
    const [reportsResult, progressResult, pendingWordsResult] = await Promise.allSettled([
      apiLoadReports(),
      apiLoadAllProgress(),
      apiLoadPendingWords()
    ]);
    const reports = reportsResult.status === 'fulfilled' ? reportsResult.value : [];
    const allProgress = progressResult.status === 'fulfilled' ? progressResult.value : [];
    const pendingWords = pendingWordsResult.status === 'fulfilled' ? pendingWordsResult.value : [];
    const categoryStats = getAdminCategoryStats();
    const reportStats = getAdminReportStats(reports);
    const wrongStats = getAdminWrongStats(allProgress);
    const missingIpaWords = getMissingIpaWords();
    const pendingGrammarWords = getPendingGrammarWords();
    const pendingReports = reports.filter(r => r.status === 'pending').length;
    const pendingWordCount = pendingWords.filter(r => r.status === 'pending').length;
    const totalAnswers = allProgress.reduce((sum, r) => sum + (r.quiz_total || 0), 0);

    el.innerHTML = `
      <div class="admin-stat-grid">
        <div class="admin-stat"><div class="admin-stat-n">${W.length}</div><div class="admin-stat-l">词库总量</div></div>
        <div class="admin-stat"><div class="admin-stat-n">${categoryStats.length}</div><div class="admin-stat-l">分类数量</div></div>
        <div class="admin-stat"><div class="admin-stat-n">${pendingWordCount}</div><div class="admin-stat-l">待审核新词</div></div>
        <div class="admin-stat"><div class="admin-stat-n">${pendingReports}</div><div class="admin-stat-l">待处理报错</div></div>
        <div class="admin-stat"><div class="admin-stat-n">${missingIpaWords.length}</div><div class="admin-stat-l">待校对音标</div></div>
      </div>
      <div class="admin-chart">
        <div class="admin-chart-title">各分类词汇数量</div>
        ${renderAdminCategoryRows(categoryStats)}
      </div>
      <div class="admin-chart">
        <div class="admin-chart-title">被报错最多的词</div>
        ${reportsResult.status === 'fulfilled' ? renderAdminReportRows(reportStats) : `<div class="empty-state">报错记录无法读取：${escapeHtml(reportsResult.reason.message)}</div>`}
      </div>
      <div class="admin-chart">
        <div class="admin-chart-title">答错率最高的词 <span style="font-weight:400;color:var(--text2)">共 ${totalAnswers} 次练习记录</span></div>
        ${progressResult.status === 'fulfilled' ? renderAdminWrongRows(wrongStats) : `<div class="empty-state">答题记录无法读取：${escapeHtml(progressResult.reason.message)}</div>`}
      </div>`;
    renderMissingIpaPanel();
    renderPendingWordsPanel(pendingWords);
    renderPendingGrammarPanel();
  } catch (e) {
    el.innerHTML = `<div class="empty-state">词库统计加载失败：${escapeHtml(e.message || '未知错误')}</div>`;
    renderMissingIpaPanel();
    loadAdminPendingWords();
    renderPendingGrammarPanel();
  }
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
            <div class="admin-word-meta">${escapeHtml(w.ro)} · 自动推测：${stressToHtml(stress.text)} · ${escapeHtml(getGrammarInfo(w))}${w.cat ? ` · ${escapeHtml(w.cat)}` : ''}</div>
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
        <div class="pending-word-cell"><div class="pending-word-label">分类</div><div class="pending-word-value">${escapeHtml(normalizeCategory(row.cat))}</div></div>
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
    W = (await apiLoadWords({ preferCloud: true })).map(normalizeWordCategory);
    rebuildWordRoIndex();
    applyFilters();
    document.getElementById('s-total').textContent = W.length;
    document.getElementById('topbar-badge').textContent = W.length + '词 · A1-B2';
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
    W = (await apiLoadWords({ preferCloud: true })).map(normalizeWordCategory);
    rebuildWordRoIndex();
    applyFilters();
    document.getElementById('s-total').textContent = W.length;
    document.getElementById('topbar-badge').textContent = W.length + '词 · A1-B2';
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
    document.getElementById('aw-cat').value = normalizeCategory(row.cat);
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
            <div class="admin-word-meta">${escapeHtml(w.ro)} · ${stressToHtml(stress.text)} · ${escapeHtml(grammar)}${w.cat ? ` · ${escapeHtml(w.cat)}` : ''}</div>
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
    .map(w => patchById.get(w.id));

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
    W = W.map(w => byId.has(w.id) ? { ...w, ipa: byId.get(w.id).ipa, hint: byId.get(w.id).hint } : w);
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
    if (!map[r.word_ro]) map[r.word_ro] = { ro: r.word_ro, qt: 0, qr: 0 };
    map[r.word_ro].qt += r.quiz_total || 0;
    map[r.word_ro].qr += r.quiz_right || 0;
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
  if (!rows.length) return '<div class="empty-state">暂无分类数据</div>';
  const max = Math.max(...rows.map(r => r.count), 1);
  return rows.slice(0, 12).map(r => `
    <div class="admin-mini-row">
      <div style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(r.cat)}</div>
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
  wrong_hint: '提示有误', wrong_cat: '分类有误', other: '其他'
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
    progressByUser[r.user_id][r.word_ro] = rowToProgress(r);
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
      const goal = Number(raw?.goal || u.daily_goal || 20);
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
      dailyGoal: u.daily_goal || 20,
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
    const word = wordMap.get(row.word_ro) || {};
    if (!byWord[row.word_ro]) {
      byWord[row.word_ro] = {
        ro: row.word_ro,
        zh: word.zh || '',
        cat: word.cat || '',
        misses: 0,
        attempts: 0,
        users: new Set()
      };
    }
    byWord[row.word_ro].misses += misses;
    byWord[row.word_ro].attempts += qt;
    byWord[row.word_ro].users.add(row.user_id);
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
init();
