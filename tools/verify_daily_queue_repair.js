const assert = require('assert');
const fs = require('fs');
const path = require('path');
const dailyPlan = require('../daily-plan.js');

function roKey(value) {
  return String(value || '').trim().toLocaleLowerCase('ro');
}

function repairTodayQueue({
  todayQueue,
  completed = [],
  deferred = [],
  unseen = [],
  dailyGoal = todayQueue.length,
  todayNewWords = completed.length
}) {
  const completedKeys = new Set(completed.map(roKey));
  const deferredKeys = new Set(deferred.map(roKey));
  const activeOpen = todayQueue.filter((ro) => !completedKeys.has(roKey(ro)) && !deferredKeys.has(roKey(ro)));
  const deferredOpen = todayQueue.filter((ro) => !completedKeys.has(roKey(ro)) && deferredKeys.has(roKey(ro)));
  return dailyPlan.composeOpenQueue({
    active: activeOpen,
    deferred: deferredOpen,
    candidates: unseen.filter(ro => !completedKeys.has(roKey(ro))),
    goal: dailyGoal,
    completedCount: todayNewWords,
    keyOf: roKey,
    sortWords: values => values
  }).words;
}

function shouldFastPathActiveQueue({ todayQueue, completed = [], deferred = [], dailyGoal, todayNewWords }) {
  const completedKeys = new Set(completed.map(roKey));
  const deferredKeys = new Set(deferred.map(roKey));
  const activeOpen = todayQueue.filter((ro) => !completedKeys.has(roKey(ro)) && !deferredKeys.has(roKey(ro)));
  const remainingQuota = Math.max(0, dailyGoal - todayNewWords);
  return activeOpen.length >= remainingQuota;
}

{
  const reviews = Array.from({ length: 3 }, (_, index) => `review-${index}`);
  const unseen = Array.from({ length: 250 }, (_, index) => `new-${String(index).padStart(3, '0')}`);
  const plan = dailyPlan.buildTieredPlan([reviews, unseen], { limit: 200, keyOf: roKey });
  assert.deepStrictEqual(plan.slice(0, 3), reviews, 'due reviews must occupy the first slots in the 200-task queue');
  assert.strictEqual(plan.filter(ro => ro.startsWith('new-')).length, 197, 'new words must fill exactly the quota left after reviews');
  assert.strictEqual(plan.length, 200, 'daily processing queue must stop at the fixed 200-task quota');
}

{
  const todayQueue = Array.from({ length: 20 }, (_, index) => `retry-${index}`);
  const deferred = [...todayQueue];
  const unseen = Array.from({ length: 135 }, (_, index) => `new-${index}`);
  const repaired = repairTodayQueue({ todayQueue, deferred, unseen, dailyGoal: 170, todayNewWords: 7 });
  const active = repaired.filter((ro) => ro.startsWith('new-'));
  const keptDeferred = repaired.filter((ro) => ro.startsWith('retry-'));
  assert.strictEqual(active.length, 135, 'expected repair to inject eligible unseen cards while quota remains');
  assert.strictEqual(keptDeferred.length, 20, 'expected deferred retry cards to be preserved');
}

{
  const todayQueue = Array.from({ length: 20 }, (_, index) => `retry-${index}`);
  const deferred = [...todayQueue];
  const unseen = Array.from({ length: 20 }, (_, index) => `new-${index}`);
  const repaired = repairTodayQueue({ todayQueue, deferred, unseen, dailyGoal: 20, todayNewWords: 0 });
  assert.strictEqual(repaired.filter(ro => ro.startsWith('new-')).length, 20, 'waiting review steps must not consume active new-card slots');
  assert.strictEqual(repaired.filter(ro => ro.startsWith('retry-')).length, 20, 'waiting review steps must remain queued for their due time');
}

{
  const due = Array.from({ length: 8 }, (_, index) => `review-${index}`);
  const unseen = Array.from({ length: 4 }, (_, index) => `new-${index}`);
  const plan = dailyPlan.interleavePriority(due, unseen, { limit: 12, primaryBatch: 3, keyOf: roKey });
  assert.deepStrictEqual(plan.slice(0, 4), ['review-0', 'review-1', 'review-2', 'new-0'], 'due reviews should be prioritized without monopolizing study');
  assert.strictEqual(plan.filter(ro => ro.startsWith('new-')).length, 4, 'interleaving must keep new cards reachable while reviews are due');
}

