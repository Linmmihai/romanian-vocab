const assert = require('assert');
const fs = require('fs');
const path = require('path');
const quiz = require('../quiz-engine.js');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const words = JSON.parse(fs.readFileSync(path.join(root, 'data/vocab.json'), 'utf8')).words;

function seededRandom(seed = 7) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

const synthetic = Array.from({ length: 90 }, (_, index) => ({
  id: index + 1,
  ro: `cuvânt-${String(index + 1).padStart(3, '0')}`,
  zh: `词义-${String(index + 1).padStart(3, '0')}`,
  naturalness_status: index % 11 === 0 ? 'needs_review' : (index % 3 === 0 ? 'revised' : 'verified'),
  difficulty: index < 30 ? 'beginner' : index < 60 ? 'intermediate' : 'advanced',
  part_of_speech: index % 2 ? 'noun' : 'verb',
  topic: `topic-${index % 6}`,
  unit_type: 'word'
}));

const standardPlan = quiz.buildDiagnosticPlan(synthetic, {
  size: 20,
  difficulty: 'standard',
  random: seededRandom(13)
});
assert.strictEqual(standardPlan.length, 20, 'standard diagnostic must respect the requested item count');
assert.strictEqual(new Set(standardPlan.map(item => item.word.ro)).size, 20, 'a diagnostic must not repeat a target word');
assert(standardPlan.every(item => quiz.isAssessmentEligible(item.word)), 'a diagnostic must exclude unreviewed content');
const standardTypes = standardPlan.reduce((counts, item) => {
  counts[item.type] = (counts[item.type] || 0) + 1;
  return counts;
}, {});
assert.deepStrictEqual(standardTypes, { listening: 7, dictation: 7, translation: 6 }, 'standard diagnostic must reserve 70% of items for listening');

const foundationPlan = quiz.buildDiagnosticPlan(synthetic, {
  size: 50,
  difficulty: 'foundation',
  random: seededRandom(3)
});
assert(foundationPlan.length > 0 && foundationPlan.length < 50, 'foundation mode must not silently backfill harder words');
assert(foundationPlan.every(item => item.word.difficulty === 'beginner'), 'foundation mode must contain only beginner-bank items');

const challengePlan = quiz.buildDiagnosticPlan(synthetic, {
  size: 50,
  difficulty: 'challenge',
  random: seededRandom(5)
});
assert(challengePlan.every(item => item.word.difficulty !== 'beginner'), 'challenge mode must exclude beginner-bank items');

const answer = {
  ro: 'piață', zh: '市场', difficulty: 'intermediate', part_of_speech: 'noun', topic: 'daily', unit_type: 'word'
};
const distractorPool = [
  answer,
  { ...answer },
  { ro: 'târg', zh: '市场', difficulty: 'intermediate', part_of_speech: 'noun', topic: 'daily', unit_type: 'word' },
  { ro: 'magazin', zh: '商店', difficulty: 'intermediate', part_of_speech: 'noun', topic: 'daily', unit_type: 'word' },
  { ro: 'stradă', zh: '街道', difficulty: 'intermediate', part_of_speech: 'noun', topic: 'daily', unit_type: 'word' },
  { ro: 'birou', zh: '办公室', difficulty: 'intermediate', part_of_speech: 'noun', topic: 'work', unit_type: 'word' },
  { ro: 'a cumpăra', zh: '购买', difficulty: 'beginner', part_of_speech: 'verb', topic: 'daily', unit_type: 'word' }
];
const distractors = quiz.buildDistractors(answer, distractorPool, {
  count: 3,
  direction: 'ro-to-zh',
  random: seededRandom(9)
});
assert.strictEqual(distractors.length, 3, 'a four-choice item should receive three usable distractors when the bank allows it');
assert(!distractors.some(word => word.ro === answer.ro), 'the correct word must never be its own distractor');
assert(!distractors.some(word => word.zh === answer.zh), 'visible answer labels must be unique');
assert.strictEqual(distractors[0].part_of_speech, 'noun', 'same-class distractors should outrank unrelated words');
assert.strictEqual(distractors[0].topic, 'daily', 'same-topic distractors should be preferred when available');

assert.deepStrictEqual(
  quiz.classifyDictation('  ȚARĂ  ', 'țară'),
  { kind: 'exact', points: 1, exact: true, listeningCorrect: true },
  'dictation should normalize case, spaces, and Unicode'
);
assert.deepStrictEqual(
  quiz.classifyDictation('tara', 'țară'),
  { kind: 'diacritics', points: 0.5, exact: false, listeningCorrect: true },
  'missing Romanian diacritics should preserve listening credit but lose spelling credit'
);
assert.strictEqual(quiz.classifyDictation('țară', 'țări').kind, 'wrong', 'a changed lexical ending must not receive partial credit');
assert.strictEqual(quiz.classifyDictation('   ', 'țară').kind, 'blank', 'blank answers must not be scored');

