const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const runtimeFiles = ['app.js', 'api.js', 'auth.js', 'scheduler.js', 'progress-model.js', 'daily-plan.js', 'quiz-engine.js', 'index.html'];
const sources = runtimeFiles.map(file => [file, fs.readFileSync(path.join(root, file), 'utf8')]);
const runtimeText = sources.map(([, source]) => source).join('\n');
const intentionalEntrypoints = new Set([
  'applyStressGrammarPatch', // Manual admin console operation for one-off data repair.
  'apiGetDailyGoal' // Kept as part of the browser API compatibility surface.
]);

const unused = [];
for (const [file, source] of sources.filter(([file]) => file.endsWith('.js'))) {
  for (const match of source.matchAll(/^(?:async )?function\s+([A-Za-z_$][\w$]*)\s*\(/gm)) {
    const name = match[1];
    if (intentionalEntrypoints.has(name)) continue;
    const references = runtimeText.match(new RegExp(`\\b${name}\\b`, 'g')) || [];
    if (references.length === 1) unused.push(`${file}:${name}`);
  }
}

assert.deepStrictEqual(unused, [], `unused runtime functions found:\n${unused.join('\n')}`);
console.log('dead code verification passed');
