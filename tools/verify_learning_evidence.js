const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const evidence = require('../learning-evidence');

const first = evidence.buildEvidence({ source: 'kept' }, 'quiz_correct', {
  eventId: 'evt-1',
  at: '2026-09-07T01:02:03.000Z',
  date: '2026-09-07',
  wordId: 42,
  wordRo: 'mână',
  exerciseType: 'dictation',
  promptMode: 'audio-to-text',
  correct: true,
  exact: false,
  spellingExact: false,
  listeningCorrect: true,
  responseMs: 1234
});
assert.equal(first.source, 'kept');
assert.deepEqual(first.events[0], {
  id: 'evt-1',
  at: '2026-09-07T01:02:03.000Z',
  date: '2026-09-07',
  interaction: 'quiz_correct',
  wordId: 42,
  wordRo: 'mână',
  exerciseType: 'dictation',
  promptMode: 'audio-to-text',
  correct: true,
  exact: false,
  spellingExact: false,
  listeningCorrect: true,
  responseMs: 1234,
  dueReview: false,
  firstAttempt: true
});

const repeated = evidence.buildEvidence(first, 'quiz_correct', {
  eventId: 'evt-2', at: '2026-09-07T02:02:03.000Z', date: '2026-09-07',
  exerciseType: 'dictation', promptMode: 'audio-to-text', correct: true
});
assert.equal(repeated.events[1].firstAttempt, false);
const replayed = evidence.buildEvidence(first, 'quiz_correct', {
  eventId: 'evt-1', at: '2026-09-07T01:02:03.000Z', date: '2026-09-07',
  exerciseType: 'dictation', promptMode: 'audio-to-text', correct: true
});
assert.equal(replayed.events.length, 1);
assert.equal(replayed.events[0].firstAttempt, true);
const nullTiming = evidence.buildEvidence({}, 'quiz_wrong', {
  eventId: 'no-timing', at: '2026-09-07T02:03:00.000Z', exerciseType: 'translation', responseMs: null
});
assert.equal(Object.hasOwn(nullTiming.events[0], 'responseMs'), false);
const cardPrompt = evidence.buildEvidence({}, 'flashcard_known', {
  eventId: 'card-prompt', at: '2026-09-07T02:04:00.000Z', correct: true
});
assert.equal(cardPrompt.events[0].promptMode, 'meaning-to-form-card');

const merged = evidence.mergeEvidence(
  { leftOnly: 1, events: [{ id: 'shared', at: '2026-09-07T03:00:00Z', exact: false }] },
  { rightOnly: 2, events: [{ id: 'older', at: '2026-09-07T01:00:00Z' }, { id: 'shared', at: '2026-09-07T03:00:00Z', exact: true }] }
);
assert.equal(merged.leftOnly, 1);
assert.equal(merged.rightOnly, 2);
assert.deepEqual(merged.events.map(event => event.id), ['older', 'shared']);
assert.equal(merged.events[1].exact, true);

let bounded = {};
for (let index = 0; index < 510; index++) {
  bounded = evidence.buildEvidence(bounded, 'quiz_correct', {
    eventId: `bounded-${index}`,
    at: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
    exerciseType: 'translation',
    correct: true
  });
}
assert.equal(bounded.events.length, 500);
assert.equal(bounded.events[0].id, 'bounded-10');

assert.equal(evidence.isActiveRecall({ exerciseType: 'translation' }), false);
assert.equal(evidence.isActiveRecall({ exerciseType: 'listening' }), false);
assert.equal(evidence.isActiveRecall({ exerciseType: 'dictation' }), false);
assert.equal(evidence.isActiveRecall({ exerciseType: 'nounPlural' }), false);
assert.equal(evidence.isActiveRecall({ exerciseType: 'futureExercise' }), false);
assert.equal(evidence.isActiveRecall({}), true);
assert.equal(evidence.isGrammarExercise({ exerciseType: 'dictation' }), false);
assert.equal(evidence.isGrammarExercise({ exerciseType: 'verbConj' }), true);

const emptySummary = evidence.summarizeEvidence([]);
assert.equal(emptySummary.listening.accuracy, null);
assert.equal(emptySummary.spelling.accuracy, null);
assert.equal(emptySummary.dueReviewFirstAttempt.accuracy, null);
const summary = evidence.summarizeEvidence([{ events: [
  { id: 'a', wordId: 1, date: '2026-09-07', exerciseType: 'dictation', promptMode: 'audio-to-text', correct: true, listeningCorrect: true, spellingExact: false, dueReview: false },
  { id: 'b', at: '2026-09-07T01:00:00Z', wordId: 2, date: '2026-09-07', exerciseType: 'activeRecall', promptMode: 'card', correct: false, dueReview: true, firstAttempt: true },
  { id: 'c', at: '2026-09-07T02:00:00Z', wordId: 2, date: '2026-09-07', exerciseType: 'activeRecall', promptMode: 'card', correct: true, dueReview: true, firstAttempt: false },
  { id: 'c', at: '2026-09-07T02:00:00Z', wordId: 2, date: '2026-09-07', exerciseType: 'activeRecall', promptMode: 'card', correct: true, dueReview: true, firstAttempt: false },
  { id: 'd', at: '2026-09-07T03:00:00Z', wordId: 3, date: '2026-09-07', exerciseType: 'activeRecall', promptMode: 'card', correct: true, dueReview: true, firstAttempt: false }
] }]);
assert.deepEqual(summary.listening, { total: 1, correct: 1, accuracy: 1 });
assert.deepEqual(summary.spelling, { total: 1, correct: 0, accuracy: 0 });
assert.deepEqual(summary.dueReviewFirstAttempt, { total: 1, correct: 0, accuracy: 0 });

const crossDeviceEvents = Array.from({ length: 1501 }, (_, index) => ({
  id: `device-event-${index}`, wordId: index % 10,
  at: new Date(Date.UTC(2026, 8, 7, 0, 0, index)).toISOString(),
  exerciseType: 'translation', correct: index % 2 === 0
}));
const wholeBook = evidence.summarizeEvidence([...crossDeviceEvents, ...crossDeviceEvents.slice(0, 20)]);
assert.equal(wholeBook.total, 1501, 'whole-book summaries must not truncate at a per-word limit');
assert.equal(wholeBook.byExerciseType.translation.correct, 751);

const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
assert(app.includes("exerciseType: 'dictation'"), 'dictation evidence must keep its own exercise type');
assert(app.includes('spellingExact: result.exact'), 'dictation must persist spelling correctness separately');
assert(app.includes('listeningCorrect: result.listeningCorrect'), 'dictation must persist listening correctness separately');
assert(app.includes('if (!coreMemory)'), 'non-active exercises need an isolated progress branch');

console.log('learning evidence checks passed');
