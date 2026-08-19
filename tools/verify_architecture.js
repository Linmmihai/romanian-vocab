const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const index = read('index.html');
const serviceWorker = read('sw.js');
const build = read('app build/scripts/build-web.mjs');
const app = read('app.js');
const api = read('api.js');
const progressModel = read('progress-model.js');
const dailyPlan = read('daily-plan.js');
const taxonomy = read('taxonomy.js');
const romanianText = read('romanian-text.js');
const quizEngine = read('quiz-engine.js');
const telemetry = read('telemetry.js');
const pwa = read('pwa.js');

const scriptOrder = [
  'scheduler.js?v=20260819-scientific-quiz-v1',
  'progress-model.js?v=20260819-scientific-quiz-v1',
  'daily-plan.js?v=20260819-scientific-quiz-v1',
  'taxonomy.js?v=20260819-scientific-quiz-v1',
  'romanian-text.js?v=20260819-scientific-quiz-v1',
  'quiz-engine.js?v=20260819-scientific-quiz-v1',
  'api.js?v=20260819-scientific-quiz-v1',
  'telemetry.js?v=20260819-scientific-quiz-v1',
  'auth.js?v=20260819-scientific-quiz-v1',
  'app.js?v=20260819-scientific-quiz-v1',
  'pwa.js?v=20260819-scientific-quiz-v1'
].map(script => index.indexOf(script));

assert(scriptOrder.every(position => position >= 0), 'all runtime modules must be present in index.html');
assert(scriptOrder.every((position, index) => index === 0 || position > scriptOrder[index - 1]), 'runtime modules must load in dependency order');
assert(build.includes("'progress-model.js'"), 'web build must copy the progress model');
assert(build.includes("'progress-model.js',"), 'web build completeness list must require the progress model');
assert(build.includes("'daily-plan.js'"), 'web build must copy and require the daily planner');
assert(build.includes("'taxonomy.js'"), 'web build must copy and require the vocabulary taxonomy');
assert(build.includes("'romanian-text.js'"), 'web build must copy and require Romanian text helpers');
assert(build.includes("'quiz-engine.js'"), 'web build must copy and require the quiz engine');
assert(build.includes("'telemetry.js'"), 'web build must copy and require telemetry');
assert(build.includes("'pwa.js'"), 'web build must copy and require the PWA update controller');
assert(serviceWorker.includes("'./progress-model.js'"), 'PWA app shell must include the progress model');
assert(serviceWorker.includes("'./daily-plan.js'"), 'PWA app shell must include the daily planner');
assert(serviceWorker.includes("'./taxonomy.js'"), 'PWA app shell must include the vocabulary taxonomy');
assert(serviceWorker.includes("'./romanian-text.js'"), 'PWA app shell must include Romanian text helpers');
assert(serviceWorker.includes("'./quiz-engine.js'"), 'PWA app shell must include the quiz engine');
assert(serviceWorker.includes("'./telemetry.js'"), 'PWA app shell must include telemetry');
assert(serviceWorker.includes("'./pwa.js'"), 'PWA app shell must include the update controller');
assert(serviceWorker.includes("ro-vocab-pwa-v46-scientific-quiz-v1"), 'PWA cache must advance with the scientific quiz release');
assert(serviceWorker.includes("'./data/grammar-courses.json'"), 'PWA app shell must include grammar course data');
assert(serviceWorker.includes("'./data/grammar-content.json'"), 'PWA app shell must include structured grammar content');
assert(build.includes("'data/grammar-courses.json'"), 'web build must require grammar course data');
assert(build.includes("'data/grammar-content.json'"), 'web build must require structured grammar content');
assert(progressModel.includes('function mergeEntries'), 'progress model must own entry merge behavior');
assert(progressModel.includes('function selectSchedulerBase'), 'progress model must own scheduler snapshot selection');
assert(dailyPlan.includes('function composeOpenQueue'), 'daily planner must own fixed-quota queue composition');
assert(dailyPlan.includes('function buildTieredPlan'), 'daily planner must own tiered plan composition');
assert(taxonomy.includes('function normalizeTopic'), 'taxonomy module must own topic normalization');
assert(taxonomy.includes('function normalizePartOfSpeech'), 'taxonomy module must own part-of-speech normalization');
assert(taxonomy.includes('function normalizeUnitType'), 'taxonomy module must own lexical-unit normalization');
assert(romanianText.includes('function stressToHtml'), 'Romanian text module must own stress rendering');
assert(quizEngine.includes('function buildDiagnosticPlan'), 'quiz engine must own diagnostic blueprint construction');
assert(quizEngine.includes('function buildDistractors'), 'quiz engine must own distractor construction');
assert(quizEngine.includes('function classifyDictation'), 'quiz engine must own dictation scoring');
assert(telemetry.includes('function reportClientIssue'), 'telemetry must own client issue reporting');
assert(pwa.includes('function showUpdatePrompt'), 'PWA controller must own the update prompt');
assert(progressModel.includes('getGrammarRight: grammarRight'), 'progress model must expose grammar-right normalization');
assert(progressModel.includes('getGrammarTotal: grammarTotal'), 'progress model must expose grammar-total normalization');
assert(!app.includes('function mergeProgressEntry'), 'app.js must not own progress merge behavior');
assert(!api.includes('function isSchedulerMergeDowngrade'), 'api.js must not own scheduler selection behavior');
assert(!app.includes('function buildSmartDailyPlan'), 'app.js must not keep the obsolete duplicate planner');
assert(!app.includes('function autoStressToken'), 'app.js must not own Romanian stress parsing');
assert(!app.includes('getProgressGrammarQr'), 'app.js must not call the removed grammar-right helper');
assert(!app.includes('getProgressGrammarQt'), 'app.js must not call the removed grammar-total helper');

console.log('architecture verification passed');
