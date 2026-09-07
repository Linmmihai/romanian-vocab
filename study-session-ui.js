(function (root, factory) {
  const api = factory(root, root && root.RomanianVocabStudySession);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.RomanianVocabStudySessionUI = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root, Session) {
  'use strict';

  const STATE_PREFIX = 'rv_study_session:v1:';
  const SAMPLE_PREFIX = 'rv_study_session_samples:v1:';
  const PANEL_ID = 'study-session-panel';
  const STYLE_ID = 'study-session-styles';
  let config = {};
  let state = null;
  let samples = [];
  let context = null;
  let panel = null;
  let idleTimer = null;
  let renderTimer = null;
  let listenersBound = false;

  function now() { return Date.now(); }

  function localDateKey() {
    const date = new Date();
    const pad = value => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function callFirst(names, fallback) {
    for (const name of names) {
      if (typeof config[name] === 'function') {
        try { return config[name](); } catch {}
      }
    }
    return fallback;
  }

  function getContext() {
    return {
      userId: String(callFirst(['getUserId', 'getCurrentUserId'], 'local') || 'local'),
      dateKey: String(callFirst(['getDateKey', 'getTodayKey'], localDateKey()) || localDateKey())
    };
  }

  function storageKey(prefix, parts) {
    return prefix + parts.map(part => encodeURIComponent(String(part))).join(':');
  }

  function stateKey(value) { return storageKey(STATE_PREFIX, [value.userId, value.dateKey]); }
  function sampleKey(value) { return storageKey(SAMPLE_PREFIX, [value.userId]); }

  function readJson(key, fallback) {
    try {
      const parsed = JSON.parse(root.localStorage.getItem(key));
      return parsed === null ? fallback : parsed;
    } catch { return fallback; }
  }

  function writeJson(key, value) {
    try { root.localStorage.setItem(key, JSON.stringify(value)); } catch {}
  }

  function loadContext(next) {
    context = next;
    const stored = readJson(stateKey(next), null);
    state = Session.normalizeState(stored || Session.createState(next), { ...next, now: now(), resumeFromStorage: true });
    const storedSamples = readJson(sampleKey(next), []);
    samples = Array.isArray(storedSamples) ? storedSamples.slice(-Session.MAX_RECENT_SAMPLES) : [];
    save();
  }

  function ensureContext() {
    if (!Session) return false;
    const next = getContext();
    if (!context || context.userId !== next.userId || context.dateKey !== next.dateKey) loadContext(next);
    return true;
  }

  function save() {
    if (!context || !state) return;
    const storedState = Session.snapshotForStorage(state, { now: now() });
    writeJson(stateKey(context), storedState);
    writeJson(sampleKey(context), samples.slice(-Session.MAX_RECENT_SAMPLES));
  }

  function isVisible() { return !root.document || root.document.visibilityState !== 'hidden'; }

  function getRemainingReviews() {
    const value = callFirst(['getRemainingReviewCount', 'getRemainingFormalReviews'], 0);
    return Math.max(0, Number(value) || 0);
  }

  function getCurrentWord() {
    return callFirst(['getCurrentWord', 'getCurrentFlashWord'], null);
  }

  function getQuantityGoals() {
    const goal = Number(callFirst(['getDailyGoal'], root.document?.getElementById('goal-input')?.value || 200)) || 200;
    const cap = Number(callFirst(['getDailyNewLimit'], root.document?.getElementById('new-limit-input')?.value || 30));
    return { goal, cap: Number.isFinite(cap) ? cap : 30 };
  }

  function formatClock(ms) {
    const total = Math.max(0, Math.ceil((Number(ms) || 0) / 1000));
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  }

  function injectStyles() {
    if (!root.document || root.document.getElementById(STYLE_ID)) return;
    const style = root.document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .study-session-panel{background:#fff;border:1px solid var(--border,#e2e0d8);border-radius:var(--radius,10px);padding:12px 14px;margin-bottom:12px;box-shadow:var(--shadow,0 1px 3px rgba(23,32,51,.08))}
      .study-session-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:9px}
      .study-session-title{font-size:14px;font-weight:850;color:var(--text,#172033)}
      .study-session-mode{display:flex;gap:4px;background:var(--bg2,#f4f4f1);padding:3px;border-radius:8px}
      .study-session-mode button{border:0;background:transparent;color:var(--text2,#64748b);padding:5px 9px;border-radius:6px;font-size:12px;cursor:pointer}
      .study-session-mode button.active{background:#fff;color:var(--blue,#2563eb);font-weight:800;box-shadow:0 1px 2px rgba(23,32,51,.1)}
      .study-session-body{font-size:12px;color:var(--text2,#64748b);line-height:1.55}
      .study-session-row{display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-top:8px}
      .study-session-row select{padding:5px 8px;border:1px solid var(--border2,#ccc8bd);border-radius:6px;background:#fff;color:var(--text,#172033)}
      .study-session-row button{padding:6px 10px;border:1px solid var(--border2,#ccc8bd);border-radius:6px;background:#fff;color:var(--text2,#64748b);font-size:12px;font-weight:700;cursor:pointer}
      .study-session-row button.primary{border-color:var(--blue,#2563eb);background:var(--blue,#2563eb);color:#fff}
      .study-session-metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin-top:9px}
      .study-session-metric{background:var(--bg2,#f4f4f1);border-radius:6px;padding:7px;min-width:0}
      .study-session-metric b{display:block;color:var(--text,#172033);font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .study-session-note{margin-top:7px;color:var(--text2,#64748b)}
      .study-session-note.attention{color:var(--yellow-text,#92400e);font-weight:700}
      @media(max-width:480px){.study-session-head{align-items:flex-start;flex-direction:column}.study-session-metrics{grid-template-columns:1fr 1fr}.study-session-metric:last-child{grid-column:1/-1}}
    `;
    root.document.head.appendChild(style);
  }

  function mount() {
    if (!root.document) return null;
    panel = root.document.getElementById(PANEL_ID);
    if (panel) return panel;
    const host = root.document.getElementById('flash-content') || root.document.querySelector('.daily-goal-panel') || root.document.getElementById('page-flash');
    if (!host) return null;
    panel = root.document.createElement('section');
    panel.id = PANEL_ID;
    panel.className = 'study-session-panel';
    panel.setAttribute('aria-label', '本次学习预算');
    if (host.classList?.contains('daily-goal-panel')) host.prepend(panel);
    else host.parentNode.insertBefore(panel, host);
    panel.addEventListener('click', onPanelClick);
    panel.addEventListener('change', onPanelChange);
    return panel;
  }

  function statusText(view) {
    if (view.mode === Session.MODES.COUNT) return '按每日数量目标继续学习';
    if (view.status === Session.STATUSES.ACTIVE && view.budgetReached) return '预算已到；完成当前作答后暂停';
    if (view.status === Session.STATUSES.ACTIVE) return '会话进行中';
    if (view.status === Session.STATUSES.PAUSED) return '本次预算已用完，可结束或增加新预算';
    if (view.status === Session.STATUSES.ENDED) return '本次会话已结束，可用新预算继续';
    return '选择时长后主动开始';
  }

  function render() {
    if (!ensureContext() || !mount()) return;
    const view = Session.getView(state, { now: now(), visible: isVisible(), remainingReviewCount: getRemainingReviews() });
    const pace = Session.estimatePace(samples);
    const quantity = getQuantityGoals();
    const timeOptions = Session.ALLOWED_MINUTES.map(minutes => `<option value="${minutes}"${minutes === state.selectedMinutes ? ' selected' : ''}>${minutes} 分钟</option>`).join('');
    const inTimeMode = view.mode === Session.MODES.TIME;
    const active = view.status === Session.STATUSES.ACTIVE;
    const hasRun = view.budgetMs > 0;
    const planLabel = pace.source === 'personal'
      ? `按本机近期 ${pace.sampleCount} 次有效作答估算`
      : `初始估计（有效样本 ${pace.sampleCount}/${pace.minimumSamples}，尚非个人数据）`;
    panel.innerHTML = `
      <div class="study-session-head">
        <div class="study-session-title">本次学习</div>
        <div class="study-session-mode" role="group" aria-label="学习预算模式">
          <button type="button" data-session-mode="count" class="${!inTimeMode ? 'active' : ''}" aria-pressed="${!inTimeMode}">数量模式</button>
          <button type="button" data-session-mode="time" class="${inTimeMode ? 'active' : ''}" aria-pressed="${inTimeMode}">时间预算</button>
        </div>
      </div>
      <div class="study-session-body">
        ${!inTimeMode ? `
          <div>每日通过目标 ${quantity.goal} 个，新词上限 ${quantity.cap} 个；沿用原有每日计划。</div>
          <div class="study-session-note">时间预算关闭，不限制当前答题。</div>
        ` : `
          <div class="study-session-row">
            <label for="study-session-minutes">本次时长</label>
            <select id="study-session-minutes" aria-label="本次学习时长">${timeOptions}</select>
            ${!active && !hasRun ? '<button type="button" class="primary" data-session-action="start">开始</button>' : ''}
            ${active ? '<button type="button" data-session-action="end">结束本次</button>' : ''}
            ${!active && hasRun ? '<button type="button" class="primary" data-session-action="continue">增加预算并继续</button>' : ''}
          </div>
          <div class="study-session-metrics">
            <div class="study-session-metric"><b>${view.plannedCount || Session.estimatePlan(state.selectedMinutes, samples).count} 题</b><span>本次计划</span></div>
            <div class="study-session-metric"><b>${view.completedCount} 题</b><span>实际完成</span></div>
            <div class="study-session-metric"><b>${view.remainingReviewCount} 题</b><span>剩余正式复习</span></div>
          </div>
          <div class="study-session-note ${view.status === Session.STATUSES.PAUSED ? 'attention' : ''}">${statusText(view)} · ${active ? `剩余 ${formatClock(view.remainingMs)}` : `已计前台作答 ${formatClock(view.activeElapsedMs)}`}</div>
          <div class="study-session-note">${planLabel}。隐藏页面和连续 60 秒无活动后的时间不计入。本次结束不会清空待复习、改变每日目标或自动打卡。</div>
        `}
      </div>`;
  }

  function notify(message) {
    if (typeof config.showToast === 'function') {
      try { config.showToast(message); return; } catch {}
    }
    panel?.setAttribute('data-message', message);
  }

  function syncCurrentCard() {
    const word = getCurrentWord();
    if (word) onCardRendered(word);
  }

  function onPanelClick(event) {
    const mode = event.target?.dataset?.sessionMode;
    const action = event.target?.dataset?.sessionAction;
    if (mode) {
      ensureContext();
      if (mode === state.mode) return;
      state = Session.setMode(state, mode, { now: now(), minutes: state.selectedMinutes });
      save();
      render();
      if (mode === Session.MODES.COUNT) syncCurrentCard();
      return;
    }
    if (!action) return;
    ensureContext();
    if (action === 'start') {
      state = Session.start(state, { now: now(), minutes: state.selectedMinutes, samples }).state;
      notify('本次时间预算已开始');
    } else if (action === 'continue') {
      state = Session.extend(state, { now: now(), minutes: state.selectedMinutes, samples }).state;
      notify(`已增加 ${state.selectedMinutes} 分钟预算`);
    } else if (action === 'end') {
      state = Session.end(state, { now: now() });
      notify('本次会话已结束；今日任务与待复习保持不变');
    }
    save();
    render();
    if (action !== 'end') {
      if (typeof config.onRequestResume === 'function') {
        try { config.onRequestResume(); } catch {}
      }
      syncCurrentCard();
    }
  }

  function onPanelChange(event) {
    if (event.target?.id !== 'study-session-minutes') return;
    ensureContext();
    state.selectedMinutes = Session.ALLOWED_MINUTES.includes(Number(event.target.value)) ? Number(event.target.value) : Session.DEFAULT_MINUTES;
    state.updatedAt = now();
    save();
    render();
  }

  function resetIdleTimer() {
    if (idleTimer) root.clearTimeout(idleTimer);
    if (!state?.attempt) return;
    idleTimer = root.setTimeout(() => {
      if (!ensureContext()) return;
      state = Session.pauseForIdle(state, { now: now() });
      save();
      render();
    }, Session.IDLE_AFTER_MS);
  }

  function onActivity() {
    if (!ensureContext() || !state?.attempt) return;
    state = Session.noteActivity(state, { now: now(), visible: isVisible() });
    resetIdleTimer();
  }

  function bindListeners() {
    if (listenersBound || !root.document) return;
    listenersBound = true;
    root.document.addEventListener('visibilitychange', () => {
      if (!ensureContext()) return;
      state = Session.visibilityChanged(state, isVisible(), { now: now() });
      save();
      render();
      if (isVisible()) resetIdleTimer();
      else if (idleTimer) root.clearTimeout(idleTimer);
    });
    root.document.addEventListener('pointerdown', onActivity, { passive: true, capture: true });
    root.document.addEventListener('keydown', onActivity, { capture: true });
    root.addEventListener?.('pagehide', save);
    renderTimer = root.setInterval(() => {
      if (state?.mode === Session.MODES.TIME && state?.status === Session.STATUSES.ACTIVE) render();
    }, 1000);
  }

  function init(options) {
    config = { ...config, ...(options || {}) };
    if (!Session) return false;
    ensureContext();
    injectStyles();
    mount();
    bindListeners();
    render();
    syncCurrentCard();
    return true;
  }

  function onCardRendered(word) {
    if (!ensureContext()) return;
    state = Session.cardRendered(state, word, { now: now(), visible: isVisible() });
    save();
    if (word) resetIdleTimer();
    else if (idleTimer) root.clearTimeout(idleTimer);
    render();
  }

  function beforeAnswer(word) {
    if (!ensureContext()) return true;
    const result = Session.beforeAnswer(state, word, { now: now(), visible: isVisible() });
    state = result.state;
    save();
    render();
    if (!result.allowed) {
      notify(result.reason === 'budget-reached'
        ? '本次预算已用完，请结束或增加新预算后继续'
        : '请先开始本次时间预算');
      panel?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
    }
    return result.allowed;
  }

  function onAnswerCommitted(word, action, snapshotOrEntry) {
    if (!ensureContext()) return null;
    const result = Session.commitAnswer(state, word, action, { now: now() });
    state = result.state;
    if (result.entry.validSample) {
      samples.push({
        id: result.entry.id,
        durationMs: result.entry.durationMs,
        committedAt: result.entry.committedAt,
        dateKey: context.dateKey
      });
      samples = samples.slice(-Session.MAX_RECENT_SAMPLES);
    }
    if (snapshotOrEntry && typeof snapshotOrEntry === 'object') snapshotOrEntry.studySessionEntryId = result.entry.id;
    save();
    render();
    if (state.status === Session.STATUSES.PAUSED) {
      notify('本次时间预算已用完；当前作答已保存，可结束或增加新预算');
      if (typeof config.onBudgetReached === 'function') {
        try { config.onBudgetReached(Session.getView(state, { now: now(), remainingReviewCount: getRemainingReviews() })); } catch {}
      }
    }
    return result.entry;
  }

  function getResponseMs(word) {
    if (!ensureContext()) return null;
    return Session.getResponseMs(state, word || getCurrentWord(), { now: now(), visible: isVisible() });
  }

  function onUndo(snapshotOrEntry) {
    if (!ensureContext()) return null;
    const entryId = snapshotOrEntry?.studySessionEntryId || snapshotOrEntry?.id || '';
    const result = Session.undoLastAnswer(state, { now: now(), entryId });
    state = result.state;
    if (result.removed) samples = samples.filter(sample => sample.id !== result.removed.id);
    save();
    render();
    syncCurrentCard();
    return result.removed;
  }

  function restoreSnapshot(snapshot) { return onUndo(snapshot); }

  function getState() {
    if (!ensureContext()) return null;
    return JSON.parse(JSON.stringify(state));
  }

  function destroy() {
    if (idleTimer) root.clearTimeout(idleTimer);
    if (renderTimer) root.clearInterval(renderTimer);
    idleTimer = null;
    renderTimer = null;
  }

  return {
    init,
    onCardRendered,
    beforeAnswer,
    getResponseMs,
    onAnswerCommitted,
    onUndo,
    restoreSnapshot,
    getState,
    render,
    destroy
  };
});
