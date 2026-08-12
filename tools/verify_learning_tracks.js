const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require(path.join(__dirname, '..', 'taxonomy.js'));

const root = path.resolve(__dirname, '..');
const payload = JSON.parse(fs.readFileSync(path.join(root, 'data', 'vocab.json'), 'utf8'));
const words = Array.isArray(payload) ? payload : (payload.words || []);
const report = JSON.parse(fs.readFileSync(path.join(root, 'artifacts', 'vocab-rebuild-report-20260812.json'), 'utf8'));
const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const apiSource = fs.readFileSync(path.join(root, 'api.js'), 'utf8');
const htmlSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const schemaSource = fs.readFileSync(path.join(root, 'tools', 'vocab_learning_tracks_schema.sql'), 'utf8');
const taxonomy = globalThis.RomanianVocabTaxonomy;

const validTracks = new Set(taxonomy.LEARNING_TRACKS.map(item => item.value));
const validBooks = new Set(taxonomy.LEARNING_COLLECTIONS
  .map(item => item.value)
  .filter(value => value.startsWith('specialist_')));
const validContentStatuses = new Set(['active', 'needs_review', 'archived']);
const validNaturalnessStatuses = new Set(['verified', 'revised', 'corpus_attested', 'needs_review']);
const ids = new Set();

assert.equal(words.length, 4867, 'learning-track rebuild must preserve every stable word id');
for (const word of words) {
  assert(!ids.has(word.id), `duplicate stable id ${word.id}`);
  ids.add(word.id);
  assert(validTracks.has(word.learning_track), `invalid learning track for id ${word.id}`);
  assert(validContentStatuses.has(word.content_status), `invalid content status for id ${word.id}`);
  assert(validNaturalnessStatuses.has(word.naturalness_status), `invalid naturalness status for id ${word.id}`);
  assert(word.specialist_book == null || validBooks.has(word.specialist_book), `invalid specialist book for id ${word.id}`);
  assert(Number.isInteger(Number(word.news_frequency || 0)) && Number(word.news_frequency || 0) >= 0, `bad news frequency for id ${word.id}`);
  assert(Number.isInteger(Number(word.news_document_count || 0)) && Number(word.news_document_count || 0) >= 0, `bad news document count for id ${word.id}`);
  assert(Number.isInteger(Number(word.news_category_count || 0)) && Number(word.news_category_count || 0) >= 0, `bad news category count for id ${word.id}`);
  if (word.frequency_source) {
    assert(word.frequency_rank || word.news_document_count, `frequency source without evidence for id ${word.id}`);
  }
  if (word.learning_track === 'quarantine') {
    assert.notEqual(word.content_status, 'active', `quarantined id ${word.id} cannot enter learning queues`);
  }
}

const trackCounts = Object.fromEntries([...validTracks].map(track => [track, words.filter(word => word.learning_track === track).length]));
assert.deepEqual(trackCounts, {
  news_core: 1789,
  news_extension: 588,
  specialist: 1236,
  scenario_phrasebook: 1254,
  quarantine: 0
});
assert.deepEqual(report.trackCounts, {
  news_core: 1789,
  news_extension: 588,
  scenario_phrasebook: 1254,
  specialist: 1236
});
assert.equal(report.totalWords, words.length);
assert.equal(report.corrections.length, 81);
assert(report.corrections.every(row => row.preservedWordId), 'every Romanian correction must preserve its stable id');
assert.equal(words.filter(word => word.naturalness_status === 'corpus_attested').length, 0,
  'lemma frequency alone must never claim that a Romanian sense or example is natural');

const byId = new Map(words.map(word => [Number(word.id), word]));
const expected = new Map([
  [3202, { ro: 'absolut', naturalness_status: 'revised' }],
  [3205, { zh: '原则；原理' }],
  [3207, { naturalness_status: 'revised' }],
  [3265, { specialist_book: 'specialist_education_language' }],
  [3333, { example_ro: 'Mihai i-a acordat primul ajutor colegului care leșinase în sala de conferințe.' }],
  [3353, { hint: 's.f.: gherile' }],
  [3445, { hint: 's.n.: curricula' }],
  [3545, { zh: '信息', specialist_book: null }],
  [3849, { ro: 'naționalism', learning_track: 'news_core' }],
  [4008, { ro: 'clasare', learning_track: 'specialist', specialist_book: 'specialist_law_public_affairs' }],
  [4568, { ro: 'criza migrației', specialist_book: 'specialist_law_public_affairs' }],
  [4580, { ro: 'inseparabilitate cuantică', learning_track: 'specialist' }],
  [5201, { ro: 'metoda Lean Startup', learning_track: 'specialist' }],
  [5228, { ro: 'arta noilor media', learning_track: 'specialist' }],
  [6435, { ro: 'agent de curățenie', learning_track: 'scenario_phrasebook' }],
  [4172, { zh: '自己；自身', part_of_speech: 'pronoun' }],
  [5377, { learning_track: 'scenario_phrasebook', frequency_rank: null }],
  [6321, { learning_track: 'news_extension', news_document_count: 3 }],
  [6938, { learning_track: 'scenario_phrasebook', frequency_rank: null }],
  [7901, { ro: 'aplică (lampă de perete)', learning_track: 'scenario_phrasebook', frequency_rank: null }],
  [8449, { ro: 'a rezerva un loc la curs', learning_track: 'scenario_phrasebook' }]
]);
for (const [id, fields] of expected) {
  const word = byId.get(id);
  assert(word, `missing corrected id ${id}`);
  for (const [field, value] of Object.entries(fields)) {
    assert.equal(word[field], value, `unexpected ${field} for corrected id ${id}`);
  }
}

for (const [headword, expectedTrack] of [
  ['principiu', 'news_core'],
  ['fenomen', 'news_core'],
  ['scop', 'news_core'],
  ['nietzscheanism', 'specialist'],
  ['tokamak', 'specialist'],
  ['tokenomics', 'specialist']
]) {
  const word = words.find(row => taxonomy.normalizedWordKey(row.ro) === taxonomy.normalizedWordKey(headword));
  assert(word, `missing audit anchor ${headword}`);
  assert.equal(word.learning_track, expectedTrack, `unexpected track for ${headword}`);
}

assert.match(appSource, /getLearningCollectionWords\(words = W\)/, 'app must scope word pools to the selected collection');
assert.match(appSource, /frequencyRank > 0/, 'new-card ordering must use corpus frequency');
assert.match(appSource, /verification_status === 'verified'.*phrase_quality === 'core'/,
  'reviewed core expressions must outrank unreviewed lemma-frequency cards');
assert.match(appSource, /learningCollectionId,\s*\n\s*curCat/, 'quiz cache must vary by selected collection');
assert.match(apiSource, /collection_id/, 'daily queue sync must carry its selected collection');
assert.match(apiSource, /cloudQueue\.collection_id.*expectedQueue\.collection_id/,
  'cloud read-back must verify queue collection ownership');
assert.match(apiSource, /collection_id: String\(queue\.collection_id \|\| 'news_core'\)/,
  'atomic daily events must carry the selected collection');
assert.match(appSource, /collectionId: learningCollectionId/,
  'undo snapshots must be bound to their vocabulary collection');
assert.match(htmlSource, /id="learning-collection-select"/, 'learner-facing collection selector is required');
assert.match(schemaSource, /app_private\.words_backup_20260812/, 'cloud migration must include a private rollback snapshot');

console.log(`Learning-track verification passed: ${words.length} stable ids, ${trackCounts.news_core} default news-core cards, 81 reviewed corrections.`);
