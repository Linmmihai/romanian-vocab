(function (root) {
  function getScheduler() {
    if (root.RomanianVocabScheduler) return root.RomanianVocabScheduler;
    if (typeof module !== 'undefined' && module.exports) return require('./scheduler.js');
    throw new Error('RomanianVocabScheduler must load before RomanianVocabProgressModel');
  }

  function newerIso(a, b) {
    if (!a) return b || null;
    if (!b) return a || null;
    const aTime = new Date(a).getTime();
    const bTime = new Date(b).getTime();
    if (!Number.isFinite(aTime)) return Number.isFinite(bTime) ? b : null;
    if (!Number.isFinite(bTime)) return a;
    return aTime >= bTime ? a : b;
  }

  function mergeRecentResults(existing = [], incoming = []) {
    return [...(Array.isArray(existing) ? existing : []), ...(Array.isArray(incoming) ? incoming : [])]
      .map(String)
      .filter(Boolean)
      .slice(-5);
  }

  function grammarRight(progress = {}) {
    return Number(progress.grammarQr || progress.grammar_qr || 0) || 0;
  }

  function grammarTotal(progress = {}) {
    return Number(progress.grammarQt || progress.grammar_qt || 0) || 0;
  }

  function selectSchedulerBase(existingProgress = {}, incomingProgress = {}, now = new Date()) {
    const scheduler = getScheduler();
    const existingScheduler = scheduler.normalizeSchedulerProgress(existingProgress, now);
    const incomingScheduler = scheduler.normalizeSchedulerProgress(incomingProgress, now);
    const incomingWouldDowngrade = scheduler.isProgressDowngrade(
      existingScheduler,
      incomingScheduler,
      existingProgress,
      incomingProgress
    );
    const existingTime = new Date(existingScheduler.lastReviewedAt || existingScheduler.dueAt || 0).getTime();
    const incomingTime = new Date(incomingScheduler.lastReviewedAt || incomingScheduler.dueAt || 0).getTime();
    return {
      existingScheduler,
      incomingScheduler,
      incomingWouldDowngrade,
      schedulerBase: incomingWouldDowngrade || incomingTime < existingTime
        ? existingScheduler
        : incomingScheduler
    };
  }

  function mergeEntries(existing = null, incoming = {}) {
    if (!existing) return incoming;
    const scheduler = getScheduler();
    const existingQt = Number(existing.qt || 0);
    const incomingQt = Number(incoming.qt || 0);
    const base = incomingQt >= existingQt ? incoming : existing;
    const other = base === incoming ? existing : incoming;
    const reviewStage = Math.max(scheduler.getReviewStage(existing), scheduler.getReviewStage(incoming));
    const nextReviewAt = newerIso(
      existing.nextReviewAt || existing.nextReview,
      incoming.nextReviewAt || incoming.nextReview
    );
    const lastReviewedAt = newerIso(existing.lastReviewedAt, incoming.lastReviewedAt);
    const wasMasteredAt = newerIso(existing.wasMasteredAt, incoming.wasMasteredAt);
    const { existingScheduler, incomingScheduler, schedulerBase } = selectSchedulerBase(existing, incoming);
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
      recentResults: Array.isArray(schedulerBase.recentResults)
        ? schedulerBase.recentResults
        : mergeRecentResults(existingScheduler.recentResults, incomingScheduler.recentResults),
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
      grammarQr: Math.max(grammarRight(existing), grammarRight(incoming)),
      grammarQt: Math.max(grammarTotal(existing), grammarTotal(incoming)),
      wasMasteredAt: wasMasteredAt || null,
      wrongCount: Math.max(Number(existing.wrongCount || 0), Number(incoming.wrongCount || 0)),
      errorStreak: Math.max(Number(existing.errorStreak || 0), Number(incoming.errorStreak || 0)),
      correctStreakSinceWrong: Math.max(
        Number(existing.correctStreakSinceWrong || 0),
        Number(incoming.correctStreakSinceWrong || 0)
      ),
      lastWrongAt: newerIso(existing.lastWrongAt, incoming.lastWrongAt) || null,
      weakClearedAt: newerIso(existing.weakClearedAt, incoming.weakClearedAt) || null
    };
  }

  function normalizeLevel(progress = {}) {
    const scheduler = getScheduler();
    const qt = Number(progress.qt || 0);
    const qr = Number(progress.qr || 0);
    const reviewStage = scheduler.getReviewStage(progress);
    if (qt >= 3 && qr / qt >= 0.8 && reviewStage >= 2) return 'mastered';
    if (progress.seen || progress.known || qt || qr || reviewStage || progress.lastReviewedAt) return 'learning';
    return 'unknown';
  }

  const api = {
    getGrammarRight: grammarRight,
    getGrammarTotal: grammarTotal,
    newerIso,
    mergeEntries,
    normalizeLevel,
    selectSchedulerBase
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.RomanianVocabProgressModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
