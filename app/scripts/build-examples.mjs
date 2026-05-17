import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const appRoot = process.cwd();
const projectRoot = path.resolve(appRoot, '..');
const vocabPath = path.join(appRoot, 'data', 'vocab.json');
const srtRoot = path.join(projectRoot, 'tools', 'content_original', 'srt');
const appOut = path.join(appRoot, 'data', 'examples.json');
const webOut = path.join(projectRoot, 'romanian_vocab_code', 'data', 'examples.json');
const MAX_EXAMPLES_PER_WORD = 6;

const payload = JSON.parse(await readFile(vocabPath, 'utf8'));
const words = Array.isArray(payload) ? payload : payload.words || [];
const sentences = existsSync(srtRoot) ? await loadSrtSentences(srtRoot) : [];
const byKey = new Map(words.map(word => [lowerRo(word.ro), word]));
const examples = {};

for (const word of words) {
  const candidates = findCandidates(word, sentences)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_EXAMPLES_PER_WORD)
    .map(item => ({
      ro: item.text,
      zh: '',
      source: `subtitle corpus:${item.file}`
    }));
  if (candidates.length) examples[lowerRo(word.ro)] = candidates;
}

const output = {
  generatedAt: new Date().toISOString(),
  source: 'tools/content_original/srt',
  wordCount: words.length,
  sentenceCount: sentences.length,
  matchedWordCount: Object.keys(examples).length,
  examples
};

await writeJson(appOut, output);
await writeJson(webOut, output);

console.log(`Indexed ${sentences.length} corpus sentences.`);
console.log(`Matched ${Object.keys(examples).length}/${words.length} words with real examples.`);
console.log(`Wrote ${path.relative(projectRoot, appOut)} and ${path.relative(projectRoot, webOut)}.`);

async function loadSrtSentences(root) {
  const files = (await readdir(root)).filter(file => file.endsWith('.srt')).sort();
  const result = [];
  for (const file of files) {
    const raw = await readFile(path.join(root, file), 'utf8');
    const cueTexts = extractSrtTexts(raw);
    const candidateTexts = [...cueTexts, cueTexts.join(' ')];
    for (const text of candidateTexts) {
      for (const sentence of splitSentences(text)) {
        if (isGoodSentence(sentence)) result.push({ text: sentence, file });
      }
    }
  }
  return uniqueSentences(result);
}

function extractSrtTexts(raw) {
  return raw
    .split(/\r?\n\r?\n+/)
    .map(block => block
      .split(/\r?\n/)
      .filter(line => line.trim() && !/^\d+$/.test(line.trim()) && !/-->/u.test(line))
      .join(' '))
    .map(cleanSubtitleText)
    .filter(Boolean);
}

function cleanSubtitleText(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\{[^}]+\}/g, ' ')
    .replace(/\[[^\]]+\]/g, ' ')
    .replace(/[♪♫]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitSentences(text) {
  return String(text || '')
    .split(/(?<=[.!?…])\s+/u)
    .map(s => s.trim())
    .filter(Boolean);
}

function isGoodSentence(sentence) {
  const words = sentence.match(/\p{L}+(?:[-'’]\p{L}+)*/gu) || [];
  if (words.length < 5 || words.length > 18) return false;
  if (!/[.!?]$/u.test(sentence)) return false;
  if (!/^\p{Lu}/u.test(sentence)) return false;
  if (/^(și|iar|dar|sau|că|de|la|în|pe)\b/iu.test(sentence)) return false;
  if (/[A-Z]{3,}|www\.|https?:|@/u.test(sentence)) return false;
  if ((sentence.match(/[!?]/g) || []).length > 2) return false;
  if (hasRepeatedWord(sentence)) return false;
  return /[ăâîșțĂÂÎȘȚ]/u.test(sentence);
}

function hasRepeatedWord(sentence) {
  const words = lowerRo(sentence).match(/\p{L}+/gu) || [];
  return words.some((word, index) => index > 0 && word === words[index - 1]);
}

function uniqueSentences(items) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = lowerRo(item.text);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function findCandidates(word, sentences) {
  const ro = String(word.ro || '').trim();
  if (!ro) return [];
  const needles = buildNeedles(ro);
  if (!needles.length) return [];
  return sentences
    .map(sentence => ({
      ...sentence,
      score: scoreSentence(sentence.text, needles, word)
    }))
    .filter(item => item.score > 0);
}

function buildNeedles(ro) {
  const base = lowerRo(ro).replace(/^a\s+/, '').trim();
  if (!base || base.length < 3) return [];
  if (base.includes(' ')) return [base];
  return [base];
}

function scoreSentence(sentence, needles, word) {
  const lower = lowerRo(sentence);
  const words = lower.match(/\p{L}+(?:[-'’]\p{L}+)*/gu) || [];
  let score = 0;
  for (const needle of needles) {
    if (needle.includes(' ')) {
      if (lower.includes(needle)) score += 12;
    } else if (words.includes(needle)) {
      score += 12;
    } else {
      continue;
    }
  }
  if (!score) return 0;
  if (words.length >= 7 && words.length <= 14) score += 4;
  if (/[.!]$/u.test(sentence)) score += 2;
  if (sentence.includes('?')) score += 1;
  if (byKey.has(lowerRo(word.ro))) score += 1;
  if (/^[-–—]/u.test(sentence)) score -= 3;
  return score;
}

function lowerRo(value) {
  return String(value || '').toLocaleLowerCase('ro');
}

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value, null, 2) + '\n');
}
