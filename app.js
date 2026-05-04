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
let curCat = '全部';
let reviewQueue = [];
let reviewIdx = 0;
let flashMode = 'today'; // today | review
let todayQueue = [];
let todayQueueCompleted = new Set();
let todayQueueRecord = null;

let qMode = 'zh';     // 测验模式：'zh' | 'ro'
let qExerciseMode = 'translation'; // translation | nounPlural | verbConj | stress
let qList = [];
let qIdx = 0;
let qRight = 0;       // 本次会话累计答对（不重置）
let qTotal = 0;       // 本次会话累计答题（不重置）
let qRoundRight = 0;  // 本轮答对（用于显示结算）
let qRoundTotal = 0;  // 本轮答题

let editingWordId = null;
let editingReportId = null;
let flashcardButtonsBound = false;

// 错题本状态
let wbList = [];
let wbIdx = 0;
let wbFlipped = false;
let wbStreaks = {};
let wbGraduated = 0;
const WB_GRADUATE = 3;

// 每日目标状态
let dailyGoal = 20;
let todayNewWords = 0;      // 今日新学词数（首次翻到背面算学过）
let todaySeenWords = new Set(); // 今天已经见过的词 ro 集合
let todayLog = null;

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

// 熟练度规则
// unknown  → 从未答题
// learning → 答题次数 ≥ 1，正确率 < 80%
// mastered → 答题次数 ≥ 3，正确率 ≥ 80%

// ── 入口 ─────────────────────────────────────────────────

async function init() {
  const { data: { session } } = await sb.auth.getSession();
  if (session) await onLogin(session.user);
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
}

// ── 词库加载 ──────────────────────────────────────────────

async function loadWords() {
  document.getElementById('flash-loading').style.display = 'flex';
  document.getElementById('flash-content').style.display = 'none';

  W = (await apiLoadWords()).map(normalizeWordCategory);
  applyFilters();

  document.getElementById('s-total').textContent = W.length;
  document.getElementById('topbar-badge').textContent = W.length + '词 · A1-A2';

  populateCategoryDatalist();
  buildCats();
  renderCard();

  document.getElementById('flash-loading').style.display = 'none';
  document.getElementById('flash-content').style.display = 'block';
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
  const previousTodayCount = todayLog?.new_words || 0;
  const saved = await apiGetDailyQueue(currentUser.id, dailyGoal);
  if (saved?.word_ro?.length) {
    todayQueueRecord = saved;
    todayQueue = saved.word_ro.filter(ro => W.some(w => w.ro === ro));
    todayQueueCompleted = new Set((saved.completed_word_ro || []).filter(ro => todayQueue.includes(ro)));
  } else {
    todayQueue = buildDailyQueueWords(dailyGoal).map(w => w.ro);
    todayQueueCompleted = new Set();
    todayQueueRecord = await apiSaveDailyQueue(currentUser.id, {
      goal: dailyGoal,
      word_ro: todayQueue,
      completed_word_ro: [],
      completed: false
    });
  }
  todayNewWords = Math.max(previousTodayCount, todayQueueCompleted.size);
  if (todayQueueCompleted.size > previousTodayCount || todayLog?.goal !== dailyGoal) {
    await apiUpdateTodayLog(currentUser.id, todayNewWords, dailyGoal);
  }
  if (todayQueueRecord?.local) {
    showToast('每日队列暂存在本设备；请应用 daily_queue 数据库表以支持多设备同步');
  }
  applyFilters();
  renderCard();
  renderDailyGoal();
  renderCalendar();
  updateReviewBadge();
}

function buildDailyQueueWords(goal) {
  const cap = Math.max(1, Number(goal || 20));
  const unknown = W.filter(w => {
    const p = progressMap[w.ro];
    return !p || (!p.qt && !p.known);
  });
  const learning = W.filter(w => {
    const p = progressMap[w.ro];
    return p && getProgressLevel(w.ro) !== 'mastered' && !unknown.some(u => u.ro === w.ro);
  });
  return [...unknown, ...sortByReviewPriority(learning)].slice(0, cap);
}

async function saveTodayQueue() {
  todayQueueRecord = await apiSaveDailyQueue(currentUser.id, {
    goal: dailyGoal,
    word_ro: todayQueue,
    completed_word_ro: [...todayQueueCompleted],
    completed: todayQueue.length > 0 && todayQueueCompleted.size >= todayQueue.length
  });
}

async function completeTodayQueueWord(wordRo) {
  if (!wordRo || todayQueueCompleted.has(wordRo)) return;
  todayQueueCompleted.add(wordRo);
  todayNewWords = todayQueueCompleted.size;
  await saveTodayQueue();
  await apiUpdateTodayLog(currentUser.id, todayNewWords, dailyGoal);
  renderDailyGoal();
  updateTodayCalendarCell();
  renderReviewPanel();
  if (todayQueue.length && todayQueueCompleted.size >= todayQueue.length) showToast('今日学习队列已完成');
}

// ── 熟练度计算 ────────────────────────────────────────────

/**
 * 根据答题记录计算熟练度
 * unknown  → 没答过题
 * learning → 答过但正确率 < 80% 或答题次数 < 3
 * mastered → 答题次数 ≥ 3 且正确率 ≥ 80%
 */
