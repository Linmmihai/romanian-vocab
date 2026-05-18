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
let filtered = [];    // 当前分类筛选后的词汇
let idx = 0;          // 卡片当前索引
let flipped = false;
let flashHistory = [];
let flashOverrideRo = null;
let curCat = '全部';
let reviewQueue = [];
let reviewIdx = 0;
let flashMode = 'today'; // today | review
let todayQueue = [];
let todayQueueCompleted = new Set();
let todayQueueRecord = null;
let dailyQueueLoaded = false;
let exampleBank = {};

let qMode = 'zh';     // 测验模式：'zh' | 'ro'
let qExerciseMode = 'translation'; // translation | nounPlural | verbConj | stress | listening
let qPracticeScope = 'smart'; // smart | today | wrong | due | new | all
let qList = [];
let qIdx = 0;
let qRight = 0;       // 本次会话累计答对（不重置）
let qTotal = 0;       // 本次会话累计答题（不重置）
let qRoundRight = 0;  // 本轮答对（用于显示结算）
let qRoundTotal = 0;  // 本轮答题

let editingWordId = null;
let editingReportId = null;
let editingPendingWordId = null;
let detailWordRo = null;
let flashcardButtonsBound = false;
let cardGesturesBound = false;

// 错题本状态
let wbList = [];
let wbIdx = 0;
let wbFlipped = false;
let wbStreaks = {};
let wbGraduated = 0;
let wbAutoAdvanceTimer = null;
const WB_GRADUATE = 3;

// 每日任务目标状态
let dailyGoal = 20;
let todayNewWords = 0;      // 今日已完成任务数；字段名兼容 legacy daily_log.new_words
let todaySeenWords = new Set(); // 今天已经见过的词 ro 集合
let todayLog = null;

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
// mastered → 答题次数 ≥ 3，正确率 ≥ 80%

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
  dailyGoal = profile?.daily_goal || 20;

  // 先设置目标输入框
  const goalInput = document.getElementById('goal-input');
  if (goalInput) goalInput.value = dailyGoal;

  showAppScreen(nickname, userRole === 'admin');

  // 按顺序加载：词库 → 进度 → 今日记录，避免互相等待
  await loadWords();
  await loadProgress();
  await loadTodayLog();
  await loadDailyQueue();

  if (userRole === 'admin') refreshAdminBadge();
  if (isOfflineMode()) setSyncBadge('本机保存', 'saved');
}

// ── 词库加载 ──────────────────────────────────────────────

async function loadWords() {
  document.getElementById('flash-loading').style.display = 'flex';
  document.getElementById('flash-content').style.display = 'none';

  W = (await apiLoadWords()).map(normalizeWordCategory);
  await loadExampleBank();
  applyFilters();

  document.getElementById('s-total').textContent = W.length;
  document.getElementById('topbar-badge').textContent = W.length + '词 · A1-B2';

  populateCategoryDatalist();
  buildCats();
  renderCard();

  document.getElementById('flash-loading').style.display = 'none';
  document.getElementById('flash-content').style.display = 'block';
}

async function loadExampleBank() {
  try {
    const response = await fetch('./data/examples.json', { cache: 'no-store' });
    if (!response.ok) {
      exampleBank = {};
      return;
    }
    const payload = await response.json();
    exampleBank = payload?.examples && typeof payload.examples === 'object' ? payload.examples : {};
  } catch {
    exampleBank = {};
  }
}

async function loadProgress() {
  progressMap = await apiLoadProgress(currentUser.id);
  applyFilters();
  renderCard();
  upStats();
}

async function loadTodayLog() {
  todayLog = await apiGetTodayLog(currentUser.id, dailyGoal);
  todayNewWords = todayLog?.new_words || 0;
  // 全部数据加载完毕，统一渲染
  upStats();
  renderList();
  renderDailyGoal();
  renderCalendar();
  updateReviewBadge();
}

async function loadDailyQueue() {
  dailyQueueLoaded = false;
  const previousTodayCount = todayLog?.new_words || 0;
  const saved = await apiGetDailyQueue(currentUser.id, dailyGoal);
  let queueChanged = false;
  if (saved?.word_ro?.length || saved?.completed_word_ro?.length) {
    todayQueueRecord = saved;
    const savedCompleted = new Set(saved.completed_word_ro || []);
    const originalQueueLength = saved.word_ro.length;
    const uniqueSavedQueue = [...new Set(saved.word_ro)];
    todayQueueCompleted = new Set([...savedCompleted].filter(ro => W.some(w => w.ro === ro)));
    todayQueue = uniqueSavedQueue.filter(ro => {
      const word = W.find(w => w.ro === ro);
      if (!word) return false;
      if (!isDailyQueueCandidate(word)) {
        todayQueueCompleted.add(ro);
        return false;
      }
      return !todayQueueCompleted.has(ro);
    });
    queueChanged = todayQueue.length !== originalQueueLength || todayQueueCompleted.size !== savedCompleted.size;
  } else {
    todayQueueCompleted = new Set();
    todaySeenWords = new Set();
    todayQueue = buildDailyQueueWords(dailyGoal).map(w => w.ro);
    todayQueueRecord = await apiSaveDailyQueue(currentUser.id, {
      goal: dailyGoal,
      word_ro: todayQueue,
      completed_word_ro: [],
      completed: false
    });
  }
  todaySeenWords = new Set(todayQueueCompleted);
  todayNewWords = Math.max(previousTodayCount, todayQueueCompleted.size);
  const normalizedQueue = buildOpenTodayQueue(dailyGoal);
  if (normalizedQueue.join('|') !== todayQueue.join('|')) {
    todayQueue = normalizedQueue;
    queueChanged = true;
  }
  if (queueChanged) await saveTodayQueue();
  if (todayQueueCompleted.size > previousTodayCount || todayLog?.goal !== dailyGoal) {
    await apiUpdateTodayLog(currentUser.id, todayNewWords, dailyGoal);
  }
  if (todayQueueRecord?.local) {
    showToast('每日队列暂存在本设备；请应用 daily_queue 数据库表以支持多设备同步');
  }
  dailyQueueLoaded = true;
  applyFilters();
  renderCard();
  renderDailyGoal();
  renderCalendar();
  updateReviewBadge();
}

function buildDailyQueueWords(goal) {
  const cap = Math.max(1, Number(goal || 20));
  return buildReviewFirstDailyPlan(W, cap);
}

function uniqueWordsByRo(words) {
  const seen = new Set();
  return words.filter(w => {
    if (!w?.ro || seen.has(w.ro)) return false;
    seen.add(w.ro);
    return true;
  });
}

function buildSmartDailyPlan(words = W, limit = dailyGoal) {
  const cap = Math.max(1, Number(limit || dailyGoal || 20));
  const blocked = new Set([...todaySeenWords, ...todayQueueCompleted]);
  const usable = words.filter(w => w?.ro && !blocked.has(w.ro));
  const due = sortReviewDueWithWeakPriority(usable).filter(w => {
    const p = progressMap[w.ro];
    return p && (p.qt || p.known) && isReviewDue(p);
  });
  const weak = getDifficultWords(usable).filter(w => !due.some(d => d.ro === w.ro));
  const unseen = getUnseenWords(usable);
  return uniqueWordsByRo([...due, ...weak, ...unseen]).slice(0, cap);
}

function isDueReviewWord(w) {
  const p = progressMap[w?.ro];
  return !!(p && (p.qt || p.known) && isReviewDue(p));
}

