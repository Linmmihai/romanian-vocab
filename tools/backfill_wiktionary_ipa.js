#!/usr/bin/env node

// Backfill missing Romanian IPA from Wiktionary.
// Preview by default. Use --apply to write updates to Supabase.

const DEFAULT_SUPABASE_URL = 'https://wuiblzpyhcjxevotwcqz.supabase.co';
const SUPABASE_URL = process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const fs = require('fs');

const args = new Set(process.argv.slice(2));
const APPLY = args.has('--apply');
const WORD_ARG = process.argv.find(arg => arg.startsWith('--word='));
const LIMIT_ARG = process.argv.find(arg => arg.startsWith('--limit='));
const FILE_ARG = process.argv.find(arg => arg.startsWith('--file='));
const ONLY_WORD = WORD_ARG ? WORD_ARG.slice('--word='.length).trim() : '';
const LIMIT = Number(LIMIT_ARG ? LIMIT_ARG.slice('--limit='.length) : 50);
const SOURCE_FILE = FILE_ARG ? FILE_ARG.slice('--file='.length).trim() : '';
const WIKTIONARY_TIMEOUT_MS = Number(process.env.WIKTIONARY_TIMEOUT_MS || 10000);

if (!SUPABASE_KEY) {
  console.error('Missing SUPABASE_SERVICE_ROLE_KEY. For preview-only reads, SUPABASE_ANON_KEY also works.');
  process.exit(1);
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripTags(value) {
  return decodeHtml(String(value || '').replace(/<[^>]+>/g, '')).trim();
}

function normalizeWord(value) {
  return String(value || '').trim().toLocaleLowerCase('ro');
}

function loadLocalIpaMap(filePath) {
  if (!filePath) return null;
  const map = new Map();
  const content = fs.readFileSync(filePath, 'utf8');
  content.split(/\r?\n/).forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const parts = trimmed.includes('|') ? trimmed.split('|') : trimmed.split(',');
    const ro = (parts[0] || '').trim();
    const ipa = (parts[1] || '').trim();
    if (ro && ipa) map.set(normalizeWord(ro), ipa);
  });
  return map;
}

function extractRomanianSection(html) {
  const start = html.search(/<h2[^>]*>[\s\S]*?(id="Romanian"|>Romanian<)/i);
  if (start < 0) return '';
  const rest = html.slice(start);
  const next = rest.slice(1).search(/<h2[^>]*>/i);
  return next >= 0 ? rest.slice(0, next + 1) : rest;
}

function pickIpa(html) {
  const section = extractRomanianSection(html);
  if (!section) return '';
  const matches = [...section.matchAll(/<span[^>]*class="[^"]*\bIPA\b[^"]*"[^>]*>([\s\S]*?)<\/span>/gi)]
    .map(m => stripTags(m[1]))
    .filter(Boolean)
    .filter(value => /[ˈˌ]/.test(value) || /[a-zăâîșțəɨ]/i.test(value));
  return matches[0] || '';
}

async function fetchWiktionaryIpa(word) {
  const url = new URL('https://en.wiktionary.org/w/api.php');
  url.searchParams.set('action', 'parse');
  url.searchParams.set('page', word);
  url.searchParams.set('prop', 'text');
  url.searchParams.set('format', 'json');
  url.searchParams.set('formatversion', '2');
  url.searchParams.set('origin', '*');

  const res = await fetch(url, {
    headers: { 'user-agent': 'romanian-vocab-ipa-backfill/1.0' },
    signal: AbortSignal.timeout(WIKTIONARY_TIMEOUT_MS)
  });
  if (!res.ok) throw new Error(`Wiktionary HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) return '';
  return pickIpa(json.parse?.text || '');
}

async function supabaseRequest(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_KEY,
      authorization: `Bearer ${SUPABASE_KEY}`,
      'content-type': 'application/json',
      prefer: 'return=representation',
      ...(options.headers || {})
    }
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Supabase HTTP ${res.status}: ${body}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

async function loadMissingWords() {
  if (ONLY_WORD) {
    const ro = encodeURIComponent(`eq.${ONLY_WORD}`);
    return supabaseRequest(`words?select=id,zh,ro,ipa&ro=${ro}&limit=1`);
  }
  return supabaseRequest(
    `words?select=id,zh,ro,ipa&or=(ipa.is.null,ipa.eq.)&order=ro.asc&limit=${encodeURIComponent(LIMIT)}`
  );
}

async function updateWordIpa(id, ipa) {
  return supabaseRequest(`words?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ ipa })
  });
}

async function main() {
  const words = await loadMissingWords();
  const localIpa = loadLocalIpaMap(SOURCE_FILE);
  const results = [];

  for (const word of words) {
    let ipa = '';
    let error = '';
    try {
      ipa = localIpa ? (localIpa.get(normalizeWord(word.ro)) || '') : await fetchWiktionaryIpa(word.ro);
      if (ipa && APPLY) await updateWordIpa(word.id, ipa);
    } catch (e) {
      error = e.message;
    }
    results.push({ ...word, ipa_found: ipa, status: error ? `error: ${error}` : ipa ? (APPLY ? 'updated' : 'preview') : 'not found' });
    await new Promise(resolve => setTimeout(resolve, 150));
  }

  console.table(results.map(r => ({
    id: r.id,
    ro: r.ro,
    zh: r.zh,
    ipa: r.ipa_found || '',
    status: r.status
  })));

  const found = results.filter(r => r.ipa_found).length;
  console.log(`${APPLY ? 'Updated' : 'Previewed'} ${found}/${results.length} words with ${localIpa ? SOURCE_FILE : 'Wiktionary'} IPA.`);
  if (!APPLY) console.log('Run again with --apply to write these IPA values to Supabase.');
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
