const assert = require('assert');
const fs = require('fs');
const path = require('path');

const api = fs.readFileSync(path.join(__dirname, '..', 'api.js'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

assert(api.includes('function dailyStatePendingKey'), 'daily state must have a durable pending key');
assert(api.includes('function queueDailyStateForSync'), 'daily state writes must enter a pending queue');
assert(api.includes('function clearPendingDailyStatePart'), 'daily state pending entries must be cleared only after cloud success');
assert(api.includes('function apiRetryPendingDailyState'), 'daily state pending entries must have an explicit retry worker');
assert(api.includes('queueDailyStateForSync(userId, today, { queue: payload })'), 'daily queue saves must be queued before cloud sync');
assert(api.includes('queueDailyStateForSync(userId, today, { log: localPayload })'), 'daily log saves must be queued before cloud sync');
assert(api.includes('function createDailySyncToken'), 'daily pending writes must have per-write sync tokens');
assert(api.includes('function createProgressSyncToken'), 'progress pending writes must have per-write sync tokens');
assert(api.includes("clearPendingDailyStatePart(userId, today, 'queue', payload.sync_token, payload.updated_at)"), 'daily queue pending must clear after successful cloud upsert');
assert(api.includes("clearPendingDailyStatePart(userId, today, 'log', localPayload.sync_token, localPayload.updated_at)"), 'daily log pending must clear after successful cloud upsert');
assert(api.includes('currentToken !== syncedToken'), 'pending clear must not delete a newer local write with a different token');
assert(api.includes('pendingSyncToken: createProgressSyncToken(key)'), 'progress pending writes must store token');
assert(api.includes('pendingSyncToken: p.pendingSyncToken'), 'progress retry must clear only the saved pending token');
assert(api.includes('updated_at|schema cache|Could not find'), 'daily log updated_at must have schema fallback');
assert(api.includes('local, syncError, pendingSync'), 'cloud payloads must strip client-only fields');
assert(api.includes('queue_date: date'), 'daily queue retry must use the pending entry date');
assert(api.includes('log_date: date'), 'daily log retry must use the pending entry date');
assert(api.includes('readPendingDailyState(userId)?.[today]?.queue'), 'daily queue reads must overlay pending queue state');
assert(api.includes('readPendingDailyState(userId)?.[today]?.log'), 'today log reads must overlay pending log state');
assert(api.includes('pendingLogs'), 'recent logs must include pending local logs');

assert(app.includes('function hasPendingSync'), 'UI sync state must include daily pending state');
assert(app.includes('apiRetryPendingDailyState(currentUser.id)'), 'app must retry daily pending state');
assert(app.includes("window.addEventListener('online'"), 'app must retry when the network comes back');
assert(app.includes('if (!hasPendingSync()) setSyncBadge'), 'sync badge must not clear while any pending state remains');
assert(app.includes('retryPendingProgressAfterLoad();'), 'startup must trigger pending retry');
assert(app.includes('|| hasPendingSync()'), 'progress refresh success must not mask daily pending state');
assert(app.includes('&& !hasDailyPending'), 'daily pending startup retry must not be blocked by progress cooldown');
assert(app.includes("triggerCloudProgressBackup('启动同步'"), 'startup retry must use the shared in-flight sync path');
assert(app.includes('if (!hasPendingSync() && !options.force) return null'), 'clean idle sync should skip no-op cloud writes');

console.log('daily sync pending verification passed');
