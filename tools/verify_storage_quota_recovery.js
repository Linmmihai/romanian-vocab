const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const apiSource = fs.readFileSync(path.join(__dirname, '..', 'api.js'), 'utf8');
const storage = new Map([
  ['words_cache:obsolete-build', 'x'.repeat(700)],
  ['progress:online-user', 'p'.repeat(250)]
]);
let quota = 1000;
const used = () => [...storage.entries()].reduce((sum, [key, value]) => sum + key.length + value.length, 0);
const quotaError = () => Object.assign(new Error('storage full'), { name: 'QuotaExceededError', code: 22 });
const localStorage = {
  get length() { return storage.size; },
  key(index) { return [...storage.keys()][index] ?? null; },
  getItem(key) { return storage.get(key) ?? null; },
  removeItem(key) { storage.delete(key); },
  setItem(key, value) {
    const next = String(value);
    const existingSize = storage.has(key) ? key.length + storage.get(key).length : 0;
    if (used() - existingSize + key.length + next.length > quota) throw quotaError();
    storage.set(key, next);
  }
};

const sandbox = {
  console,
  Date,
  Error,
  Promise,
  Math,
  Map,
  Set,
  AbortController,
  setTimeout,
  clearTimeout,
  localStorage,
  currentUser: null,
  window: { RomanianVocabTaxonomy: {} }
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(`${apiSource}\n;globalThis.__quotaRecovery = { writeLocalStorageString };`, sandbox);

assert.strictEqual(storage.has('words_cache:obsolete-build'), false, 'startup must remove oversized legacy vocabulary caches');
sandbox.__quotaRecovery.writeLocalStorageString('daily_state_pending:online-user', 'd'.repeat(400));
assert.strictEqual(storage.has('daily_state_pending:online-user'), true, 'critical daily outbox data must use reclaimed cache capacity');

storage.clear();
quota = 600;
storage.set('progress:online-user', 'p'.repeat(500));
sandbox.__quotaRecovery.writeLocalStorageString('progress_pending_event:online-user:event-1', 'e'.repeat(250));
assert.strictEqual(storage.has('progress:online-user'), false, 'an online cloud mirror may be evicted when the durable outbox needs space');
assert.strictEqual(storage.has('progress_pending_event:online-user:event-1'), true, 'the durable progress event must survive quota recovery');

console.log('storage quota recovery verification passed');
