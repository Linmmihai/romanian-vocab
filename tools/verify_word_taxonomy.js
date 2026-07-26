const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require(path.join(__dirname, '..', 'taxonomy.js'));

const taxonomy = globalThis.RomanianVocabTaxonomy;
const vocabPayload = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'vocab.json'), 'utf8'));
const examplePayload = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'examples.json'), 'utf8'));
const words = Array.isArray(vocabPayload) ? vocabPayload : (vocabPayload.words || []);
const examples = examplePayload.examples || examplePayload;

assert.equal(words.length, 4867, 'offline bundle must match the curated cloud vocabulary count');
assert.equal(Object.keys(examples).length, words.length, 'every bundled word needs one complete example group');

const topicValues = new Set(taxonomy.TOPICS.map(item => item.value));
const posValues = new Set(taxonomy.PARTS_OF_SPEECH.map(item => item.value));
const unitValues = new Set(taxonomy.UNIT_TYPES.map(item => item.value));
const normalizedKeys = new Set();

for (const word of words) {
  assert(topicValues.has(word.topic), `invalid topic for id ${word.id}`);
  assert(posValues.has(word.part_of_speech), `invalid part of speech for id ${word.id}`);
  assert(unitValues.has(word.unit_type), `invalid unit type for id ${word.id}`);
  assert.notEqual(word.topic, 'unclassified', `unclassified topic for id ${word.id}`);
  assert.notEqual(word.part_of_speech, 'other', `unclassified part of speech for id ${word.id}`);
  assert.equal(typeof word.grammar_data, 'object', `grammar_data must be an object for id ${word.id}`);
  assert(!Array.isArray(word.grammar_data), `grammar_data must not be an array for id ${word.id}`);
  assert(!taxonomy.looksLikeTemplateWord(word), `template content leaked into id ${word.id}`);
  assert(!/[\u3400-\u9fff]/u.test(word.ro), `Romanian field contains CJK for id ${word.id}`);
  assert(!/^s\.[fmn]\.pl\.?\s*:/i.test(word.hint) || !/fără plural/i.test(word.hint), `plural contradiction for id ${word.id}`);

  const key = taxonomy.normalizedWordKey(word.ro);
  assert(!normalizedKeys.has(key), `normalized duplicate: ${word.ro}`);
  normalizedKeys.add(key);

  const group = examples[key];
  assert(Array.isArray(group) && group.length, `missing example group for ${word.ro}`);
  group.forEach(example => {
    assert(String(example.ro || '').trim(), `blank Romanian example for ${word.ro}`);
    assert(String(example.zh || '').trim(), `blank Chinese example for ${word.ro}`);
  });
}

const repairedLanguage = words.find(word => word.id === 6191);
assert.equal(repairedLanguage?.ro, 'limba română');
assert.equal(repairedLanguage?.topic, 'education_language');
assert.equal(repairedLanguage?.part_of_speech, 'noun');

const industrial = words.filter(word => taxonomy.normalizedWordKey(word.ro) === 'revoluție industrială');
assert.equal(industrial.length, 1, 'industrial revolution duplicate must be merged');
assert.equal(industrial[0].id, 6270, 'progress-bearing industrial revolution row must be retained');

const reflexive = words.find(word => word.id === 8703);
assert.match(taxonomy.formatGrammarInfo(reflexive), /反身/);
assert.match(taxonomy.formatGrammarInfo(reflexive), /第 IV 变位/);

const collocation = words.find(word => taxonomy.normalizedWordKey(word.ro) === 'a lipi eticheta');
const collocationSummary = taxonomy.getClassificationSummary(collocation, { includeUnit: true });
assert.match(collocationSummary, /动词 · 搭配/, 'ordinary compositional actions must be labeled as collocations');

const verbPhrase = words.find(word => taxonomy.normalizedWordKey(word.ro) === 'a da banii înapoi');
const verbPhraseSummary = taxonomy.getClassificationSummary(verbPhrase, { includeUnit: true });
assert.match(verbPhraseSummary, /动词短语/, 'verb phrases must retain their specific learner-facing unit label');
assert.doesNotMatch(verbPhraseSummary, /动词 · 动词短语/, 'verb phrases must not repeat the generic verb label');

const curatedRows = words.filter(word => word.grammar_data?.curation_batch === 'phrase_curation_20260726');
assert.equal(curatedRows.length, 856, 'all existing phrase rows and new core chunks must carry the curation batch');
assert.equal(curatedRows.filter(word => word.grammar_data?.phrase_quality === 'core').length, 141, 'core phrase inventory count must remain stable');
assert.equal(curatedRows.filter(word => !word.cefr || !word.register).length, 0, 'curated phrases need CEFR and register metadata');

const sentencePattern = words.find(word => taxonomy.normalizedWordKey(word.ro) === taxonomy.normalizedWordKey('Mi se pare că...'));
assert.equal(sentencePattern?.unit_type, 'sentence_pattern');
assert.equal(sentencePattern?.grammar_data?.phrase_quality, 'core');

const thanks = words.find(word => taxonomy.normalizedWordKey(word.ro) === 'mulțumesc');
assert.equal(thanks?.unit_type, 'word', 'single-token mulțumesc must not be labeled as a verb phrase');

console.log(`Word taxonomy verification passed: ${words.length} words, ${normalizedKeys.size} unique normalized keys.`);
