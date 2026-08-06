-- Atomic, idempotent synchronization for daily_queue and daily_log.
--
-- Daily state is synchronized as base -> target deltas. The RPC locks both
-- rows, applies set/count deltas in one transaction, and records each event id
-- before returning. Concurrent devices therefore preserve independent card
-- completions, while a retried POST cannot apply the same delta twice.

begin;

alter table public.daily_queue
  add column if not exists sync_revision bigint not null default 0;

alter table public.daily_log
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists sync_revision bigint not null default 0;

create unique index if not exists daily_log_user_date_sync_uidx
  on public.daily_log (user_id, log_date);

create table if not exists public.daily_state_sync_events (
  user_id uuid not null references auth.users(id) on delete cascade,
  event_id text not null,
  state_date date not null,
  client_id text not null,
  client_seq bigint not null,
  base_state jsonb not null,
  target_state jsonb not null,
  applied_revision bigint,
  created_at timestamptz not null default clock_timestamp(),
  primary key (user_id, event_id),
  unique (user_id, client_id, client_seq),
  constraint daily_state_sync_events_event_id_ck
    check (char_length(event_id) between 8 and 200),
  constraint daily_state_sync_events_client_id_ck
    check (char_length(client_id) between 8 and 200),
  constraint daily_state_sync_events_client_seq_ck
    check (client_seq > 0),
  constraint daily_state_sync_events_state_shape_ck
    check (jsonb_typeof(base_state) = 'object' and jsonb_typeof(target_state) = 'object'),
  constraint daily_state_sync_events_state_size_ck
    check (pg_column_size(base_state) <= 65536 and pg_column_size(target_state) <= 65536)
);

create index if not exists daily_state_sync_events_user_date_idx
  on public.daily_state_sync_events (user_id, state_date, created_at desc);

create table if not exists public.daily_state_sync_client_heads (
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id text not null,
  last_seq bigint not null default 0,
  updated_at timestamptz not null default clock_timestamp(),
  primary key (user_id, client_id),
  constraint daily_state_sync_client_heads_client_id_ck
    check (char_length(client_id) between 8 and 200),
  constraint daily_state_sync_client_heads_last_seq_ck
    check (last_seq >= 0)
);

alter table public.daily_state_sync_events enable row level security;
alter table public.daily_state_sync_client_heads enable row level security;

drop policy if exists "Users can read own daily state events" on public.daily_state_sync_events;
create policy "Users can read own daily state events"
  on public.daily_state_sync_events for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert own daily state events" on public.daily_state_sync_events;
create policy "Users can insert own daily state events"
  on public.daily_state_sync_events for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can read own daily state client heads" on public.daily_state_sync_client_heads;
create policy "Users can read own daily state client heads"
  on public.daily_state_sync_client_heads for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert own daily state client heads" on public.daily_state_sync_client_heads;
create policy "Users can insert own daily state client heads"
  on public.daily_state_sync_client_heads for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update own daily state client heads" on public.daily_state_sync_client_heads;
create policy "Users can update own daily state client heads"
  on public.daily_state_sync_client_heads for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on table public.daily_state_sync_events from public, anon, authenticated;
revoke all on table public.daily_state_sync_client_heads from public, anon, authenticated;
grant select, insert on table public.daily_state_sync_events to authenticated;
grant select, insert, update on table public.daily_state_sync_client_heads to authenticated;

-- Convert a JSON array to a de-duplicated integer array while keeping the
-- first occurrence order. Malformed values fail the event instead of silently
-- corrupting a queue.
create or replace function public.daily_state_jsonb_int_array(p_value jsonb)
returns integer[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(item_id order by first_ordinality), '{}'::integer[])
  from (
    select value::integer as item_id, min(ordinality) as first_ordinality
    from jsonb_array_elements_text(
      case when jsonb_typeof(p_value) = 'array' then p_value else '[]'::jsonb end
    ) with ordinality as entries(value, ordinality)
    group by value::integer
  ) normalized;
$$;

