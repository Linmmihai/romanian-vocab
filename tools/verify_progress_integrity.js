const assert = require('assert');
const fs = require('fs');
const path = require('path');

function newerIsoLike(a, b) {
  if (!a) return b || null;
  if (!b) return a || null;
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
}

function getProgressReviewStage(progress = {}) {
  return Number(progress.reviewStage ?? progress.review_stage ?? progress.reviewCount ?? progress.review_count ?? 0) || 0;
}

function normalizeScheduler(progress = {}) {
  return {
    cardState: progress.cardState || progress.card_state || 'new',
    dueAt: progress.dueAt || progress.due_at || progress.nextReviewAt || null,
    intervalDays: Number(progress.intervalDays ?? progress.interval_days ?? 0) || 0,
    memoryStrength: Number(progress.memoryStrength ?? progress.memory_strength ?? 0) || 0,
    reps: Number(progress.reps ?? progress.qt ?? 0) || 0,
    correctCount: Number(progress.correctCount ?? progress.correct_count ?? progress.qr ?? 0) || 0,
    fuzzyCount: Number(progress.fuzzyCount ?? progress.fuzzy_count ?? 0) || 0,
    forgetCount: Number(progress.forgetCount ?? progress.forget_count ?? Math.max(0, (progress.qt || 0) - (progress.qr || 0))) || 0,
    lapses: Number(progress.lapses ?? 0) || 0,
    recentResults: Array.isArray(progress.recentResults) ? progress.recentResults : [],
    needsReinforcement: !!(progress.needsReinforcement || progress.needs_reinforcement),
    lastReviewedAt: progress.lastReviewedAt || progress.last_reviewed_at || null
  };
}

function schedulerMaturityRank(state) {
  const ranks = {
    new: 0,
    learning: 1,
    relearning: 1,
    reinforcing: 2,
    review: 3,
    mastered: 4
  };
  return ranks[state] ?? 0;
}

function isSchedulerProgressDowngrade(existingScheduler = {}, incomingScheduler = {}, existingProgress = {}, incomingProgress = {}) {
  const existingReps = Number(existingScheduler.reps || existingProgress.qt || 0);
  const incomingReps = Number(incomingScheduler.reps || incomingProgress.qt || 0);
  const existingReviewStage = getProgressReviewStage(existingProgress);
  const incomingReviewStage = getProgressReviewStage(incomingProgress);
  const existingInterval = Number(existingScheduler.intervalDays || 0);
  const incomingInterval = Number(incomingScheduler.intervalDays || 0);
  const existingRank = schedulerMaturityRank(existingScheduler.cardState);
  const incomingRank = schedulerMaturityRank(incomingScheduler.cardState);
  return (
    incomingReps < existingReps ||
    incomingReviewStage < existingReviewStage ||
    incomingRank < existingRank ||
    (incomingInterval < existingInterval && incomingReps <= existingReps)
  );
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
  const existingScheduler = normalizeScheduler(existing);
  const incomingScheduler = normalizeScheduler(incoming);
  const incomingWouldDowngrade = isSchedulerProgressDowngrade(existingScheduler, incomingScheduler, existing, incoming);
  const schedulerBase = incomingWouldDowngrade
    ? existingScheduler
    : (new Date(incomingScheduler.lastReviewedAt || incomingScheduler.dueAt || 0).getTime() >=
      new Date(existingScheduler.lastReviewedAt || existingScheduler.dueAt || 0).getTime()
        ? incomingScheduler
        : existingScheduler);
  return {
    ...other,
    ...base,
    known: !!(existing.known || incoming.known),
    seen: !!(existing.seen || incoming.seen || existing.known || incoming.known || existingQt || incomingQt || reviewStage),
    qr: Math.max(Number(existing.qr || 0), Number(incoming.qr || 0)),
    qt: Math.max(existingQt, incomingQt),
    reviewStage,
    reviewCount: reviewStage,
    nextReviewAt: nextReviewAt || base.nextReviewAt || other.nextReviewAt,
    lastReviewedAt: lastReviewedAt || base.lastReviewedAt || other.lastReviewedAt,
    cardState: schedulerBase.cardState,
    dueAt: schedulerBase.dueAt || null,
    intervalDays: Number(schedulerBase.intervalDays || 0),
    memoryStrength: Number(schedulerBase.memoryStrength || 0),
    reps: Math.max(Number(existingScheduler.reps || 0), Number(incomingScheduler.reps || 0)),
    correctCount: Math.max(Number(existingScheduler.correctCount || 0), Number(incomingScheduler.correctCount || 0)),
    fuzzyCount: Math.max(Number(existingScheduler.fuzzyCount || 0), Number(incomingScheduler.fuzzyCount || 0)),
    forgetCount: Math.max(Number(existingScheduler.forgetCount || 0), Number(incomingScheduler.forgetCount || 0)),
    lapses: Math.max(Number(existingScheduler.lapses || 0), Number(incomingScheduler.lapses || 0)),
    recentResults: Array.isArray(schedulerBase.recentResults) ? schedulerBase.recentResults : [],
    needsReinforcement: !!schedulerBase.needsReinforcement
  };
}

