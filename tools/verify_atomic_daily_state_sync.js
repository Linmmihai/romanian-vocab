const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const apiSource = fs.readFileSync(path.join(root, 'api.js'), 'utf8');
const sql = fs.readFileSync(path.join(root, 'tools', 'atomic_daily_state_sync.sql'), 'utf8');

const storage = new Map();
const localStorage = {
  get length() { return storage.size; },
  key(index) { return [...storage.keys()][index] ?? null; },
  getItem(key) { return storage.get(key) ?? null; },
  setItem(key, value) { storage.set(key, String(value)); },
  removeItem(key) { storage.delete(key); }
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
vm.runInContext(`${apiSource}\n;globalThis.__dailyAtomic = {
  applyDailyQueueEventLocally,
  applyDailyLogEventLocally,
  createDailyStateEvent,
  readPendingDailyEvents,
  readPendingDailyEventsThrough,
  writeProgressEventJournal,
  readProgressEventJournal
};`, sandbox);

const {
  applyDailyQueueEventLocally,
  applyDailyLogEventLocally,
  createDailyStateEvent,
  readPendingDailyEvents,
  readPendingDailyEventsThrough,
  writeProgressEventJournal,
  readProgressEventJournal
} = sandbox.__dailyAtomic;

const baseQueue = {
  goal: 30,
  word_id: [1, 2, 3],
  word_ro: ['unu', 'doi', 'trei'],
  completed_word_id: [],
  completed_word_ro: [],
  introduced_word_id: [],
  introduced_word_ro: [],
  completed: false
};
const deviceAQueue = {
  ...baseQueue,
  word_id: [2, 3],
  word_ro: ['doi', 'trei'],
  completed_word_id: [1],
  completed_word_ro: ['unu'],
  updated_at: '2099-01-01T00:00:00.000Z'
};
const deviceBQueue = {
  ...baseQueue,
  word_id: [1, 3],
  word_ro: ['unu', 'trei'],
  completed_word_id: [2],
  completed_word_ro: ['doi'],
  updated_at: '1999-01-01T00:00:00.000Z'
};
const baseLog = { new_words: 30, goal: 30, completed: true };
const deviceALog = { new_words: 31, goal: 30, completed: true };
const deviceBLog = { new_words: 31, goal: 30, completed: true };

let cloudQueue = applyDailyQueueEventLocally(baseQueue, baseQueue, deviceAQueue);
let cloudLog = applyDailyLogEventLocally(baseLog, baseLog, deviceALog);
cloudQueue = applyDailyQueueEventLocally(cloudQueue, baseQueue, deviceBQueue);
cloudLog = applyDailyLogEventLocally(cloudLog, baseLog, deviceBLog);

assert.deepStrictEqual([...cloudQueue.completed_word_id].sort((a, b) => a - b), [1, 2], 'same-base completions from both devices must survive');
assert.deepStrictEqual([...cloudQueue.word_id], [3], 'completed cards must be removed without losing the remaining open card');
assert.strictEqual(cloudLog.new_words, 32, 'same-base +1 count deltas must add instead of last-write-winning at 31');
assert.strictEqual(cloudQueue.goal, 30, 'client timestamps must have no authority over daily state');

const undoAQueue = baseQueue;
const undoALog = baseLog;
cloudQueue = applyDailyQueueEventLocally(cloudQueue, deviceAQueue, undoAQueue);
cloudLog = applyDailyLogEventLocally(cloudLog, deviceALog, undoALog);
assert.deepStrictEqual([...cloudQueue.completed_word_id], [2], 'undo must remove only its own completion delta');
assert.deepStrictEqual([...cloudQueue.word_id], [1, 3], 'undo must reopen only the reverted card');
assert.strictEqual(cloudLog.new_words, 31, 'undo must subtract exactly one completed task');

const firstEvent = createDailyStateEvent('cross-tab-user', '2026-08-04', 'queue', baseQueue, deviceAQueue);
const secondEvent = createDailyStateEvent('cross-tab-user', '2026-08-04', 'queue', baseQueue, deviceBQueue);
assert(firstEvent.ok && secondEvent.ok, 'daily events must be durably journaled before network I/O');
assert.strictEqual(readPendingDailyEvents('cross-tab-user').length, 2, 'independent writes must use unique storage keys instead of overwriting one localStorage map');
assert.deepStrictEqual(
  [...readPendingDailyEventsThrough('cross-tab-user', secondEvent.event)].map(event => event.clientSeq),
  [firstEvent.event.clientSeq, secondEvent.event.clientSeq],
  'sending sequence N must drain every durable same-client predecessor first'
);

const progressA = { eventId: 'progress-event-a', occurredAt: '2026-08-04T10:00:00.000Z', base: {}, target: { qt: 1 } };
const progressB = { eventId: 'progress-event-b', occurredAt: '2026-08-04T10:00:01.000Z', base: {}, target: { qt: 1 } };
assert(writeProgressEventJournal('cross-tab-user', 1, 'unu', progressA, { qt: 1 }).ok);
assert(writeProgressEventJournal('cross-tab-user', 2, 'doi', progressB, { qt: 1 }).ok);
assert.strictEqual(readProgressEventJournal('cross-tab-user').length, 2, 'progress events from separate tabs must not share one overwrite-prone storage key');

assert(apiSource.includes("db: { retry: false }"), 'opaque Supabase POST retries must be disabled');
assert(apiSource.includes("request.abortSignal(controller.signal)"), 'Supabase timeouts must abort the underlying request');
assert(apiSource.includes("sb.rpc('apply_daily_state_sync_event'"), 'daily writes must use the atomic RPC');
assert(!apiSource.includes("from('daily_queue').upsert"), 'daily queue snapshots must never be unconditionally upserted');
assert(!apiSource.includes("from('daily_log').upsert"), 'daily log snapshots must never be unconditionally upserted');
assert(!apiSource.includes('selectLatestDailyPayload'), 'client timestamps must not choose authoritative daily state');
assert(apiSource.includes('const dailyStateSyncChains = new Map()'), 'same-client daily requests must be serialized');
assert(apiSource.includes('function syncPendingDailyEventsThrough'), 'a later daily event must replay every failed same-client predecessor first');
assert(apiSource.includes('Number(event.clientSeq || 0) <= requestedSequence'), 'daily prefix replay must include all earlier durable client sequences');

assert(sql.includes('primary key (user_id, event_id)'), 'daily event idempotency must be enforced in PostgreSQL');
assert(sql.includes('for update;'), 'daily rows and client sequence must be locked before applying an event');
assert(sql.includes('v_new_words + v_log_delta'), 'daily counts must be applied as atomic deltas');
assert(sql.includes('public.daily_state_apply_int_delta'), 'queue memberships must be applied as set deltas');
assert(sql.includes('if p_client_seq <= v_last_seq then'), 'late same-client requests must be ignored');
assert(sql.includes('if p_client_seq <> v_last_seq + 1 then'), 'the server must reject a client sequence gap that would lose an earlier delta');
assert(sql.includes('security invoker'), 'daily sync must honor caller RLS');
assert(sql.includes("revoke all on function public.apply_daily_state_sync_event"), 'the RPC must not be executable by anon/public');

console.log('atomic daily state synchronization verification passed');
