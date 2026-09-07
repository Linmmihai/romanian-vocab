(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.RomanianVocabStudySession = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const VERSION = 1;
  const MODES = Object.freeze({ COUNT: 'count', TIME: 'time' });
  const STATUSES = Object.freeze({ IDLE: 'idle', ACTIVE: 'active', PAUSED: 'paused', ENDED: 'ended' });
  const ALLOWED_MINUTES = Object.freeze([5, 10, 15, 20, 30]);
  const DEFAULT_MINUTES = 15;
  const INITIAL_MS_PER_ANSWER = 30 * 1000;
  const MIN_PERSONAL_SAMPLES = 5;
  const MAX_RECENT_SAMPLES = 40;
  const MIN_VALID_ANSWER_MS = 1000;
  const MAX_VALID_ANSWER_MS = 2 * 60 * 1000;
  const IDLE_AFTER_MS = 60 * 1000;

  function finiteNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function nonNegative(value) {
    return Math.max(0, finiteNumber(value, 0));
  }

  function validMinutes(value) {
    const number = Math.round(finiteNumber(value, DEFAULT_MINUTES));
    return ALLOWED_MINUTES.includes(number) ? number : DEFAULT_MINUTES;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function wordKey(word) {
    if (word === null || word === undefined) return '';
    if (typeof word === 'string' || typeof word === 'number') return String(word);
    return String(word.id ?? word.word_id ?? word.ro ?? word.wordRo ?? '');
  }

  function createState(options) {
    const opts = options || {};
    const now = finiteNumber(opts.now, Date.now());
    return {
      version: VERSION,
      userId: String(opts.userId || 'local'),
      dateKey: String(opts.dateKey || ''),
      mode: opts.mode === MODES.TIME ? MODES.TIME : MODES.COUNT,
      selectedMinutes: validMinutes(opts.selectedMinutes),
      status: STATUSES.IDLE,
      budgetMs: 0,
      plannedCount: 0,
      completedCount: 0,
      activeElapsedMs: 0,
      activeStartedAt: null,
      attempt: null,
      idlePaused: false,
      cardPaused: false,
      answers: [],
      startedAt: null,
      endedAt: null,
      updatedAt: now
    };
  }

  function normalizeState(value, options) {
    const opts = options || {};
    const base = createState({
      userId: opts.userId ?? value?.userId,
      dateKey: opts.dateKey ?? value?.dateKey,
      selectedMinutes: value?.selectedMinutes,
      mode: value?.mode,
      now: opts.now
    });
    if (!value || typeof value !== 'object') return base;
    const state = {
      ...base,
      ...clone(value),
      version: VERSION,
      userId: String(opts.userId ?? value.userId ?? base.userId),
      dateKey: String(opts.dateKey ?? value.dateKey ?? base.dateKey),
      mode: value.mode === MODES.TIME ? MODES.TIME : MODES.COUNT,
      selectedMinutes: validMinutes(value.selectedMinutes),
      status: Object.values(STATUSES).includes(value.status) ? value.status : STATUSES.IDLE,
      budgetMs: nonNegative(value.budgetMs),
      plannedCount: Math.max(0, Math.round(nonNegative(value.plannedCount))),
      completedCount: Math.max(0, Math.round(nonNegative(value.completedCount))),
      activeElapsedMs: nonNegative(value.activeElapsedMs),
      activeStartedAt: value.activeStartedAt !== null && value.activeStartedAt !== undefined && Number.isFinite(Number(value.activeStartedAt))
        ? Number(value.activeStartedAt)
        : null,
      attempt: value.attempt && wordKey(value.attempt.wordKey) ? {
        wordKey: wordKey(value.attempt.wordKey),
        activeElapsedAtStart: nonNegative(value.attempt.activeElapsedAtStart),
        renderedAt: finiteNumber(value.attempt.renderedAt, base.updatedAt)
      } : null,
      idlePaused: !!value.idlePaused,
      cardPaused: !!value.cardPaused,
      answers: Array.isArray(value.answers) ? value.answers.slice(-2000) : [],
      updatedAt: finiteNumber(opts.now, finiteNumber(value.updatedAt, Date.now()))
    };
    if (opts.resumeFromStorage) {
      // Never charge time spent while the tab was closed or reloading.
      state.activeStartedAt = null;
      state.idlePaused = false;
    }
    if (state.mode === MODES.COUNT) state.status = STATUSES.IDLE;
    return state;
  }

  function shouldTrack(state) {
    return state.mode === MODES.COUNT || (state.mode === MODES.TIME && state.status === STATUSES.ACTIVE);
  }

  function stopClockMutable(state, now) {
    if (state.activeStartedAt !== null) {
      state.activeElapsedMs += Math.max(0, finiteNumber(now, state.activeStartedAt) - state.activeStartedAt);
      state.activeStartedAt = null;
    }
  }

  function startClockMutable(state, now, visible) {
    if (visible !== false && shouldTrack(state) && state.attempt && state.activeStartedAt === null && !state.idlePaused && !state.cardPaused) {
      state.activeStartedAt = finiteNumber(now, Date.now());
    }
  }

  function elapsedAt(state, now, visible) {
    const running = visible !== false && state.activeStartedAt !== null
      ? Math.max(0, finiteNumber(now, state.activeStartedAt) - state.activeStartedAt)
      : 0;
    return state.activeElapsedMs + running;
  }

  function setMode(input, mode, options) {
    const opts = options || {};
    const now = finiteNumber(opts.now, Date.now());
    const state = normalizeState(input, { now });
    stopClockMutable(state, now);
    state.mode = mode === MODES.TIME ? MODES.TIME : MODES.COUNT;
    state.status = STATUSES.IDLE;
    state.attempt = null;
    state.idlePaused = false;
    state.cardPaused = false;
    state.selectedMinutes = validMinutes(opts.minutes ?? state.selectedMinutes);
    state.updatedAt = now;
    return state;
  }

  function validSampleDurations(samples) {
    return (Array.isArray(samples) ? samples : [])
      .map(sample => typeof sample === 'number' ? sample : sample?.durationMs)
      .map(Number)
      .filter(duration => Number.isFinite(duration) && duration >= MIN_VALID_ANSWER_MS && duration <= MAX_VALID_ANSWER_MS)
      .slice(-MAX_RECENT_SAMPLES);
  }

  function estimatePace(samples) {
    const durations = validSampleDurations(samples).sort((a, b) => a - b);
    if (durations.length < MIN_PERSONAL_SAMPLES) {
      return {
        msPerAnswer: INITIAL_MS_PER_ANSWER,
        source: 'initial',
        sampleCount: durations.length,
        minimumSamples: MIN_PERSONAL_SAMPLES
      };
    }
    // A median keeps a single interruption or unusually quick click from distorting the budget.
    const middle = Math.floor(durations.length / 2);
    const median = durations.length % 2
      ? durations[middle]
      : (durations[middle - 1] + durations[middle]) / 2;
    return {
      msPerAnswer: Math.round(median),
      source: 'personal',
      sampleCount: durations.length,
      minimumSamples: MIN_PERSONAL_SAMPLES
    };
  }

  function estimatePlan(minutes, samples) {
    const pace = estimatePace(samples);
    return {
      ...pace,
      minutes: validMinutes(minutes),
      count: Math.max(1, Math.floor((validMinutes(minutes) * 60 * 1000) / pace.msPerAnswer))
    };
  }

  function start(input, options) {
    const opts = options || {};
    const now = finiteNumber(opts.now, Date.now());
    const minutes = validMinutes(opts.minutes);
    const plan = estimatePlan(minutes, opts.samples);
    const state = normalizeState(input, { now });
    stopClockMutable(state, now);
    state.mode = MODES.TIME;
    state.selectedMinutes = minutes;
    state.status = STATUSES.ACTIVE;
    state.budgetMs = minutes * 60 * 1000;
    state.plannedCount = plan.count;
    state.completedCount = 0;
    state.activeElapsedMs = 0;
    state.activeStartedAt = null;
    state.attempt = null;
    state.idlePaused = false;
    state.cardPaused = false;
    state.answers = state.answers.filter(answer => !answer.sessionCounted);
    state.startedAt = now;
    state.endedAt = null;
    state.updatedAt = now;
    return { state, plan };
  }

  function extend(input, options) {
    const opts = options || {};
    const now = finiteNumber(opts.now, Date.now());
    const minutes = validMinutes(opts.minutes);
    const plan = estimatePlan(minutes, opts.samples);
    const state = normalizeState(input, { now });
    stopClockMutable(state, now);
    state.mode = MODES.TIME;
    state.selectedMinutes = minutes;
    state.status = STATUSES.ACTIVE;
    // Continuing starts a fresh budget from the current consumed time; unused
    // time from a manually ended run is not silently carried forward.
    state.budgetMs = state.activeElapsedMs + minutes * 60 * 1000;
    state.plannedCount += plan.count;
    state.activeStartedAt = null;
    state.attempt = null;
    state.idlePaused = false;
    state.cardPaused = false;
    state.endedAt = null;
    state.updatedAt = now;
    return { state, plan };
  }

  function end(input, options) {
    const opts = options || {};
    const now = finiteNumber(opts.now, Date.now());
    const state = normalizeState(input, { now });
    stopClockMutable(state, now);
    state.status = STATUSES.ENDED;
    state.activeStartedAt = null;
    state.attempt = null;
    state.idlePaused = false;
    state.cardPaused = false;
    state.endedAt = now;
    state.updatedAt = now;
    return state;
  }

  function cardRendered(input, word, options) {
    const opts = options || {};
    const now = finiteNumber(opts.now, Date.now());
    const state = normalizeState(input, { now });
    const key = wordKey(word);
    if (!key) {
      stopClockMutable(state, now);
      state.cardPaused = true;
      state.updatedAt = now;
      return state;
    }
    if (!shouldTrack(state)) return state;
    if (!state.attempt || state.attempt.wordKey !== key) {
      stopClockMutable(state, now);
      state.attempt = { wordKey: key, activeElapsedAtStart: state.activeElapsedMs, renderedAt: now };
      state.idlePaused = false;
    }
    state.cardPaused = false;
    startClockMutable(state, now, opts.visible);
    state.updatedAt = now;
    return state;
  }

  function getResponseMs(input, word, options) {
    const opts = options || {};
    const state = normalizeState(input, { now: opts.now });
    const key = wordKey(word) || state.attempt?.wordKey || '';
    if (!state.attempt || !key || state.attempt.wordKey !== key) return null;
    const responseMs = Math.max(0, Math.round(elapsedAt(state, opts.now, opts.visible) - state.attempt.activeElapsedAtStart));
    return responseMs > 0 ? responseMs : null;
  }

  function snapshotForStorage(input, options) {
    const opts = options || {};
    const now = finiteNumber(opts.now, Date.now());
    const state = normalizeState(input, { now });
    stopClockMutable(state, now);
    state.updatedAt = now;
    return state;
  }

  function visibilityChanged(input, visible, options) {
    const opts = options || {};
    const now = finiteNumber(opts.now, Date.now());
    const state = normalizeState(input, { now });
    if (!visible) stopClockMutable(state, now);
    else startClockMutable(state, now, true);
    state.updatedAt = now;
    return state;
  }

  function pauseForIdle(input, options) {
    const opts = options || {};
    const now = finiteNumber(opts.now, Date.now());
    const state = normalizeState(input, { now });
    stopClockMutable(state, now);
    state.idlePaused = true;
    state.updatedAt = now;
    return state;
  }

  function noteActivity(input, options) {
    const opts = options || {};
    const now = finiteNumber(opts.now, Date.now());
    const state = normalizeState(input, { now });
    state.idlePaused = false;
    startClockMutable(state, now, opts.visible);
    state.updatedAt = now;
    return state;
  }

  function beforeAnswer(input, word, options) {
    const opts = options || {};
    const now = finiteNumber(opts.now, Date.now());
    let state = normalizeState(input, { now });
    if (state.mode === MODES.TIME && state.status !== STATUSES.ACTIVE) {
      return {
        state,
        allowed: false,
        reason: state.status === STATUSES.PAUSED ? 'budget-reached' : 'session-not-started'
      };
    }
    state = cardRendered(state, word, { now, visible: opts.visible });
    state = noteActivity(state, { now, visible: opts.visible });
    stopClockMutable(state, now);
    state.updatedAt = now;
    return { state, allowed: true, reason: '' };
  }

  function makeEntryId(state, now, key) {
    return [state.userId, state.dateKey, Math.round(now), state.answers.length, key].join(':');
  }

  function commitAnswer(input, word, action, options) {
    const opts = options || {};
    const now = finiteNumber(opts.now, Date.now());
    const state = normalizeState(input, { now });
    stopClockMutable(state, now);
    const key = wordKey(word);
    const attemptMatches = !!state.attempt && state.attempt.wordKey === key;
    const durationMs = attemptMatches
      ? Math.max(0, state.activeElapsedMs - state.attempt.activeElapsedAtStart)
      : 0;
    const sessionCounted = state.mode === MODES.TIME && state.status === STATUSES.ACTIVE;
    const entry = {
      id: String(opts.entryId || makeEntryId(state, now, key)),
      wordKey: key,
      action: String(action || ''),
      durationMs: Math.round(durationMs),
      validSample: durationMs >= MIN_VALID_ANSWER_MS && durationMs <= MAX_VALID_ANSWER_MS,
      sessionCounted,
      committedAt: now
    };
    state.answers.push(entry);
    state.answers = state.answers.slice(-2000);
    if (sessionCounted) state.completedCount += 1;
    state.attempt = null;
    state.activeStartedAt = null;
    state.idlePaused = false;
    state.cardPaused = false;
    if (sessionCounted && state.activeElapsedMs >= state.budgetMs) state.status = STATUSES.PAUSED;
    state.updatedAt = now;
    return { state, entry };
  }

  function undoLastAnswer(input, options) {
    const opts = options || {};
    const now = finiteNumber(opts.now, Date.now());
    const state = normalizeState(input, { now });
    const requestedId = opts.entryId ? String(opts.entryId) : '';
    let index = -1;
    if (requestedId) {
      for (let i = state.answers.length - 1; i >= 0; i--) {
        if (state.answers[i]?.id === requestedId) { index = i; break; }
      }
    } else if (state.answers.length) {
      index = state.answers.length - 1;
    }
    if (index < 0) return { state, removed: null };
    const removed = state.answers.splice(index, 1)[0];
    if (removed?.sessionCounted) state.completedCount = Math.max(0, state.completedCount - 1);
    state.updatedAt = now;
    return { state, removed };
  }

  function getView(input, options) {
    const opts = options || {};
    const now = finiteNumber(opts.now, Date.now());
    const state = normalizeState(input, { now });
    const activeElapsedMs = elapsedAt(state, now, opts.visible);
    const remainingMs = Math.max(0, state.budgetMs - activeElapsedMs);
    return {
      mode: state.mode,
      status: state.status,
      selectedMinutes: state.selectedMinutes,
      budgetMs: state.budgetMs,
      activeElapsedMs,
      remainingMs,
      plannedCount: state.plannedCount,
      completedCount: state.completedCount,
      remainingReviewCount: Math.max(0, Math.round(nonNegative(opts.remainingReviewCount))),
      budgetReached: state.mode === MODES.TIME && state.budgetMs > 0 && activeElapsedMs >= state.budgetMs,
      canAnswer: state.mode === MODES.COUNT || state.status === STATUSES.ACTIVE
    };
  }

  return Object.freeze({
    VERSION,
    MODES,
    STATUSES,
    ALLOWED_MINUTES,
    DEFAULT_MINUTES,
    INITIAL_MS_PER_ANSWER,
    MIN_PERSONAL_SAMPLES,
    MAX_RECENT_SAMPLES,
    MIN_VALID_ANSWER_MS,
    MAX_VALID_ANSWER_MS,
    IDLE_AFTER_MS,
    createState,
    normalizeState,
    validSampleDurations,
    estimatePace,
    estimatePlan,
    setMode,
    start,
    extend,
    end,
    cardRendered,
    getResponseMs,
    snapshotForStorage,
    visibilityChanged,
    pauseForIdle,
    noteActivity,
    beforeAnswer,
    commitAnswer,
    undoLastAnswer,
    getView,
    wordKey
  });
});
