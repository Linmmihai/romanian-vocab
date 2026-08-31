const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const api = fs.readFileSync(path.join(root, 'api.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const serviceWorker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');

function functionSource(source, name) {
  const start = source.indexOf(`async function ${name}`);
  assert(start >= 0, `missing function ${name}`);
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  for (let i = bodyStart; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}') depth--;
    if (depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`unterminated function ${name}`);
}

(async () => {
  const pagedLoaderSource = functionSource(api, 'apiLoadPagedRows');
  const loadPagedRows = new Function('PROGRESS_PAGE_SIZE', `${pagedLoaderSource}; return apiLoadPagedRows;`)(500);
  const sourceRows = Array.from({ length: 1203 }, (_, id) => ({ id: id + 1 }));
  const calls = [];
  const result = await loadPagedRows(async (from, to) => {
    calls.push([from, to]);
    return { data: sourceRows.slice(from, to + 1), error: null };
  });

  assert.strictEqual(result.error, null, 'paged class reads should finish without an error');
  assert.strictEqual(result.data.length, sourceRows.length, 'paged class reads must not stop at the first server-sized page');
  assert.deepStrictEqual(calls, [[0, 499], [500, 999], [1000, 1499]], 'paged class reads should request every non-overlapping range');

  const progressBlock = functionSource(api, 'apiLoadAllProgress');
  assert(progressBlock.includes("sb.rpc('admin_load_all_progress')"), 'leaderboard progress should keep the protected RPC path');
  assert(progressBlock.includes(".order('id', { ascending: true })"), 'leaderboard progress pages need a stable unique order');
  assert.strictEqual((progressBlock.match(/apiLoadPagedRows/g) || []).length, 2, 'both RPC and RLS fallback progress reads must paginate');

  const logsBlock = functionSource(api, 'apiGetClassRecentLogs');
  assert(logsBlock.includes(".order('log_date', { ascending: false })"), 'class log pages need a stable date order');
  assert(logsBlock.includes(".order('user_id', { ascending: true })"), 'class log pages need a stable tie-breaker');
  assert.strictEqual((logsBlock.match(/apiLoadPagedRows/g) || []).length, 2, 'both RPC and RLS fallback class-log reads must paginate');

  const leaderboardBlock = functionSource(app, 'renderLeaderboard');
  assert(leaderboardBlock.includes("triggerCloudProgressBackup('刷新排行', { force: true, limit: 1000 })"), 'leaderboard refresh must flush the current user before reading class totals');
  assert(leaderboardBlock.includes('u.id === currentUser.id ? progressMap'), 'the current leaderboard row must match the current personal progress map');
  assert(leaderboardBlock.includes('logsByUser[currentUser.id] = currentLogsResult.value || []'), 'the current streak must include local pending daily logs');
  assert(leaderboardBlock.includes('renderToken !== leaderboardRenderToken'), 'an older refresh must not overwrite a newer leaderboard result');

  assert(index.includes("window.ROMANIAN_VOCAB_APP_VERSION='20260831-leaderboard-sync-v1'"), 'leaderboard sync fix must ship with a new app version');
  assert(serviceWorker.includes("ro-vocab-pwa-v45"), 'leaderboard sync fix must ship with a new service-worker cache');

  console.log('leaderboard sync verification passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
