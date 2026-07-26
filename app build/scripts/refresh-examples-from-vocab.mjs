import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appBuildRoot = path.resolve(scriptDir, '..');
const repositoryRoot = path.resolve(appBuildRoot, '..');

function wordKey(value) {
  return String(value || '')
    .normalize('NFC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('ro');
}

function completeExample(item) {
  const ro = String(item?.ro || '').normalize('NFC').trim();
  const zh = String(item?.zh || '').normalize('NFC').trim();
  if (!ro || !zh) return null;
  return { ro, zh, source: String(item?.source || '已审核例句').trim() || '已审核例句' };
}

const vocabPayload = JSON.parse(await readFile(path.join(repositoryRoot, 'data', 'vocab.json'), 'utf8'));
const words = Array.isArray(vocabPayload) ? vocabPayload : (vocabPayload.words || []);
const previousBanks = [];
for (const targetRoot of [repositoryRoot, appBuildRoot]) {
  try {
    const payload = JSON.parse(await readFile(path.join(targetRoot, 'data', 'examples.json'), 'utf8'));
    previousBanks.push(payload.examples || payload || {});
  } catch {}
}

const previousByKey = new Map();
for (const bank of previousBanks) {
  for (const [rawKey, examples] of Object.entries(bank)) {
    const key = wordKey(rawKey);
    if (!key) continue;
    const target = previousByKey.get(key) || [];
    for (const item of Array.isArray(examples) ? examples : []) {
      const complete = completeExample(item);
      if (complete) target.push(complete);
    }
    previousByKey.set(key, target);
  }
}

const examples = {};
for (const word of words) {
  const key = wordKey(word.ro);
  if (!key) continue;
  const primary = completeExample({
    ro: word.example_ro,
    zh: word.example_zh,
    source: '云端词库例句'
  });
  if (!primary) throw new Error(`Vocabulary row ${word.id || word.ro} has an incomplete primary example`);
  const rows = [primary];
  const seen = new Set([`${wordKey(primary.ro)}::${primary.zh}`]);
  for (const candidate of previousByKey.get(key) || []) {
    const signature = `${wordKey(candidate.ro)}::${candidate.zh}`;
    if (seen.has(signature)) continue;
    seen.add(signature);
    rows.push(candidate);
  }
  examples[key] = rows;
}

const output = JSON.stringify({
  generatedAt: new Date().toISOString(),
  source: 'cloud vocabulary primary examples plus complete reviewed alternatives',
  wordCount: words.length,
  fetchedCloudExampleRows: words.length,
  matchedWordCount: Object.keys(examples).length,
  examples
}, null, 2) + '\n';

for (const targetRoot of [repositoryRoot, appBuildRoot]) {
  await writeFile(path.join(targetRoot, 'data', 'examples.json'), output);
}

console.log(`Refreshed ${Object.keys(examples).length} complete example groups in both bundles`);
