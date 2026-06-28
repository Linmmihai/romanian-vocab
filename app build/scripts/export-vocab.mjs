import { createClient } from '@supabase/supabase-js';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const SUPA_URL = 'https://wuiblzpyhcjxevotwcqz.supabase.co';
const SUPA_KEY = 'sb_publishable_R_1KpyBLGgn_BW1McVso7w_maR5OzDJ';

const sb = createClient(SUPA_URL, SUPA_KEY);
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

await mkdir(path.join(process.cwd(), 'data'), { recursive: true });
await writeFile(
  path.join(process.cwd(), 'data', 'vocab.json'),
  JSON.stringify({ exportedAt: new Date().toISOString(), words: all }, null, 2) + '\n'
);

console.log(`Exported ${all.length} words to data/vocab.json`);
