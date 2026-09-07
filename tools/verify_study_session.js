'use strict';

const assert = require('assert');
const Session = require('../study-session.js');

function state(options = {}) {
  return Session.createState({ userId: 'u1', dateKey: '2026-09-07', now: 0, ...options });
}

function answer(current, word, renderedAt, answeredAt, action = 'known') {
  current = Session.cardRendered(current, word, { now: renderedAt, visible: true });
  const gate = Session.beforeAnswer(current, word, { now: answeredAt, visible: true });
  assert.equal(gate.allowed, true);
  return Session.commitAnswer(gate.state, word, action, { now: answeredAt });
}

// Initial estimates are explicit and deterministic until five valid local samples exist.
const initial = Session.estimatePlan(15, [10_000, 20_000, 30_000, 40_000]);
assert.equal(initial.source, 'initial');
assert.equal(initial.count, 30);
const personal = Session.estimatePlan(15, [10_000, 20_000, 30_000, 40_000, 50_000]);
assert.equal(personal.source, 'personal');
assert.equal(personal.msPerAnswer, 30_000);
assert.equal(personal.count, 30);

// Count mode never blocks the app and can collect effective local timing samples.
let current = state();
let result = answer(current, { ro: 'unu' }, 1000, 11_000);
current = result.state;
assert.equal(result.entry.durationMs, 10_000);
assert.equal(result.entry.validSample, true);
assert.equal(result.entry.sessionCounted, false);
assert.equal(current.completedCount, 0);

// A duplicate render of the same word does not restart its clock.
current = Session.cardRendered(current, { ro: 'doi' }, { now: 20_000, visible: true });
current = Session.cardRendered(current, { ro: 'doi' }, { now: 25_000, visible: true });
let gated = Session.beforeAnswer(current, { ro: 'doi' }, { now: 32_000, visible: true });
result = Session.commitAnswer(gated.state, { ro: 'doi' }, 'known', { now: 32_000 });
assert.equal(result.entry.durationMs, 12_000);

// Hidden time and time after the idle cutoff are not charged.
current = state();
current = Session.cardRendered(current, 'trei', { now: 0, visible: true });
current = Session.visibilityChanged(current, false, { now: 5000 });
current = Session.visibilityChanged(current, true, { now: 65_000 });
current = Session.pauseForIdle(current, { now: 70_000 });
current = Session.noteActivity(current, { now: 170_000, visible: true });
gated = Session.beforeAnswer(current, 'trei', { now: 175_000, visible: true });
assert.equal(Session.getResponseMs(gated.state, 'trei', { now: 175_000, visible: true }), 15_000);
result = Session.commitAnswer(gated.state, 'trei', 'known', { now: 175_000 });
assert.equal(result.entry.durationMs, 15_000);

// Leaving the card pauses timing but preserves the attempt for a later return.
current = state();
current = Session.cardRendered(current, 'pauză', { now: 0, visible: true });
current = Session.cardRendered(current, null, { now: 4000, visible: true });
assert.equal(Session.getResponseMs(current, 'pauză', { now: 40_000, visible: true }), 4000);
current = Session.noteActivity(current, { now: 30_000, visible: true });
assert.equal(Session.getResponseMs(current, 'pauză', { now: 40_000, visible: true }), 4000);
current = Session.cardRendered(current, 'pauză', { now: 40_000, visible: true });
gated = Session.beforeAnswer(current, 'pauză', { now: 46_000, visible: true });
assert.equal(Session.getResponseMs(gated.state, 'pauză', { now: 46_000, visible: true }), 10_000);

// Time budget pauses only after preserving the answer that crosses the boundary.
current = Session.start(state({ mode: 'time' }), { now: 0, minutes: 5, samples: [] }).state;
current = Session.cardRendered(current, 'patru', { now: 0, visible: true });
gated = Session.beforeAnswer(current, 'patru', { now: 301_000, visible: true });
assert.equal(gated.allowed, true);
result = Session.commitAnswer(gated.state, 'patru', 'known', { now: 301_000 });
current = result.state;
assert.equal(current.completedCount, 1);
assert.equal(current.status, Session.STATUSES.PAUSED);
gated = Session.beforeAnswer(current, 'cinci', { now: 302_000, visible: true });
assert.equal(gated.allowed, false);
assert.equal(gated.reason, 'budget-reached');

// Continue adds a fresh budget without clearing current results or the review backlog.
const previousBudget = current.budgetMs;
current = Session.extend(current, { now: 303_000, minutes: 10, samples: [] }).state;
assert.equal(current.status, Session.STATUSES.ACTIVE);
assert.equal(current.completedCount, 1);
assert.equal(current.budgetMs, previousBudget + 10 * 60 * 1000 + 1000);
assert.equal(Session.getView(current, { now: 303_000, remainingReviewCount: 17 }).remainingReviewCount, 17);

// Undo removes the associated answer/sample statistic and decrements this-session completion.
current = Session.cardRendered(current, 'șase', { now: 304_000, visible: true });
gated = Session.beforeAnswer(current, 'șase', { now: 310_000, visible: true });
result = Session.commitAnswer(gated.state, 'șase', 'fuzzy', { now: 310_000 });
current = result.state;
assert.equal(current.completedCount, 2);
const undone = Session.undoLastAnswer(current, { now: 311_000, entryId: result.entry.id });
assert.equal(undone.removed.id, result.entry.id);
assert.equal(undone.state.completedCount, 1);

// Reload recovery never counts closed-tab wall time, and state remains user/date scoped.
const stored = { ...current, activeStartedAt: 310_000 };
const storageSnapshot = Session.snapshotForStorage(stored, { now: 315_000 });
assert.equal(storageSnapshot.activeStartedAt, null);
assert.equal(storageSnapshot.activeElapsedMs, current.activeElapsedMs + 5000);
const recovered = Session.normalizeState(stored, {
  userId: 'u1', dateKey: '2026-09-07', now: 999_000, resumeFromStorage: true
});
assert.equal(recovered.activeStartedAt, null);
assert.equal(recovered.userId, 'u1');
assert.equal(recovered.dateKey, '2026-09-07');

console.log('study-session verification passed');
