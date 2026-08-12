#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const vocab = JSON.parse(fs.readFileSync(path.join(root, 'data', 'vocab.json'), 'utf8'));
const words = Array.isArray(vocab) ? vocab : vocab.words || [];
const normalize = value => String(value || '').normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ro');
const examples = {};

for (const word of words) {
  const key = normalize(word.ro);
  if (!key) throw new Error(`Missing Romanian headword for id ${word.id}`);
  if (examples[key]) throw new Error(`Duplicate normalized headword ${word.ro}`);
  const ro = String(word.example_ro || '').trim();
  const zh = String(word.example_zh || '').trim();
  if (!ro || !zh) throw new Error(`Incomplete primary example for id ${word.id}`);
  examples[key] = [{ ro, zh, source: word.source || 'vocabulary primary example' }];
}

const output = JSON.stringify({
  generatedAt: new Date().toISOString(),
  source: 'vocabulary primary examples',
  wordCount: words.length,
  matchedWordCount: words.length,
  examples
}, null, 2) + '\n';

for (const target of [
  path.join(root, 'data', 'examples.json'),
  path.join(root, 'app build', 'data', 'examples.json')
]) {
  fs.writeFileSync(target, output);
}

console.log(`Synchronized ${words.length} complete example groups with the vocabulary.`);
