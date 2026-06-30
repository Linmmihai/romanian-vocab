const assert = require('assert');
const fs = require('fs');
const path = require('path');

function roKey(value) {
  return String(value || '').trim().toLocaleLowerCase('ro');
}

function uniqueRos(values) {
  const seen = new Set();
  return values.filter((value) => {
    const key = roKey(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function repairTodayQueue({
  todayQueue,
  completed = [],
  deferred = []
}) {
  const completedKeys = new Set(completed.map(roKey));
  const deferredKeys = new Set(deferred.map(roKey));
  const activeOpen = todayQueue.filter((ro) => !completedKeys.has(roKey(ro)) && !deferredKeys.has(roKey(ro)));
  const deferredOpen = todayQueue.filter((ro) => !completedKeys.has(roKey(ro)) && deferredKeys.has(roKey(ro)));
  return uniqueRos([...activeOpen, ...deferredOpen]);
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
  assert.strictEqual(active.length, 0, 'expected repair not to inject unseen cards into a fixed queue');
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
  assert(app.includes("path = 'global-due-only'"), 'expected global due reviews to block daily new cards');
  assert(app.includes('const completesTodayTask = isKnownAction;'), 'expected fuzzy answers not to complete daily tasks');
  assert(app.includes('function appendExplicitTodayQueueCards'), 'expected explicit goal changes to be the only path that appends new cards');
  assert(app.includes('return wordByRoIndex.get(key) || null'), 'expected getWordByRo to use indexed lookup');
  assert(app.includes('skipRepair: true'), 'expected applyFilters to avoid duplicate getDailyWordList repair');
  assert(!app.includes('ensureTodayQueueHasActiveCards(`markCard:${action}`)'), 'expected markCard not to duplicate normal repair');
  assert(!app.includes('getEligibleUnseenWordsForToday(W).slice(0, activeSlots)'), 'expected queue repair not to backfill unseen words');
  assert(!app.includes('const candidates = buildReviewFirstDailyPlan(W, Math.max(openSlots + activeOpenWords.length, dailyGoal))'), 'expected open queue normalization not to backfill unseen words');
  assert(app.includes('incrementalToday'), 'expected normal today answers to advance without rebuilding the whole queue');
  assert(app.includes('todaySeenWords.size'), 'expected metrics cache key to include todaySeenWords.size');
  assert(app.includes("todayQueue.join('|')"), 'expected metrics cache key to include todayQueue signature');
  assert(app.includes('todayQueueCompleted.size'), 'expected metrics cache key to include completed queue size');
  assert(app.includes('getDailyWordList:using-active-queue-before-load'), 'expected active repaired queues to render before dailyQueueLoaded settles');
}

console.log('daily queue repair verification passed');
