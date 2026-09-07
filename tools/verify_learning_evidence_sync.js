const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const evidence = require('../learning-evidence');

const sql = fs.readFileSync(path.join(__dirname, 'learning_evidence_sync.sql'), 'utf8');

assert.match(sql, /primary key \(user_id, event_id\)/i, 'event idempotency must be scoped to one user');
assert.match(sql, /enable row level security/i, 'the evidence table must enable RLS');
assert.match(sql, /using \(\(select auth\.uid\(\)\) = user_id\)/i, 'reads must be limited to the authenticated user');
assert.match(sql, /v_user_id uuid := auth\.uid\(\)/i, 'the RPC must derive user_id from authentication');
assert.match(sql, /security definer[\s\S]*set search_path = ''/i, 'the write-only RPC must use a fixed empty search_path');
assert.match(sql, /jsonb_array_length\(p_events\) > 200/i, 'one outbox batch must be capped at 200 items');
assert.match(sql, /on conflict \(user_id, event_id\) do nothing/i, 'event retries must not replace the original event');
assert.match(sql, /deleted_at = coalesce\([\s\S]*deleted_at[\s\S]*excluded\.deleted_at/i,
  'a tombstone update must never clear the existing deletion');
assert.match(sql, /revoke all on table public\.learning_evidence_events from authenticated/i,
  'clients must not bypass the RPC with direct table writes');
assert.match(sql, /grant select on table public\.learning_evidence_events to authenticated/i,
  'clients need RLS-protected paginated reads');
assert.doesNotMatch(sql, /grant\s+(insert|update|delete|all)[^;]*learning_evidence_events\s+to authenticated/i,
  'authenticated users must not receive direct write grants');
assert.match(sql, /revoke all on function public\.apply_learning_evidence_batch\(jsonb\) from anon/i,
  'anonymous callers must not execute the RPC');
assert.match(sql, /'payload', v_row\.payload/i, 'RPC acknowledgements must return the canonical stored payload');
assert.doesNotMatch(sql, /DEFAULT_EVENT_LIMIT|slice\(-500\)|events\s*:\s*merged/i,
  'the RPC must accept individual events, not copy a per-word 500-event history');

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

class EvidenceStore {
  constructor() {
    this.rows = new Map();
    this.clock = 0;
  }

  applyBatch(userId, entries) {
    if (!userId) throw new Error('Authentication required');
    if (!Array.isArray(entries) || entries.length < 1 || entries.length > 200) {
      throw new Error('Learning evidence batch size must be between 1 and 200');
    }
    return {
      results: entries.map(entry => {
        const key = `${userId}\0${entry.event_id}`;
        const existing = this.rows.get(key);
        if (entry.deleted === true) {
          if (!existing) {
            this.rows.set(key, {
              event_id: entry.event_id, word_id: null, word_ro: null, payload: null,
              deleted: true, changed_at: ++this.clock
            });
          } else if (!existing.deleted) {
            existing.deleted = true;
            existing.changed_at = ++this.clock;
          }
        } else if (!existing) {
          assert.equal(entry.payload.id, entry.event_id);
          assert.ok(entry.word_id || entry.word_ro);
          this.rows.set(key, {
            event_id: entry.event_id,
            word_id: entry.word_id ?? entry.payload.wordId ?? null,
            word_ro: entry.word_ro ?? entry.payload.wordRo ?? null,
            payload: clone(entry.payload),
            deleted: false,
            changed_at: ++this.clock
          });
        }
        return clone(this.rows.get(key));
      })
    };
  }

  readOwn(userId, requestedUserId = userId) {
    if (userId !== requestedUserId) return [];
    const prefix = `${userId}\0`;
    return [...this.rows.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([, row]) => clone(row))
      .sort((left, right) => left.event_id.localeCompare(right.event_id));
  }
}

const canonical = evidence.buildEvidence({}, 'quiz_correct', {
  eventId: 'evidence-sync-primary',
  at: '2026-09-07T01:02:03.000Z',
  date: '2026-09-07',
  wordId: 42,
  wordRo: 'mână',
  exerciseType: 'dictation',
  promptMode: 'audio-to-text',
  correct: true,
  spellingExact: true,
  listeningCorrect: true,
  responseMs: 900
}).events[0];

const store = new EvidenceStore();
const first = store.applyBatch('user-a', [{
  event_id: canonical.id,
  word_id: 42,
  word_ro: 'mână',
  payload: canonical
}]);
assert.equal(first.results[0].deleted, false);
assert.deepEqual(first.results[0].payload, canonical);

const conflictingRetry = store.applyBatch('user-a', [{
  event_id: canonical.id,
  word_id: 999,
  payload: { ...canonical, interaction: 'stale_retry_must_not_replace' }
}]);
assert.equal(conflictingRetry.results[0].word_id, 42, 'the first accepted identity must remain canonical');
assert.equal(conflictingRetry.results[0].payload.interaction, 'quiz_correct', 'a retry must not replace stored evidence');

const removed = store.applyBatch('user-a', [{ event_id: canonical.id, deleted: true }]);
assert.equal(removed.results[0].deleted, true);
const replayAfterRemoval = store.applyBatch('user-a', [{
  event_id: canonical.id,
  word_id: 42,
  word_ro: 'mână',
  payload: canonical
}]);
assert.equal(replayAfterRemoval.results[0].deleted, true, 'an offline replay must not revive a removed event');
assert.equal(replayAfterRemoval.results[0].payload.interaction, 'quiz_correct', 'deletion may retain its audit payload');

const earlyRemoval = store.applyBatch('user-a', [{ event_id: 'evidence-sync-before-create', deleted: true }]);
assert.equal(earlyRemoval.results[0].payload, null);
const lateCreate = store.applyBatch('user-a', [{
  event_id: 'evidence-sync-before-create',
  word_ro: 'acasă',
  payload: { ...canonical, id: 'evidence-sync-before-create', wordId: undefined, wordRo: 'acasă' }
}]);
assert.equal(lateCreate.results[0].deleted, true, 'delete-before-create ordering must converge to deleted');
assert.equal(lateCreate.results[0].payload, null, 'a late create must not fill or revive a prior tombstone');

const otherUser = store.applyBatch('user-b', [{
  event_id: canonical.id,
  word_id: 42,
  payload: canonical
}]);
assert.equal(otherUser.results[0].deleted, false, 'event ids must be independent between users');
assert.equal(store.readOwn('user-b').length, 1);
assert.equal(store.readOwn('user-b', 'user-a').length, 0, 'one user must not read another user\'s rows');
assert.deepEqual(
  store.readOwn('user-a').map(row => row.event_id),
  ['evidence-sync-before-create', 'evidence-sync-primary'],
  'event_id ordering must provide stable full pagination'
);

assert.throws(() => store.applyBatch(null, [{ event_id: 'x', deleted: true }]), /Authentication required/);
assert.throws(() => store.applyBatch('user-a', []), /between 1 and 200/);
assert.throws(() => store.applyBatch('user-a', Array.from({ length: 201 }, (_, index) => ({
  event_id: `too-many-${index}`, deleted: true
}))), /between 1 and 200/);

console.log('learning evidence sync verification passed');
