const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const serviceWorker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');

function functionBlock(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} should exist`);
  const next = source.indexOf('\nfunction ', start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

const queueMessage = functionBlock(app, 'getDailyQueueLocalSaveMessage');
assert(!/daily_queue|数据库表|数据库字段/.test(queueMessage), 'queue save message should not expose database implementation details');
assert(queueMessage.includes('暂未同步到其他设备'), 'local queue message should explain the user-visible limitation');

const saveWarning = functionBlock(app, 'handleProgressSaveStatus');
assert(!/数据库缺少|数据库字段/.test(saveWarning), 'progress warning should use user-facing language');

assert(html.includes('.sync-badge{display:inline-block;max-width:82px'), 'mobile sync status should remain visible');
const baseToastRule = html.indexOf('.toast{position:fixed;bottom:24px');
const mobileToastRule = html.indexOf('.toast{bottom:calc(64px + env(safe-area-inset-bottom))', baseToastRule);
assert(baseToastRule !== -1 && mobileToastRule > baseToastRule, 'mobile toast override should follow the base rule and clear the bottom navigation');
assert(html.includes('id="toast" role="status" aria-live="polite"'), 'toast should announce status updates accessibly');
assert(html.includes('id="sync-badge" role="status" aria-live="polite"'), 'sync status should announce changes accessibly');
assert(html.includes('app.js?v=20260712-anki-queue'), 'app cache buster should include the Anki queue release');
assert(serviceWorker.includes('ro-vocab-pwa-v20'), 'service worker cache should include the Anki queue release');

console.log('user feedback UI verification passed');
