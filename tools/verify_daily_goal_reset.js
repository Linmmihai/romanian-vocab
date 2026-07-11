const assert = require('assert');
const fs = require('fs');
const path = require('path');

const DAILY_GOAL_MAX = 5000;
let defaultDailyGoal = 20;
let temporaryGoal = 0;
let hasTemporaryGoal = false;

function normalizeDailyGoalValue(value, fallback = 20) {
  return Math.max(1, Math.min(DAILY_GOAL_MAX, Number(value) || fallback || 20));
}

function readTodayTemporaryGoal() {
  return temporaryGoal ? normalizeDailyGoalValue(temporaryGoal, 0) : 0;
}

function hasTodayTemporaryGoal() {
  return hasTemporaryGoal;
}

function resolveLoadedDailyGoal({ logGoal = 0, queueGoal = 0, completedCount = 0 } = {}) {
  const explicitTemporaryGoal = hasTodayTemporaryGoal() ? readTodayTemporaryGoal() : 0;
  if (explicitTemporaryGoal > defaultDailyGoal) {
    return Math.max(defaultDailyGoal, explicitTemporaryGoal);
  }
  const candidateGoal = Math.max(Number(logGoal || 0), Number(queueGoal || 0), defaultDailyGoal);
  const completed = Number(completedCount || 0);
  if (candidateGoal > defaultDailyGoal && completed > defaultDailyGoal) {
    return Math.max(candidateGoal, completed);
  }
  return defaultDailyGoal;
}

function simulateLoadedQueueCorrection({
  savedGoal = 20,
  logGoal = 20,
  completedCount = 0,
  queueWasNormalized = false,
  completedWasTrimmed = false
} = {}) {
  let queueChanged = false;
  let forceQueueLocal = false;
  const dailyGoal = resolveLoadedDailyGoal({ logGoal, queueGoal: savedGoal, completedCount });
  if (savedGoal > dailyGoal || logGoal > dailyGoal) {
    forceQueueLocal = true;
    queueChanged = true;
  }
  if (completedWasTrimmed) {
    forceQueueLocal = true;
    queueChanged = true;
  }
  queueChanged = queueChanged || queueWasNormalized;
  return { dailyGoal, queueChanged, forceQueueLocal };
}

{
  hasTemporaryGoal = false;
  temporaryGoal = 0;
  assert.strictEqual(
    resolveLoadedDailyGoal({ logGoal: 5000, queueGoal: 5000, completedCount: 0 }),
    20,
    'stale unlimited goal with no explicit today extension must reset to the default goal'
  );
}

{
  hasTemporaryGoal = false;
  temporaryGoal = 0;
  assert.strictEqual(
    resolveLoadedDailyGoal({ logGoal: 5000, queueGoal: 5000, completedCount: 20 }),
    20,
    'stale unlimited goal at the default completion count must not block check-in'
  );
}

{
  hasTemporaryGoal = true;
  temporaryGoal = 5000;
  assert.strictEqual(
    resolveLoadedDailyGoal({ logGoal: 20, queueGoal: 20, completedCount: 20 }),
    5000,
    'same-day explicit unlimited mode must remain active'
  );
}

{
  hasTemporaryGoal = false;
  temporaryGoal = 0;
  assert.strictEqual(
    resolveLoadedDailyGoal({ logGoal: 50, queueGoal: 50, completedCount: 35 }),
    50,
    'a same-day extended goal with progress beyond the default should be preserved'
  );
}

{
  hasTemporaryGoal = false;
  temporaryGoal = 0;
  const result = simulateLoadedQueueCorrection({
    savedGoal: 5000,
    logGoal: 5000,
    completedCount: 20,
    queueWasNormalized: false,
    completedWasTrimmed: false
  });
  assert.deepStrictEqual(
    result,
    { dailyGoal: 20, queueChanged: true, forceQueueLocal: true },
    'stale cloud queue/log goal must be marked for force-local overwrite even when queue rows need no cleanup'
  );
}

{
  hasTemporaryGoal = false;
  temporaryGoal = 0;
  const result = simulateLoadedQueueCorrection({
    savedGoal: 20,
    logGoal: 20,
    completedCount: 20,
    queueWasNormalized: false,
    completedWasTrimmed: false
  });
  assert.deepStrictEqual(
    result,
    { dailyGoal: 20, queueChanged: false, forceQueueLocal: false },
    'normal default-goal queue should not be rewritten just because it was loaded'
  );
}

{
  const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const serviceWorker = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
  assert(app.includes('function resolveLoadedDailyGoal'), 'expected daily goal reset helper');
  assert(app.includes('function hasTodayTemporaryGoal'), 'expected explicit temporary-goal key check');
  assert(app.includes('function getDailyQueueLocalSaveMessage'), 'expected offline/local queue save message helper');
  assert(app.includes('if (!isDefaultGoalDone()) return;'), 'check-in modal should open after fixed goal is done');
  assert(app.includes('if (!ensureDailyStateCurrent({ reload: true })) return null;'), 'queue saves should not persist stale previous-day runtime state');
  assert(app.includes('Number(todayLog?.goal || 0) > dailyGoal'), 'cloud daily log with stale higher goal should be overwritten');
  assert(app.includes('queueChanged = queueChanged || todayQueue.length !== originalQueueLength'), 'stale-goal queue correction must not be overwritten by later normalization checks');
  assert(index.includes('app.js?v=20260711-daily-goal-sync'), 'app.js cache-busting version must move with daily-goal behavior changes');
  assert(serviceWorker.includes("ro-vocab-pwa-v13"), 'service worker cache name must move with app shell behavior changes');
}

console.log('daily goal reset verification passed');
