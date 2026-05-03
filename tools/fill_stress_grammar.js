#!/usr/bin/env node

// Fill missing stress markers and grammar notes for Romanian vocabulary.
// Preview by default. Use --apply to update Supabase.

const fs = require('fs');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://wuiblzpyhcjxevotwcqz.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || readAnonKey();
const APPLY = process.argv.includes('--apply');
const ALL = process.argv.includes('--all');
const FROM_ID = Number((process.argv.find(a => a.startsWith('--from-id=')) || '').split('=')[1] || 406);
const LIMIT = Number((process.argv.find(a => a.startsWith('--limit=')) || '').split('=')[1] || 2000);
const OUT = (process.argv.find(a => a.startsWith('--out=')) || '').split('=')[1] || 'tools/stress_grammar_preview.csv';

function readAnonKey() {
  const src = fs.readFileSync('api.js', 'utf8');
  return src.match(/const SUPA_KEY = '([^']+)'/)?.[1] || '';
}

function titleCaseRo(value) {
  return String(value || '').toLocaleLowerCase('ro');
}

function hasStress(value) {
  return /[A-ZĂÂÎȘȚˈ]/.test(String(value || ''));
}

function vowelGroups(word) {
  const vowels = 'aeiouăâîAEIOUĂÂÎ';
  const groups = [];
  let start = -1;
  for (let i = 0; i < word.length; i++) {
    if (vowels.includes(word[i])) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      groups.push([start, i]);
      start = -1;
    }
  }
  if (start >= 0) groups.push([start, word.length]);
  return groups;
}

function stressWord(ro) {
  const parts = String(ro || '').split(/([\s-]+)/);
  return parts.map(part => {
    if (/^[\s-]+$/.test(part)) return part;
    const lower = titleCaseRo(part);
    const groups = vowelGroups(lower);
    if (!groups.length) return lower;

    let target = groups.length - 2;
    if (/(ție|ție[ai]?|tate|iune|ment|ism|ist|tor|oare|eală|ește|ează)$/i.test(lower)) {
      target = groups.length - 2;
    } else if (/(ar|al|ent|ant|os|iv|ic|or)$/i.test(lower) && groups.length >= 2) {
      target = groups.length - 1;
    }
    target = Math.max(0, Math.min(groups.length - 1, target));
    const [start, end] = groups[target];
    return lower.slice(0, start) + lower.slice(start, end).toLocaleUpperCase('ro') + lower.slice(end);
  }).join('');
}

function inferPos(word) {
  const cat = String(word.cat || '');
  const zh = String(word.zh || '');
  const ro = titleCaseRo(word.ro);

  if (cat.includes('动词')) return 'verb';
  if (cat.includes('形容词')) return 'adjective';
  if (cat.includes('副词')) return 'adverb';
  if (cat.includes('介词')) return 'preposition';
  if (cat.includes('连词') || cat.includes('连接词')) return 'conjunction';
  if (cat.includes('代词')) return 'pronoun';
  if (cat.includes('数词')) return 'numeral';
  if (cat.includes('方向') || cat.includes('时间')) {
    if (!/(ție|tate|ment|iune|are|ere|ire|ură|eală)$/i.test(ro)) return 'adverb';
  }
  if (zh.endsWith('的')) return 'adjective';
  if (/^(a\s+)?[a-zăâîșț]+(a|ea|e|i|î)$/i.test(ro) && (cat.includes('动词') || /(iza|ifica|iona|ui|ăi|ezi|eri)$/i.test(ro))) return 'verb';
  if (/^(în|pe|la|cu|de|din|spre|sub|peste|fără)$/i.test(ro)) return 'preposition';
  return 'noun';
}

function pluralForNoun(ro) {
  const w = titleCaseRo(ro).replace(/^a\s+/, '');
  if (/\s/.test(w)) return { value: '短语，复数待核对', confident: false };
  if (w.endsWith('tate')) return { value: w.slice(0, -4) + 'tăți', confident: true };
  if (w.endsWith('ție')) return { value: w.slice(0, -3) + 'ții', confident: true };
  if (w.endsWith('iune')) return { value: w.slice(0, -4) + 'iuni', confident: true };
  if (w.endsWith('anță')) return { value: w.slice(0, -4) + 'anțe', confident: true };
  if (w.endsWith('ență')) return { value: w.slice(0, -4) + 'ențe', confident: true };
  if (w.endsWith('ință')) return { value: w.slice(0, -4) + 'ințe', confident: true };
  if (w.endsWith('eală')) return { value: w.slice(0, -4) + 'eli', confident: false };
  if (w.endsWith('ment')) return { value: w + 'e', confident: true };
  if (w.endsWith('tor')) return { value: w.slice(0, -3) + 'toare', confident: false };
  if (w.endsWith('ar')) return { value: w + 'e', confident: false };
  if (w.endsWith('ent')) return { value: w + 'e', confident: false };
  if (w.endsWith('ant')) return { value: w.slice(0, -2) + 'ți', confident: false };
  if (w.endsWith('ă')) return { value: w.slice(0, -1) + 'e', confident: true };
  if (w.endsWith('ie')) return { value: w.slice(0, -2) + 'ii', confident: false };
  if (w.endsWith('e')) return { value: w.slice(0, -1) + 'i', confident: false };
  if (w.endsWith('iu')) return { value: w.slice(0, -2) + 'ii', confident: false };
  if (w.endsWith('u')) return { value: w.slice(0, -1) + 'uri', confident: false };
  if (/[bcdfghjklmnpqrstvwxzșț]$/.test(w)) return { value: w + 'e', confident: false };
  return { value: w + 'i', confident: false };
}

