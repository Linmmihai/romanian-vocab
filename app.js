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

let qMode = 'zh';     // 测验模式：'zh' | 'ro'
let qList = [];
let qIdx = 0;
let qRight = 0;       // 本次会话累计答对（不重置）
let qTotal = 0;       // 本次会话累计答题（不重置）
let qRoundRight = 0;  // 本轮答对（用于显示结算）
let qRoundTotal = 0;  // 本轮答题

let editingWordId = null;
let editingReportId = null;

// 错题本状态
let wbList = [];      // 错题列表
let wbIdx = 0;
let wbFlipped = false;
let wbStreaks = {};   // word_ro -> 当前连续答对次数（错题本专用）
let wbGraduated = 0; // 本次会话毕业词数
const WB_GRADUATE = 3; // 连续答对几次移出错题本

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
  showAppScreen(nickname, userRole === 'admin');

  await Promise.all([loadWords(), loadProgress()]);
  if (userRole === 'admin') refreshAdminBadge();
}

// ── 词库加载 ──────────────────────────────────────────────

async function loadWords() {
  document.getElementById('flash-loading').style.display = 'flex';
  document.getElementById('flash-content').style.display = 'none';

  W = await apiLoadWords();
  filtered = [...W];

  document.getElementById('s-total').textContent = W.length;
  document.getElementById('topbar-badge').textContent = W.length + '词 · A1-A2';

  buildCats();
  renderCard();
  renderList();
  upStats();

  document.getElementById('flash-loading').style.display = 'none';
  document.getElementById('flash-content').style.display = 'block';
}

async function loadProgress() {
  progressMap = await apiLoadProgress(currentUser.id);
  upStats();
}

// ── 统计 ─────────────────────────────────────────────────

function upStats() {
  const k = Object.values(progressMap).filter(p => p.known).length;
  document.getElementById('s-known').textContent = k;
  const wbCount = getWrongWords().length;
  document.getElementById('s-wrong').textContent = wbCount;
  const masteryPct = W.length > 0 ? Math.round(k / W.length * 100) : 0;
  document.getElementById('s-pct').textContent = masteryPct + '%';
  const badge = document.getElementById('wb-tab-badge');
  if (badge) {
    badge.textContent = wbCount;
    badge.style.display = wbCount > 0 ? 'inline' : 'none';
  }
}

// ── 进度同步 ──────────────────────────────────────────────

function setSyncBadge(txt, cls) {
  const el = document.getElementById('sync-badge');
  el.textContent = txt;
  el.className = 'sync-badge ' + (cls || '');
}

async function syncProgress(wordRo, known, qr, qt) {
  setSyncBadge('同步中...', '');
  progressMap[wordRo] = { known, qr, qt };
  try {
    await apiSaveProgress(currentUser.id, wordRo, known, qr, qt);
    setSyncBadge('已保存', 'saved');
  } catch {
    setSyncBadge('同步失败', '');
  }
  setTimeout(() => setSyncBadge('', ''), 2000);
}

// ── 导航 ─────────────────────────────────────────────────

function switchPage(p) {
  ['flash', 'wrongbook', 'quiz', 'guide', 'list', 'admin'].forEach((s, i) => {
    document.querySelectorAll('.nav-tab')[i].classList.toggle('active', s === p);
    document.getElementById('page-' + s).classList.toggle('active', s === p);
  });
  if (p === 'quiz') showQuizSetup();
  if (p === 'list') renderList();
  if (p === 'wrongbook') initWrongbook();
  if (p === 'admin') { loadAdminReports(); loadAdminUsers(); }
}

// ── 卡片记忆 ──────────────────────────────────────────────

function buildCats() {
  const cats = ['全部', ...new Set(W.map(w => w.cat).filter(Boolean))]
    .sort((a, b) => a === '全部' ? -1 : b === '全部' ? 1 : a.localeCompare(b, 'zh'));
  document.getElementById('cat-bar').innerHTML = cats.map(c =>
    `<button class="cat-chip${c === curCat ? ' active' : ''}" onclick="setCat('${c.replace(/'/g, "\\'")}')">${c}</button>`
  ).join('');
}

function setCat(c) {
  curCat = c;
  filtered = c === '全部' ? [...W] : W.filter(w => w.cat === c);
  idx = 0; flipped = false;
  document.getElementById('main-card').classList.remove('flipped');
  buildCats();
  renderCard();
}

function renderCard() {
  if (!filtered.length) return;
  const w = filtered[idx];
  document.getElementById('fc-cat').textContent = w.cat || '';
  document.getElementById('fc-cat2').textContent = w.cat || '';
  document.getElementById('fc-zh').textContent = w.zh;
  document.getElementById('fc-ro').textContent = w.ro;
  document.getElementById('fc-ipa').textContent = w.ipa || w.ro;
  document.getElementById('fc-phint').textContent = w.hint || '';
  document.getElementById('fc-count').textContent = (idx + 1) + ' / ' + filtered.length;
}

