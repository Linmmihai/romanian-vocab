const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const words = JSON.parse(fs.readFileSync(path.join(root, 'data', 'vocab.json'), 'utf8')).words;
const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const apiSource = fs.readFileSync(path.join(root, 'api.js'), 'utf8');
const builderSource = fs.readFileSync(path.join(root, 'tools', 'build_vocab_learning_tracks.py'), 'utf8');
const byId = new Map(words.map(word => [Number(word.id), word]));

assert.equal(words.length, 4867, 'adversarial cleanup must preserve stable word ids');
assert.equal(words.filter(word => word.naturalness_status === 'corpus_attested').length, 0,
  'frequency evidence cannot certify sense, translation, example, or naturalness');

for (const [id, fields] of new Map([
  [4172, { zh: '自己；自身', part_of_speech: 'pronoun', naturalness_status: 'revised' }],
  [5377, { learning_track: 'scenario_phrasebook', frequency_rank: null, news_document_count: 0 }],
  [6321, { learning_track: 'news_extension', news_document_count: 3 }],
  [6938, { learning_track: 'scenario_phrasebook', frequency_rank: null, news_document_count: 0 }],
  [7901, { ro: 'aplică (lampă de perete)', learning_track: 'scenario_phrasebook', frequency_rank: null }]
])) {
  const word = byId.get(id);
  assert(word, `missing adversarial anchor ${id}`);
  for (const [field, value] of Object.entries(fields)) {
    assert.equal(word[field], value, `bad ${field} for adversarial anchor ${id}`);
  }
}

for (const id of [3410, 3785, 3883, 3973, 4099, 4170, 4254, 4263, 5050]) {
  assert.equal(byId.get(id)?.learning_track, 'specialist', `specialist term ${id} leaked into news extension`);
}

assert.match(builderSource, /evidence_method.*exact_headword/s,
  'corpus builder must record whether evidence came from an exact headword');
assert.match(builderSource, /single_surface_ids/,
  'exact surface evidence must be counted separately from automatic lemmas');
const syncDailySource = appSource.slice(appSource.indexOf('async function syncDailyStateToCloud'), appSource.indexOf('function saveTodayLogBackground'));
assert.match(syncDailySource, /collection_id: learningCollectionId/,
  'daily cloud sync must preserve the selected collection');
assert.match(appSource, /snapshot\.collectionId !== learningCollectionId/,
  'cross-collection undo must be rejected');
assert.match(apiSource, /cloudQueue\.collection_id.*expectedQueue\.collection_id/s,
  'manual sync must verify collection ownership on cloud read-back');
assert.match(apiSource, /collection_id: String\(queue\.collection_id \|\| 'news_core'\)/,
  'atomic daily events must carry the selected collection');
assert.doesNotMatch(apiSource, /from\('daily_queue'\)\.upsert/,
  'daily queue writes must remain on the atomic RPC path');

console.log('Adversarial vocabulary invariants passed: sense-frequency anchors, collection sync, undo isolation, and naturalness claims.');