function getRemainingDueReviewWords(words = W) {
  return words.filter(w => !todayQueueCompleted.has(w.ro) && isDueReviewWord(w));
}

function isDailyQueueCandidate(w) {
  return isDueReviewWord(w) || isUnseenWord(w);
}

function buildReviewFirstDailyPlan(words = W, limit = dailyGoal) {
  const cap = Math.max(1, Number(limit || dailyGoal || 20));
  const blocked = new Set([...todaySeenWords, ...todayQueueCompleted]);
  const usable = words.filter(w => w?.ro && !blocked.has(w.ro));
  const due = sortReviewDueWithWeakPriority(usable).filter(isDueReviewWord);
  const dueSet = new Set(due.map(w => w.ro));
  const unseen = getUnseenWords(usable).filter(w => !dueSet.has(w.ro));
  return uniqueWordsByRo([...due, ...unseen]).slice(0, cap);
}

function buildOpenTodayQueue(goal = dailyGoal) {
  const neededOpenWords = Math.max(0, Number(goal || dailyGoal || 20) - todayNewWords);
  return buildDailyQueueWords(goal)
    .map(w => w.ro)
    .filter(ro => !todayQueueCompleted.has(ro))
    .slice(0, neededOpenWords);
}

function getDailyWordList(words = W, options = {}) {
  if (!dailyQueueLoaded && !options.allowBeforeQueueLoaded) return [];
  const includeFallback = options.includeFallback !== false;
  const limit = Math.max(1, Number(options.limit || dailyGoal || 20));
  const scoped = options.ignoreCategory || curCat === '全部'
    ? words
    : words.filter(w => w.cat === curCat);
  const queueWords = todayQueue
    .map(ro => scoped.find(w => w.ro === ro))
    .filter(Boolean)
    .filter(w => !todayQueueCompleted.has(w.ro));
  if (queueWords.length || !includeFallback) return queueWords.slice(0, limit);
  if (todayQueue.some(ro => !todayQueueCompleted.has(ro))) return [];
  if (todayNewWords >= dailyGoal) return [];

  const blocked = new Set([...todaySeenWords, ...todayQueueCompleted, ...todayQueue]);
  return buildReviewFirstDailyPlan(scoped, Math.min(limit, dailyGoal - todayNewWords))
    .filter(w => !blocked.has(w.ro))
    .slice(0, limit);
}

function getDailyTaskType(w) {
  if (!w) return '';
  if (isDueReviewWord(w)) return '到期复习';
  return '新词';
}

async function saveTodayQueue() {
  todayQueueRecord = await apiSaveDailyQueue(currentUser.id, {
    goal: dailyGoal,
    word_ro: todayQueue,
    completed_word_ro: [...todayQueueCompleted],
    completed: todayNewWords >= dailyGoal
  });
}

async function recordTodayWord(wordRo) {
  if (!wordRo || todaySeenWords.has(wordRo)) return;
  const wasGoalDone = todayNewWords >= dailyGoal;
  const isQueuedWord = todayQueue.includes(wordRo);

  todaySeenWords.add(wordRo);
  todayNewWords += 1;
  todayNewWords = Math.max(todayNewWords, todayQueueCompleted.size);
  if (!todayQueueCompleted.has(wordRo)) {
    todayQueueCompleted.add(wordRo);
  }
  if (isQueuedWord) {
    todayQueue = todayQueue.filter(ro => ro !== wordRo);
    todayNewWords = Math.max(todayNewWords, todayQueueCompleted.size);
  }
  await saveTodayQueue();

  await apiUpdateTodayLog(currentUser.id, todayNewWords, dailyGoal);
  renderDailyGoal();
  updateTodayCalendarCell();
  renderReviewPanel();
  updateReviewBadge();
  if (!wasGoalDone && todayNewWords >= dailyGoal) showToast('今日任务目标已完成，可以继续测验或复习');
}

async function completeTodayQueueWord(wordRo) {
  await recordTodayWord(wordRo);
}

// ── 熟练度计算 ────────────────────────────────────────────

/**
 * 根据答题记录计算熟练度
 * unknown  → 没答过题
 * learning → 答过但正确率 < 80% 或答题次数 < 3
 * mastered → 答题次数 ≥ 3 且正确率 ≥ 80%
 */
function calcLevel(qr, qt, known = false) {
  if (!qt) return known ? 'learning' : 'unknown';
  const pct = qr / qt;
  if (qt >= 3 && pct >= 0.8) return 'mastered';
  return 'learning';
}

function getStoredLevel(progress) {
  if (!progress) return 'unknown';
  return calcLevel(progress.qr, progress.qt, progress.known);
}

function isStartedNotMastered(progress) {
  if (!progress || (!progress.qt && !progress.known)) return false;
  return getStoredLevel(progress) !== 'mastered';
}

const LEVEL_LABEL = { unknown: '未学', learning: '学习中', mastered: '已掌握' };
const DUE_MASTERED_LABEL = '已掌握 · 待复习';
const LEVEL_COLOR = { unknown: 'var(--text3)', learning: 'var(--yellow)', mastered: 'var(--green)' };
const LEVEL_BG    = { unknown: 'var(--bg3)', learning: '#fffbeb', mastered: 'var(--green-bg)' };
const LEVEL_TC    = { unknown: 'var(--text2)', learning: 'var(--yellow-text)', mastered: 'var(--green-text)' };
const RO_VOWELS = 'aeiouăâîAEIOUĂÂÎ';
const REVIEW_INTERVALS = [
  { label: '20分钟', ms: 20 * 60 * 1000 },
  { label: '1天', ms: 24 * 60 * 60 * 1000 },
  { label: '2天', ms: 2 * 24 * 60 * 60 * 1000 },
  { label: '4天', ms: 4 * 24 * 60 * 60 * 1000 },
  { label: '7天', ms: 7 * 24 * 60 * 60 * 1000 },
  { label: '15天', ms: 15 * 24 * 60 * 60 * 1000 },
  { label: '30天', ms: 30 * 24 * 60 * 60 * 1000 },
  { label: '90天', ms: 90 * 24 * 60 * 60 * 1000 },
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
  } else if (flashMode === 'review') {
    filtered = sortReviewDueWithWeakPriority(scoped).filter(isDueReviewWord);
  } else {
    filtered = sortByReviewPriority(scoped).filter(w => getReviewBucket(w) !== 2);
  }
  idx = Math.min(idx, Math.max(filtered.length - 1, 0));
  renderReviewPanel();
}

function isUnseenWord(w) {
  const p = progressMap[w.ro];
  return !p || (!p.seen && !p.qt && !p.known);
}

function getUnseenWords(words = W) {
  return words
    .filter(isUnseenWord)
    .sort((a, b) => String(a.ro).localeCompare(String(b.ro), 'ro'));
}

async function addWordToTodayQueue(wordRo) {
  const w = getWordByRo(wordRo);
  if (!w) { showToast('找不到该词条'); return; }
  if (!isUnseenWord(w)) { showToast('这个词已经学过，请用智能练习或错题本巩固'); return; }
  const remainingSlots = Math.max(0, dailyGoal - todayNewWords);
  const remainingDueReviews = getRemainingDueReviewWords(W).length;
  if (todayNewWords >= dailyGoal || remainingDueReviews >= remainingSlots) {
    showToast('请先完成到期复习；提高今日任务目标后可以继续添加新词');
    return;
  }
  if (todayQueue.includes(wordRo) && !todayQueueCompleted.has(wordRo)) {
    showToast('这个词已在今日队列中');
    switchPage('flash');
    return;
  }

  const completed = todayQueue.filter(ro => todayQueueCompleted.has(ro));
  const open = todayQueue.filter(ro => !todayQueueCompleted.has(ro) && ro !== wordRo);
  todayQueue = [...completed, wordRo, ...open];
  todayQueueCompleted.delete(wordRo);
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
  return { ...word, rawCat: word.rawCat ?? word.cat, cat: normalizeCategory(word.cat) };
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
  if (!progress?.nextReviewAt) return false;
  return new Date(progress.nextReviewAt).getTime() <= Date.now();
}

