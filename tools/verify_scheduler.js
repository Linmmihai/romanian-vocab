const assert = require('assert');
const scheduler = require('../scheduler.js');

const NOW = '2026-06-21T08:00:00.000Z';
const TEN_MINUTES = 10 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

function dueDiff(result) {
  return new Date(result.dueAt).getTime() - new Date(NOW).getTime();
}

function approx(actual, expected, tolerance = 1000) {
  assert(Math.abs(actual - expected) <= tolerance, `expected ${actual} to be within ${tolerance}ms of ${expected}`);
}

{
  const result = scheduler.scheduleCardReview({}, scheduler.ACTION_UNKNOWN, { now: NOW });
  assert.strictEqual(result.cardState, 'learning');
  approx(dueDiff(result), TEN_MINUTES);
  assert.strictEqual(result.forgetCount, 1);
}

{
  const result = scheduler.scheduleCardReview({}, scheduler.ACTION_FUZZY, { now: NOW });
  assert.strictEqual(result.cardState, 'learning');
  approx(dueDiff(result), DAY);
  assert.strictEqual(result.fuzzyCount, 1);
}

{
  const result = scheduler.scheduleCardReview({}, scheduler.ACTION_KNOWN, { now: NOW });
  assert(['learning', 'review'].includes(result.cardState));
  approx(dueDiff(result), DAY);
  assert.strictEqual(result.correctCount, 1);
}

{
  const result = scheduler.scheduleCardReview({
    cardState: 'review',
    intervalDays: 7,
    memoryStrength: 70,
    reps: 3,
    correctCount: 3
  }, scheduler.ACTION_UNKNOWN, { now: NOW });
  assert.strictEqual(result.cardState, 'reinforcing');
  assert.strictEqual(result.lapses, 1);
  approx(dueDiff(result), TEN_MINUTES);
  assert.strictEqual(result.needsReinforcement, true);
}

{
  const review = {
    cardState: 'review',
    intervalDays: 7,
    memoryStrength: 70,
    reps: 3,
    correctCount: 3
  };
  const fuzzy = scheduler.scheduleCardReview(review, scheduler.ACTION_FUZZY, { now: NOW });
  const known = scheduler.scheduleCardReview(review, scheduler.ACTION_KNOWN, { now: NOW });
  assert(fuzzy.intervalDays < known.intervalDays, `expected fuzzy ${fuzzy.intervalDays} < known ${known.intervalDays}`);
}

{
  const result = scheduler.normalizeSchedulerProgress({
    cardState: 'reinforcing',
    intervalDays: 3,
    memoryStrength: 55,
    forgetCount: 3,
    lapses: 2,
    recentResults: ['unknown', 'known', 'known'],
    needsReinforcement: true,
    lastWrongAt: '2026-06-20T08:00:00.000Z',
    weakClearedAt: '2026-06-21T08:00:00.000Z'
  }, NOW);
  assert.strictEqual(result.needsReinforcement, false);
  assert.strictEqual(result.cardState, 'review');
}

{
  const result = scheduler.scheduleCardReview({
    cardState: 'review',
    intervalDays: 3,
    memoryStrength: 60,
    reps: 3,
    forgetCount: 1,
    recentResults: ['unknown']
  }, scheduler.ACTION_UNKNOWN, { now: NOW });
  assert.strictEqual(result.cardState, 'reinforcing');
  assert.strictEqual(result.needsReinforcement, true);
}

console.log('scheduler verification passed');
