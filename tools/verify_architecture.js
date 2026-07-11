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

const scriptOrder = [
  'scheduler.js?v=20260711-quality-cleanup',
  'progress-model.js?v=20260711-quality-cleanup',
  'daily-plan.js?v=20260711-quality-cleanup',
  'api.js?v=20260711-quality-cleanup',
  'auth.js?v=20260619-direct-front-reset',
  'app.js?v=20260711-quality-cleanup'
].map(script => index.indexOf(script));

assert(scriptOrder.every(position => position >= 0), 'all runtime modules must be present in index.html');
assert(scriptOrder.every((position, index) => index === 0 || position > scriptOrder[index - 1]), 'runtime modules must load in dependency order');
assert(build.includes("'progress-model.js'"), 'web build must copy the progress model');
assert(build.includes("'progress-model.js',"), 'web build completeness list must require the progress model');
assert(build.includes("'daily-plan.js'"), 'web build must copy and require the daily planner');
assert(serviceWorker.includes("'./progress-model.js'"), 'PWA app shell must include the progress model');
assert(serviceWorker.includes("'./daily-plan.js'"), 'PWA app shell must include the daily planner');
assert(serviceWorker.includes("ro-vocab-pwa-v18"), 'PWA cache must advance with the quality cleanup');
assert(progressModel.includes('function mergeEntries'), 'progress model must own entry merge behavior');
assert(progressModel.includes('function selectSchedulerBase'), 'progress model must own scheduler snapshot selection');
assert(dailyPlan.includes('function composeOpenQueue'), 'daily planner must own fixed-quota queue composition');
assert(dailyPlan.includes('function buildTieredPlan'), 'daily planner must own tiered plan composition');
assert(progressModel.includes('getGrammarRight: grammarRight'), 'progress model must expose grammar-right normalization');
assert(progressModel.includes('getGrammarTotal: grammarTotal'), 'progress model must expose grammar-total normalization');
assert(!app.includes('function mergeProgressEntry'), 'app.js must not own progress merge behavior');
assert(!api.includes('function isSchedulerMergeDowngrade'), 'api.js must not own scheduler selection behavior');
assert(!app.includes('function buildSmartDailyPlan'), 'app.js must not keep the obsolete duplicate planner');
assert(!app.includes('getProgressGrammarQr'), 'app.js must not call the removed grammar-right helper');
assert(!app.includes('getProgressGrammarQt'), 'app.js must not call the removed grammar-total helper');

console.log('architecture verification passed');
