const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const guideStart = html.indexOf('<!-- 指南 -->');
const guideEnd = html.indexOf('<!-- 词汇表 -->');
assert(guideStart >= 0 && guideEnd > guideStart, 'guide section must exist');
const guide = html.slice(guideStart, guideEnd);
const alphabet = guide.match(/<div class="alphabet-item"[^>]*>/g) || [];

assert(html.includes('class="btn-sm topbar-guide-btn"'), 'guide must have a visible topbar shortcut outside the account menu');
assert(html.includes('aria-label="打开学习指南"'), 'topbar guide shortcut must have a clear accessible label');
assert(alphabet.length === 31, `Romanian alphabet must contain 31 cards, found ${alphabet.length}`);
assert(alphabet.every(card => card.includes('data-speak=') && card.includes('data-tts=')), 'every alphabet card must include a label and Romanian TTS phrase');
assert(!guide.includes('data-tts-lang="en'), 'guide must never force Romanian letters through an English voice');
assert(!guide.includes('data-tts-mode='), 'obsolete TTS override mode must not return');

for (const expected of [
  'data-speak="je"',
  'data-speak="ka"',
  'data-speak="kü"',
  'data-speak="iks"',
  'data-speak="i grec"',
  'data-speak="ze"'
]) {
  assert(guide.includes(expected), `missing normative letter name: ${expected}`);
}

for (const expectedRule of ['c / ce·ci / che·chi', 'g / ge·gi / ghe·ghi', '词尾 i · /ʲ/', 'x · /ks/ 或 /gz/']) {
  assert(guide.includes(expectedRule), `missing pronunciation rule: ${expectedRule}`);
}

assert(app.includes("const ttsText = item.dataset.tts || '';"), 'click and keyboard handlers must use complete Romanian example phrases');
assert(app.includes("已停止播放以免误导"), 'missing Romanian voices must stop playback instead of using a misleading fallback');
assert(app.includes('waitForSpeechVoices'), 'guide must wait briefly for browser voices to load');

console.log('Guide pronunciation checks passed.');