function hasWordProgress(progress) {
  if (!progress) return false;
  return !!(
    progress.seen ||
    progress.known ||
    Number(progress.qt || 0) ||
    Number(progress.qr || 0) ||
    getProgressReviewStage(progress) ||
    progress.lastReviewedAt
  );
}

function isUnseenWord(word, progressMap, completed = new Set(), seenToday = new Set()) {
  const progress = progressMap[word.ro] || null;
  return !hasWordProgress(progress) && !completed.has(word.ro) && !seenToday.has(word.ro);
}

function repairTodayQueue({ todayQueue, completed = [], deferred = [], unseen = [], dailyGoal, todayNewWords }) {
  const completedSet = new Set(completed);
  const deferredSet = new Set(deferred);
  const activeOpen = todayQueue.filter((ro) => !completedSet.has(ro) && !deferredSet.has(ro));
  const deferredOpen = todayQueue.filter((ro) => !completedSet.has(ro) && deferredSet.has(ro));
  const queued = new Set(todayQueue);
  const slots = Math.max(0, dailyGoal - todayNewWords - activeOpen.length);
  const injected = unseen.filter((ro) => !queued.has(ro) && !completedSet.has(ro)).slice(0, slots);
  return [...activeOpen, ...injected, ...deferredOpen];
}

const matureProgress = {
  known: true,
  seen: true,
  qr: 18,
  qt: 20,
  reviewStage: 5,
  reviewCount: 5,
  cardState: 'review',
  dueAt: '2026-07-20T00:00:00.000Z',
  nextReviewAt: '2026-07-20T00:00:00.000Z',
  intervalDays: 30,
  easeFactor: 2.55,
  memoryStrength: 88,
  reps: 20,
  lapses: 1,
  lastReviewedAt: '2026-06-20T00:00:00.000Z'
};

{
  const accidentalFreshWrite = {
    known: true,
    seen: true,
    qr: 1,
    qt: 1,
    reviewStage: 1,
    cardState: 'learning',
    dueAt: '2026-06-21T01:00:00.000Z',
    nextReviewAt: '2026-06-21T01:00:00.000Z',
    intervalDays: 0,
    reps: 1,
    lastReviewedAt: '2026-06-21T00:00:00.000Z'
  };
  const merged = mergeProgressEntry(matureProgress, accidentalFreshWrite);
  assert.strictEqual(merged.cardState, 'review', 'mature cardState must not be downgraded');
  assert.strictEqual(merged.dueAt, matureProgress.dueAt, 'mature dueAt must not be replaced by fresh-card dueAt');
  assert.strictEqual(merged.intervalDays, 30, 'mature interval must be preserved');
  assert.strictEqual(merged.reps, 20, 'mature reps must be preserved');
  assert.strictEqual(merged.reviewStage, 5, 'mature reviewStage must be preserved');
  assert.strictEqual(merged.qt, 20, 'quiz total must not decrease');
  assert.strictEqual(merged.qr, 18, 'quiz right must not decrease');
}