-- Apply target-base membership changes to the current server array. Target
-- order is preferred, and concurrent server-only entries are appended rather
-- than erased by a stale snapshot.
create or replace function public.daily_state_apply_int_delta(
  p_current integer[],
  p_base integer[],
  p_target integer[]
)
returns integer[]
language sql
immutable
set search_path = ''
as $$
  with removals as (
    select id from unnest(coalesce(p_base, '{}'::integer[])) as removed(id)
    except
    select id from unnest(coalesce(p_target, '{}'::integer[])) as retained(id)
  ),
  candidates as (
    select id, 0 as source_rank, ordinality::bigint as position
    from unnest(coalesce(p_target, '{}'::integer[])) with ordinality as target(id, ordinality)
    union all
    select id, 1 as source_rank, ordinality::bigint as position
    from unnest(coalesce(p_current, '{}'::integer[])) with ordinality as current_values(id, ordinality)
  ),
  normalized as (
    select distinct on (id) id, source_rank, position
    from candidates
    where not exists (select 1 from removals where removals.id = candidates.id)
    order by id, source_rank, position
  )
  select coalesce(array_agg(id order by source_rank, position), '{}'::integer[])
  from normalized;
$$;

create or replace function public.apply_daily_state_sync_event(
  p_event_id text,
  p_state_date date,
  p_client_id text,
  p_client_seq bigint,
  p_base_state jsonb,
  p_target_state jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_base_queue jsonb := coalesce(p_base_state -> 'queue', '{}'::jsonb);
  v_target_queue jsonb := coalesce(p_target_state -> 'queue', '{}'::jsonb);
  v_base_log jsonb := coalesce(p_base_state -> 'log', '{}'::jsonb);
  v_target_log jsonb := coalesce(p_target_state -> 'log', '{}'::jsonb);
  v_base_open integer[] := public.daily_state_jsonb_int_array(p_base_state #> '{queue,word_id}');
  v_target_open integer[] := public.daily_state_jsonb_int_array(p_target_state #> '{queue,word_id}');
  v_base_completed integer[] := public.daily_state_jsonb_int_array(p_base_state #> '{queue,completed_word_id}');
  v_target_completed integer[] := public.daily_state_jsonb_int_array(p_target_state #> '{queue,completed_word_id}');
  v_base_introduced integer[] := public.daily_state_jsonb_int_array(p_base_state #> '{queue,introduced_word_id}');
  v_target_introduced integer[] := public.daily_state_jsonb_int_array(p_target_state #> '{queue,introduced_word_id}');
  v_open integer[];
  v_completed integer[];
  v_introduced integer[];
  v_goal integer;
  v_new_words integer;
  v_queue_completed boolean;
  v_log_completed boolean;
  v_log_delta integer := 0;
  v_last_seq bigint;
  v_revision bigint;
  v_queue public.daily_queue%rowtype;
  v_log public.daily_log%rowtype;
  v_existing_event public.daily_state_sync_events%rowtype;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_state_date is null or p_state_date < current_date - 3660 or p_state_date > current_date + 1 then
    raise exception 'Invalid daily state date' using errcode = '22023';
  end if;
  if coalesce(char_length(p_event_id), 0) < 8 or char_length(p_event_id) > 200 then
    raise exception 'Invalid daily state event id' using errcode = '22023';
  end if;
  if coalesce(char_length(p_client_id), 0) < 8 or char_length(p_client_id) > 200 or coalesce(p_client_seq, 0) <= 0 then
    raise exception 'Invalid daily state client sequence' using errcode = '22023';
  end if;
  if jsonb_typeof(p_base_state) <> 'object' or jsonb_typeof(p_target_state) <> 'object' then
    raise exception 'Daily state event states must be JSON objects' using errcode = '22023';
  end if;
  if pg_column_size(p_base_state) > 65536 or pg_column_size(p_target_state) > 65536 then
    raise exception 'Daily state event is too large' using errcode = '22023';
  end if;
  if cardinality(v_base_open) > 5000 or cardinality(v_target_open) > 5000
    or cardinality(v_base_completed) > 5000 or cardinality(v_target_completed) > 5000
    or cardinality(v_base_introduced) > 5000 or cardinality(v_target_introduced) > 5000 then
    raise exception 'Daily state arrays are too large' using errcode = '22023';
  end if;

  v_goal := greatest(1, least(5000, coalesce(
    nullif(v_base_queue ->> 'goal', '')::integer,
    nullif(v_base_log ->> 'goal', '')::integer,
    nullif(v_target_queue ->> 'goal', '')::integer,
    nullif(v_target_log ->> 'goal', '')::integer,
    200
  )));

  insert into public.daily_queue (
    user_id, queue_date, goal, word_id, word_ro,
    completed_word_id, completed_word_ro,
    introduced_word_id, introduced_word_ro,
    completed, updated_at, sync_revision
  ) values (
    v_user_id, p_state_date, v_goal, v_base_open, '{}'::text[],
    v_base_completed, '{}'::text[], v_base_introduced, '{}'::text[],
    coalesce((v_base_queue ->> 'completed')::boolean, false), v_now, 0
  ) on conflict (user_id, queue_date) do nothing;

  insert into public.daily_log (
    user_id, log_date, new_words, goal, completed, updated_at, sync_revision
  ) values (
    v_user_id,
    p_state_date,
    greatest(0, coalesce(nullif(v_base_log ->> 'new_words', '')::integer, 0)),
    v_goal,
    coalesce((v_base_log ->> 'completed')::boolean, false),
    v_now,
    0
  ) on conflict (user_id, log_date) do nothing;

  select q.* into v_queue
  from public.daily_queue q
  where q.user_id = v_user_id and q.queue_date = p_state_date
  for update;

  select l.* into v_log
  from public.daily_log l
  where l.user_id = v_user_id and l.log_date = p_state_date
  for update;

  select e.* into v_existing_event
  from public.daily_state_sync_events e
  where e.user_id = v_user_id and e.event_id = p_event_id;
  if found then
    if v_existing_event.state_date <> p_state_date
      or v_existing_event.client_id <> p_client_id
      or v_existing_event.client_seq <> p_client_seq then
      raise exception 'Daily state event id was reused with different identity' using errcode = '22023';
    end if;
    return jsonb_build_object(
      'event_id', p_event_id,
      'duplicate', true,
      'revision', greatest(v_queue.sync_revision, v_log.sync_revision),
      'queue', to_jsonb(v_queue),
      'log', to_jsonb(v_log)
    );
  end if;

  insert into public.daily_state_sync_client_heads (user_id, client_id, last_seq, updated_at)
  values (v_user_id, p_client_id, 0, v_now)
  on conflict (user_id, client_id) do nothing;

  select h.last_seq into v_last_seq
  from public.daily_state_sync_client_heads h
  where h.user_id = v_user_id and h.client_id = p_client_id
  for update;

  -- A delayed request from the same client must never undo a newer event. This
  -- is a successful no-op so the obsolete local outbox entry can be removed.
  if p_client_seq <= v_last_seq then
    return jsonb_build_object(
      'event_id', p_event_id,
      'ignored', true,
      'revision', greatest(v_queue.sync_revision, v_log.sync_revision),
      'queue', to_jsonb(v_queue),
      'log', to_jsonb(v_log)
    );
  end if;

  -- A later base->target delta does not include a missing earlier delta. Refuse
  -- gaps so a buggy/reordered client cannot acknowledge sequence N+1 while N
  -- is still only in the local outbox.
  if p_client_seq <> v_last_seq + 1 then
    raise exception 'Daily state client sequence gap: expected %, received %', v_last_seq + 1, p_client_seq
      using errcode = '40001';
  end if;

  v_open := v_queue.word_id;
  v_completed := v_queue.completed_word_id;
  v_introduced := v_queue.introduced_word_id;
  v_goal := v_queue.goal;
  v_new_words := greatest(0, v_log.new_words);
  v_queue_completed := v_queue.completed;
  v_log_completed := v_log.completed;

  if p_target_state ? 'queue' then
    v_open := public.daily_state_apply_int_delta(v_open, v_base_open, v_target_open);
    v_completed := public.daily_state_apply_int_delta(v_completed, v_base_completed, v_target_completed);
    v_introduced := public.daily_state_apply_int_delta(v_introduced, v_base_introduced, v_target_introduced);

    select coalesce(array_agg(id order by ordinality), '{}'::integer[])
    into v_open
    from unnest(v_open) with ordinality as open_items(id, ordinality)
    where not (id = any(v_completed));

    if v_target_queue ? 'goal' and (
      not (v_base_queue ? 'goal')
      or (v_target_queue ->> 'goal') is distinct from (v_base_queue ->> 'goal')
    ) then
      v_goal := greatest(1, least(5000, (v_target_queue ->> 'goal')::integer));
    end if;
    if v_target_queue ? 'completed' and (
      not (v_base_queue ? 'completed')
      or (v_target_queue ->> 'completed') is distinct from (v_base_queue ->> 'completed')
    ) then
      v_queue_completed := coalesce((v_target_queue ->> 'completed')::boolean, false);
    end if;
  end if;

  if p_target_state ? 'log' then
    v_log_delta := greatest(0, coalesce(nullif(v_target_log ->> 'new_words', '')::integer, 0))
      - greatest(0, coalesce(nullif(v_base_log ->> 'new_words', '')::integer, 0));
    v_new_words := greatest(0, v_new_words + v_log_delta);
    if v_target_log ? 'goal' and (
      not (v_base_log ? 'goal')
      or (v_target_log ->> 'goal') is distinct from (v_base_log ->> 'goal')
    ) then
      v_goal := greatest(1, least(5000, (v_target_log ->> 'goal')::integer));
    end if;
    if v_target_log ? 'completed' and (
      not (v_base_log ? 'completed')
      or (v_target_log ->> 'completed') is distinct from (v_base_log ->> 'completed')
    ) then
      v_log_completed := coalesce((v_target_log ->> 'completed')::boolean, false);
    end if;
  end if;

  -- Stable-id completion evidence is stronger than a stale legacy counter.
  v_new_words := greatest(v_new_words, cardinality(v_completed));
  v_revision := greatest(v_queue.sync_revision, v_log.sync_revision) + 1;

  update public.daily_queue q
  set goal = v_goal,
      word_id = v_open,
      completed_word_id = v_completed,
      introduced_word_id = v_introduced,
      completed = v_queue_completed,
      updated_at = v_now,
      sync_revision = v_revision
  where q.user_id = v_user_id and q.queue_date = p_state_date
  returning q.* into v_queue;

  update public.daily_log l
  set new_words = v_new_words,
      goal = v_goal,
      completed = v_log_completed,
      updated_at = v_now,
      sync_revision = v_revision
  where l.user_id = v_user_id and l.log_date = p_state_date
  returning l.* into v_log;

  insert into public.daily_state_sync_events (
    user_id, event_id, state_date, client_id, client_seq,
    base_state, target_state, applied_revision
  ) values (
    v_user_id, p_event_id, p_state_date, p_client_id, p_client_seq,
    p_base_state, p_target_state, v_revision
  );

  update public.daily_state_sync_client_heads h
  set last_seq = p_client_seq, updated_at = v_now
  where h.user_id = v_user_id and h.client_id = p_client_id;

  return jsonb_build_object(
    'event_id', p_event_id,
    'revision', v_revision,
    'queue', to_jsonb(v_queue),
    'log', to_jsonb(v_log)
  );
end;
$$;

revoke all on function public.daily_state_jsonb_int_array(jsonb) from public, anon;
revoke all on function public.daily_state_apply_int_delta(integer[], integer[], integer[]) from public, anon;
revoke all on function public.apply_daily_state_sync_event(text, date, text, bigint, jsonb, jsonb) from public, anon;
grant execute on function public.daily_state_jsonb_int_array(jsonb) to authenticated;
grant execute on function public.daily_state_apply_int_delta(integer[], integer[], integer[]) to authenticated;
grant execute on function public.apply_daily_state_sync_event(text, date, text, bigint, jsonb, jsonb) to authenticated;

notify pgrst, 'reload schema';

commit;