function calcLevel(qr, qt) {
  if (!qt) return 'unknown';
  const pct = qr / qt;
  if (qt >= 3 && pct >= 0.8) return 'mastered';
  return 'learning';
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

function applyFilters() {
  const scoped = curCat === '全部' ? W : W.filter(w => w.cat === curCat);
  if (flashMode === 'today') {
    filtered = todayQueue
      .map(ro => W.find(w => w.ro === ro))
      .filter(Boolean)
      .filter(w => curCat === '全部' || w.cat === curCat)
      .filter(w => !todayQueueCompleted.has(w.ro));
  } else if (flashMode === 'review') {
    filtered = sortReviewDueWithWeakPriority(scoped).filter(w => {
      const p = progressMap[w.ro];
      return p && (p.qt || p.known) && isReviewDue(p);
    });
  } else {
    filtered = sortByReviewPriority(scoped).filter(w => getReviewBucket(w) !== 2);
  }
  idx = Math.min(idx, Math.max(filtered.length - 1, 0));
  renderReviewPanel();
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
  return p.level || calcLevel(p.qr, p.qt);
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
  return { today: '今日新词', review: '到期复习' }[flashMode] || '卡片记忆';
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
  const due = scoped.filter(w => isReviewDue(progressMap[w.ro])).length;
  const difficult = getDifficultWords(scoped).length;
  const scopedQueue = todayQueue
    .map(ro => W.find(w => w.ro === ro))
    .filter(Boolean)
    .filter(w => curCat === '全部' || w.cat === curCat);
  const queueDone = scopedQueue.filter(w => todayQueueCompleted.has(w.ro)).length;
  const queueTotal = curCat === '全部' ? (todayQueue.length || dailyGoal) : scopedQueue.length;
  const waiting = scoped.length - due;
  const current = filtered[idx];
  const p = current ? progressMap[current.ro] : null;
  setText('review-due-count', due);
  setText('review-new-count', `${queueDone}/${queueTotal}`);
  setText('review-stage-label', difficult);
  const currentStage = Number(p?.reviewStage || 0);
  const nextInterval = REVIEW_INTERVALS[Math.min(currentStage, REVIEW_INTERVALS.length - 1)] || REVIEW_INTERVALS[0];
  const nextLabel = nextInterval?.label || '';
  const modeNote = {
    today: `今日队列固定为 ${queueTotal} 个词，已完成 ${queueDone} 个。答完后自动打勾，不再继续滚动词库。`,
    review: current
      ? `当前词下次复习：${formatReviewDue(p?.nextReviewAt)}。到期复习会自动优先安排错误率高、连续答错或最近遗忘的词。`
      : '当前没有到期复习词，可以切换到今日新词。'
  };
  setText('review-note', current
    ? modeNote[flashMode]
    : `${modeNote[flashMode] || ''}${waiting > 0 && flashMode !== 'today' ? ` ${waiting} 个词暂未进入当前模式。` : ''}`);
  document.querySelectorAll('.study-mode-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.mode === flashMode));
  setText('flash-mode-title', getFlashModeLabel());
}

function setFlashMode(mode) {
  flashMode = mode;
  idx = 0;
  flipped = false;
  const card = document.getElementById('main-card');
  if (card) card.classList.remove('flipped');
  applyFilters();
  renderCard();
}

// ── 统计 ─────────────────────────────────────────────────

function upStats() {
  const vals = Object.values(progressMap);
  const mastered = vals.filter(p => calcLevel(p.qr, p.qt) === 'mastered').length;
  const learning = vals.filter(p => calcLevel(p.qr, p.qt) === 'learning').length;
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
  setSyncBadge('同步中...', '');
  const level = calcLevel(qr, qt);
  const prev = progressMap[wordRo] || {};
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
  progressMap[wordRo] = { ...prev, known, qr, qt, level, ...review, ...memory };
  try {
    await apiSaveProgress(currentUser.id, wordRo, known, qr, qt, level, review, null, memory);
    setSyncBadge('已保存', 'saved');
  } catch {
    setSyncBadge('同步失败', '');
  }
  setTimeout(() => setSyncBadge('', ''), 2000);
  applyFilters();
  upStats();
  updateReviewBadge();
}

// ── 导航 ─────────────────────────────────────────────────

function switchPage(p) {
  if (p === 'review') { flashMode = 'review'; p = 'flash'; }
  const pages = ['flash', 'wrongbook', 'quiz', 'stats', 'leaderboard', 'guide', 'list', 'admin'];
  pages.forEach((s, i) => {
    const tab = document.querySelectorAll('.nav-tab:not(.hidden-tab)')[i];
    if (tab) tab.classList.toggle('active', s === p);
    const page = document.getElementById('page-' + s);
    if (page) page.classList.toggle('active', s === p);
  });
  const reviewPage = document.getElementById('page-review');
  if (reviewPage) reviewPage.classList.remove('active');
  if (p === 'flash') { applyFilters(); renderCard(); renderDailyGoal(); renderCalendar(); }
  if (p === 'quiz') showQuizSetup();
  if (p === 'stats') renderStatsPage();
  if (p === 'leaderboard') renderLeaderboard();
  if (p === 'list') renderList();
  if (p === 'wrongbook') initWrongbook();
  if (p === 'admin') { restoreAdminSections(); loadAdminStats(); loadAdminReports(); loadAdminUsers(); }
}

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
  const count = getTodayReviewWords().length;
  badge.textContent = count;
  badge.style.display = count > 0 ? 'inline' : 'none';
}

// ── 每日目标 ──────────────────────────────────────────────

function renderDailyGoal() {
  const el = document.getElementById('daily-goal-bar');
  if (!el) return;
  const pct = Math.min(100, Math.round(todayNewWords / dailyGoal * 100));
  const done = todayNewWords >= dailyGoal;
  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
      <span style="font-size:13px;font-weight:600;color:var(--text)">
        ${done ? '🎉 今日目标完成！' : '📅 今日目标'}
      </span>
      <span style="font-size:13px;color:var(--text2)">${todayNewWords} / ${dailyGoal} 词</span>
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
  if (todayQueue.length < dailyGoal) {
    const existing = new Set(todayQueue);
    const extra = buildDailyQueueWords(dailyGoal)
      .map(w => w.ro)
      .filter(ro => !existing.has(ro))
      .slice(0, dailyGoal - todayQueue.length);
    todayQueue = [...todayQueue, ...extra];
  } else if (todayQueue.length > dailyGoal) {
    const keepCompleted = todayQueue.filter(ro => todayQueueCompleted.has(ro));
    const keepOpen = todayQueue.filter(ro => !todayQueueCompleted.has(ro));
    todayQueue = [...keepCompleted, ...keepOpen].slice(0, dailyGoal);
    todayQueueCompleted = new Set([...todayQueueCompleted].filter(ro => todayQueue.includes(ro)));
  }
  await saveTodayQueue();
  await apiUpdateTodayLog(currentUser.id, todayNewWords, dailyGoal);
  applyFilters();
  renderCard();
  renderDailyGoal();
  renderCalendar();
  showToast('每日目标已更新');
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
    const dateStr = d.toISOString().slice(0, 10);
    const log = logMap[dateStr];
    const isToday = d.getTime() === today.getTime();
    const label = isToday ? '今' : (d.getMonth() + 1) + '/' + d.getDate();

    // 今天用实时数据，历史用数据库
    const newWords = isToday ? todayNewWords : (log?.new_words || 0);
    const goal = isToday ? dailyGoal : (log?.goal || dailyGoal);
    const completed = isToday ? (todayNewWords >= dailyGoal) : (log?.completed || false);

    const stateClass = completed ? 'completed' : newWords > 0 ? 'started' : '';
    const todayAttr = isToday ? 'data-today="1"' : '';
    days.push(`<div ${todayAttr} class="calendar-cell ${stateClass}${isToday ? ' today' : ''}" title="${label}: ${newWords}词 / 目标${goal}词">
      <span class="calendar-date">${label}</span>
      <span class="cal-sub">${newWords > 0 ? newWords : ''}</span>
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
  const cats = CATEGORY_ORDER
    .filter(c => c === '全部' || present.has(c))
    .concat([...present].filter(c => !CATEGORY_ORDER.includes(c)).sort((a, b) => a.localeCompare(b, 'en')));
  document.getElementById('cat-bar').innerHTML = cats.map(c =>
    `<button class="cat-chip${c === curCat ? ' active' : ''}" onclick="setCat('${c.replace(/'/g, "\\'")}')">${c}</button>`
  ).join('');
}

