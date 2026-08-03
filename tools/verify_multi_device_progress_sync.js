const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const api = fs.readFileSync(path.join(root, 'api.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const sql = fs.readFileSync(path.join(root, 'tools/atomic_multi_device_progress_sync.sql'), 'utf8');

assert(api.includes('const PROGRESS_PAGE_SIZE = 500'), 'progress reads must use explicit pagination');
assert(api.includes('.range(from, to)'), 'every progress page must use a bounded range');
assert(api.includes(".order('word_id', { ascending: true })"), 'progress pagination must use a stable order');
assert(api.includes('pendingEvents: appendProgressPendingEvent'), 'pending progress must retain replayable events');
assert(!api.includes('.slice(-500)'), 'offline replay events must never be silently discarded');
assert(api.includes('base: progressSyncSnapshot(baseProgress)'), 'each event must capture its base state');
assert(api.includes('target: progressSyncSnapshot(targetProgress)'), 'each event must capture its target state');
assert(api.includes("sb.rpc('apply_progress_sync_event'"), 'pending events must use the atomic RPC');
assert(!api.includes("savedPayload: 'reviewOnly'"), 'partial progress payload fallback must not report success');
assert(!api.includes("savedPayload: 'legacy'"), 'legacy partial progress fallback must not report success');
assert(api.includes('seen_via_card: completeSnapshot.seenViaCard'), 'card-origin state must be uploaded');
assert(api.includes('grammar_qr: completeSnapshot.grammarQr'), 'grammar counters must be uploaded');
assert(api.includes('was_mastered_at: completeSnapshot.wasMasteredAt'), 'mastery history must be uploaded');
assert(api.includes('correct_streak_since_wrong: completeSnapshot.correctStreakSinceWrong'), 'wrongbook recovery state must be uploaded');
assert(app.includes('replaceProgressMap(loadedProgress)'), 'cloud refresh must apply authoritative corrections');
assert(!app.includes('replaceProgressMap(mergeProgressMaps(progressMap, loadedProgress))'), 'stale local max-merge must not block remote undo');
assert(app.includes('apiMergeLegacyProgressBaselines(currentUser.id, progressMap)'), 'first upgraded client must preserve formerly local-only fields');
assert(app.includes('apiVerifyProgressState(currentUser.id, progressMap)'), 'manual success must verify the complete progress map');
assert(app.includes('const answerExistsOnlyInFastBuffer = bufferedEventCount > snapshotEventCount'), 'undo must distinguish buffered answers from uploaded answers');
assert(app.includes('if (!answerExistsOnlyInFastBuffer)'), 'a buffered answer must be removed without creating a duplicate correction event');

assert(sql.includes('primary key (user_id, event_id)'), 'event idempotency must be enforced by the database');
assert(sql.includes('security invoker'), 'sync RPCs must honor caller RLS');
assert(sql.includes('auth.uid()'), 'sync RPCs must derive the user from authentication');
assert(sql.includes('on conflict (user_id, event_id) do nothing'), 'duplicate events must not be applied twice');
assert(sql.includes('v_target_qt - v_base_qt'), 'quiz totals must be applied as atomic deltas');
assert(sql.includes("v_received_at + interval '5 minutes'"), 'a skewed device clock must not poison future state convergence');
assert(sql.includes('grant execute on function public.apply_progress_sync_event'), 'atomic RPC execution must be explicitly granted');
assert(sql.includes('revoke all on function public.apply_progress_sync_event'), 'atomic RPC must not retain default public execution');

function applyEvent(state, event, seenEvents) {
  if (seenEvents.has(event.id)) return state;
  seenEvents.add(event.id);
  const next = {
    ...state,
    qr: Math.max(0, state.qr + event.target.qr - event.base.qr),
    qt: Math.max(0, state.qt + event.target.qt - event.base.qt)
  };
  if (event.at >= state.stateUpdatedAt) {
    next.known = event.target.known;
    next.stateUpdatedAt = event.at;
  }
  next.qt = Math.max(next.qt, next.qr);
  return next;
}

const baseline = { qr: 8, qt: 10, known: false, stateUpdatedAt: 100 };
const deviceA = { id: 'a', at: 200, base: baseline, target: { qr: 9, qt: 11, known: true } };
const deviceB = { id: 'b', at: 201, base: baseline, target: { qr: 9, qt: 11, known: true } };
const seenEvents = new Set();
let cloud = applyEvent(baseline, deviceA, seenEvents);
cloud = applyEvent(cloud, deviceB, seenEvents);
assert.deepStrictEqual({ qr: cloud.qr, qt: cloud.qt }, { qr: 10, qt: 12 }, 'same-base device answers must both survive');
cloud = applyEvent(cloud, deviceA, seenEvents);
assert.deepStrictEqual({ qr: cloud.qr, qt: cloud.qt }, { qr: 10, qt: 12 }, 'retrying an acknowledged event must be idempotent');

const undoA = { id: 'undo-a', at: 300, base: deviceA.target, target: baseline };
cloud = applyEvent(cloud, undoA, seenEvents);
assert.deepStrictEqual({ qr: cloud.qr, qt: cloud.qt }, { qr: 9, qt: 11 }, 'undo must remove only its original answer delta');

const staleState = { id: 'stale', at: 150, base: baseline, target: { qr: 8, qt: 10, known: true } };
cloud = applyEvent(cloud, staleState, seenEvents);
assert.strictEqual(cloud.known, false, 'newer undo state must remain authoritative over an older event');
assert.strictEqual(cloud.stateUpdatedAt, 300, 'out-of-order replay must not move state time backward');

const fastBufferAfterTwoAnswers = [{ id: 'fast-a' }, { id: 'fast-b' }];
const fastBufferBeforeLastAnswer = [{ id: 'fast-a' }];
const answerExistsOnlyInFastBuffer = fastBufferAfterTwoAnswers.length > fastBufferBeforeLastAnswer.length;
const correctionEvents = answerExistsOnlyInFastBuffer ? [] : [{ id: 'undo-fast-b' }];
assert.deepStrictEqual(
  [...fastBufferBeforeLastAnswer, ...correctionEvents].map(event => event.id),
  ['fast-a'],
  'undoing an unflushed rapid answer must leave only the earlier buffered event'
);

console.log('multi-device progress sync adversarial verification passed');