function getReviewBucket(w) {
  const p = progressMap[w.ro];
  if (!p || !p.qt && !p.known) return 1;
  return isReviewDue(p) ? 0 : 2;
}

function sortByReviewPriority(words) {
  return [...words].sort((a, b) => {
    const ba = getReviewBucket(a);
    const bb = getReviewBucket(b);
    if (ba !== bb) return ba - bb;
    const pa = progressMap[a.ro] || {};
    const pb = progressMap[b.ro] || {};
    const da = pa.nextReviewAt ? new Date(pa.nextReviewAt).getTime() : 0;
    const db = pb.nextReviewAt ? new Date(pb.nextReviewAt).getTime() : 0;
    return da - db || String(a.ro).localeCompare(String(b.ro), 'ro');
  });
}

function getProgressLevel(wordRo) {
  const p = progressMap[wordRo] || {};
  return getStoredLevel(p);
}

function getLevelLabel(wordRo) {
  const p = progressMap[wordRo] || {};
  const lv = getProgressLevel(wordRo);
  if (lv === 'mastered' && isReviewDue(p)) return DUE_MASTERED_LABEL;
  return LEVEL_LABEL[lv] || LEVEL_LABEL.unknown;
}

function getDifficultScore(w) {
  const p = progressMap[w.ro] || {};
  const qt = p.qt || 0;
  const qr = p.qr || 0;
  const wrong = p.wrongCount ?? Math.max(0, qt - qr);
  const rate = qt ? wrong / qt : 0;
  return {
    wrong,
    rate,
    streak: p.errorStreak || 0,
    lastWrong: p.lastWrongAt ? new Date(p.lastWrongAt).getTime() : 0,
    qt
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

function sortReviewDueWithWeakPriority(words) {
  return [...words].sort((a, b) => {
    const ba = getReviewBucket(a);
    const bb = getReviewBucket(b);
    if (ba !== bb) return ba - bb;
    const pa = progressMap[a.ro] || {};
    const pb = progressMap[b.ro] || {};
    const sa = getDifficultScore(a);
    const sb = getDifficultScore(b);
    const da = pa.nextReviewAt ? new Date(pa.nextReviewAt).getTime() : 0;
    const db = pb.nextReviewAt ? new Date(pb.nextReviewAt).getTime() : 0;
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
    return {
      reviewStage: 0,
      nextReviewAt: now.toISOString(),
      lastReviewedAt: now.toISOString()
    };
  }
  const current = Number(progress?.reviewStage || 0);
  const nextStage = Math.min(current + 1, REVIEW_INTERVALS.length);
  const interval = REVIEW_INTERVALS[Math.max(0, nextStage - 1)] || REVIEW_INTERVALS[REVIEW_INTERVALS.length - 1];
  return {
    reviewStage: nextStage,
    nextReviewAt: new Date(now.getTime() + interval.ms).toISOString(),
    lastReviewedAt: now.toISOString()
  };
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

function renderReviewPanel() {
  const dueEl = document.getElementById('review-due-count');
  if (!dueEl) return;
  const scoped = getCurrentScopeWords();
  const due = getRemainingDueReviewWords(scoped).length;
  const rawUnseenRemaining = getUnseenWords(scoped).filter(w => !todaySeenWords.has(w.ro) && !todayQueueCompleted.has(w.ro)).length;
  const remainingSlots = Math.max(0, dailyGoal - todayNewWords);
  const remainingDueReviews = getRemainingDueReviewWords(W).length;
  const availableNewSlots = Math.max(0, remainingSlots - remainingDueReviews);
  const unseenRemaining = Math.min(rawUnseenRemaining, availableNewSlots);
  const current = filtered[idx];
  setText('review-due-count', due);
  setText('review-new-count', `${todayNewWords}/${dailyGoal}`);
  setText('review-new-remaining', unseenRemaining);
  const taskType = current ? getDailyTaskType(current) : '';
  setText('review-note', todayNewWords >= dailyGoal
    ? `今日任务已完成：${todayNewWords}/${dailyGoal} 个。可以继续做测验或打开错题本巩固。`
    : `今日任务先完成到期复习，再学习新词。${taskType ? `当前卡片：${taskType}。` : ''}`);
  document.querySelectorAll('.study-mode-btn[data-mode]').forEach(btn => btn.classList.toggle('active', btn.dataset.mode === flashMode));
  setText('flash-mode-title', getFlashModeLabel());
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
  const wbCount = getWrongWords().length;

  setText('s-mastered', mastered);
  setText('s-learning', learning);
  setText('s-wrong', wbCount);
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

async function syncProgress(wordRo, known, qr, qt, success = known, options = {}) {
  setSyncBadge(isOfflineMode() ? '保存中...' : '同步中...', '');
  const prev = progressMap[wordRo] || {};
  const calculatedLevel = calcLevel(qr, qt, known);
  const level = options.preserveLearningLevel && (prev.qt || prev.known)
    ? getStoredLevel(prev)
    : calculatedLevel;
  const review = getNextReview(prev, success);
  const shouldTrackWrongbook = options.trackWrongbook === true;
  const shouldClearWrongbook = options.clearWrongbook === true;
  const wrongCount = shouldClearWrongbook
    ? 0
    : (prev.wrongCount || 0) + (shouldTrackWrongbook && !success ? 1 : 0);
  const errorStreak = shouldClearWrongbook
    ? 0
    : (shouldTrackWrongbook
        ? (success ? 0 : (prev.errorStreak || 0) + 1)
        : (prev.errorStreak || 0));
  const lastWrongAt = shouldClearWrongbook
    ? null
    : (shouldTrackWrongbook && !success ? new Date().toISOString() : (prev.lastWrongAt || null));
  const memory = { wrongCount, errorStreak, lastWrongAt };
  const nextProgress = { ...prev, seen: true, known, qr, qt, level, ...review, ...memory };
  progressMap[wordRo] = nextProgress;
  try {
    await apiSaveProgress(currentUser.id, wordRo, known, qr, qt, level, review, null, memory);
    setSyncBadge(isOfflineMode() ? '已存本机' : '已保存', 'saved');
  } catch {
    if (Object.keys(prev).length) {
      progressMap[wordRo] = prev;
    } else {
      delete progressMap[wordRo];
    }
    setSyncBadge('同步失败', '');
  }
  setTimeout(() => setSyncBadge('', ''), 2000);
  applyFilters();
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
      options: {}
    };
  },
  flashcard_unknown(prev) {
    return {
      known: !!prev.known,
      qr: prev.qr || 0,
      qt: (prev.qt || 0) + 1,
      success: false,
      options: {}
    };
  },
  review_correct(prev) {
    return {
      known: true,
      qr: (prev.qr || 0) + 1,
      qt: (prev.qt || 0) + 1,
      success: true,
      options: { preserveLearningLevel: true }
    };
  },
  review_wrong(prev) {
    return {
      known: !!prev.known,
      qr: prev.qr || 0,
      qt: (prev.qt || 0) + 1,
      success: false,
      options: { preserveLearningLevel: true, trackWrongbook: true }
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
      options: { trackWrongbook: true }
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

async function recordInteraction(wordRo, interactionType) {
  const rule = INTERACTION_RULES[interactionType];
  if (!rule) throw new Error(`Unknown interaction type: ${interactionType}`);
  const prev = progressMap[wordRo] || { known: false, qr: 0, qt: 0 };
  const next = rule(prev);
  await syncProgress(wordRo, next.known, next.qr, next.qt, next.success, next.options);
  return progressMap[wordRo] || {};
}

// ── 导航 ─────────────────────────────────────────────────

function switchPage(p) {
  if (p === 'review') { qPracticeScope = 'due'; p = 'quiz'; }
  if (p !== 'wrongbook' && wbAutoAdvanceTimer) {
    clearTimeout(wbAutoAdvanceTimer);
    wbAutoAdvanceTimer = null;
  }
  const pages = ['flash', 'list', 'wrongbook', 'quiz', 'stats', 'leaderboard', 'guide', 'admin'];
  pages.forEach((s) => {
    document.querySelectorAll(`.nav-tab[data-page="${s}"]`).forEach(tab => tab.classList.toggle('active', s === p));
    const page = document.getElementById('page-' + s);
    if (page) page.classList.toggle('active', s === p);
  });
  document.getElementById('nav-more')?.classList.remove('open');
  const reviewPage = document.getElementById('page-review');
  if (reviewPage) reviewPage.classList.remove('active');
  if (p === 'flash') { applyFilters(); renderCard(); renderDailyGoal(); renderCalendar(); }
  if (p === 'quiz') showQuizSetup();
  if (p === 'stats') renderStatsPage();
  if (p === 'leaderboard') renderLeaderboard();
  if (p === 'list') renderList();
  if (p === 'wrongbook') initWrongbook();
  if (p === 'admin') { restoreAdminSections(); loadAdminStats(); loadAdminPendingWords(); loadAdminReports(); loadAdminUsers(); }
}

function toggleNavMenu(event) {
  event?.stopPropagation();
  const menu = document.getElementById('nav-more');
  if (!menu) return;
  menu.classList.toggle('open');
}

document.addEventListener('click', (event) => {
  const menu = document.getElementById('nav-more');
  if (menu && !menu.contains(event.target)) menu.classList.remove('open');
});

function toggleAdminSection(id) {
  const section = document.getElementById(id);
  if (!section) return;
  section.classList.toggle('collapsed');
  saveAdminSectionState();
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
  if (!state) return;
  document.querySelectorAll('#page-admin .admin-section[id]').forEach(section => {
    if (section.id in state) section.classList.toggle('collapsed', !state[section.id]);
  });
}

function updateReviewBadge() {
  const badge = document.getElementById('review-tab-badge') || document.getElementById('flash-tab-badge');
  if (!badge) return;
  const count = getRemainingDueReviewWords(W).length;
  badge.textContent = count;
  badge.style.display = count > 0 ? 'inline' : 'none';
}

// ── 每日任务目标 ──────────────────────────────────────────

function renderDailyGoal() {
  const el = document.getElementById('daily-goal-bar');
  if (!el) return;
  const pct = Math.min(100, Math.round(todayNewWords / dailyGoal * 100));
  const done = todayNewWords >= dailyGoal;
  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
      <span style="font-size:13px;font-weight:600;color:var(--text)">
        ${done ? '今日任务完成' : '今日任务'}
      </span>
      <span style="font-size:13px;color:var(--text2)">${todayNewWords} / ${dailyGoal} 个</span>
    </div>
    <div style="background:var(--bg3);border-radius:99px;height:10px;overflow:hidden">
      <div style="height:100%;width:${pct}%;background:${done ? 'var(--green)' : 'var(--blue)'};border-radius:99px;transition:width .4s"></div>
    </div>`;
}

async function saveGoalSetting() {
  const val = parseInt(document.getElementById('goal-input').value);
  if (!val || val < 1 || val > 100) { showToast('请输入1-100之间的数字'); return; }
  dailyGoal = val;
  await apiSetDailyGoal(currentUser.id, val);
  todayQueue = buildOpenTodayQueue(dailyGoal);
  await saveTodayQueue();
  await apiUpdateTodayLog(currentUser.id, todayNewWords, dailyGoal);
  applyFilters();
  renderCard();
  renderDailyGoal();
  renderCalendar();
  showToast('每日任务目标已更新');
}

async function renderCalendar() {
  const el = document.getElementById('calendar-container');
  if (!el) return;
  const logs = await apiGetRecentLogs(currentUser.id, 14);
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
    const completed = isToday ? (todayNewWords >= dailyGoal) : isDailyLogCompleted({ ...log, new_words: completedTasks, goal });

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
  document.getElementById('cat-bar').innerHTML = cats.map(c =>
    `<button class="cat-chip${c === curCat ? ' active' : ''}" onclick="setCat(decodeURIComponent('${encodedArg(c)}'))">${escapeHtml(c)}</button>`
  ).join('');
}

function setCat(c) {
  curCat = c;
  flashHistory = [];
  flashOverrideRo = null;
  applyFilters();
  idx = 0; flipped = false;
  document.getElementById('main-card').classList.remove('flipped');
  buildCats();
  renderCard();
}

function getWordByRo(wordRo) {
  return W.find(w => w.ro === wordRo) || null;
}

function getCurrentFlashWord() {
  return flashOverrideRo ? getWordByRo(flashOverrideRo) : filtered[idx];
}

function renderCard() {
  const overrideWord = flashOverrideRo ? getWordByRo(flashOverrideRo) : null;
  if (flashOverrideRo && !overrideWord) flashOverrideRo = null;

  if (!filtered.length && !overrideWord) {
    setText('fc-cat', curCat === '全部' ? '' : curCat);
    setText('fc-cat2', curCat === '全部' ? '' : curCat);
    const hasOpenQueue = todayQueue.some(ro => !todayQueueCompleted.has(ro));
    const hasDueReview = getRemainingDueReviewWords(W).length > 0;
    const hasNewWords = getUnseenWords(getCurrentScopeWords()).some(w => !todaySeenWords.has(w.ro) && !todayQueueCompleted.has(w.ro));
    const emptyText = {
      today: todayNewWords >= dailyGoal ? '今日任务已完成' : (hasDueReview || hasNewWords ? '当前分类没有今日任务' : '今日没有可安排任务'),
      review: '当前没有到期复习词',
    }[flashMode] || '当前分类暂无可学词';
    const actionText = {
      today: todayNewWords >= dailyGoal
        ? '可以继续做测验，或明天再学习'
        : (hasOpenQueue ? '请切换到全部，先完成到期复习' : '可以切换分类、提高今日任务目标或去测验'),
      review: '没有到期复习时，可以继续学习新词'
    }[flashMode] || 'No words';
    setText('fc-zh', emptyText);
    setText('fc-ro', actionText);
    setText('fc-ipa', '');
    setText('fc-phint', '');
    renderExampleBlock('fc-example', null);
    setText('fc-level', '');
    const verifyEl = document.getElementById('fc-verify');
    if (verifyEl) verifyEl.style.display = 'none';
    return;
  }
  bindFlashcardButtons();
  if (filtered.length) idx = (idx + filtered.length) % filtered.length;
  const w = overrideWord || filtered[idx];
  const stress = getStressDisplay(w);
  const taskType = flashMode === 'today' ? ` · ${getDailyTaskType(w)}` : '';
  document.getElementById('fc-cat').textContent = `${w.cat || ''}${taskType}`;
  document.getElementById('fc-cat2').textContent = `${w.cat || ''}${taskType}`;
  document.getElementById('fc-zh').textContent = w.zh;
  document.getElementById('fc-ro').textContent = w.ro;
  const verifyEl = document.getElementById('fc-verify');
  if (verifyEl) {
    verifyEl.textContent = isWordUnverified(w) ? '未核对' : '';
    verifyEl.style.display = isWordUnverified(w) ? '' : 'none';
  }
  setStressHtml('fc-ipa', w);
  setGrammarText('fc-phint', w, stress);
  const example = buildExampleSentence(w);
  renderExampleBlock('fc-example', example);
  // 显示熟练度
  const p = progressMap[w.ro] || {};
  const lv = getProgressLevel(w.ro);
  const lvEl = document.getElementById('fc-level');
  if (lvEl) { lvEl.textContent = getLevelLabel(w.ro); lvEl.style.color = LEVEL_TC[lv]; lvEl.style.background = LEVEL_BG[lv]; }
  renderReviewPanel();
}

// 点卡片：来回翻转
function flipCard() {
  flipped = !flipped;
  document.getElementById('main-card').classList.toggle('flipped', flipped);
}

function nextCard() {
  if (!filtered.length) return;
  const current = getCurrentFlashWord();
  if (current && !flashOverrideRo) flashHistory.push(current.ro);
  flashOverrideRo = null;
  idx = (idx + 1) % filtered.length;
  flipped = false;
  document.getElementById('main-card').classList.remove('flipped');
  renderCard();
}

function bindFlashcardButtons() {
  if (flashcardButtonsBound) return;
  const knownBtn = document.getElementById('mark-known-btn');
  const unknownBtn = document.getElementById('mark-unknown-btn');
  if (!knownBtn || !unknownBtn) return;

  knownBtn.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    markCard(true);
  });

  unknownBtn.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    markCard(false);
  });

  flashcardButtonsBound = true;
}

/**
 * 记录当前卡片为「今日已完成任务」
 */
async function recordDailyWord() {
  const w = getCurrentFlashWord();
  if (!w) return;
  await recordTodayWord(w.ro);
}

/**
 * 只更新今天日历格子颜色，不重新请求数据库
 */
function updateTodayCalendarCell() {
  const cells = document.querySelectorAll('#calendar-container [data-today]');
  cells.forEach(cell => {
    const done = todayNewWords >= dailyGoal;
    cell.classList.toggle('completed', done);
    cell.classList.toggle('started', !done && todayNewWords > 0);
    const sub = cell.querySelector('.cal-sub');
    if (sub) sub.textContent = todayNewWords;
  });
}

// 「认识了」/「不认识」
async function markCard(yes) {
  const w = getCurrentFlashWord();
  if (!w) return;
  const wasReviewingHistory = !!flashOverrideRo;
  const p = progressMap[w.ro];
  const isReviewTask = flashMode === 'review' || (flashMode === 'today' && p && (p.qt || p.known));
  const interaction = flashMode === 'review'
    ? (yes ? 'review_correct' : 'review_wrong')
    : (isReviewTask ? (yes ? 'review_correct' : 'review_wrong') : (yes ? 'flashcard_known' : 'flashcard_unknown'));
  await recordInteraction(w.ro, interaction);
  if (flashMode === 'today') await completeTodayQueueWord(w.ro);
  // 跳下一张，重置为中文面
  if (!wasReviewingHistory) flashHistory.push(w.ro);
  flashOverrideRo = null;
  applyFilters();
  const nextIdx = filtered.findIndex(item => item.ro !== w.ro);
  idx = nextIdx >= 0 ? nextIdx : 0;
  flipped = false;
  document.getElementById('main-card').classList.remove('flipped');
  renderCard();
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

function prevReviewCard() {
  if (!reviewQueue.length) return;
  reviewIdx = (reviewIdx - 1 + reviewQueue.length) % reviewQueue.length;
  renderReviewCard();
}

function nextReviewCard() {
  if (!reviewQueue.length) return;
  reviewIdx = (reviewIdx + 1) % reviewQueue.length;
  renderReviewCard();
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
  bindCardGesture('rv-card', {
    prev: prevReviewCard,
    next: nextReviewCard,
    flip: flipReviewCard
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

// ── 艾宾浩斯复习页 ────────────────────────────────────────

function getTodayReviewWords() {
  return W.filter(isDueReviewWord);
}

function initReviewQueue() {
  reviewQueue = getTodayReviewWords().sort((a, b) => {
    const pa = progressMap[a.ro] || {};
    const pb = progressMap[b.ro] || {};
    return new Date(pa.nextReviewAt || 0) - new Date(pb.nextReviewAt || 0);
  });
  reviewIdx = 0;
}

function renderReviewCard() {
  const wrap = document.getElementById('review-wrap');
  const empty = document.getElementById('review-empty');
  if (!wrap || !empty) return;

  if (!reviewQueue.length || reviewIdx >= reviewQueue.length) {
    wrap.style.display = 'none';
    empty.style.display = 'flex';
    empty.innerHTML = `
      <div style="font-size:48px">😴</div>
      <div style="font-size:16px;font-weight:600;color:var(--text)">当前没有到期复习任务</div>
      <div style="font-size:14px;color:var(--text2);text-align:center">可以回到今日任务学习新词，系统会按复习间隔安排下一次复习</div>
      <button class="btn-sm" style="margin-top:12px" onclick="switchPage('flash')">去今日任务</button>`;
    return;
  }

  wrap.style.display = 'block';
  empty.style.display = 'none';

  const w = reviewQueue[reviewIdx];
  const p = progressMap[w.ro] || {};
  const stress = getStressDisplay(w);
  const stage = Number(p.reviewStage || p.reviewCount || 0);
  const nextInterval = REVIEW_INTERVALS[Math.min(stage, REVIEW_INTERVALS.length - 1)] || REVIEW_INTERVALS[REVIEW_INTERVALS.length - 1];

  setText('rv-count', `${reviewIdx + 1} / ${reviewQueue.length}`);
  setText('rv-zh', w.zh);
  setText('rv-ro', w.ro);
  setStressHtml('rv-ipa', w);
  setGrammarText('rv-hint', w, stress);
  setText('rv-cat', w.cat || '');
  setText('rv-cat2', w.cat || '');
  setText('rv-interval', `当前阶段 ${stage} · 答对后进入 ${nextInterval.label}`);

  document.getElementById('rv-card').classList.remove('flipped');
  document.getElementById('rv-btns').style.display = 'none';
  document.getElementById('rv-flip-hint').style.display = 'block';
}

function flipReviewCard() {
  const card = document.getElementById('rv-card');
  if (!card) return;
  const flippedNow = card.classList.toggle('flipped');
  document.getElementById('rv-btns').style.display = flippedNow ? 'flex' : 'none';
  document.getElementById('rv-flip-hint').style.display = flippedNow ? 'none' : 'block';
}

function speakReview(rate) {
  if (!reviewQueue.length || reviewIdx >= reviewQueue.length) return;
  const w = reviewQueue[reviewIdx];
  if (!('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(w.ro);
  u.lang = 'ro-RO';
  u.rate = rate;
  const rv = speechSynthesis.getVoices().find(v => v.lang.startsWith('ro'));
  if (rv) u.voice = rv;
  speechSynthesis.speak(u);
}

async function markReview(yes) {
  if (!reviewQueue.length || reviewIdx >= reviewQueue.length) return;
  const w = reviewQueue[reviewIdx];
  await recordInteraction(w.ro, yes ? 'review_correct' : 'review_wrong');

  reviewIdx++;
  if (reviewIdx >= reviewQueue.length) {
    showReviewComplete();
    return;
  }
  renderReviewCard();
}

function showReviewComplete() {
  const wrap = document.getElementById('review-wrap');
  const empty = document.getElementById('review-empty');
  if (wrap) wrap.style.display = 'none';
  if (!empty) return;
  empty.style.display = 'flex';
  empty.innerHTML = `
      <div style="font-size:18px;font-weight:700;margin-bottom:8px;color:var(--text)">今日复习完成</div>
      <div style="font-size:14px;color:var(--text2);text-align:center">完成了 ${reviewQueue.length} 个复习任务</div>
      <button class="btn-sm" onclick="switchPage('flash')">去今日任务</button>
    `;
}

// ── 错题本 ────────────────────────────────────────────────

/**
 * 判断一个词是否是错题：只统计测验模式中答错过的词。
 */
function isWrongWord(wordRo) {
  const p = progressMap[wordRo];
  return !!p && (p.wrongCount || 0) > 0;
}

/**
 * 获取当前错题列表
 */
function getWrongWords() {
  return W.filter(w => isWrongWord(w.ro));
}

/**
 * 初始化/刷新错题本
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

function renderWrongbookCard() {
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
  const p = progressMap[w.ro] || {};
  const wrongCount = p.wrongCount || 0;
  const streak = wbStreaks[w.ro] || 0;

  document.getElementById('wb-cat').textContent = w.cat || '';
  document.getElementById('wb-cat2').textContent = w.cat || '';
  document.getElementById('wb-zh').textContent = w.zh;
  document.getElementById('wb-ro').textContent = w.ro;
  setStressHtml('wb-ipa', w);
  setGrammarText('wb-phint', w, stress);
  document.getElementById('wb-count').textContent = (wbIdx + 1) + ' / ' + wbList.length;
  document.getElementById('wb-wrong-count').textContent = `答错 ${wrongCount} 次`;
  document.getElementById('wb-streak').textContent = streak > 0 ? `连续答对 ${streak}/${WB_GRADUATE}` : '';
  document.getElementById('wb-streak').style.color = streak > 0 ? 'var(--green-text)' : '';

  // 重置卡片翻转
  wbFlipped = false;
  document.getElementById('wb-card').classList.remove('flipped');
}

function flipWbCard() {
  wbFlipped = !wbFlipped;
  document.getElementById('wb-card').classList.toggle('flipped', wbFlipped);
}

function nextWbCard() {
  if (wbAutoAdvanceTimer) {
    clearTimeout(wbAutoAdvanceTimer);
    wbAutoAdvanceTimer = null;
  }
  if (!wbList.length) return;
  wbIdx = (wbIdx + 1) % wbList.length;
  wbFlipped = false;
  document.getElementById('wb-card').classList.remove('flipped');
  renderWrongbookCard();
}

function prevWbCard() {
  if (wbAutoAdvanceTimer) {
    clearTimeout(wbAutoAdvanceTimer);
    wbAutoAdvanceTimer = null;
  }
  if (!wbList.length) return;
  wbIdx = (wbIdx - 1 + wbList.length) % wbList.length;
  wbFlipped = false;
  document.getElementById('wb-card').classList.remove('flipped');
  renderWrongbookCard();
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

/**
 * 在错题本中答题
 * @param {boolean} correct
 */
async function answerWb(correct) {
  const w = wbList[wbIdx];
  await recordInteraction(w.ro, correct ? 'wrongbook_correct' : 'wrongbook_wrong');

  if (correct) {
    // 连击+1
    wbStreaks[w.ro] = (wbStreaks[w.ro] || 0) + 1;
    if (wbStreaks[w.ro] >= WB_GRADUATE) {
      // 毕业！移出错题本
      wbGraduated++;
      await recordInteraction(w.ro, 'wrongbook_clear');
      delete wbStreaks[w.ro];
      saveWrongbookStreaks();
      showToast(`🎓 "${w.zh}" 已从错题本移出！`);
      wbList.splice(wbIdx, 1);
      if (wbList.length === 0) { renderWrongbookCard(); renderWrongbookStats(); return; }
      wbIdx = wbIdx % wbList.length;
      renderWrongbookStats();
      renderWrongbookCard();
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
    wbFlipped = false;
    document.getElementById('wb-card').classList.remove('flipped');
    renderWrongbookCard();
  }, 800);
}

// ── 测验模式 ──────────────────────────────────────────────

let qSize = 20; // 每轮题目数，默认20

function setQMode(m) {
  qMode = m;
  document.getElementById('m-zh').classList.toggle('active', m === 'zh');
  document.getElementById('m-ro').classList.toggle('active', m === 'ro');
  showQuizSetup();
}

function setExerciseMode(mode) {
  qExerciseMode = mode;
  document.querySelectorAll('.exercise-btn').forEach(b => b.classList.toggle('active', b.dataset.exercise === mode));
  showQuizSetup();
}

function setPracticeScope(scope) {
  qPracticeScope = scope;
  document.querySelectorAll('#quiz-scope-bar .study-mode-btn').forEach(b => b.classList.toggle('active', b.dataset.scope === scope));
  showQuizSetup();
}

function setQSize(n) {
  qSize = n;
  document.querySelectorAll('.qsize-btn').forEach(b =>
    b.classList.toggle('active', parseInt(b.dataset.n) === n)
  );
}

function getActiveStudyPool() {
  const scoped = curCat === '全部' ? W : W.filter(w => w.cat === curCat);
  return sortByReviewPriority(scoped);
}

function getScopedPracticePool() {
  const scoped = curCat === '全部' ? W : W.filter(w => w.cat === curCat);
  if (qPracticeScope === 'today') {
    const todaySet = new Set([...todayQueue, ...todayQueueCompleted]);
    return sortByReviewPriority(scoped.filter(w => todaySet.has(w.ro)));
  }
  if (qPracticeScope === 'wrong') return getDifficultWords(scoped);
  if (qPracticeScope === 'due') {
    return sortReviewDueWithWeakPriority(scoped).filter(w => {
      const p = progressMap[w.ro];
      return p && (p.qt || p.known) && isReviewDue(p);
    });
  }
  if (qPracticeScope === 'new') return getUnseenWords(scoped);
  if (qPracticeScope === 'all') return sortByReviewPriority(scoped);
  return uniqueWordsByRo([
    ...sortReviewDueWithWeakPriority(scoped).filter(w => {
      const p = progressMap[w.ro];
      return p && (p.qt || p.known) && isReviewDue(p);
    }),
    ...getDifficultWords(scoped),
    ...getUnseenWords(scoped),
    ...sortByReviewPriority(scoped)
  ]);
}

function getPracticeScopeLabel() {
  return {
    smart: '智能练习',
    today: '今日任务',
    wrong: '错题',
    due: '到期复习',
    new: '新词',
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
  return '把这个词加入错题本后，系统会在智能练习里提高它的优先级。';
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
  const pool = qExerciseMode === 'translation' || qExerciseMode === 'listening' ? getScopedPracticePool() : buildExercisePool();
  const qmodeBar = document.querySelector('.qmode-bar');
  if (qmodeBar) qmodeBar.style.display = qExerciseMode === 'translation' ? 'flex' : 'none';
  const modeName = {
    translation: '翻译测验',
    listening: '听力测验',
    nounPlural: '名词复数',
    verbConj: '动词变位',
    stress: '重音选择'
  }[qExerciseMode];
  document.getElementById('quiz-area').innerHTML = `
    <div style="text-align:center;padding:1.5rem 0">
      <div style="font-size:13px;color:var(--text2);margin-bottom:8px">${curCat !== '全部' ? curCat : '全部分类'} · ${getPracticeScopeLabel()} · ${modeName} · ${pool.length} 题</div>
      <div style="font-size:15px;font-weight:600;margin-bottom:1rem;color:var(--text)">选择本轮题目数</div>
      <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-bottom:1.5rem">
        <button class="qsize-btn${qSize===20?' active':''}" data-n="20" onclick="setQSize(20)">20题</button>
        <button class="qsize-btn${qSize===50?' active':''}" data-n="50" onclick="setQSize(50)">50题</button>
        <button class="qsize-btn${qSize===100?' active':''}" data-n="100" onclick="setQSize(100)">100题</button>
        <button class="qsize-btn${qSize===0?' active':''}" data-n="0" onclick="setQSize(0)">全部(${pool.length}题)</button>
      </div>
      ${pool.length ? '<button class="btn-primary" style="max-width:200px" onclick="startQuiz()">开始测验 →</button>' : '<div class="empty-state">当前模式没有足够的已核对数据。请先由管理员核对词条。</div>'}
    </div>`;
}

function startQuiz() {
  const activePool = qExerciseMode === 'translation' || qExerciseMode === 'listening' ? getScopedPracticePool() : buildExercisePool();
  if (!activePool.length) { showToast('当前模式没有可测验的词'); return; }
  const pool = qExerciseMode === 'translation' || qExerciseMode === 'listening' ? buildReviewPriorityPool(activePool) : shuffleGroup(activePool);
  qList = qSize > 0 ? pool.slice(0, qSize) : pool;
  qIdx = 0;
  qRoundRight = 0;
  qRoundTotal = 0;
  renderQuiz();
}

function renderQuiz() {
  if (qIdx >= qList.length) { showResult(); return; }
  const pct = Math.round(qIdx / qList.length * 100);
  const livePct = qRoundTotal > 0 ? Math.round(qRoundRight / qRoundTotal * 100) : 0;
  if (qExerciseMode === 'listening') {
    const w = qList[qIdx];
    const optionPool = getScopedPracticePool().filter(x => x.ro !== w.ro);
    const fallbackPool = W.filter(x => x.ro !== w.ro && !optionPool.some(o => o.ro === x.ro));
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
        const ok = o.ro === w.ro;
        return `<button class="opt" onclick="answerQ(this,${ok},decodeURIComponent('${encodedArg(w.ro)}'),decodeURIComponent('${encodedArg(w.zh)}'))">${escapeHtml(o.zh)}</button>`;
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
        const ok = o === ex.answer;
        const label = ex.type === 'stress' ? stressToHtml(o) : escapeHtml(o);
        return `<button class="opt" onclick="answerExerciseQ(this,${ok})">${label}</button>`;
      }).join('')}</div>
      <div class="quiz-fb" id="qfb"></div>
      <button class="next-btn" id="qnxt" onclick="nextQ()" style="display:none">下一题 →</button>`;
    return;
  }

  const w = qList[qIdx];
  const optionPool = getScopedPracticePool().filter(x => x.ro !== w.ro);
  const fallbackPool = W.filter(x => x.ro !== w.ro && !optionPool.some(o => o.ro === x.ro));
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
      const ok = o.ro === w.ro;
      return `<button class="opt" onclick="answerQ(this,${ok},decodeURIComponent('${encodedArg(w.ro)}'),decodeURIComponent('${encodedArg(w.zh)}'))">${escapeHtml(label)}</button>`;
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
    // 根据模式匹配正确答案：中文模式按钮显示罗语，罗语模式按钮显示中文
    const correctLabel = qMode === 'zh' ? ro : zh;
    btn.parentElement.querySelectorAll('.opt').forEach(b => {
      if (b.textContent === correctLabel) b.classList.add('correct');
    });
    document.getElementById('qfb').style.color = 'var(--red-text)';
  }
  const w = qList[qIdx];
  document.getElementById('qfb').innerHTML = buildFeedbackHtml(w, ok, { type: qExerciseMode === 'listening' ? 'listening' : 'translation' });
  await recordInteraction(w.ro, ok ? 'quiz_correct' : 'quiz_wrong');
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
    const ex = qList[qIdx];
    btn.parentElement.querySelectorAll('.opt').forEach(b => {
      if (normalizeStressText(b.textContent) === normalizeStressText(ex.answer) || b.textContent === ex.answer) b.classList.add('correct');
    });
    document.getElementById('qfb').style.color = 'var(--red-text)';
  }
  const ex = qList[qIdx];
  const w = ex.word;
  document.getElementById('qfb').innerHTML = buildFeedbackHtml(w, ok, { type: ex.type, answer: ex.answer });
  await recordInteraction(w.ro, ok ? 'quiz_correct' : 'quiz_wrong');
  upStats();
  document.getElementById('qnxt').style.display = 'block';
}

function nextQ() { qIdx++; renderQuiz(); }

function showResult() {
  const pct = qRoundTotal > 0 ? Math.round(qRoundRight / qRoundTotal * 100) : 0;
  const wrongCount = getWrongWords().length;
  document.getElementById('quiz-area').innerHTML = `
    <div class="result-box">
      <div class="result-score">${qRoundRight}/${qRoundTotal}</div>
      <div class="result-label">本轮正确率 ${pct}% · ${pct >= 80 ? '优秀🎉' : pct >= 60 ? '良好👍' : '继续加油💪'}</div>
      ${wrongCount > 0 ? `<div style="font-size:13px;color:var(--red-text);margin-bottom:16px">错题本有 ${wrongCount} 个词待练习</div>` : ''}
      <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap">
        <button class="restart-btn" onclick="startQuiz()">再来一轮</button>
        ${wrongCount > 0 ? `<button class="restart-btn" style="border-color:var(--red);color:var(--red-text)" onclick="switchPage('wrongbook')">去错题本 →</button>` : ''}
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
  const completedTasks = Number(log.new_words || 0);
  const goal = Number(log.goal || dailyGoal || 20);
  return !!log.completed || (goal > 0 && completedTasks >= goal);
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
  const weakCat = getWeakestCategory();
  const todayOpen = todayQueue.length;
  const items = [];
  if (dueCount) items.push({ title: `先复习 ${dueCount} 个到期词`, kind: 'due' });
  if (wrongCount) items.push({ title: `再清理 ${wrongCount} 个错题`, kind: 'wrong' });
  if (todayOpen) items.push({ title: `完成今日剩余 ${todayOpen} 个任务`, kind: 'today' });
  if (weakCat) items.push({ title: `薄弱分类：${weakCat.cat}（掌握率 ${weakCat.pct}%）`, kind: 'cat', arg: weakCat.cat });
  if (!items.length) items.push({ title: `状态稳定。可以做一轮智能测验，当前正确率 ${summary.accuracy}%`, kind: 'quiz' });
  el.innerHTML = items.slice(0, 4).map(item => `
    <div class="hard-row">
      <div class="hard-main"><div class="hard-word">${escapeHtml(item.title)}</div></div>
      <button class="btn-sm" onclick="startCoachAction(decodeURIComponent('${encodedArg(item.kind)}'),decodeURIComponent('${encodedArg(item.arg || '')}'))">开始</button>
    </div>`).join('');
}

function startCoachAction(kind, arg = '') {
  if (kind === 'due') { setPracticeScope('due'); switchPage('quiz'); return; }
  if (kind === 'wrong') { switchPage('wrongbook'); return; }
  if (kind === 'today') { setFlashMode('today'); switchPage('flash'); return; }
  if (kind === 'cat') { setCat(arg); switchPage('flash'); return; }
  setPracticeScope('smart');
  switchPage('quiz');
}

function getWeakestCategory() {
  const groups = {};
  W.forEach(w => {
    const cat = normalizeCategory(w.cat);
    if (!groups[cat]) groups[cat] = { cat, total: 0, mastered: 0 };
    groups[cat].total++;
    if (getStoredLevel(progressMap[w.ro]) === 'mastered') groups[cat].mastered++;
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
    { name: '错题清零', done: wrongCount === 0, meta: `${wrongCount} 个错题` },
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
    dailyGoal,
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
    progressMap = { ...progressMap, ...incoming };
    const rows = Object.entries(incoming).slice(0, 1000);
    for (const [wordRo, p] of rows) {
      await apiSaveProgress(
        currentUser.id,
        wordRo,
        !!p.known,
        p.qr || 0,
        p.qt || 0,
        p.level || getStoredLevel(p),
        {
          reviewStage: p.reviewStage || p.reviewCount || 0,
          nextReviewAt: p.nextReviewAt || p.next_review_at || new Date().toISOString(),
          lastReviewedAt: p.lastReviewedAt || p.last_reviewed_at || new Date().toISOString()
        },
        null,
        {
          wrongCount: p.wrongCount || 0,
          errorStreak: p.errorStreak || 0,
          lastWrongAt: p.lastWrongAt || null
        }
      );
    }
    if (payload.dailyGoal) {
      dailyGoal = Math.max(1, Math.min(100, Number(payload.dailyGoal) || dailyGoal));
      const input = document.getElementById('goal-input');
      if (input) input.value = dailyGoal;
      await apiSetDailyGoal(currentUser.id, dailyGoal);
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
    const lv = getStoredLevel(progressMap[w.ro]);
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
    const p = progressMap[w.ro] || {};
    const stage = Number(p.reviewStage || p.reviewCount || 0);
    return `<div class="hard-row">
      <div class="hard-main">
        <div class="hard-word">${escapeHtml(w.zh || '')} · ${escapeHtml(w.ro || '')}</div>
        <div class="hard-meta">${escapeHtml(w.cat || '')} · 复习阶段 ${stage} · 连错 ${s.streak}</div>
      </div>
      <div class="hard-score">${s.wrong}错 · ${rate}%</div>
    </div>`;
  }).join('') : '<div class="empty-state">还没有错题记录</div>';
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
          <div class="rank-name">${escapeHtml(u.name)}${u.id === currentUser.id ? ' · 我' : ''}</div>
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
  const p = progressMap[w.ro] || {};
  const s = getDifficultScore(w);
  const stress = getStressDisplay(w);
  const nextReview = p.nextReviewAt ? formatReviewDue(p.nextReviewAt) : '未安排';
  const example = buildExampleSentence(w);
  const canQueue = isUnseenWord(w) && !(todayQueue.includes(w.ro) && !todayQueueCompleted.has(w.ro));
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
      <div class="detail-chip"><div class="detail-label">复习</div><div class="detail-value">下次：${escapeHtml(nextReview)} · 阶段 ${Number(p.reviewStage || p.reviewCount || 0)}</div></div>
      <div class="detail-chip"><div class="detail-label">练习记录</div><div class="detail-value">正确 ${p.qr || 0}/${p.qt || 0} · 答错 ${s.wrong} · 连错 ${s.streak}</div></div>
      <div class="detail-chip"><div class="detail-label">今日类型</div><div class="detail-value">${escapeHtml(getDailyTaskType(w))}</div></div>
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
  if (savedRo) return { ro: savedRo, zh: savedZh || `例句使用了“${zh || ro}”。` };
  return null;
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
  const examples = exampleBank[lowerRo(ro)] || exampleBank[ro];
  if (!Array.isArray(examples) || !examples.length) return null;
  const selected = examples[Math.abs(hashText(`${ro}:${idx}:${flashMode}`)) % examples.length];
  if (!selected?.ro) return null;
  return {
    ro: selected.ro,
    zh: selected.zh || `真实语料例句，句中使用“${w?.zh || ro}”。`,
    source: selected.source || 'local corpus'
  };
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
  return `<div class="example-ro">${escapeHtml(example.ro || '')}</div>
    <div class="example-zh">${escapeHtml(example.zh || '')}</div>
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
  const direct = CORPUS_EXAMPLES[lowerRo(ro)];
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
      zh: getChineseCorpusTranslation(selected) || `语料例句，句中使用“${zh || wordRo}”。`,
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
  if (todayQueue.includes(w.ro) && !todayQueueCompleted.has(w.ro)) {
    return '<span class="word-queued">已在队列</span>';
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
  document.getElementById('em-example-ro').value = word.example_ro || word.exampleRo || '';
  document.getElementById('em-example-zh').value = word.example_zh || word.exampleZh || '';
  document.getElementById('edit-modal').style.display = 'flex';
}

function closeEditModal() {
  document.getElementById('edit-modal').style.display = 'none';
  editingWordId = null; editingReportId = null;
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
  try {
    await apiUpdateWord(editingWordId, updates);
    if (editingReportId) await apiResolveReport(editingReportId);
    // 更新本地缓存
    const wi = W.findIndex(w => w.id === editingWordId);
    if (wi >= 0) W[wi] = { ...W[wi], ...updates };
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
    W = (await apiLoadWords()).map(normalizeWordCategory);
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
    W = (await apiLoadWords()).map(normalizeWordCategory);
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
      const word = W.find(w => w.ro === s.ro) || {};
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
  const word = W.find(w => w.ro === wordRo);
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
    document.getElementById('users-container').innerHTML = data.map(u => `
      <div class="user-row">
        <div style="flex:1;min-width:0">
          <div class="user-email">${escapeHtml(u.email || '')}</div>
          <div class="user-nickname">${escapeHtml(u.nickname || '未设昵称')} · ${new Date(u.created_at).toLocaleDateString('zh')}</div>
        </div>
        <span class="role-badge role-${escapeHtml(u.role)}">${escapeHtml({ admin: '管理员', user: '已通过', pending: '待审批' }[u.role] || u.role)}</span>
        ${u.role === 'pending' ? `<button class="admin-btn approve" onclick="setUserRole(decodeURIComponent('${encodedArg(u.id)}'),'user')">✓ 通过</button><button class="admin-btn revoke" onclick="rejectUserProfile(decodeURIComponent('${encodedArg(u.id)}'),decodeURIComponent('${encodedArg(u.email || u.nickname || '')}'))">拒绝</button>` : ''}
        ${u.role === 'user' ? `<button class="admin-btn revoke" onclick="setUserRole(decodeURIComponent('${encodedArg(u.id)}'),'pending')">撤销</button>` : ''}
      </div>`).join('');
  } catch (e) {
    document.getElementById('users-container').innerHTML = '<div class="empty-state">加载失败</div>';
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

// ── Toast 提示 ────────────────────────────────────────────

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

// ── 启动 ─────────────────────────────────────────────────
if (window.speechSynthesis) { speechSynthesis.onvoiceschanged = () => {}; }
bindCardGestures();
init();