{
  const nextRealReview = {
    ...matureProgress,
    qr: 19,
    qt: 21,
    reviewStage: 6,
    cardState: 'review',
    dueAt: '2026-08-20T00:00:00.000Z',
    nextReviewAt: '2026-08-20T00:00:00.000Z',
    intervalDays: 60,
    reps: 21,
    lastReviewedAt: '2026-06-21T00:00:00.000Z'
  };
  const merged = mergeProgressEntry(matureProgress, nextRealReview);
  assert.strictEqual(merged.dueAt, nextRealReview.dueAt, 'legitimate higher-rep review update should advance dueAt');
  assert.strictEqual(merged.intervalDays, 60, 'legitimate higher-rep review update should advance interval');
  assert.strictEqual(merged.reps, 21, 'legitimate higher-rep review update should advance reps');
}

{
  const progressMap = { learned: matureProgress, due: { ...matureProgress, cardState: 'review', dueAt: '2026-06-21T00:00:00.000Z' } };
  const unseen = [{ ro: 'learned' }, { ro: 'due' }, { ro: 'brand-new' }]
    .filter((word) => isUnseenWord(word, progressMap))
    .map((word) => word.ro);
  assert.deepStrictEqual(unseen, ['brand-new'], 'queue repair must inject only truly unseen words');
}

{
  const progressBefore = JSON.stringify(matureProgress);
  const repaired = repairTodayQueue({
    todayQueue: ['retry-card'],
    deferred: ['retry-card'],
    unseen: ['brand-new'],
    dailyGoal: 20,
    todayNewWords: 5
  });
  assert.deepStrictEqual(repaired, ['brand-new', 'retry-card'], 'repair should add active new card and preserve deferred card');
  assert.strictEqual(JSON.stringify(matureProgress), progressBefore, 'queue repair must not mutate progress records');
}

{
  const once = mergeProgressEntry(matureProgress, matureProgress);
  const twice = mergeProgressEntry(once, matureProgress);
  assert.deepStrictEqual(twice, once, 'migration/load merge should be idempotent for identical mature progress');
}

{
  const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const api = fs.readFileSync(path.join(__dirname, '..', 'api.js'), 'utf8');
  assert(app.includes('progressLoaded = false'), 'login should mark progress as not loaded before initial data load');
  assert(app.includes('loadWords({ render: false })'), 'initial word load must not render answerable cards before progress load');
  assert(app.includes('if (dailyQueueLoaded) {\n        applyFilters();\n        renderCard();'), 'progress load must not render or repair today cards before daily queue load');
  assert(app.includes("if (dailyQueueLoaded) ensureTodayQueueHasActiveCards('applyFilters:today-before')"), 'applyFilters must not persist queue repair before daily queue load');
  assert(app.includes('blocked-progress-not-loaded'), 'answer/list/repair paths must be blocked before progress load');
  assert(app.includes('debugProgressWrite'), 'progress writes should be instrumented behind debug mode');
  assert(app.includes('isSchedulerProgressDowngrade'), 'front-end progress merge must prevent scheduler downgrades');
  assert(api.includes('isSchedulerMergeDowngrade'), 'local/cloud progress merge must prevent scheduler downgrades');
  assert(api.includes('map[key] = mergeCloudProgress({ ...(progress || {}), word_id:'), 'local progress writes must merge with existing id-keyed records');
  assert(api.includes('mergeCloudProgress(progress || {}, pending[key] || localProgress[key] || null)'), 'pending progress writes must merge with existing id-keyed records');
}

console.log('progress integrity verification passed');
