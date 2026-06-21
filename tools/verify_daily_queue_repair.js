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
  deferred = [],
  unseen = [],
  dailyGoal,
  todayNewWords
}) {
  const completedKeys = new Set(completed.map(roKey));
  const deferredKeys = new Set(deferred.map(roKey));
  const activeOpen = todayQueue.filter((ro) => !completedKeys.has(roKey(ro)) && !deferredKeys.has(roKey(ro)));
  const deferredOpen = todayQueue.filter((ro) => !completedKeys.has(roKey(ro)) && deferredKeys.has(roKey(ro)));
  const queuedKeys = new Set(todayQueue.map(roKey));
  const remainingQuota = Math.max(0, dailyGoal - todayNewWords);
  const activeSlots = Math.max(0, remainingQuota - activeOpen.length);
  const newCards = unseen.filter((ro) => !queuedKeys.has(roKey(ro)) && !completedKeys.has(roKey(ro))).slice(0, activeSlots);
  return uniqueRos([...activeOpen, ...newCards, ...deferredOpen]);
}

{
  const todayQueue = Array.from({ length: 20 }, (_, index) => `retry-${index}`);
  const deferred = [...todayQueue];
  const unseen = Array.from({ length: 135 }, (_, index) => `new-${index}`);
  const repaired = repairTodayQueue({ todayQueue, deferred, unseen, dailyGoal: 170, todayNewWords: 7 });
  const active = repaired.filter((ro) => ro.startsWith('new-'));
  const keptDeferred = repaired.filter((ro) => ro.startsWith('retry-'));
  assert(active.length > 0, 'expected active new cards to be injected');
  assert.strictEqual(active[0], 'new-0');
  assert.strictEqual(keptDeferred.length, 20, 'expected deferred retry cards to be preserved');
}

{
  const todayQueue = Array.from({ length: 20 }, (_, index) => `retry-${index}`);
  const deferred = [...todayQueue];
  const repaired = repairTodayQueue({ todayQueue, deferred, unseen: [], dailyGoal: 170, todayNewWords: 7 });
  assert.deepStrictEqual(repaired, todayQueue, 'expected deferred-only queue to remain when no unseen cards are eligible');
}

{
  const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  assert(app.includes('function ensureTodayQueueHasActiveCards'), 'expected centralized queue repair function');
  assert(app.includes('todaySeenWords.size'), 'expected metrics cache key to include todaySeenWords.size');
  assert(app.includes("todayQueue.join('|')"), 'expected metrics cache key to include todayQueue signature');
  assert(app.includes('todayQueueCompleted.size'), 'expected metrics cache key to include completed queue size');
  assert(app.includes('getDailyWordList:using-active-queue-before-load'), 'expected active repaired queues to render before dailyQueueLoaded settles');
}

console.log('daily queue repair verification passed');