function setCat(c) {
  curCat = c;
  applyFilters();
  idx = 0; flipped = false;
  document.getElementById('main-card').classList.remove('flipped');
  buildCats();
  renderCard();
}

function renderCard() {
  if (!filtered.length) {
    setText('fc-cat', curCat === '全部' ? '' : curCat);
    setText('fc-cat2', curCat === '全部' ? '' : curCat);
    const emptyText = {
      today: todayQueue.length && todayQueueCompleted.size >= todayQueue.length ? '今日队列已完成' : '今日暂无新词',
      review: '当前没有到期复习词',
    }[flashMode] || '当前分类暂无可学词';
    const actionText = {
      today: '可以切换到复习或测验',
      review: '先完成今日新词，系统会安排复习'
    }[flashMode] || 'No words';
    setText('fc-zh', emptyText);
    setText('fc-ro', actionText);
    setText('fc-ipa', '');
    setText('fc-phint', '');
    setText('fc-count', '0 / 0');
    setText('fc-level', '');
    const verifyEl = document.getElementById('fc-verify');
    if (verifyEl) verifyEl.style.display = 'none';
    return;
  }
  bindFlashcardButtons();
  idx = (idx + filtered.length) % filtered.length;
  const w = filtered[idx];
  const stress = getStressDisplay(w);
  document.getElementById('fc-cat').textContent = w.cat || '';
  document.getElementById('fc-cat2').textContent = w.cat || '';
  document.getElementById('fc-zh').textContent = w.zh;
  document.getElementById('fc-ro').textContent = w.ro;
  const verifyEl = document.getElementById('fc-verify');
  if (verifyEl) {
    verifyEl.textContent = isWordUnverified(w) ? '未核对' : '';
    verifyEl.style.display = isWordUnverified(w) ? '' : 'none';
  }
  setStressHtml('fc-ipa', w);
  setGrammarText('fc-phint', w, stress);
  document.getElementById('fc-count').textContent = `${getFlashModeLabel()} ${idx + 1} / ${flashMode === 'today' ? (todayQueue.length || dailyGoal) : filtered.length}`;
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
 * 记录当前词为「今日已学」
 */
async function recordDailyWord() {
  if (!filtered.length) return;
  const w = filtered[idx];
  if (flashMode === 'today') {
    await completeTodayQueueWord(w.ro);
    return;
  }
  if (!todaySeenWords.has(w.ro)) {
    todaySeenWords.add(w.ro);
    todayNewWords++;
    apiUpdateTodayLog(currentUser.id, todayNewWords, dailyGoal);
    renderDailyGoal();
    updateTodayCalendarCell();
    if (todayNewWords === dailyGoal) showToast('🎉 恭喜！今日目标达成！');
  }
}

/**
 * 只更新今天日历格子颜色，不重新请求数据库
 */
function updateTodayCalendarCell() {
  const cells = document.querySelectorAll('#calendar-container [data-today]');
  cells.forEach(cell => {
    const done = todayNewWords >= dailyGoal;
    cell.style.background = done ? 'var(--green)' : '#bbf7d0';
    cell.style.color = done ? 'white' : 'var(--green-text)';
    const sub = cell.querySelector('.cal-sub');
    if (sub) sub.textContent = todayNewWords;
  });
}

// 「认识了」/「不认识」
async function markCard(yes) {
  if (!filtered.length) return;
  const w = filtered[idx];
  const prev = progressMap[w.ro] || { known: false, qr: 0, qt: 0 };
  const newQr = (prev.qr || 0) + (yes ? 1 : 0);
  const newQt = (prev.qt || 0) + 1;
  await syncProgress(w.ro, yes || prev.known, newQr, newQt, yes);
  if (flashMode === 'today') await completeTodayQueueWord(w.ro);
  // 跳下一张，重置为中文面
  applyFilters();
  const nextIdx = filtered.findIndex(item => item.ro !== w.ro);
  idx = nextIdx >= 0 ? nextIdx : 0;
  flipped = false;
  document.getElementById('main-card').classList.remove('flipped');
  renderCard();
}

// 「上一个」— 回到上一张的罗语面
function prevCard() {
  if (!filtered.length) return;
  idx = (idx - 1 + filtered.length) % filtered.length;
  flipped = true;
  document.getElementById('main-card').classList.add('flipped');
  renderCard();
}

function speak(rate) {
  if (!filtered.length) return;
  const w = filtered[idx];
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
  return W.filter(w => {
    const p = progressMap[w.ro];
    return p && (p.qt || p.known) && isReviewDue(p);
  });
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
      <div style="font-size:16px;font-weight:600;color:var(--text)">今日没有待复习词汇</div>
      <div style="font-size:14px;color:var(--text2);text-align:center">先去学新词，系统会按复习间隔安排下一次复习</div>
      <button class="btn-sm" style="margin-top:12px" onclick="switchPage('flash')">去学新词</button>`;
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
  const prev = progressMap[w.ro] || { known: true, qr: 0, qt: 0 };
  const newQr = (prev.qr || 0) + (yes ? 1 : 0);
  const newQt = (prev.qt || 0) + 1;
  await syncProgress(w.ro, yes || prev.known, newQr, newQt, yes);

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
      <div style="font-size:14px;color:var(--text2);text-align:center">完成了 ${reviewQueue.length} 个词的复习</div>
      <button class="btn-sm" onclick="switchPage('flash')">去学新词</button>
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
  wbList = getWrongWords();
  wbIdx = 0;
  wbFlipped = false;
  wbStreaks = {};
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
  wbIdx = (wbIdx + 1) % wbList.length;
  wbFlipped = false;
  document.getElementById('wb-card').classList.remove('flipped');
  renderWrongbookCard();
}

function prevWbCard() {
  wbIdx = (wbIdx - 1 + wbList.length) % wbList.length;
  wbFlipped = false;
  document.getElementById('wb-card').classList.remove('flipped');
  renderWrongbookCard();
}

function speakWb(rate) {
  const w = wbList[wbIdx];
  if (!('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(w.ro);
  u.lang = 'ro-RO'; u.rate = rate;
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
  const prev = progressMap[w.ro] || { known: false, qr: 0, qt: 0 };

  // 更新进度
  const newQr = (prev.qr || 0) + (correct ? 1 : 0);
  const newQt = (prev.qt || 0) + 1;
  await syncProgress(w.ro, correct || prev.known, newQr, newQt, correct);

  if (correct) {
    // 连击+1
    wbStreaks[w.ro] = (wbStreaks[w.ro] || 0) + 1;
    if (wbStreaks[w.ro] >= WB_GRADUATE) {
      // 毕业！移出错题本
      wbGraduated++;
      await syncProgress(w.ro, true, newQr, newQt, true, { clearWrongbook: true });
      showToast(`🎓 "${w.zh}" 已从错题本移出！`);
      wbList.splice(wbIdx, 1);
      if (wbList.length === 0) { renderWrongbookCard(); renderWrongbookStats(); return; }
      wbIdx = wbIdx % wbList.length;
      renderWrongbookStats();
      renderWrongbookCard();
      return;
    } else {
      showToast(`✓ 正确！连续答对 ${wbStreaks[w.ro]}/${WB_GRADUATE}`);
    }
  } else {
    // 答错重置连击
    wbStreaks[w.ro] = 0;
    showToast('✗ 再来一次，加油！');
  }

  renderWrongbookStats();
  // 自动跳下一张
  setTimeout(() => nextWbCard(), 800);
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
  const m = getGrammarInfo(w).match(/名词\s*·\s*复数\s*:\s*([^·]+)/);
  return m ? m[1].trim() : null;
}

function parseVerbClass(w) {
  if (isGrammarUnverified(w)) return null;
  const m = getGrammarInfo(w).match(/动词\s*·\s*(.+)$/);
  return m ? m[1].trim() : null;
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

function buildExercisePool() {
  const scoped = getActiveStudyPool();
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
    const verified = scoped.map(w => ({ w, answer: parseVerbClass(w) })).filter(x => x.answer);
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
  const pool = qExerciseMode === 'translation' ? getActiveStudyPool() : buildExercisePool();
  const qmodeBar = document.querySelector('.qmode-bar');
  if (qmodeBar) qmodeBar.style.display = qExerciseMode === 'translation' ? 'flex' : 'none';
  const modeName = {
    translation: '翻译测验',
    nounPlural: '名词复数',
    verbConj: '动词变位',
    stress: '重音选择'
  }[qExerciseMode];
  document.getElementById('quiz-area').innerHTML = `
    <div style="text-align:center;padding:1.5rem 0">
      <div style="font-size:13px;color:var(--text2);margin-bottom:8px">${curCat !== '全部' ? curCat : '全部分类'} · ${modeName} · ${pool.length} 题</div>
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
  const activePool = qExerciseMode === 'translation' ? getActiveStudyPool() : buildExercisePool();
  if (!activePool.length) { showToast('当前模式没有可测验的词'); return; }
  const pool = qExerciseMode === 'translation' ? buildReviewPriorityPool(activePool) : shuffleGroup(activePool);
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
  const optionPool = getActiveStudyPool().filter(x => x.ro !== w.ro);
  const fallbackPool = W.filter(x => x.ro !== w.ro && !optionPool.some(o => o.ro === x.ro));
  const wrongs = [...optionPool, ...fallbackPool].sort(() => Math.random() - 0.5).slice(0, 3);
  const opts = [w, ...wrongs].sort(() => Math.random() - 0.5);
  const qText = qMode === 'zh' ? w.zh : w.ro;
  document.getElementById('quiz-area').innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;font-size:13px;color:var(--text2)">
      <span>第 ${qIdx + 1} / ${qList.length} 题</span>
      <span style="color:${livePct>=60?'var(--green-text)':'var(--red-text)'}">答对 ${qRoundRight}/${qRoundTotal}${qRoundTotal>0?' ('+livePct+'%)':''}</span>
    </div>
    <div style="background:var(--bg3);border-radius:99px;height:6px;margin-bottom:1rem;overflow:hidden">
      <div style="height:100%;width:${pct}%;background:var(--blue);border-radius:99px;transition:width .3s"></div>
    </div>
    <div class="quiz-q">${qText}</div>
    <div class="quiz-sub">${qMode === 'zh' ? '选择对应的罗马尼亚语' : '选择对应的中文'}</div>
    <div class="opts">${opts.map(o => {
      const label = qMode === 'zh' ? o.ro : o.zh;
      const ok = o.ro === w.ro;
      return `<button class="opt" onclick="answerQ(this,${ok},'${w.ro.replace(/'/g, "\\'")}','${w.zh.replace(/'/g, "\\'")}')">${label}</button>`;
    }).join('')}</div>
    <div class="quiz-fb" id="qfb"></div>
    <button class="next-btn" id="qnxt" onclick="nextQ()" style="display:none">下一题 →</button>`;
}

function answerQ(btn, ok, ro, zh) {
  btn.parentElement.querySelectorAll('.opt').forEach(b => b.style.pointerEvents = 'none');
  qTotal++;
  qRoundTotal++;
  if (ok) {
    btn.classList.add('correct');
    document.getElementById('qfb').style.color = 'var(--green-text)';
    document.getElementById('qfb').textContent = '正确！';
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
    document.getElementById('qfb').textContent = '错误，答案已标出';
  }
  const w = qList[qIdx];
  const prev = progressMap[w.ro] || { known: false, qr: 0, qt: 0 };
  const newQr = (prev.qr || 0) + (ok ? 1 : 0);
  const newQt = (prev.qt || 0) + 1;
  progressMap[w.ro] = { ...prev, known: ok || prev.known, qr: newQr, qt: newQt };
  syncProgress(w.ro, ok || prev.known, newQr, newQt, ok, { trackWrongbook: true });
  upStats();
  document.getElementById('qnxt').style.display = 'block';
}

function answerExerciseQ(btn, ok) {
  btn.parentElement.querySelectorAll('.opt').forEach(b => b.style.pointerEvents = 'none');
  qTotal++;
  qRoundTotal++;
  if (ok) {
    btn.classList.add('correct');
    document.getElementById('qfb').style.color = 'var(--green-text)';
    document.getElementById('qfb').textContent = '正确！';
    qRight++;
    qRoundRight++;
  } else {
    btn.classList.add('wrong');
    const ex = qList[qIdx];
    btn.parentElement.querySelectorAll('.opt').forEach(b => {
      if (normalizeStressText(b.textContent) === normalizeStressText(ex.answer) || b.textContent === ex.answer) b.classList.add('correct');
    });
    document.getElementById('qfb').style.color = 'var(--red-text)';
    document.getElementById('qfb').textContent = '错误，答案已标出';
  }
  const ex = qList[qIdx];
  const w = ex.word;
  const prev = progressMap[w.ro] || { known: false, qr: 0, qt: 0 };
  const newQr = (prev.qr || 0) + (ok ? 1 : 0);
  const newQt = (prev.qt || 0) + 1;
  syncProgress(w.ro, ok || prev.known, newQr, newQt, ok, { trackWrongbook: true });
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

function getDateKey(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

function buildRecentDays(days) {
  const arr = [];
  for (let i = days - 1; i >= 0; i--) arr.push(getDateKey(-i));
  return arr;
}

function fillDailyLogs(logs, days) {
  const map = {};
  (logs || []).forEach(l => { map[l.log_date] = l; });
  return buildRecentDays(days).map(date => ({
    log_date: date,
    new_words: map[date]?.new_words || 0,
    goal: map[date]?.goal || dailyGoal,
    completed: map[date]?.completed || false
  }));
}

function calcStreak(logs) {
  const learned = new Set((logs || []).filter(l => (l.new_words || 0) > 0).map(l => l.log_date));
  let streak = 0;
  for (let i = 0; i < 365; i++) {
    if (!learned.has(getDateKey(-i))) break;
    streak++;
  }
  return streak;
}

function calcProgressSummary(map) {
  const vals = Object.values(map || {});
  const mastered = vals.filter(p => calcLevel(p.qr, p.qt) === 'mastered').length;
  const learning = vals.filter(p => calcLevel(p.qr, p.qt) === 'learning').length;
  const known = vals.filter(p => p.known).length;
  const qr = vals.reduce((sum, p) => sum + (p.qr || 0), 0);
  const qt = vals.reduce((sum, p) => sum + (p.qt || 0), 0);
  return { mastered, learning, known, qr, qt, accuracy: qt ? Math.round(qr / qt * 100) : 0 };
}

async function renderStatsPage() {
  const dailyEl = document.getElementById('daily-chart');
  const catEl = document.getElementById('cat-mastery');
  dailyEl.innerHTML = '<div class="empty-state">加载中...</div>';
  catEl.innerHTML = '<div class="empty-state">加载中...</div>';

  try {
    const logs = await apiGetRecentLogs(currentUser.id, 30);
    const filled14 = fillDailyLogs(logs, 14);
    const summary = calcProgressSummary(progressMap);
    const learned30 = fillDailyLogs(logs, 30).reduce((sum, l) => sum + (l.new_words || 0), 0);

    setText('stat-streak', calcStreak(logs));
    setText('stat-30days', learned30);
    setText('stat-accuracy', summary.accuracy + '%');
    renderDailyChart(filled14);
    await renderCalendar();
    renderCategoryMastery();
  } catch (e) {
    dailyEl.innerHTML = '<div class="empty-state">学习记录暂时无法读取</div>';
    catEl.innerHTML = '<div class="empty-state">分类统计暂时无法读取</div>';
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
        return `<div class="day-bar" title="${label}: ${l.new_words || 0}词">
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
    const lv = calcLevel(progressMap[w.ro]?.qr, progressMap[w.ro]?.qt);
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
          <div class="rank-meta">正确率 ${u.accuracy}% · 连续 ${u.streak} 天 · 测验 ${u.qt} 题</div>
        </div>
        <div class="rank-score"><strong>${u.mastered}</strong>已掌握</div>
      </div>`).join('') : '<div class="empty-state">暂时没有排行榜数据</div>';
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

// ── 词汇表 ────────────────────────────────────────────────

function renderList() {
  if (!W.length) return;
  const q = (document.getElementById('search-input') || { value: '' }).value.toLowerCase();
  const f = W.filter(w => !q || w.zh.includes(q) || w.ro.toLowerCase().includes(q) || (w.cat || '').includes(q));
  const editBtns = (w) => userRole === 'admin'
    ? `<button class="admin-btn edit" style="margin-left:4px;padding:3px 8px;font-size:11px" onclick='openEditModal(${JSON.stringify(w)})'>编辑</button>
       <button class="admin-btn revoke" style="margin-left:2px;padding:3px 8px;font-size:11px" onclick='deleteWord(${w.id},"${w.zh.replace(/"/g, '&quot;')}")'>删除</button>`
    : '';
  document.getElementById('word-list').innerHTML = f.slice(0, 200).map(w => {
    const p = progressMap[w.ro] || {};
    const lv = getProgressLevel(w.ro);
    const stress = getStressDisplay(w);
    const grammar = getGrammarInfo(w);
    return `<div class="word-row">
      <div style="flex:1;min-width:0">
        <div class="word-zh">${w.zh}</div>
        <div class="word-ro">${w.ro}</div>
        <div class="word-ipa${isWordUnverified(w) ? ' unverified-text' : ''}">${stressToHtml(stress.text)} · ${escapeHtml(grammar)}${stress.auto ? ' · 自动重音' : ''} ${unverifiedBadgeHtml(w)}</div>
      </div>
      <div style="display:flex;align-items:center;flex-shrink:0;gap:4px">
        <div class="word-cat">${w.cat || ''}</div>
        <span style="font-size:10px;padding:2px 7px;border-radius:99px;background:${LEVEL_BG[lv]};color:${LEVEL_TC[lv]};white-space:nowrap">${getLevelLabel(w.ro)}</span>
        ${editBtns(w)}
      </div>
    </div>`;
  }).join('') + (f.length > 200 ? `<div style="text-align:center;padding:12px;font-size:13px;color:var(--text3)">显示前200条，请搜索缩小范围</div>` : '');
}

function getMissingIpaWords() {
  return W
    .filter(w => !String(w.ipa || '').trim())
    .sort((a, b) => String(a.ro).localeCompare(String(b.ro), 'ro'));
}

function getPendingGrammarWords() {
  return W
    .filter(w => /待核对|待补充/.test(getGrammarInfo(w)))
    .sort((a, b) => String(a.ro).localeCompare(String(b.ro), 'ro'));
}

// ── 报错弹窗（用户） ──────────────────────────────────────

function openReportModal() {
  const w = filtered[idx];
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
  const w = filtered[idx];
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
  document.getElementById('aw-mode').value = 'single';
  document.getElementById('aw-single').style.display = 'block';
  document.getElementById('aw-bulk').style.display = 'none';
  document.getElementById('aw-zh').value = '';
  document.getElementById('aw-ro').value = '';
  document.getElementById('aw-ipa').value = '';
  document.getElementById('aw-hint').value = '';
  document.getElementById('aw-cat').value = '';
  document.getElementById('aw-bulk-text').value = '';
  document.getElementById('aw-result').textContent = '';
  document.getElementById('add-word-modal').style.display = 'flex';
}

function closeAddWordModal() {
  document.getElementById('add-word-modal').style.display = 'none';
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
  btn.disabled = true; btn.textContent = '保存中...';

  try {
    let words = [];
    if (mode === 'single') {
      const zh = document.getElementById('aw-zh').value.trim();
      const ro = document.getElementById('aw-ro').value.trim();
      if (!zh || !ro) { showToast('中文和罗语是必填项'); btn.disabled = false; btn.textContent = '保存'; return; }
      words = [{
        zh, ro,
        ipa: document.getElementById('aw-ipa').value.trim(),
        hint: document.getElementById('aw-hint').value.trim(),
        cat: normalizeCategory(document.getElementById('aw-cat').value)
      }];
    } else {
      // 批量模式：每行 中文|罗语|重音标记|语法信息|分类
      const lines = document.getElementById('aw-bulk-text').value.trim().split('\n').filter(l => l.trim());
      words = lines.map(line => {
        const parts = line.split('|').map(s => s.trim());
        return {
          zh: parts[0] || '',
          ro: parts[1] || '',
          ipa: parts[2] || '',
          hint: parts[3] || '',
          cat: normalizeCategory(parts[4])
        };
      }).filter(w => w.zh && w.ro);
      if (!words.length) { showToast('没有解析到有效词汇，请检查格式'); btn.disabled = false; btn.textContent = '保存'; return; }
    }

    const { inserted, skipped } = await apiInsertWords(words);

    // 刷新本地词库
    W = (await apiLoadWords()).map(normalizeWordCategory);
    applyFilters();
    document.getElementById('s-total').textContent = W.length;
    document.getElementById('topbar-badge').textContent = W.length + '词 · A1-A2';
    buildCats(); renderCard(); renderList();

    const msg = `✅ 成功添加 ${inserted} 个词${skipped > 0 ? `，跳过重复 ${skipped} 个` : ''}`;
    const missingIpa = words.filter(w => !String(w.ipa || '').trim()).length;
    document.getElementById('aw-result').textContent = msg;
    document.getElementById('aw-result').style.color = 'var(--green-text)';
    showToast(missingIpa ? `${msg}，其中 ${missingIpa} 个待校对音标` : msg);
    loadAdminStats();

    if (mode === 'single') {
      // 单条模式清空表单，方便继续添加
      document.getElementById('aw-zh').value = '';
      document.getElementById('aw-ro').value = '';
      document.getElementById('aw-ipa').value = '';
      document.getElementById('aw-hint').value = '';
    }
  } catch (e) {
    document.getElementById('aw-result').textContent = '❌ 失败：' + e.message;
    document.getElementById('aw-result').style.color = 'var(--red-text)';
  }
  btn.disabled = false; btn.textContent = '保存';
}

async function clearVocabularyForManualInput() {
  if (userRole !== 'admin') { showToast('只有管理员可以清空词库'); return; }
  const ok = confirm('这会清空词库、学习进度、今日队列、学习日志和报错记录。清空后需要在管理员页面重新导入词汇。确定继续吗？');
  if (!ok) return;

  const btn = [...document.querySelectorAll('button')]
    .find(b => b.textContent.trim() === '清空词库');
  if (btn) { btn.disabled = true; btn.textContent = '清空中...'; }

  try {
    await apiClearVocabularyData();
    W = [];
    filtered = [];
    progressMap = {};
    todayQueue = [];
    todayQueueCompleted = new Set();
    todayQueueRecord = null;
    todayNewWords = 0;
    todaySeenWords = new Set();
    todayLog = null;
    idx = 0;
    flipped = false;
    curCat = '全部';
    const card = document.getElementById('main-card');
    if (card) card.classList.remove('flipped');
    applyFilters();
    buildCats();
    renderCard();
    renderList();
    renderDailyGoal();
    renderCalendar();
    loadAdminStats();
    setText('s-total', 0);
    setText('topbar-badge', '0词 · A1-A2');
    showToast('词库已清空，可以开始重新导入');
  } catch (e) {
    showToast('清空失败：' + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '清空词库'; }
  }
}

async function applyCategoryNormalization() {
  if (userRole !== 'admin') { showToast('只有管理员可以应用分类规则'); return; }
  const changes = W
    .map(w => ({ ...w, nextCat: normalizeCategory(w.rawCat ?? w.cat) }))
    .filter(w => String((w.rawCat ?? w.cat) || '').trim() !== w.nextCat);
  if (!changes.length) {
    showToast('分类已经是新规则');
    return;
  }
  const ok = confirm(`将 ${changes.length} 个旧分类改为新分类，只修改分类字段。确定继续吗？`);
  if (!ok) return;

  const btn = [...document.querySelectorAll('button')]
    .find(b => b.textContent.trim() === '应用分类规则');
  if (btn) { btn.disabled = true; btn.textContent = '分类更新中...'; }

  try {
    let done = 0;
    for (const w of changes) {
      await apiUpdateWord(w.id, { cat: w.nextCat });
      done++;
      if (done % 50 === 0 && btn) btn.textContent = `${done}/${changes.length}`;
    }
    W = (await apiLoadWords()).map(normalizeWordCategory);
    applyFilters();
    buildCats();
    renderCard();
    renderList();
    renderStatsPage();
    loadAdminStats();
    showToast(`已更新 ${done} 个分类`);
  } catch (e) {
    showToast('分类更新失败：' + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '应用分类规则'; }
  }
}

// 从词汇表删除词条（管理员）
async function deleteWord(wordId, wordZh) {
  if (!confirm(`确定删除「${wordZh}」吗？此操作不可撤销。`)) return;
  try {
    await apiDeleteWord(wordId);
    W = W.filter(w => w.id !== wordId);
    applyFilters();
    document.getElementById('s-total').textContent = W.length;
    document.getElementById('topbar-badge').textContent = W.length + '词 · A1-A2';
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
    const [reportsResult, progressResult] = await Promise.allSettled([
      apiLoadReports(),
      apiLoadAllProgress()
    ]);
    const reports = reportsResult.status === 'fulfilled' ? reportsResult.value : [];
    const allProgress = progressResult.status === 'fulfilled' ? progressResult.value : [];
    const categoryStats = getAdminCategoryStats();
    const reportStats = getAdminReportStats(reports);
    const wrongStats = getAdminWrongStats(allProgress);
    const missingIpaWords = getMissingIpaWords();
    const pendingGrammarWords = getPendingGrammarWords();
    const pendingReports = reports.filter(r => r.status === 'pending').length;
    const totalAnswers = allProgress.reduce((sum, r) => sum + (r.quiz_total || 0), 0);

    el.innerHTML = `
      <div class="admin-stat-grid">
        <div class="admin-stat"><div class="admin-stat-n">${W.length}</div><div class="admin-stat-l">词库总量</div></div>
        <div class="admin-stat"><div class="admin-stat-n">${categoryStats.length}</div><div class="admin-stat-l">分类数量</div></div>
        <div class="admin-stat"><div class="admin-stat-n">${pendingReports}</div><div class="admin-stat-l">待处理报错</div></div>
        <div class="admin-stat"><div class="admin-stat-n">${missingIpaWords.length}</div><div class="admin-stat-l">待校对音标</div></div>
        <div class="admin-stat"><div class="admin-stat-n">${pendingGrammarWords.length}</div><div class="admin-stat-l">语法待核对</div></div>
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
        <div class="admin-chart-title">答错率最高的词 <span style="font-weight:400;color:var(--text2)">共 ${totalAnswers} 次测验记录</span></div>
        ${progressResult.status === 'fulfilled' ? renderAdminWrongRows(wrongStats) : `<div class="empty-state">答题记录无法读取：${escapeHtml(progressResult.reason.message)}</div>`}
      </div>`;
    renderMissingIpaPanel();
    renderPendingGrammarPanel();
  } catch (e) {
    el.innerHTML = `<div class="empty-state">词库统计加载失败：${escapeHtml(e.message || '未知错误')}</div>`;
    renderMissingIpaPanel();
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
            <button class="admin-btn edit" onclick='openEditModal(${JSON.stringify(w)})'>补音标</button>
          </div>
        </div>`;
      }).join('')}
    </div>`;
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
            <button class="admin-btn edit" onclick='openEditModal(${JSON.stringify(w)})'>核对</button>
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
  const count = await apiPendingReportCount();
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
        <div class="report-word">${r.word_zh} → ${r.word_ro}
          <span class="issue-tag">${ISSUE_LABELS[r.issue_type] || r.issue_type}</span>
          ${r.status === 'resolved' ? '<span style="font-size:11px;color:var(--green-text);font-weight:600">✓ 已解决</span>' : ''}
        </div>
        <div class="report-meta">来自：${r.reporter_email || '未知'} · ${new Date(r.created_at).toLocaleDateString('zh')}</div>
        ${r.note ? `<div class="report-note">"${r.note}"</div>` : ''}
        <div class="report-actions">
          <button class="admin-btn edit" onclick="openEditFromReport(${r.id},'${r.word_ro.replace(/'/g, "\\'")}')">✏️ 编辑词条</button>
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
          <div class="user-email">${u.email || ''}</div>
          <div class="user-nickname">${u.nickname || '未设昵称'} · ${new Date(u.created_at).toLocaleDateString('zh')}</div>
        </div>
        <span class="role-badge role-${u.role}">${{ admin: '管理员', user: '已通过', pending: '待审批' }[u.role] || u.role}</span>
        ${u.role === 'pending' ? `<button class="admin-btn approve" onclick="setUserRole('${u.id}','user')">✓ 通过</button>` : ''}
        ${u.role === 'user' ? `<button class="admin-btn revoke" onclick="setUserRole('${u.id}','pending')">撤销</button>` : ''}
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

// ── Toast 提示 ────────────────────────────────────────────

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

// ── 启动 ─────────────────────────────────────────────────
if (window.speechSynthesis) { speechSynthesis.onvoiceschanged = () => {}; }
init();