const trustedAudioWord = {
  audio_url: 'https://upload.wikimedia.org/example.ogg',
  audio_kind: 'human',
  audio_source: 'Wikimedia Commons File:example.ogg',
  audio_license: 'CC BY-SA 4.0'
};
assert.strictEqual(
  quiz.getTrustedAudioUrl(trustedAudioWord, 'https://romanian-vocab.example/'),
  'https://upload.wikimedia.org/example.ogg',
  'fully attributed HTTPS human audio should be eligible'
);
for (const unsafeAudioWord of [
  { ...trustedAudioWord, audio_url: 'javascript:alert(1)' },
  { ...trustedAudioWord, audio_url: 'http://audio.example/word.ogg' },
  { ...trustedAudioWord, audio_kind: 'synthetic' },
  { ...trustedAudioWord, audio_source: '' },
  { ...trustedAudioWord, audio_license: '' }
]) {
  assert.strictEqual(quiz.getTrustedAudioUrl(unsafeAudioWord, 'https://romanian-vocab.example/'), '', 'untrusted audio metadata must fall back to device synthesis');
}

const summary = quiz.summarizeResults([
  { type: 'listening', exact: true, points: 1, replayCount: 1, audioSource: 'recording' },
  { type: 'dictation', exact: false, points: 0.5, replayCount: 2, audioSource: 'tts' },
  { type: 'translation', exact: true, points: 1, replayCount: 0, audioSource: '' }
]);
assert.strictEqual(summary.percent, 83, 'the result should preserve partial dictation credit');
assert.strictEqual(summary.partial, 1, 'partial-credit items must remain visible in the result');
assert.strictEqual(summary.listeningCount, 2, 'listening choice and dictation must share the listening evidence count');
assert.strictEqual(summary.recordingCount, 1, 'recorded and synthetic audio evidence must remain distinguishable');

const trustedWords = words.filter(quiz.isAssessmentEligible);
assert(trustedWords.length >= 100, 'the production bank must have enough reviewed words for a 100-item diagnostic');
for (const target of trustedWords) {
  const options = quiz.buildDistractors(target, trustedWords, {
    count: 3,
    direction: 'ro-to-zh',
    random: seededRandom(Number(target.id || 1))
  });
  assert.strictEqual(options.length, 3, `trusted item ${target.ro} must have three distractors`);
  assert.strictEqual(new Set(options.map(option => quiz.normalizeChineseLabel(option.zh))).size, 3, `trusted item ${target.ro} must not expose duplicate labels`);
  assert(!options.some(option => quiz.normalizeChineseLabel(option.zh) === quiz.normalizeChineseLabel(target.zh)), `trusted item ${target.ro} must not use an equivalent visible answer as a distractor`);
}
for (let seed = 1; seed <= 25; seed++) {
  const plan = quiz.buildDiagnosticPlan(trustedWords, { size: 100, difficulty: 'standard', random: seededRandom(seed) });
  assert.strictEqual(plan.length, 100, `seed ${seed} must produce a complete 100-item plan`);
  assert.strictEqual(new Set(plan.map(item => item.word.ro)).size, plan.length, `seed ${seed} must not repeat target words`);
  assert.strictEqual(plan.filter(item => ['listening', 'dictation'].includes(item.type)).length, 70, `seed ${seed} must preserve the listening blueprint`);
}
assert(app.includes('综合诊断只使用“已核对/已修订”词条'), 'the setup must disclose the content-quality gate');
assert(index.includes('不等于 CEFR'), 'the UI must not overclaim CEFR alignment');
assert(app.includes("qExerciseMode = 'diagnostic'"), 'the quiz tab should default to the multidimensional diagnostic');
assert(app.includes("qCurrentAudioPlays >= 2"), 'listening assessment must cap replay count');
assert(app.includes("result.listeningCorrect ? 'quiz_correct' : 'quiz_wrong'"), 'dictation spelling partials must not erase correct sound recognition');
assert(!app.includes('setTimeout(() => speakQuizWord'), 'listening assessment must require an explicit playback action');
assert(!app.includes('data-ok='), 'the rendered DOM must not disclose which option is correct');

console.log('scientific quiz checks passed');