function adjectiveForms(ro) {
  const w = titleCaseRo(ro);
  if (w.endsWith('os')) return `形容词 · f: ${w.slice(0, -2)}oasă · pl: ${w.slice(0, -2)}oși/oase`;
  if (w.endsWith('at')) return `形容词 · f: ${w.slice(0, -2)}ată · pl: ${w.slice(0, -2)}ați/ate`;
  if (w.endsWith('it')) return `形容词 · f: ${w.slice(0, -2)}ită · pl: ${w.slice(0, -2)}iți/ite`;
  if (w.endsWith('ut')) return `形容词 · f: ${w.slice(0, -2)}ută · pl: ${w.slice(0, -2)}uți/ute`;
  if (w.endsWith('iv')) return `形容词 · f: ${w.slice(0, -2)}ivă · pl: ${w.slice(0, -2)}ivi/ive`;
  if (w.endsWith('ic')) return `形容词 · f: ${w.slice(0, -2)}ică · pl: ${w.slice(0, -2)}ici/ice`;
  if (w.endsWith('ent')) return `形容词 · f: ${w.slice(0, -3)}entă · pl: ${w.slice(0, -3)}enți/ente`;
  if (w.endsWith('ă')) return `形容词 · m/f 待核对 · pl: ${w.slice(0, -1)}e`;
  return '形容词 · 形式待核对';
}

function conjugationClass(ro) {
  const w = titleCaseRo(ro).replace(/^a\s+/, '');
  if (/(iza|ifica|iona|activa|organiza|analiza|utiliza)$/.test(w)) return '动词 · -ez 变位';
  if (w.endsWith('î')) return '动词 · -ăsc 变位';
  if (w.endsWith('i')) return '动词 · -esc 变位';
  if (w.endsWith('ea')) return '动词 · -ea 类';
  if (w.endsWith('e')) return '动词 · -e 类';
  if (w.endsWith('a')) return '动词 · 零变位';
  return '动词 · 变位待核对';
}

function grammarFor(word) {
  const pos = inferPos(word);
  if (pos === 'verb') return conjugationClass(word.ro);
  if (pos === 'adjective') return adjectiveForms(word.ro);
  if (pos === 'adverb') return '副词 · 不变';
  if (pos === 'preposition') return '介词 · 不变';
  if (pos === 'conjunction') return '连词 · 不变';
  if (pos === 'pronoun') return '代词';
  if (pos === 'numeral') return '数词';
  const plural = pluralForNoun(word.ro);
  return `名词 · 复数${plural.confident ? '' : '待核对'}: ${plural.value}`;
}

function csvCell(value) {
  const s = String(value ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function supabase(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_KEY,
      authorization: `Bearer ${SUPABASE_KEY}`,
      'content-type': 'application/json',
      prefer: options.prefer || 'return=representation',
      ...(options.headers || {})
    }
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

async function loadWords() {
  let all = [];
  for (let offset = 0; offset < LIMIT; offset += 1000) {
    const rows = await supabase(`words?select=id,zh,ro,ipa,hint,cat,difficulty&id=gte.${FROM_ID}&order=id.asc&offset=${offset}&limit=1000`);
    all = all.concat(rows || []);
    if (!rows || rows.length < 1000) break;
  }
  return all;
}

async function updateWord(row) {
  return supabase(`words?id=eq.${row.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ ipa: row.next_ipa, hint: row.next_hint })
  });
}

async function updateBatch(rows) {
  return supabase('words?on_conflict=id', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=minimal',
    body: JSON.stringify(rows.map(row => ({
      id: row.id,
      ipa: row.next_ipa,
      hint: row.next_hint
    })))
  });
}

async function main() {
  const words = await loadWords();
  const updates = words.map(w => {
    const nextIpa = hasStress(w.ipa) ? w.ipa : stressWord(w.ro);
    const nextHint = ALL || !String(w.hint || '').trim() ? grammarFor(w) : w.hint;
    const changed = nextIpa !== (w.ipa || '') || nextHint !== (w.hint || '');
    return { ...w, next_ipa: nextIpa, next_hint: nextHint, changed };
  }).filter(w => w.changed);

  const csv = [
    ['id', 'zh', 'ro', 'cat', 'old_ipa', 'new_ipa', 'old_hint', 'new_hint'].map(csvCell).join(','),
    ...updates.map(w => [w.id, w.zh, w.ro, w.cat, w.ipa, w.next_ipa, w.hint, w.next_hint].map(csvCell).join(','))
  ].join('\n');
  fs.writeFileSync(OUT, csv);

  console.log(`Loaded ${words.length} words from id >= ${FROM_ID}.`);
  console.log(`Prepared ${updates.length} updates.`);
  console.log(`Preview written to ${OUT}.`);
  console.table(updates.slice(0, 20).map(w => ({
    id: w.id,
    ro: w.ro,
    ipa: w.next_ipa,
    grammar: w.next_hint
  })));

  if (!APPLY) {
    console.log('Preview only. Re-run with --apply to update Supabase.');
    return;
  }

  for (let i = 0; i < updates.length; i += 100) {
    await updateBatch(updates.slice(i, i + 100));
    console.log(`Updated ${Math.min(i + 100, updates.length)}/${updates.length}`);
  }
  console.log(`Updated ${updates.length} rows in Supabase.`);
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
