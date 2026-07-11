const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const api = fs.readFileSync(path.join(root, 'api.js'), 'utf8');
const sql = fs.readFileSync(path.join(root, 'tools', 'security_rls_hardening.sql'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const serviceWorker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');

function assertBefore(source, first, second, message) {
  const firstIndex = source.indexOf(first);
  const secondIndex = source.indexOf(second);
  assert(firstIndex >= 0, `missing first marker: ${first}`);
  assert(secondIndex >= 0, `missing second marker: ${second}`);
  assert(firstIndex < secondIndex, message);
}

function functionBlock(source, name) {
  const start = source.indexOf(`async function ${name}`);
  assert(start >= 0, `missing function ${name}`);
  const next = source.indexOf('\nasync function ', start + 1);
  return source.slice(start, next >= 0 ? next : undefined);
}

assert(api.includes('function isMissingRpcError'), 'expected shared missing-RPC detection helper');

assertBefore(
  functionBlock(api, 'apiLoadAllProgress'),
  "sb.rpc('admin_load_all_progress')",
  "sb.from('progress')",
  'all-progress reads should try the admin RPC before falling back to raw progress reads'
);

assertBefore(
  functionBlock(api, 'apiGetClassRecentLogs'),
  "sb.rpc('admin_get_class_recent_logs', { days_count: days })",
  "sb.from('daily_log').select('*')",
  'class log reads should try the admin RPC before falling back to raw daily_log reads'
);

assertBefore(
  functionBlock(api, 'apiDeleteUserProfile'),
  "sb.rpc('admin_delete_user_profile'",
  "sb.from('profiles').delete()",
  'profile rejection should try the admin RPC before falling back to direct profile deletion'
);

assert(sql.includes('create or replace function public.admin_load_all_progress()'), 'expected admin progress RPC');
assert(sql.includes('create or replace function public.admin_get_class_recent_logs(days_count integer default 30)'), 'expected admin class logs RPC');
assert(sql.includes('create or replace function public.admin_delete_user_profile(target_user_id uuid)'), 'expected admin profile rejection RPC');
assert(sql.includes("raise exception 'Only admins can read class progress'"), 'progress RPC must reject non-admin callers');
assert(sql.includes("raise exception 'Only admins can read class logs'"), 'class logs RPC must reject non-admin callers');
assert(sql.includes('Admins cannot reject their own profile'), 'profile rejection RPC must protect the current admin');
assert(sql.includes("target_role = 'admin'"), 'profile rejection RPC must protect admin profiles');

[
  'admin_load_all_progress()',
  'admin_get_class_recent_logs(integer)',
  'admin_delete_user_profile(uuid)'
].forEach(signature => {
  assert(sql.includes(`revoke all on function public.${signature} from public;`), `expected public revoke for ${signature}`);
  assert(sql.includes(`revoke all on function public.${signature} from anon;`), `expected anon revoke for ${signature}`);
  assert(sql.includes(`grant execute on function public.${signature} to authenticated;`), `expected authenticated grant for ${signature}`);
});

assert(index.includes('api.js?v=20260711-admin-rpc-rls'), 'api.js cache-busting version must move with RLS API changes');
assert(serviceWorker.includes("ro-vocab-pwa-v13"), 'service worker cache name must move with RLS API changes');

console.log('admin RLS path verification passed');
