const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('index.html');
const app = read('app.js');
const api = read('api.js');
const auth = read('auth.js');

assert(html.includes('id="sync-badge-text"'), 'top bar must keep a persistent sync status');
assert(html.includes('onclick="openAccountModal()"'), 'top sync status must open its details');
assert(html.includes('id="account-sync-panel"'), 'account modal must include a today-sync panel');
assert(html.includes('id="manual-sync-btn"'), 'account modal must expose manual sync');
assert(html.includes('onclick="manualSyncToday()"'), 'manual sync button must call the serialized sync action');
assert(!html.includes('提交今日记录'), 'sync must not be mislabeled as a final or irreversible submission');

assert(app.includes('let manualSyncInFlight = null'), 'manual sync must serialize repeated clicks');
assert(app.includes('if (manualSyncInFlight) return manualSyncInFlight'), 'duplicate clicks must share the in-flight request');
assert(app.includes('if (!progressLoaded || !dailyQueueLoaded || !todayLog)'), 'manual sync must not submit an incomplete loading snapshot');
assert(app.includes('flushFastProgressQueue();'), 'manual sync must flush buffered card answers first');
assert(app.includes("triggerCloudProgressBackup('同步今日记录', { force: true, limit: 1000 })"), 'manual sync must force the shared cloud retry path');
assert(app.includes('apiVerifyTodayState(currentUser.id, snapshot)'), 'manual sync success must require daily cloud read-back');
assert(app.includes('apiVerifyProgressState(currentUser.id, progressMap)'), 'manual sync success must require full progress cloud read-back');
assert(app.includes('if (pending.totalCount || hasPendingProgress())'), 'manual sync must reject success while durable work remains');
assert(app.includes("phase: pending.totalCount || hasPendingProgress() ? 'pending' : 'error'"), 'failure copy must distinguish pending local data from an unconfirmed cloud result');
assert(app.includes("showToast('今日记录已同步到云端')"), 'success copy must be explicit');

assert(api.includes("sb.from('daily_log')"), 'cloud verification must read the daily log');
assert(api.includes("sb.from('daily_queue')"), 'cloud verification must read the daily queue');
assert(auth.includes('window.renderCloudSyncPanel?.();'), 'opening the account modal must refresh current sync details');
assert(html.includes("window.ROMANIAN_VOCAB_APP_VERSION='20260819-scientific-quiz-v1'"), 'scientific quiz release must have a distinct app version');

console.log('manual sync UI verification passed');
