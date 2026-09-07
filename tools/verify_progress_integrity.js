const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const scheduler = require('../scheduler.js');
const progressModel = require('../progress-model.js');

function loadApiProgressMerge() {
  const storage = { getItem: () => null, setItem() {}, removeItem() {} };
  const sandbox = {
    console,
    localStorage: storage,
    sessionStorage: storage,
    RomanianVocabScheduler: scheduler,
    RomanianVocabProgressModel: progressModel,
    setTimeout,
    clearTimeout
  };
  sandbox.window = sandbox;
  const source = fs.readFileSync(path.join(__dirname, '..', 'api.js'), 'utf8');
  vm.runInNewContext(`${source}\nglobalThis.__mergeCloudProgress = mergeCloudProgress;`, sandbox);
  return sandbox.__mergeCloudProgress;
}

function hasWordProgress(progress) {
  if (!progress) return false;
  return !!(
    progress.seen ||
    progress.known ||
    Number(progress.qt || 0) ||
    Number(progress.qr || 0) ||
    scheduler.getReviewStage(progress) ||
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

assert.strictEqual(progressModel.getGrammarRight({ grammar_qr: 3 }), 3);
assert.strictEqual(progressModel.getGrammarTotal({ grammarQt: 5 }), 5);

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
  const merged = progressModel.mergeEntries(matureProgress, accidentalFreshWrite);
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
  const merged = progressModel.mergeEntries(matureProgress, nextRealReview);
  assert.strictEqual(merged.dueAt, nextRealReview.dueAt, 'legitimate higher-rep review update should advance dueAt');
  assert.strictEqual(merged.intervalDays, 60, 'legitimate higher-rep review update should advance interval');
  assert.strictEqual(merged.reps, 21, 'legitimate higher-rep review update should advance reps');
}

{
  const legitimateLapse = {
    ...matureProgress,
    qt: 21,
    reps: 21,
    cardState: 'reinforcing',
    dueAt: '2026-06-21T00:10:00.000Z',
    nextReviewAt: '2026-06-21T00:10:00.000Z',
    intervalDays: 0,
    memoryStrength: 63,
    lapses: 2,
    needsReinforcement: true,
    lastReviewedAt: '2026-06-21T00:00:00.000Z'
  };
  const merged = progressModel.mergeEntries(matureProgress, legitimateLapse);
  assert.strictEqual(merged.cardState, 'reinforcing', 'a real newer answer must be allowed to move a review card into relearning');
  assert.strictEqual(merged.reps, 21, 'a real newer answer must advance reps');
  assert.strictEqual(merged.seen, true, 'a lapsed learned card must never become unseen');
  assert.strictEqual(merged.known, true, 'a lapsed learned card must preserve durable recognition history');
}

{
  const previousFailureState = {
    ...matureProgress,
    qt: 20,
    reps: 20,
    wrongCount: 4,
    errorStreak: 3,
    correctStreakSinceWrong: 0,
    dueAt: '2026-06-20T00:10:00.000Z',
    nextReviewAt: '2026-06-20T00:10:00.000Z',
    lastReviewedAt: '2026-06-20T00:00:00.000Z',
    syncRevision: 7
  };
  const successfulReview = {
    ...previousFailureState,
    qr: 19,
    qt: 21,
    reps: 21,
    wrongCount: 3,
    errorStreak: 0,
    correctStreakSinceWrong: 1,
    dueAt: '2026-06-22T00:00:00.000Z',
    nextReviewAt: '2026-06-22T00:00:00.000Z',
    lastReviewedAt: '2026-06-21T00:00:00.000Z'
  };
  const merged = progressModel.mergeEntries(previousFailureState, successfulReview);
  assert.strictEqual(merged.qt, 21, 'a newer answer must advance cumulative quiz totals');
  assert.strictEqual(merged.wrongCount, 3, 'a newer successful state must be allowed to lower wrongCount');
  assert.strictEqual(merged.errorStreak, 0, 'a newer successful state must be allowed to clear errorStreak');
  assert.strictEqual(merged.correctStreakSinceWrong, 1, 'current streak must come from the newer state snapshot');
  assert.strictEqual(merged.dueAt, successfulReview.dueAt, 'dueAt must come from the selected newer snapshot');
  assert.strictEqual(merged.nextReviewAt, successfulReview.nextReviewAt, 'nextReviewAt must come from the same selected snapshot as dueAt');
  assert.strictEqual(merged.syncRevision, 7, 'an unsynced local answer must retain its server base revision');
}

{
  const mergeCloudProgress = loadApiProgressMerge();
  const cloudRow = {
    quiz_right: 18,
    quiz_total: 20,
    wrong_count: 4,
    error_streak: 3,
    correct_streak_since_wrong: 0,
    card_state: 'review',
    due_at: '2026-06-20T00:10:00.000Z',
    next_review_at: '2026-06-20T00:10:00.000Z',
    last_reviewed_at: '2026-06-20T00:00:00.000Z',
    reps: 20,
    sync_revision: 7
  };
  const localProgress = {
    qr: 19,
    qt: 21,
    wrongCount: 3,
    errorStreak: 0,
    correctStreakSinceWrong: 1,
    cardState: 'review',
    dueAt: '2026-06-22T00:00:00.000Z',
    nextReviewAt: '2026-06-22T00:00:00.000Z',
    lastReviewedAt: '2026-06-21T00:00:00.000Z',
    reps: 21,
    syncRevision: 7
  };
  const merged = mergeCloudProgress(localProgress, cloudRow);
  assert.strictEqual(merged.errorStreak, 0, 'API cloud merge must preserve a newer explicit streak reset');
  assert.strictEqual(merged.wrongCount, 3, 'API cloud merge must preserve a newer decreased wrongCount');
  assert.strictEqual(merged.dueAt, localProgress.dueAt, 'API cloud merge must use the newer scheduler snapshot');
  assert.strictEqual(merged.nextReviewAt, localProgress.nextReviewAt, 'API cloud merge must keep both due fields on that snapshot');
}

{
  const beforeFailure = {
    ...matureProgress,
    qt: 21,
    reps: 21,
    errorStreak: 0,
    correctStreakSinceWrong: 3,
    lastReviewedAt: '2026-06-21T00:00:00.000Z'
  };
  const failedReview = {
    ...beforeFailure,
    qt: 22,
    reps: 22,
    wrongCount: 1,
    errorStreak: 1,
    correctStreakSinceWrong: 0,
    dueAt: '2026-06-22T00:10:00.000Z',
    nextReviewAt: '2026-06-22T00:10:00.000Z',
    lastReviewedAt: '2026-06-22T00:00:00.000Z'
  };
  const merged = progressModel.mergeEntries(beforeFailure, failedReview);
  assert.strictEqual(merged.correctStreakSinceWrong, 0, 'a newer failure must clear the consecutive-success state');
  assert.strictEqual(merged.errorStreak, 1, 'a newer failure must set the current error streak');
}

{
  const current = {
    ...matureProgress,
    errorStreak: 0,
    wrongCount: 2,
    correctStreakSinceWrong: 2,
    dueAt: '2026-07-20T00:00:00.000Z',
    nextReviewAt: '2026-07-20T00:00:00.000Z',
    stateUpdatedAt: '2026-06-22T00:00:00.000Z',
    syncRevision: 9
  };
  const stale = {
    ...current,
    errorStreak: 3,
    wrongCount: 5,
    correctStreakSinceWrong: 0,
    dueAt: '2026-09-20T00:00:00.000Z',
    nextReviewAt: '2026-09-20T00:00:00.000Z',
    lastReviewedAt: '2026-06-23T00:00:00.000Z',
    stateUpdatedAt: '2026-06-21T00:00:00.000Z',
    syncRevision: 8
  };
  const merged = progressModel.mergeEntries(current, stale);
  assert.strictEqual(merged.errorStreak, 0, 'a lower sync revision must not revive stale current-state fields');
  assert.strictEqual(merged.wrongCount, 2, 'a lower sync revision must not overwrite current wrongCount');
  assert.strictEqual(merged.dueAt, current.dueAt, 'a stale future due date must not replace the current scheduler snapshot');
  assert.strictEqual(merged.nextReviewAt, current.nextReviewAt, 'legacy and scheduler due fields must stay on the current snapshot');
  assert.strictEqual(merged.lastReviewedAt, current.lastReviewedAt, 'a stale revision must not replace the current review timestamp');
  assert.strictEqual(merged.syncRevision, 9, 'syncRevision must remain monotonic');
}

{
  const stalePending = {
    word_id: matureProgress.word_id,
    known: false,
    seen: false,
    qr: 0,
    qt: 0,
    reviewStage: 0,
    cardState: 'new',
    reps: 0,
    lastReviewedAt: '2026-06-22T00:00:00.000Z',
    pendingSync: true
  };
  const merged = progressModel.mergeEntries(matureProgress, stalePending);
  assert.strictEqual(merged.cardState, 'review', 'a stale pending overlay must not replace mature cloud scheduler state');
  assert.strictEqual(merged.seen, true, 'a stale pending overlay must not make a learned word unseen');
  assert.strictEqual(merged.qt, 20, 'a stale pending overlay must not erase answer history');
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
  const once = progressModel.mergeEntries(matureProgress, matureProgress);
  const twice = progressModel.mergeEntries(once, matureProgress);
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
  assert(app.includes('RomanianVocabProgressModel.mergeEntries'), 'front-end progress writes must use the shared progress model');
  assert(api.includes('const merged = RomanianVocabProgressModel.mergeEntries(cloudProgress, localProgress);'), 'local/cloud progress merge must delegate to the shared progress model');
  assert(!api.includes('const wrongCount = Math.max(Number(localProgress.wrongCount'), 'API layer must not redefine current-state merge rules');
  assert(api.includes('function mergeStoredProgress'), 'all storage overlays must use one monotonic progress merge helper');
  assert(api.includes('map[nextKey] = mergeStoredProgress(map[nextKey]'), 'pending progress must merge with cloud progress instead of overwriting it');
  assert(api.includes('const { preferCloud = !isOfflineMode() } = options;'), 'online vocabulary loading must be cloud-first');
  assert(api.includes("sb.from('words').select('id,ro').in('id', candidateWordIds)"), 'pending progress retries must validate word IDs against the current cloud vocabulary');
  assert(api.includes('resolveCurrentWordForProgress'), 'stale word IDs must be rebound through the current normalized Romanian text index');
  assert(!app.includes('function mergeProgressEntry'), 'front-end must not redefine progress merge rules');
  assert(!api.includes('function isSchedulerMergeDowngrade'), 'API layer must not redefine scheduler merge rules');
  assert(!app.includes('function schedulerMaturityRank'), 'front-end must not duplicate scheduler maturity rules');
  assert(!api.includes('function schedulerMaturityRank'), 'API layer must not duplicate scheduler maturity rules');
  assert(!app.includes('function getProgressReviewStage'), 'front-end must use the shared review-stage adapter');
  assert(!api.includes('function getProgressReviewStage'), 'API layer must use the shared review-stage adapter');
  assert(api.includes('map[key] = mergeCloudProgress({ ...(progress || {}), word_id:'), 'local progress writes must merge with existing id-keyed records');
  assert(api.includes('mergeCloudProgress(progress || {}, pending[key] || localProgress[key] || null)'), 'pending progress writes must merge with existing id-keyed records');
}

console.log('progress integrity verification passed');
