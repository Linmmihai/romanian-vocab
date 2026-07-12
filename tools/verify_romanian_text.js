const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const code = fs.readFileSync(path.resolve(__dirname, '..', 'romanian-text.js'), 'utf8');
const context = { globalThis: {} };
vm.createContext(context);
vm.runInContext(code, context);
const text = context.globalThis.RomanianVocabText;

assert(text, 'Romanian text helpers must be exported');
assert.strictEqual(text.autoStressWord('fenomen'), 'fenOmen');
assert.strictEqual(text.getStressDisplay({ ro: 'masă', ipa: 'mAsă' }).auto, false);
assert(text.stressToHtml('mAsă').includes('<span class="stress-mark">a</span>'));
assert.strictEqual(text.getGrammarInfo({ cat: '副词', ro: 'repede' }), '副词');
assert(!text.stressToHtml('<script>').includes('<script>'), 'stress markup must escape HTML');

console.log('Romanian text verification passed');
