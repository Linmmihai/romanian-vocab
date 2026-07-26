import { createClient } from '@supabase/supabase-js';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SUPA_URL = 'https://wuiblzpyhcjxevotwcqz.supabase.co';
const SUPA_KEY = 'sb_publishable_R_1KpyBLGgn_BW1McVso7w_maR5OzDJ';

const sb = createClient(SUPA_URL, SUPA_KEY);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appBuildRoot = path.resolve(scriptDir, '..');
const repositoryRoot = path.resolve(appBuildRoot, '..');
let all = [];
let from = 0;

while (true) {
  const { data, error } = await sb
    .from('words')
    .select('*')
    .order('id')
    .range(from, from + 999);
  if (error) throw new Error(error.message);
  if (!data?.length) break;
  all = all.concat(data);
  if (data.length < 1000) break;
  from += 1000;
}

const invalid = all.filter(word =>
  !String(word.zh || '').trim() ||
  !String(word.ro || '').trim() ||
  /[\u3400-\u9fff]/u.test(String(word.ro || '')) ||
  !word.topic ||
  !word.part_of_speech ||
  !word.unit_type ||
  !word.grammar_data
);
if (invalid.length) {
  throw new Error(`Refusing to export ${invalid.length} invalid vocabulary rows; first id: ${invalid[0]?.id}`);
}

const payload = JSON.stringify({ exportedAt: new Date().toISOString(), words: all }, null, 2) + '\n';
for (const targetRoot of [repositoryRoot, appBuildRoot]) {
  const dataDir = path.join(targetRoot, 'data');
  await mkdir(dataDir, { recursive: true });
  await writeFile(path.join(dataDir, 'vocab.json'), payload);
}

console.log(`Exported ${all.length} words to root and app-build data/vocab.json`);