{
  const todayQueue = Array.from({ length: 20 }, (_, index) => `retry-${index}`);
  const deferred = [...todayQueue];
  const repaired = repairTodayQueue({ todayQueue, deferred, unseen: [], dailyGoal: 170, todayNewWords: 7 });
  assert.deepStrictEqual(repaired, todayQueue, 'expected deferred-only queue to remain when no unseen cards are eligible');
}

{
  const todayQueue = Array.from({ length: 30 }, (_, index) => `active-${index}`);
  assert.strictEqual(
    shouldFastPathActiveQueue({ todayQueue, dailyGoal: 30, todayNewWords: 0 }),
    true,
    'expected normal active queue to skip expensive repair'
  );
  const repaired = repairTodayQueue({
    todayQueue,
    unseen: Array.from({ length: 50 }, (_, index) => `new-${index}`),
    dailyGoal: 30,
    todayNewWords: 0
  });
  assert.deepStrictEqual(repaired, todayQueue, 'expected active queue repair to make no queue changes');
}

{
  const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert(app.includes('function ensureTodayQueueHasActiveCards'), 'expected centralized queue repair function');
  assert(app.includes("fastPath: 'active-queue-full'"), 'expected active queues to have a repair fast path');
  assert(app.includes('activeOpenCount >= activeSlots'), 'expected only active cards to satisfy the remaining daily quota');
  assert(app.includes('cap - Number(todayNewWords || 0)'), 'expected open slots to use the canonical daily completion count');
  assert(!app.includes("path = 'global-due-only'"), 'global due reviews must not block every queued new card');
  assert(app.includes('RomanianVocabDailyPlan.interleavePriority'), 'today mode must interleave prioritized reviews with active learning cards');
  assert(app.includes('isTodayBlockingReviewWord'), 'expected blocking review cards in today mode to count when known');
  assert(app.includes('const completesTodayTask = isKnownAction;'), 'expected fuzzy answers not to complete daily tasks');
  assert(app.includes('function appendExplicitTodayQueueCards'), 'expected explicit goal changes to keep their fast append path');
  assert(app.includes('return wordByRoIndex.get(key) || null'), 'expected getWordByRo to use indexed lookup');
  assert(app.includes('skipRepair: true'), 'expected applyFilters to avoid duplicate getDailyWordList repair');
  assert(!app.includes('ensureTodayQueueHasActiveCards(`markCard:${action}`)'), 'expected markCard not to duplicate normal repair');
  assert(app.includes('RomanianVocabDailyPlan.composeOpenQueue'), 'expected open queue composition to use the shared daily planner');
  assert(!app.includes('function buildSmartDailyPlan'), 'expected obsolete duplicate daily planner to be removed');
  assert(app.includes("incrementalToday: flashMode === 'today'"), 'expected every normal today answer to advance away from the current card');
  assert(app.includes('incrementalToday'), 'expected normal today answers to advance without rebuilding the whole queue');
  assert(app.includes('todaySeenWords.size'), 'expected metrics cache key to include todaySeenWords.size');
  assert(app.includes("todayQueue.join('|')"), 'expected metrics cache key to include todayQueue signature');
  assert(app.includes('todayQueueCompleted.size'), 'expected metrics cache key to include completed queue size');
  assert(app.includes('getDailyWordList:using-active-queue-before-load'), 'expected active repaired queues to render before dailyQueueLoaded settles');
  assert(app.includes("if (isDueLearningStepWord(w)) return 0;"), 'expected due learning steps to have first queue priority');
  assert(app.includes("if (isDueGraduatedReviewWord(w)) return 1;"), 'expected graduated reviews to follow learning steps');
  assert(app.includes("if (isUnseenWord(w)) return 3;"), 'expected unseen cards to remain behind learning and review cards');
  assert(app.includes("queuePhase === 'learning-due'"), 'expected learning steps to have a distinct visible state');
  assert(app.includes("queuePhase === 'review-due' || queuePhase === 'relearning-due'"), 'expected due review and relearning cards to render as review');
  assert(index.includes('id="today-focus-meta"'), 'expected one concise daily-plan explanation instead of repeated stage cards');
  assert(index.includes('复习优先，不足目标的名额自动补入新词'), 'expected the daily quota composition rule to be visible');
  assert(app.includes('const DEFAULT_DAILY_GOAL = 200;'), 'expected the default daily processing quota to be 200');
}

console.log('daily queue repair verification passed');
