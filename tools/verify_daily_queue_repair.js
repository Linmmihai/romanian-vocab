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
  assert(app.includes('function ensureTodayQueueHasActiveCards'), 'expected centralized queue repair function');
  assert(app.includes("fastPath: 'active-queue-full'"), 'expected active queues to have a repair fast path');
  assert(app.includes('activeOpenCount >= activeSlots'), 'expected queue repair to backfill until active cards cover remaining quota');
  assert(app.includes('cap - Number(todayNewWords || 0)'), 'expected open slots to use the canonical daily completion count');
  assert(app.includes("path = 'global-due-only'"), 'expected global due reviews to block daily new cards');
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
}

console.log('daily queue repair verification passed');
