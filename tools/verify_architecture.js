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

const scriptOrder = [
  'scheduler.js?v=20260711-progress-model',
  'progress-model.js?v=20260711-progress-model',
  'api.js?v=20260711-progress-model',
  'auth.js?v=20260619-direct-front-reset',
  'app.js?v=20260711-progress-model'
].map(script => index.indexOf(script));

assert(scriptOrder.every(position => position >= 0), 'all runtime modules must be present in index.html');
assert(scriptOrder.every((position, index) => index === 0 || position > scriptOrder[index - 1]), 'runtime modules must load in dependency order');
assert(build.includes("'progress-model.js'"), 'web build must copy the progress model');
assert(build.includes("'progress-model.js',"), 'web build completeness list must require the progress model');
assert(serviceWorker.includes("'./progress-model.js'"), 'PWA app shell must include the progress model');
assert(serviceWorker.includes("ro-vocab-pwa-v16"), 'PWA cache must advance with the progress model extraction');
assert(progressModel.includes('function mergeEntries'), 'progress model must own entry merge behavior');
assert(progressModel.includes('function selectSchedulerBase'), 'progress model must own scheduler snapshot selection');
assert(progressModel.includes('getGrammarRight: grammarRight'), 'progress model must expose grammar-right normalization');
assert(progressModel.includes('getGrammarTotal: grammarTotal'), 'progress model must expose grammar-total normalization');
assert(!app.includes('function mergeProgressEntry'), 'app.js must not own progress merge behavior');
assert(!api.includes('function isSchedulerMergeDowngrade'), 'api.js must not own scheduler selection behavior');
assert(!app.includes('getProgressGrammarQr'), 'app.js must not call the removed grammar-right helper');
assert(!app.includes('getProgressGrammarQt'), 'app.js must not call the removed grammar-total helper');

console.log('architecture verification passed');
