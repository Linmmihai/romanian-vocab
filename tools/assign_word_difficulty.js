#!/usr/bin/env node

const fs = require('node:fs');

const FREQUENCY_URL = 'https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/ro/ro_50k.txt';
const SOURCE_LABEL = 'FrequencyWords OpenSubtitles 2018 Romanian 50K';
const BEGINNER_MAX_RANK = 2000;
const INTERMEDIATE_MAX_RANK = 7000;

function sqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function normalizeWord(value) {
  return String(value || '').trim().toLowerCase().replace(/ş/g, 'ș').replace(/ţ/g, 'ț');
}

function readSupabaseConfig() {
  const api = fs.readFileSync('api.js', 'utf8');
  const url = api.match(/const SUPA_URL = '([^']+)'/)?.[1];
  const key = api.match(/const SUPA_KEY = '([^']+)'/)?.[1];
  if (!url || !key) throw new Error('Could not read SUPA_URL/SUPA_KEY from api.js');
  return { url, key };
}

async function loadWords() {
  const { url, key } = readSupabaseConfig();
  const all = [];
  for (let from = 0; ; from += 1000) {
    const to = from + 999;
    const res = await fetch(`${url}/rest/v1/words?select=ro&order=id&offset=${from}&limit=1000`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (!res.ok) throw new Error(`Failed to load words: ${res.status} ${await res.text()}`);
    const rows = await res.json();
    all.push(...rows);
    if (rows.length < 1000) break;
  }
  return [...new Set(all.map(w => normalizeWord(w.ro)).filter(Boolean))];
}

async function loadFrequencyRanks() {
  const res = await fetch(FREQUENCY_URL, {
    headers: { 'User-Agent': 'RomanianVocabApp/1.0 difficulty assignment' },
  });
  if (!res.ok) throw new Error(`Failed to download frequency list: ${res.status}`);
  const text = await res.text();
  const ranks = new Map();
  text.split(/\r?\n/).forEach((line, index) => {
    const word = normalizeWord(line.split(/\s+/)[0]);
    if (word && !ranks.has(word)) ranks.set(word, index + 1);
  });
  if (ranks.size < 40000) throw new Error(`Parsed only ${ranks.size} frequency entries`);
  return ranks;
}

async function main() {
  const [words, ranks] = await Promise.all([loadWords(), loadFrequencyRanks()]);
  const matched = words
    .map(ro => ({ ro, rank: ranks.get(ro) }))
    .filter(item => item.rank)
    .sort((a, b) => a.ro.localeCompare(b.ro));

  const values = matched.map(e => `(${sqlString(e.ro)}, ${e.rank})`).join(',\n    ');
  const source = sqlString(SOURCE_LABEL);
  const unmatchedSource = sqlString(`${SOURCE_LABEL}: unmatched`);

  const sql = `with freq(ro, rank) as (\n  values\n    ${values}\n), matched as (\n  update public.words w\n  set\n    frequency_rank = f.rank,\n    frequency_source = ${source},\n    difficulty = case\n      when f.rank <= ${BEGINNER_MAX_RANK} then 'beginner'\n      when f.rank <= ${INTERMEDIATE_MAX_RANK} then 'intermediate'\n      else 'advanced'\n    end\n  from freq f\n  where lower(trim(w.ro)) = f.ro\n  returning w.id\n), unmatched as (\n  update public.words w\n  set\n    frequency_rank = null,\n    frequency_source = ${unmatchedSource},\n    difficulty = 'advanced'\n  where not exists (select 1 from freq f where lower(trim(w.ro)) = f.ro)\n  returning w.id\n)\nselect\n  (select count(*)::int from matched) as matched,\n  (select count(*)::int from unmatched) as unmatched,\n  (select count(*)::int from public.words where difficulty = 'beginner') as beginner,\n  (select count(*)::int from public.words where difficulty = 'intermediate') as intermediate,\n  (select count(*)::int from public.words where difficulty = 'advanced') as advanced;\n`;

  process.stderr.write(`Loaded ${words.length} app words; matched ${matched.length} frequency ranks.\\n`);
  process.stdout.write(sql);
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
