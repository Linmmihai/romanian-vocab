(function (root) {
  const ACTION_UNKNOWN = 'unknown';
  const ACTION_FUZZY = 'fuzzy';
  const ACTION_KNOWN = 'known';
  const CARD_STATES = ['new', 'learning', 'review', 'reinforcing', 'mastered'];
  const CARD_STATE_MATURITY = Object.freeze({
    new: 0,
    learning: 1,
    relearning: 1,
    reinforcing: 2,
    review: 3,
    mastered: 4
  });
  const STABLE_INTERVAL_DAYS = [1, 3, 7, 15, 30, 60];
  const RECENT_RESULT_LIMIT = 5;
  const TEN_MINUTES_MS = 10 * 60 * 1000;
  const DAY_MS = 24 * 60 * 60 * 1000;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, Number(value) || 0));
  }

  function validIso(value) {
    if (!value) return null;
    const time = new Date(value).getTime();
    return Number.isFinite(time) ? new Date(time).toISOString() : null;
  }

  function addDaysIso(now, days) {
    const base = new Date(now || Date.now()).getTime();
    return new Date(base + Number(days || 0) * DAY_MS).toISOString();
  }

  function addMinutesIso(now, minutes) {
    const base = new Date(now || Date.now()).getTime();
    return new Date(base + Number(minutes || 0) * 60 * 1000).toISOString();
  }

  function normalizeRecentResults(value) {
    if (Array.isArray(value)) return value.map(String).filter(Boolean).slice(-RECENT_RESULT_LIMIT);
    if (typeof value === 'string' && value.trim()) {
      try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) return normalizeRecentResults(parsed);
      } catch {}
    }
    return [];
  }

  function getReviewStage(progress = {}) {
    return Number(
      progress.reviewStage ??
      progress.reviewCount ??
      progress.review_stage ??
      progress.review_count ??
      0
    ) || 0;
  }

  function cardStateMaturity(state) {
    return CARD_STATE_MATURITY[state] ?? 0;
  }

  function isProgressDowngrade(existingScheduler = {}, incomingScheduler = {}, existingProgress = {}, incomingProgress = {}) {
    const existingReps = Number(existingScheduler.reps || existingProgress.qt || 0);
    const incomingReps = Number(incomingScheduler.reps || incomingProgress.qt || 0);
    const existingReviewStage = getReviewStage(existingProgress);
    const incomingReviewStage = getReviewStage(incomingProgress);
    const existingInterval = Number(existingScheduler.intervalDays || 0);
    const incomingInterval = Number(incomingScheduler.intervalDays || 0);
    const existingRank = cardStateMaturity(existingScheduler.cardState);
    const incomingRank = cardStateMaturity(incomingScheduler.cardState);
    return (
      incomingReps < existingReps ||
      incomingReviewStage < existingReviewStage ||
      incomingRank < existingRank ||
      (incomingInterval < existingInterval && incomingReps <= existingReps)
    );
  }

  function legacyIntervalDays(progress = {}) {
    const direct = Number(progress.intervalDays ?? progress.interval_days ?? 0) || 0;
    if (direct > 0) return direct;
    const stage = getReviewStage(progress);
    if (stage <= 0) return 0;
    return STABLE_INTERVAL_DAYS[Math.min(stage - 1, STABLE_INTERVAL_DAYS.length - 1)] || 1;
  }

  function legacyDueAt(progress = {}) {
    return validIso(
      progress.dueAt ||
      progress.due_at ||
      progress.nextReviewAt ||
      progress.next_review_at ||
      progress.nextReview ||
      progress.next_review
    );
  }

  function inferCardState(progress = {}, now = new Date()) {
    const raw = progress.cardState || progress.card_state;
    if (CARD_STATES.includes(raw)) return raw;
    const qt = Number(progress.qt ?? progress.quiz_total ?? 0) || 0;
    const qr = Number(progress.qr ?? progress.quiz_right ?? 0) || 0;
    const level = progress.level || 'unknown';
    const reviewStage = getReviewStage(progress);
    const dueAt = legacyDueAt(progress);
    const memoryStrength = Number(progress.memoryStrength ?? progress.memory_strength ?? 0) || 0;
    const intervalDays = legacyIntervalDays(progress);
    const hasProgress = !!(progress.seen || progress.known || qt || qr || reviewStage || level !== 'unknown' || dueAt);
    if (!hasProgress) return 'new';
    if (level === 'mastered' || (intervalDays >= 15 && memoryStrength >= 75)) return 'review';
    if (Number(progress.needsReinforcement ?? progress.needs_reinforcement ?? 0)) return 'reinforcing';
    if (dueAt && new Date(dueAt).getTime() <= new Date(now).getTime() && reviewStage > 0) return 'review';
    return reviewStage > 0 ? 'review' : 'learning';
  }

  function recentAccuracy(results = []) {
    if (!results.length) return 1;
    const score = results.reduce((sum, result) => {
      if (result === ACTION_KNOWN) return sum + 1;
      if (result === ACTION_FUZZY) return sum + 0.5;
      return sum;
    }, 0);
    return score / results.length;
  }

  function hasRecentUnknown(results = []) {
    return results.includes(ACTION_UNKNOWN);
  }

  function consecutiveKnown(results = []) {
    let count = 0;
    for (let i = results.length - 1; i >= 0; i--) {
      if (results[i] !== ACTION_KNOWN) break;
      count++;
    }
    return count;
  }

  function repeatedWeakResults(results = []) {
    const failures = results.filter(result => result === ACTION_UNKNOWN).length;
    const fuzzy = results.filter(result => result === ACTION_FUZZY).length;
    return failures >= 2 || fuzzy >= 3 || recentAccuracy(results) < 0.6;
  }

  function wasReinforcementCleared(progress = {}) {
    const clearedAt = validIso(progress.weakClearedAt || progress.weak_cleared_at);
    if (!clearedAt) return false;
    const lastWrongAt = validIso(progress.lastWrongAt || progress.last_wrong_at);
    return !lastWrongAt || new Date(clearedAt).getTime() >= new Date(lastWrongAt).getTime();
  }

  function normalizeSchedulerProgress(progress = {}, now = new Date()) {
    const recentResults = normalizeRecentResults(progress.recentResults ?? progress.recent_results);
    const intervalDays = legacyIntervalDays(progress);
    const qt = Number(progress.qt ?? progress.quiz_total ?? 0) || 0;
    const qr = Number(progress.qr ?? progress.quiz_right ?? 0) || 0;
    const correctCount = Number(progress.correctCount ?? progress.correct_count ?? qr ?? 0) || 0;
    const fuzzyCount = Number(progress.fuzzyCount ?? progress.fuzzy_count ?? 0) || 0;
    const forgetCount = Number(progress.forgetCount ?? progress.forget_count ?? Math.max(0, qt - qr) ?? 0) || 0;
    const lapses = Number(progress.lapses ?? 0) || 0;
    const memoryStrength = clamp(
      progress.memoryStrength ?? progress.memory_strength ?? (qt ? Math.round((qr / Math.max(qt, 1)) * 60 + Math.min(intervalDays, 30)) : 0),
      0,
      100
    );
    const normalized = {
      cardState: inferCardState(progress, now),
      dueAt: legacyDueAt(progress),
      intervalDays,
      memoryStrength,
      reps: Number(progress.reps ?? qt ?? 0) || 0,
      correctCount,
      fuzzyCount,
      forgetCount,
      lapses,
      recentResults,
      needsReinforcement: !!(progress.needsReinforcement ?? progress.needs_reinforcement ?? false),
      lastReviewedAt: validIso(progress.lastReviewedAt || progress.last_reviewed_at)
    };
    const reinforcementCleared = wasReinforcementCleared(progress);
    normalized.needsReinforcement = !reinforcementCleared && (
      normalized.needsReinforcement ||
      normalized.forgetCount >= 2 ||
      normalized.lapses >= 2 ||
      repeatedWeakResults(normalized.recentResults)
    );
    if (reinforcementCleared && normalized.cardState === 'reinforcing') {
      normalized.cardState = normalized.reps || normalized.intervalDays ? 'review' : 'learning';
    }
    return normalized;
  }

  function nextStableInterval(currentDays) {
    const current = Number(currentDays || 0);
    return STABLE_INTERVAL_DAYS.find(days => days > current) || STABLE_INTERVAL_DAYS[STABLE_INTERVAL_DAYS.length - 1];
  }

  function fuzzyInterval(currentDays) {
    if (!currentDays) return 1;
    const next = nextStableInterval(currentDays);
    return Math.max(1, Math.min(currentDays, Math.floor(next / 2)));
  }

  function shouldMaster(progress) {
    return progress.cardState === 'review' &&
      progress.intervalDays >= 15 &&
      progress.memoryStrength >= 75 &&
      !progress.needsReinforcement &&
      recentAccuracy(progress.recentResults) >= 0.8 &&
      !hasRecentUnknown(progress.recentResults);
  }

  function scheduleCardReview(progress = {}, action, options = {}) {
    const now = options.now ? new Date(options.now) : new Date();
    const nowIso = now.toISOString();
    const prev = normalizeSchedulerProgress(progress, now);
    const result = {
      ...prev,
      reps: prev.reps + 1,
      recentResults: [...prev.recentResults, action].slice(-RECENT_RESULT_LIMIT),
      lastReviewedAt: nowIso
    };
    const wasReviewLike = ['review', 'reinforcing', 'mastered'].includes(prev.cardState);

    if (action === ACTION_UNKNOWN) {
      result.forgetCount += 1;
      result.lapses += wasReviewLike || prev.reps > 0 ? 1 : 0;
      result.memoryStrength = clamp(prev.memoryStrength - 25, 0, 100);
      result.intervalDays = 0;
      result.dueAt = addMinutesIso(now, 10);
      result.cardState = wasReviewLike ? 'reinforcing' : 'learning';
      result.needsReinforcement = wasReviewLike || result.forgetCount >= 2 || repeatedWeakResults(result.recentResults);
    } else if (action === ACTION_FUZZY) {
      result.fuzzyCount += 1;
      result.memoryStrength = clamp(prev.memoryStrength + (wasReviewLike ? -3 : 8), 0, 100);
      result.intervalDays = wasReviewLike ? fuzzyInterval(prev.intervalDays) : 1;
      result.dueAt = addDaysIso(now, result.intervalDays || 1);
      result.cardState = wasReviewLike && result.needsReinforcement ? 'reinforcing' : 'learning';
      if (wasReviewLike && !result.needsReinforcement) result.cardState = 'review';
      result.needsReinforcement = result.needsReinforcement || repeatedWeakResults(result.recentResults);
      if (result.needsReinforcement && wasReviewLike) result.cardState = 'reinforcing';
    } else if (action === ACTION_KNOWN) {
      result.correctCount += 1;
      result.memoryStrength = clamp(prev.memoryStrength + (wasReviewLike ? 12 : 25), 0, 100);
      const stableRecognition = consecutiveKnown(result.recentResults) >= 2 || result.memoryStrength >= 60 || wasReviewLike;
      result.cardState = stableRecognition ? 'review' : 'learning';
      result.intervalDays = stableRecognition ? nextStableInterval(prev.intervalDays) : 1;
      result.dueAt = addDaysIso(now, result.intervalDays || 1);
      const canClearReinforcement = consecutiveKnown(result.recentResults) >= 2 &&
        result.memoryStrength >= 60 &&
        !hasRecentUnknown(result.recentResults);
      result.needsReinforcement = prev.needsReinforcement && !canClearReinforcement;
      if (result.needsReinforcement) result.cardState = 'reinforcing';
      if (shouldMaster(result)) result.cardState = 'mastered';
    } else {
      throw new Error(`Unknown scheduler action: ${action}`);
    }

    if (result.cardState === 'mastered') result.needsReinforcement = false;
    return result;
  }

  function isSchedulerDue(progress = {}, now = new Date()) {
    const normalized = normalizeSchedulerProgress(progress, now);
    if (!normalized.dueAt) return false;
    return new Date(normalized.dueAt).getTime() <= new Date(now).getTime();
  }

  const api = {
    ACTION_UNKNOWN,
    ACTION_FUZZY,
    ACTION_KNOWN,
    STABLE_INTERVAL_DAYS,
    normalizeSchedulerProgress,
    scheduleCardReview,
    isSchedulerDue,
    getReviewStage,
    cardStateMaturity,
    isProgressDowngrade,
    recentAccuracy,
    consecutiveKnown
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.RomanianVocabScheduler = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
