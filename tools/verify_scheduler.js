const assert = require('assert');
const fs = require('fs');
const path = require('path');
const scheduler = require('../scheduler.js');

const schedulerMigration = fs.readFileSync(path.join(__dirname, 'progress_scheduler_schema.sql'), 'utf8');
const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const serviceWorker = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
assert(schedulerMigration.includes('add column if not exists card_state'), 'scheduler migration must persist card state');
assert(schedulerMigration.includes('add column if not exists due_at'), 'scheduler migration must persist due dates');
assert(schedulerMigration.includes('add column if not exists recent_results jsonb'), 'scheduler migration must persist recent outcomes as jsonb');
assert(schedulerMigration.includes('progress_user_due_at_idx'), 'scheduler migration must index per-user due lookups');
assert(schedulerMigration.includes('validate constraint progress_card_state_check'), 'scheduler migration must validate the card-state constraint after backfill');
assert(schedulerMigration.includes("notify pgrst, 'reload schema'"), 'scheduler migration must refresh the Data API schema cache');
assert(index.includes('scheduler.js?v=20260726-queue-slot-fix'), 'scheduler cache buster must move with the queue-slot fix');
assert(index.includes('api.js?v=20260726-queue-slot-fix'), 'API cache buster must match the queue-slot fix');
assert(index.includes('app.js?v=20260726-queue-slot-fix'), 'app cache buster must match the queue-slot fix');
assert(serviceWorker.includes('ro-vocab-pwa-v36'), 'service worker cache must move with the queue-slot fix');

const NOW = '2026-06-21T08:00:00.000Z';
const TEN_MINUTES = 10 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

assert.strictEqual(scheduler.cardStateMaturity('new'), 0);
assert.strictEqual(scheduler.cardStateMaturity('reinforcing'), 2);
assert.strictEqual(scheduler.cardStateMaturity('mastered'), 4);
assert.strictEqual(scheduler.getReviewStage({ review_stage: 3 }), 3);
assert.strictEqual(scheduler.getReviewStage({ reviewCount: 5 }), 5);

{
  const mature = { cardState: 'review', intervalDays: 30, reps: 20 };
  const accidentalFresh = { cardState: 'learning', intervalDays: 0, reps: 1 };
  assert.strictEqual(
    scheduler.isProgressDowngrade(mature, accidentalFresh, { reviewStage: 5 }, { reviewStage: 1 }),
    true,
    'shared merge policy must reject a scheduler downgrade'
  );
  assert.strictEqual(
    scheduler.isProgressDowngrade(mature, { cardState: 'review', intervalDays: 60, reps: 21 }, { reviewStage: 5 }, { reviewStage: 6 }),
    false,
    'shared merge policy must allow a legitimate review advance'
  );
}

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
  assert.strictEqual(result.lapses, 0, 'a failed new card must not count as a review lapse');
  assert.strictEqual(result.needsReinforcement, false, 'a failed new card must stay in learning, not reinforcement');

  const secondFailure = scheduler.scheduleCardReview(result, scheduler.ACTION_UNKNOWN, { now: NOW });
  assert.strictEqual(secondFailure.cardState, 'learning');
  assert.strictEqual(secondFailure.lapses, 0, 'repeated learning failures must not become review lapses');
  assert.strictEqual(secondFailure.needsReinforcement, false, 'repeated learning failures must remain in the learning queue');
}

{
  const result = scheduler.scheduleCardReview({}, scheduler.ACTION_FUZZY, { now: NOW });
  assert.strictEqual(result.cardState, 'learning');
  approx(dueDiff(result), DAY);
  assert.strictEqual(result.fuzzyCount, 1);
  assert.strictEqual(result.needsReinforcement, false, 'a fuzzy new card must not enter reinforcement');
}

{
  const result = scheduler.scheduleCardReview({}, scheduler.ACTION_KNOWN, { now: NOW });
  assert.strictEqual(result.cardState, 'learning', 'first successful new-card answer should remain in the learning steps');
  approx(dueDiff(result), DAY);
  assert.strictEqual(result.correctCount, 1);

  const graduated = scheduler.scheduleCardReview(result, scheduler.ACTION_KNOWN, {
    now: new Date(new Date(NOW).getTime() + DAY).toISOString()
  });
  assert.strictEqual(graduated.cardState, 'review', 'second successful learning step should graduate the card to review');
  assert(graduated.intervalDays > result.intervalDays, 'graduated review interval must grow beyond the learning interval');
}

{
  const repaired = scheduler.normalizeSchedulerProgress({
    cardState: 'reinforcing',
    reps: 2,
    forgetCount: 2,
    recentResults: ['unknown', 'unknown'],
    needsReinforcement: true,
    lapses: 0
  }, NOW);
  assert.strictEqual(repaired.cardState, 'learning', 'legacy new-card misses must be repaired back to learning');
  assert.strictEqual(repaired.needsReinforcement, false, 'legacy new-card misses must not remain reinforced');
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
