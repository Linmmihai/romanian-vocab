const assert = require('assert');
const fs = require('fs');
const path = require('path');
const scheduler = require('../scheduler.js');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const app = read('app.js');
const api = read('api.js');
const html = read('index.html');
const vocabPayload = JSON.parse(read('data/vocab.json'));
const examplePayload = JSON.parse(read('data/examples.json'));
const words = Array.isArray(vocabPayload) ? vocabPayload : vocabPayload.words;
const examples = examplePayload.examples || {};
const normalize = value => String(value || '').normalize('NFC').trim().toLocaleLowerCase('ro');

{
  const now = new Date('2026-07-25T00:00:00.000Z');
  const unknown = scheduler.scheduleCardReview({}, 'unknown', { now });
  const fuzzy = scheduler.scheduleCardReview({}, 'fuzzy', { now });
  const known = scheduler.scheduleCardReview({}, 'known', { now });
  assert.strictEqual(new Date(unknown.dueAt).getTime() - now.getTime(), 10 * 60 * 1000, 'unknown must retry in ten minutes');
  assert.strictEqual(fuzzy.intervalDays, 1, 'fuzzy must remain a learning result even when its interval is one day');
  assert.strictEqual(known.intervalDays, 1, 'a first accurate recall may also have a one-day interval');
  assert(app.includes('继续学习') && app.includes('通过今日任务'), 'equal intervals must expose different completion consequences');
}

{
  assert(app.includes("if (flashOverrideRo) {\n    showToast('历史卡片仅供回看，不会重复计分');"), 'history view must reject scoring');
  assert(app.includes('function undoLastCardAnswer()'), 'flashcards need a real undo action');
  assert(app.includes('queueProgressCorrectionForSync('), 'undo must enqueue an exact progress correction');
  assert(api.includes('function queueProgressCorrectionForSync'), 'API storage must support exact undo corrections');
  assert(api.includes('pendingDelete: true'), 'undoing a first answer must be able to delete the created progress row');
  assert(api.includes('pendingCorrection'), 'pending corrections must override monotonic progress merges');
  assert(api.includes('applyDailyQueueEventLocally'), 'daily queue undo must use a reversible base-target delta');
  assert(api.includes('const countDelta = target.new_words - base.new_words'), 'daily count undo must subtract only its own atomic delta');
  assert(html.includes('历史回看 · 不会重复计分'), 'read-only history state must be visible');
}

{
  assert(app.includes("if (key === 'ArrowRight' || key.toLowerCase() === 'n') { nextCard(); return true; }"), 'right-arrow shortcut should use the guarded card navigation path');
  assert(app.includes('请先选择“不认识”“模糊”或“准确回忆”，完成当前单词'), 'a flipped card must require an explicit memory result before advancing');
  assert(app.includes('作答后会自动进入下一词'), 'an unflipped card must explain the answer-first flow');
}

{
  assert(app.includes('getRemainingDailyNewSlots'), 'daily queue must enforce a new-card cap');
  assert(app.includes("path = result.length ? 'due-only' : 'due-scope-fallback'"), 'due cards must produce a strict due-only display path, including cross-topic fallback');
  assert(html.includes('id="new-limit-input"'), 'new-card cap must be user-configurable');
  assert(html.includes('已引入新词'), 'new-card count must be distinguished from completed cards');
}

{
  assert(app.includes("showToast('当前浏览器不支持发音播放')"), 'unsupported speech must be visible');
  assert(app.includes("showToast('当前设备没有罗马尼亚语语音，请先在系统中安装')"), 'missing Romanian voice must be visible');
  assert(!/if \\(rv\\) u\\.voice = rv/.test(app), 'speech must never silently fall back to a non-Romanian voice');
}

{
  const vocabKeys = new Set(words.map(word => normalize(word.ro === 'poștas' ? 'poștaș' : word.ro)));
  const exampleKeys = new Set(Object.keys(examples).map(normalize));
  const missing = [...vocabKeys].filter(key => !exampleKeys.has(key));
  assert.deepStrictEqual(missing, [], `every unique card must have a primary example; missing: ${missing.join(', ')}`);

  const targetChecks = {
    'fizică': /fizic/i,
    'albină': /albin/i,
    'antreprenor': /antreprenor/i,
    'micul dejun': /micul dejun/i,
    'poștaș': /poștaș/i,
    'a se zvârcoli': /zvârcol/i,
    'a ezita': /ezitat/i,
    'a renunța': /renunțat/i,
    'vag': /vag/i,
    'strict': /strict/i,
    'fragil': /fragil/i,
    'temporar': /temporar/i,
    'prin urmare': /prin urmare/i,
    'deși': /deși/i,
    'a picta în ulei': /a picta în ulei/i
  };
  Object.entries(targetChecks).forEach(([word, pattern]) => {
    const primary = examples[word]?.[0];
    assert(primary?.ro && pattern.test(primary.ro), `${word} primary example must contain the target lexeme`);
    assert(primary?.zh, `${word} primary example must contain a Chinese context sentence`);
  });
  assert(app.includes('return getPrimaryExampleSentence(w);'), 'main cards must use the reviewed primary example instead of a random subtitle line');
  assert(app.includes('return getPrimaryLocalExample(w) || buildExampleSentence(w)'), 'reviewed local examples must override stale cloud examples');
  assert(app.includes('function buildChineseCloze'), 'front context must hide the Chinese answer in a real cloze');
  assert(!app.includes('空格处先回忆罗语：____'), 'front context must not reveal the answer beside a detached blank');
  assert(html.includes('id="fc-pos"'), 'ambiguous Chinese prompts need a part-of-speech cue');
}

console.log('flashcard invariant verification passed');
