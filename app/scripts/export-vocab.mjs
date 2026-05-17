import { createClient } from '@supabase/supabase-js';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const SUPA_URL = 'https://wuiblzpyhcjxevotwcqz.supabase.co';
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind1aWJsenB5aGNqeGV2b3R3Y3F6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxMjg3NTksImV4cCI6MjA5MjcwNDc1OX0.ImJ1yH8v0op6_5G2P4fI--uJG8LOXIPt-JujPCzeN54';

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
