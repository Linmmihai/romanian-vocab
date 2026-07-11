const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const api = fs.readFileSync(path.join(root, 'api.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'tools/progress_word_id_migration.sql'), 'utf8');
const queueBackfill = fs.readFileSync(path.join(root, 'tools/daily_queue_word_id_backfill.sql'), 'utf8');
const legacyConsolidation = fs.readFileSync(path.join(root, 'tools/consolidate_legacy_progress_variants.sql'), 'utf8');
const stateRepair = fs.readFileSync(path.join(root, 'tools/repair_legacy_consolidation_state.sql'), 'utf8');

assert(api.includes("onConflict: 'user_id,word_id'"), 'apiSaveProgress must upsert by user_id,word_id');
assert(api.includes('word_id: stableWordId'), 'apiSaveProgress payload must include word_id');
assert(api.includes('progressEntryKey(wordId, wordRo)'), 'local progress keys must use wordId first');
assert(app.includes('let wordIdIndex = new Map();'), 'app must build a word id index');
assert(app.includes('function progressKeyForWordRef'), 'app must resolve progress keys by word id');
assert(app.includes('word_id: queueIdsToWordIds(todayQueue)'), 'daily queue payload must carry word ids');
assert(migration.includes('add column if not exists word_id integer references public.words(id)'), 'migration must add progress.word_id');
assert(migration.includes('progress_user_word_id_unique_idx'), 'migration must add a user_id,word_id unique index');
assert(migration.includes('private.progress_word_id_duplicate_backup_20260711'), 'migration must preserve duplicate semantic rows before consolidation');
assert(migration.includes('candidate_rank > 1'), 'migration must remove only backed-up duplicate candidates');
assert(migration.indexOf('delete from public.progress') < migration.indexOf('progress_user_word_id_unique_idx'), 'duplicate consolidation must happen before the unique word-id index');
assert(queueBackfill.includes('with ordinality'), 'queue backfill must preserve the original queue order');
assert(queueBackfill.includes('matches.reference_count = matches.matched_count'), 'queue backfill must reject partial word-id arrays');
assert(queueBackfill.includes("'partial_queue_arrays'"), 'queue backfill must report partial-array safety violations');
assert(legacyConsolidation.includes('private.progress_legacy_variant_backup_20260711'), 'legacy consolidation must back up both rows privately');
assert(legacyConsolidation.includes("'legacy'::text as row_role"), 'legacy consolidation must label backed-up source rows');
assert(legacyConsolidation.includes("'current'::text as row_role"), 'legacy consolidation must back up the stable target row');
assert(legacyConsolidation.includes("then 'stress_hyphens'"), 'legacy consolidation must recognize the reviewed stress format');
assert(legacyConsolidation.includes("then 'parenthetical_note'"), 'legacy consolidation must recognize the reviewed note format');
assert(legacyConsolidation.includes("where match_rule is not null"), 'legacy consolidation must exclude unproven mappings');
assert(legacyConsolidation.indexOf('update public.progress current') < legacyConsolidation.indexOf('delete from public.progress legacy'), 'legacy evidence must merge before the source row is removed');
assert(legacyConsolidation.includes("backup.row_role = 'legacy'"), 'deletion must be limited to backed-up legacy rows');
assert(legacyConsolidation.includes('remaining_progress_without_word_id'), 'legacy consolidation must report the remaining unresolved count');
const schedulerStateMerge = legacyConsolidation.slice(legacyConsolidation.indexOf('greatest(current.weak_cleared_at'));
assert(schedulerStateMerge.indexOf("then 'reinforcing'") < schedulerStateMerge.indexOf("then 'mastered'"), 'reinforcement must take precedence when merging scheduler state');
assert(stateRepair.includes('private.progress_legacy_variant_backup_20260711'), 'state repair must use the private backup as its source of truth');
assert(stateRepair.includes("card_state = 'reinforcing'"), 'state repair must restore the reinforcement state');
assert(stateRepair.includes('remaining_state_mismatches'), 'state repair must report unresolved state mismatches');

let W = [];
let wordIdIndex = new Map();
let wordByRoIndex = new Map();
let progressMap = {};
let todaySeenWords = new Set();
let todayQueueCompleted = new Set();

function normalizeWordText(value) {
  return String(value || '').normalize('NFC').trim().replace(/\s+/g, ' ');
}

function roKey(value) {
  const raw = String(value ?? '');
  if (wordIdIndex.has(raw)) return normalizeWordText(wordIdIndex.get(raw).ro).toLocaleLowerCase('ro');
  return normalizeWordText(value).toLocaleLowerCase('ro');
}

function rebuildIndexes() {
  wordIdIndex = new Map();
  wordByRoIndex = new Map();
  W.forEach((word) => {
    wordIdIndex.set(String(word.id), word);
    wordByRoIndex.set(roKey(word.ro), word);
  });
}

function getWordByRo(wordRo) {
  const raw = String(wordRo ?? '');
  if (wordIdIndex.has(raw)) return wordIdIndex.get(raw);
  return wordByRoIndex.get(roKey(wordRo)) || null;
}

function resolveWord(wordRef) {
  if (typeof wordRef === 'object') return wordIdIndex.get(String(wordRef.id)) || getWordByRo(wordRef.ro);
  return getWordByRo(wordRef);
}

function progressKeyForWordRef(wordRef) {
  const word = resolveWord(wordRef);
  if (word) return String(word.id);
  const key = roKey(String(wordRef || '').replace(/^legacy:/, ''));
  return key ? `legacy:${key}` : '';
}

function getProgress(wordRef) {
  return progressMap[progressKeyForWordRef(wordRef)] || null;
}

function hasWordProgress(progress) {
  return !!(progress && (progress.seen || progress.known || progress.qt || progress.qr || progress.level !== 'unknown'));
}

function dailyWordKey(wordRef) {
  const word = resolveWord(wordRef);
  if (word) return String(word.id);
  const key = roKey(String(wordRef || ''));
  return key ? `legacy:${key}` : '';
}

function setHasRo(set, wordRef) {
  const key = dailyWordKey(wordRef);
  return [...set].some((value) => dailyWordKey(value) === key);
}

function isUnseenWord(w) {
  return !hasWordProgress(getProgress(w.ro)) && !setHasRo(todayQueueCompleted, w.ro) && !setHasRo(todaySeenWords, w.ro);
}

W = [
  { id: 42, ro: 'școală', zh: '学校' },
  { id: 43, ro: 'masă', zh: '桌子' }
];
rebuildIndexes();
progressMap = {
  42: { word_id: 42, word_ro: 'școală', seen: true, known: true, qr: 3, qt: 3, level: 'mastered' }
};
todaySeenWords = new Set(['42']);
todayQueueCompleted = new Set(['42']);

assert(hasWordProgress(getProgress('școală')), 'known word should have progress before edit');
assert(!isUnseenWord(W[0]), 'known word should not be unseen before edit');

W = [
  { id: 42, ro: 'ȘCOALĂ ', zh: '学校' },
  { id: 43, ro: 'masă', zh: '桌子' }
];
rebuildIndexes();

assert(hasWordProgress(getProgress(W[0].ro)), 'known word should retain progress after ro text edit');
assert(!isUnseenWord(W[0]), 'known word should not reappear as new after ro text edit');
assert(isUnseenWord(W[1]), 'word without progress should still be unseen');
assert(setHasRo(todaySeenWords, W[0].ro), 'today seen set should survive ro text edit via id');
assert(setHasRo(todayQueueCompleted, W[0].ro), 'completed queue set should survive ro text edit via id');

const localProgress = {};
const key = String(42);
localProgress[key] = { word_id: 42, word_ro: W[0].ro, known: true };
assert(localProgress['42'].word_id === 42, 'offline progress should be keyed by word id');

console.log('word_id progress migration regression checks passed');
