const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const apiPath = path.join(__dirname, '..', 'api.js');
const apiSource = fs.readFileSync(apiPath, 'utf8');
const storage = new Map();
const sandbox = {
  console,
  Date,
  Error,
  Promise,
  setTimeout,
  clearTimeout,
  window: { RomanianVocabTaxonomy: {} },
  localStorage: {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: key => storage.delete(key)
  },
  currentUser: null
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(`${apiSource}\n;globalThis.__dailyMergeTest = { mergeDailyQueuePayload, mergeDailyLogPayload };`, sandbox);

const { mergeDailyQueuePayload, mergeDailyLogPayload } = sandbox.__dailyMergeTest;
const older = '2026-08-03T10:00:00.000Z';
const newer = '2026-08-03T10:05:00.000Z';

{
  const cloud = {
    goal: 200,
    word_id: [1, 2, 3],
    word_ro: ['unu', 'doi', 'trei'],
    completed_word_id: [1],
    completed_word_ro: ['unu'],
    introduced_word_id: [9],
    introduced_word_ro: ['nouă'],
    completed: false,
    updated_at: older
  };
  const local = {
    goal: 30,
    word_id: [2],
    word_ro: ['doi'],
    completed_word_id: [1, 3],
    completed_word_ro: ['unu', 'trei'],
    introduced_word_id: [10],
    introduced_word_ro: ['zece'],
    completed: true,
    updated_at: newer
  };
  const merged = mergeDailyQueuePayload(local, cloud);
  assert.strictEqual(merged.goal, 30, 'newer lower goal must replace an obsolete larger goal');
  assert.deepStrictEqual([...merged.word_id], [2], 'stale cloud open cards must not be unioned into the current queue');
  assert.deepStrictEqual([...merged.completed_word_id], [1, 3], 'completed cards remain monotonic across devices');
  assert.deepStrictEqual([...merged.introduced_word_id], [9, 10], 'new-card introductions must merge across devices');
  assert.strictEqual(merged.completed, true, 'check-in completion must remain monotonic');
}

{
  const merged = mergeDailyLogPayload(
    { new_words: 30, goal: 30, completed: true, updated_at: newer },
    { new_words: 28, goal: 200, completed: false, updated_at: older },
    30
  );
  assert.strictEqual(merged.new_words, 30, 'daily completion count must preserve the strongest evidence');
  assert.strictEqual(merged.goal, 30, 'daily log must use the newest goal instead of the largest goal');
  assert.strictEqual(merged.completed, true, 'daily check-in must survive an older device write');
}

console.log('daily state merge verification passed');