function flipCard() {
  flipped = !flipped;
  document.getElementById('main-card').classList.toggle('flipped', flipped);
}

function nextCard() {
  idx = (idx + 1) % filtered.length;
  flipped = false;
  document.getElementById('main-card').classList.remove('flipped');
  renderCard();
}

function prevCard() {
  idx = (idx - 1 + filtered.length) % filtered.length;
  flipped = false;
  document.getElementById('main-card').classList.remove('flipped');
  renderCard();
}

function markCard(yes) {
  const w = filtered[idx];
  const prev = progressMap[w.ro] || { qr: 0, qt: 0 };
  syncProgress(w.ro, yes, prev.qr, prev.qt);
  upStats();
  nextCard();
}

function speak(rate) {
  const w = filtered[idx];
  if (!('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(w.ro);
  u.lang = 'ro-RO'; u.rate = rate;
  const rv = speechSynthesis.getVoices().find(v => v.lang.startsWith('ro'));
  if (rv) u.voice = rv;
  speechSynthesis.speak(u);
}

// ── 错题本 ────────────────────────────────────────────────

/**
 * 判断一个词是否是错题：答错过至少1次，且答错次数 >= 答对次数
 */
function isWrongWord(wordRo) {
  const p = progressMap[wordRo];
  if (!p || !p.qt) return false;
  const wrong = (p.qt || 0) - (p.qr || 0);
  return wrong >= 1 && wrong >= (p.qr || 0);
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
  const p = progressMap[w.ro] || {};
  const wrongCount = (p.qt || 0) - (p.qr || 0);
  const streak = wbStreaks[w.ro] || 0;

  document.getElementById('wb-cat').textContent = w.cat || '';
  document.getElementById('wb-cat2').textContent = w.cat || '';
  document.getElementById('wb-zh').textContent = w.zh;
  document.getElementById('wb-ro').textContent = w.ro;
  document.getElementById('wb-ipa').textContent = w.ipa || w.ro;
  document.getElementById('wb-phint').textContent = w.hint || '';
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
  await syncProgress(w.ro, prev.known, newQr, newQt);

  if (correct) {
    // 连击+1
    wbStreaks[w.ro] = (wbStreaks[w.ro] || 0) + 1;
    if (wbStreaks[w.ro] >= WB_GRADUATE) {
      // 毕业！移出错题本
      wbGraduated++;
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

function setQSize(n) {
  qSize = n;
  document.querySelectorAll('.qsize-btn').forEach(b =>
    b.classList.toggle('active', parseInt(b.dataset.n) === n)
  );
}

function showQuizSetup() {
  document.getElementById('quiz-area').innerHTML = `
    <div style="text-align:center;padding:1.5rem 0">
      <div style="font-size:15px;font-weight:600;margin-bottom:1rem;color:var(--text)">选择本轮题目数</div>
      <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-bottom:1.5rem">
        <button class="qsize-btn${qSize===20?' active':''}" data-n="20" onclick="setQSize(20)">20题</button>
        <button class="qsize-btn${qSize===50?' active':''}" data-n="50" onclick="setQSize(50)">50题</button>
        <button class="qsize-btn${qSize===100?' active':''}" data-n="100" onclick="setQSize(100)">100题</button>
        <button class="qsize-btn${qSize===0?' active':''}" data-n="0" onclick="setQSize(0)">全部(${W.length}题)</button>
      </div>
      <button class="btn-primary" style="max-width:200px" onclick="startQuiz()">开始测验 →</button>
    </div>`;
}

function startQuiz() {
  if (!W.length) return;
  const pool = [...W].sort(() => Math.random() - 0.5);
  qList = qSize > 0 ? pool.slice(0, qSize) : pool;
  qIdx = 0;
  qRoundRight = 0;
  qRoundTotal = 0;
  renderQuiz();
}

function renderQuiz() {
  if (qIdx >= qList.length) { showResult(); return; }
  const w = qList[qIdx];
  const wrongs = W.filter(x => x.ro !== w.ro).sort(() => Math.random() - 0.5).slice(0, 3);
  const opts = [w, ...wrongs].sort(() => Math.random() - 0.5);
  const qText = qMode === 'zh' ? w.zh : w.ro;
  const pct = Math.round(qIdx / qList.length * 100);
  const livePct = qRoundTotal > 0 ? Math.round(qRoundRight / qRoundTotal * 100) : 0;
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
  progressMap[w.ro] = { known: prev.known, qr: newQr, qt: newQt };
  syncProgress(w.ro, prev.known, newQr, newQt);
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

// ── 词汇表 ────────────────────────────────────────────────

function renderList() {
  if (!W.length) return;
  const q = (document.getElementById('search-input') || { value: '' }).value.toLowerCase();
  const f = W.filter(w => !q || w.zh.includes(q) || w.ro.toLowerCase().includes(q) || (w.cat || '').includes(q));
  const editBtn = (w) => userRole === 'admin'
    ? `<button class="admin-btn edit" style="margin-left:6px;padding:3px 8px;font-size:11px" onclick='openEditModal(${JSON.stringify(w)})'>编辑</button>
       <button class="admin-btn revoke" style="margin-left:4px;padding:3px 8px;font-size:11px" onclick='deleteWord(${w.id},"${w.zh.replace(/"/g,'&quot;')}")'>删除</button>`
    : '';
  document.getElementById('word-list').innerHTML = f.slice(0, 200).map(w => {
    const p = progressMap[w.ro];
    return `<div class="word-row">
      <div style="flex:1;min-width:0">
        <div class="word-zh">${w.zh}</div>
        <div class="word-ro">${w.ro}</div>
        <div class="word-ipa">[${w.ipa || w.ro}]${w.hint ? ' · ' + w.hint : ''}</div>
      </div>
      <div style="display:flex;align-items:center;flex-shrink:0">
        <div class="word-cat">${w.cat || ''}</div>
        <div class="word-known${p?.known ? ' yes' : ''}"></div>
        ${editBtn(w)}
      </div>
    </div>`;
  }).join('') + (f.length > 200 ? `<div style="text-align:center;padding:12px;font-size:13px;color:var(--text3)">显示前200条，请搜索缩小范围</div>` : '');
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
  document.getElementById('em-cat').value = word.cat || '';
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
    cat: document.getElementById('em-cat').value.trim(),
  };
  try {
    await apiUpdateWord(editingWordId, updates);
    if (editingReportId) await apiResolveReport(editingReportId);
    // 更新本地缓存
    const wi = W.findIndex(w => w.id === editingWordId);
    if (wi >= 0) W[wi] = { ...W[wi], ...updates };
    filtered = curCat === '全部' ? [...W] : W.filter(w => w.cat === curCat);
    renderCard(); renderList();
    closeEditModal();
    showToast('✅ 修改已保存');
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
  btn.disabled = true; btn.textContent = '保存中...';

  try {
    let words = [];
    if (mode === 'single') {
      const zh = document.getElementById('aw-zh').value.trim();
      const ro = document.getElementById('aw-ro').value.trim();
      if (!zh || !ro) { showToast('中文和罗语是必填项'); btn.disabled = false; btn.textContent = '保存'; return; }
      words = [{ zh, ro, ipa: document.getElementById('aw-ipa').value.trim(), hint: document.getElementById('aw-hint').value.trim(), cat: document.getElementById('aw-cat').value.trim() || '其他' }];
    } else {
      // 批量模式：每行 中文|罗语|音标|提示|分类
      const lines = document.getElementById('aw-bulk-text').value.trim().split('\n').filter(l => l.trim());
      words = lines.map(line => {
        const parts = line.split('|').map(s => s.trim());
        return { zh: parts[0] || '', ro: parts[1] || '', ipa: parts[2] || '', hint: parts[3] || '', cat: parts[4] || '其他' };
      }).filter(w => w.zh && w.ro);
      if (!words.length) { showToast('没有解析到有效词汇，请检查格式'); btn.disabled = false; btn.textContent = '保存'; return; }
    }

    const { inserted, skipped } = await apiInsertWords(words);

    // 刷新本地词库
    W = await apiLoadWords();
    filtered = curCat === '全部' ? [...W] : W.filter(w => w.cat === curCat);
    document.getElementById('s-total').textContent = W.length;
    document.getElementById('topbar-badge').textContent = W.length + '词 · A1-A2';
    buildCats(); renderCard(); renderList();

    const msg = `✅ 成功添加 ${inserted} 个词${skipped > 0 ? `，跳过重复 ${skipped} 个` : ''}`;
    document.getElementById('aw-result').textContent = msg;
    document.getElementById('aw-result').style.color = 'var(--green-text)';
    showToast(msg);

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

// 从词汇表删除词条（管理员）
async function deleteWord(wordId, wordZh) {
  if (!confirm(`确定删除「${wordZh}」吗？此操作不可撤销。`)) return;
  try {
    await apiDeleteWord(wordId);
    W = W.filter(w => w.id !== wordId);
    filtered = curCat === '全部' ? [...W] : W.filter(w => w.cat === curCat);
    document.getElementById('s-total').textContent = W.length;
    document.getElementById('topbar-badge').textContent = W.length + '词 · A1-A2';
    buildCats(); renderCard(); renderList();
    showToast(`✅ 已删除「${wordZh}」`);
  } catch (e) {
    showToast('删除失败：' + e.message);
  }
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
