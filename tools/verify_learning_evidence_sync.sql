-- Run after learning_evidence_sync.sql in the Supabase SQL editor.
-- Requires two existing auth users. Every verification row is rolled back.

begin;

do $$
begin
  if (select count(*) from auth.users) < 2 then
    raise exception 'Learning evidence sync verification needs two auth users';
  end if;
end;
$$;

create or replace function pg_temp.assert_evidence(p_ok boolean, p_message text)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if not coalesce(p_ok, false) then raise exception '%', p_message; end if;
end;
$$;

-- User A: accept an event, keep the first payload on retry, and create an early tombstone.
select set_config('request.jwt.claim.sub',
  (select id::text from auth.users order by id limit 1), true);
set local role authenticated;

select public.apply_learning_evidence_batch('[{
  "event_id":"codex-verify-evidence-primary","word_id":424242,
  "payload":{"id":"codex-verify-evidence-primary","at":"2026-09-07T01:02:03Z",
  "date":"2026-09-07","interaction":"quiz_correct","wordId":424242}
}]'::jsonb);
select public.apply_learning_evidence_batch('[{
  "event_id":"codex-verify-evidence-primary","word_id":999999,
  "payload":{"id":"codex-verify-evidence-primary","at":"2026-09-07T02:02:03Z",
  "date":"2026-09-07","interaction":"stale_retry","wordId":999999}
},{"event_id":"codex-verify-evidence-before-create","deleted":true}]'::jsonb);

select pg_temp.assert_evidence(
  (select payload ->> 'interaction' = 'quiz_correct'
   from public.learning_evidence_events
   where event_id = 'codex-verify-evidence-primary'),
  'same-id retry replaced the first payload');

-- Delete the live event, then replay both events from an old offline device.
select public.apply_learning_evidence_batch('[
  {"event_id":"codex-verify-evidence-primary","deleted":true},
  {"event_id":"codex-verify-evidence-before-create","word_ro":"acasă",
   "payload":{"id":"codex-verify-evidence-before-create","at":"2026-09-07T03:02:03Z",
   "date":"2026-09-07","interaction":"flashcard_known","wordRo":"acasă"}}
]'::jsonb);
select pg_temp.assert_evidence(
  (select bool_and(deleted) and count(*) = 2
   from public.learning_evidence_events
   where event_id like 'codex-verify-evidence-%'),
  'tombstone failed to survive offline replay');
select pg_temp.assert_evidence(
  (select payload is null from public.learning_evidence_events
   where event_id = 'codex-verify-evidence-before-create'),
  'delete-before-create accepted a late payload');

reset role;

-- User B sees none of A's rows and owns an independent row with the same event id.
select set_config('request.jwt.claim.sub',
  (select id::text from auth.users order by id limit 1 offset 1), true);
set local role authenticated;
select pg_temp.assert_evidence(
  (select count(*) = 0 from public.learning_evidence_events),
  'RLS exposed user A evidence to user B');
select public.apply_learning_evidence_batch('[{
  "event_id":"codex-verify-evidence-primary","word_ro":"mână",
  "payload":{"id":"codex-verify-evidence-primary","at":"2026-09-07T04:02:03Z",
  "date":"2026-09-07","interaction":"quiz_wrong","wordRo":"mână"}
}]'::jsonb);
select pg_temp.assert_evidence(
  (select count(*) = 1 from public.learning_evidence_events
   where event_id like 'codex-verify-evidence-%'),
  'per-user event identity or RLS failed');
reset role;

-- Direct writes, anonymous reads, and anonymous RPC calls stay denied.
select pg_temp.assert_evidence(
  not has_table_privilege('authenticated', 'public.learning_evidence_events', 'INSERT')
  and not has_table_privilege('authenticated', 'public.learning_evidence_events', 'UPDATE'),
  'authenticated received direct table write privileges');
select pg_temp.assert_evidence(
  not has_table_privilege('anon', 'public.learning_evidence_events', 'SELECT'),
  'anon can read the learning evidence table');
select pg_temp.assert_evidence(
  not has_function_privilege('anon', 'public.apply_learning_evidence_batch(jsonb)', 'EXECUTE'),
  'anon can execute the learning evidence RPC');

rollback;
