-- Atomic, idempotent multi-device progress synchronization.
-- Client answers are applied as base -> target deltas so concurrent devices do
-- not lose increments, while timestamped state fields converge deterministically.

alter table public.progress
  add column if not exists seen boolean not null default false,
  add column if not exists seen_via_card boolean not null default false,
  add column if not exists grammar_qr integer not null default 0,
  add column if not exists grammar_qt integer not null default 0,
  add column if not exists was_mastered_at timestamptz,
  add column if not exists correct_streak_since_wrong integer not null default 0,
  add column if not exists sync_revision bigint not null default 0,
  add column if not exists state_updated_at timestamptz;

alter table public.daily_log
  add column if not exists updated_at timestamptz not null default now();

update public.progress
set
  seen = seen or known or coalesce(quiz_total, 0) > 0 or coalesce(review_stage, 0) > 0,
  grammar_qr = greatest(grammar_qr, 0),
  grammar_qt = greatest(grammar_qt, grammar_qr, 0),
  was_mastered_at = case
    when was_mastered_at is null and level = 'mastered' then coalesce(last_reviewed_at, updated_at, now())
    else was_mastered_at
  end,
  state_updated_at = coalesce(state_updated_at, updated_at, last_reviewed_at, now())
where true;

create table if not exists public.progress_sync_events (
  user_id uuid not null references auth.users(id) on delete cascade,
  event_id text not null,
  word_id integer not null references public.words(id) on delete cascade,
  occurred_at timestamptz not null,
  correction boolean not null default false,
  base_state jsonb not null,
  target_state jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (user_id, event_id),
  constraint progress_sync_events_event_id_length check (char_length(event_id) between 8 and 200),
  constraint progress_sync_events_base_object check (jsonb_typeof(base_state) = 'object'),
  constraint progress_sync_events_target_object check (jsonb_typeof(target_state) = 'object'),
  constraint progress_sync_events_state_size check (
    pg_column_size(base_state) <= 16384 and pg_column_size(target_state) <= 16384
  )
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.progress_sync_events'::regclass
      and conname = 'progress_sync_events_state_size'
  ) then
    alter table public.progress_sync_events
      add constraint progress_sync_events_state_size
      check (pg_column_size(base_state) <= 16384 and pg_column_size(target_state) <= 16384)
      not valid;
    alter table public.progress_sync_events validate constraint progress_sync_events_state_size;
  end if;
end $$;

create index if not exists progress_sync_events_user_created_idx
  on public.progress_sync_events (user_id, created_at desc);

create index if not exists progress_sync_events_word_id_idx
  on public.progress_sync_events (word_id);

alter table public.progress_sync_events enable row level security;

drop policy if exists "Users can read own progress sync events" on public.progress_sync_events;
create policy "Users can read own progress sync events"
  on public.progress_sync_events
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert own progress sync events" on public.progress_sync_events;
create policy "Users can insert own progress sync events"
  on public.progress_sync_events
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

revoke all on table public.progress_sync_events from anon;
revoke all on table public.progress_sync_events from authenticated;
grant select, insert on table public.progress_sync_events to authenticated;

create or replace function public.apply_progress_sync_event(
  p_event_id text,
  p_word_id integer,
  p_word_ro text,
  p_occurred_at timestamptz,
  p_base_state jsonb,
  p_target_state jsonb,
  p_correction boolean default false
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_inserted integer := 0;
  v_state_is_newer boolean;
  v_received_at timestamptz := clock_timestamp();
  v_event_time timestamptz;
  v_row public.progress%rowtype;
  v_base_qr integer := greatest(0, coalesce((p_base_state ->> 'qr')::integer, 0));
  v_base_qt integer := greatest(0, coalesce((p_base_state ->> 'qt')::integer, 0));
  v_target_qr integer := greatest(0, coalesce((p_target_state ->> 'qr')::integer, 0));
  v_target_qt integer := greatest(0, coalesce((p_target_state ->> 'qt')::integer, 0));
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_word_id is null or coalesce(btrim(p_word_ro), '') = '' or char_length(p_word_ro) > 1000 then
    raise exception 'Stable word identity is required' using errcode = '22023';
  end if;
  if coalesce(char_length(p_event_id), 0) < 8 or char_length(p_event_id) > 200 then
    raise exception 'Invalid progress event id' using errcode = '22023';
  end if;
  if jsonb_typeof(p_base_state) <> 'object' or jsonb_typeof(p_target_state) <> 'object' then
    raise exception 'Progress event states must be JSON objects' using errcode = '22023';
  end if;
  if pg_column_size(p_base_state) > 16384 or pg_column_size(p_target_state) > 16384 then
    raise exception 'Progress event state is too large' using errcode = '22023';
  end if;
  -- A badly skewed device clock must not block every other device indefinitely.
  v_event_time := least(
    greatest(coalesce(p_occurred_at, v_received_at), v_received_at - interval '30 days'),
    v_received_at + interval '5 minutes'
  );

  insert into public.progress_sync_events (
    user_id, event_id, word_id, occurred_at, correction, base_state, target_state
  ) values (
    v_user_id,
    p_event_id,
    p_word_id,
    v_event_time,
    coalesce(p_correction, false),
    p_base_state,
    p_target_state
  )
  on conflict (user_id, event_id) do nothing;
  get diagnostics v_inserted = row_count;

  if v_inserted = 0 then
    select p.* into v_row
    from public.progress p
    where p.user_id = v_user_id and p.word_id = p_word_id;
    if not found then
      raise exception 'Progress event exists but its progress row is missing' using errcode = 'P0002';
    end if;
    return to_jsonb(v_row);
  end if;

  insert into public.progress (
    user_id, word_id, word_ro, known, quiz_right, quiz_total, level,
    seen, seen_via_card, grammar_qr, grammar_qt, state_updated_at, updated_at
  ) values (
    v_user_id, p_word_id, p_word_ro, false, 0, 0, 'unknown',
    false, false, 0, 0, '-infinity'::timestamptz, clock_timestamp()
  )
  on conflict (user_id, word_id) do nothing;

  select p.* into v_row
  from public.progress p
  where p.user_id = v_user_id and p.word_id = p_word_id
  for update;

  v_state_is_newer := v_event_time >= coalesce(v_row.state_updated_at, '-infinity'::timestamptz);

  update public.progress p
  set
    word_ro = case when v_state_is_newer then p_word_ro else p.word_ro end,
    quiz_right = greatest(0, coalesce(p.quiz_right, 0) + v_target_qr - v_base_qr),
    quiz_total = greatest(0, coalesce(p.quiz_total, 0) + v_target_qt - v_base_qt),
    grammar_qr = greatest(0, p.grammar_qr
      + greatest(0, coalesce((p_target_state ->> 'grammarQr')::integer, 0))
      - greatest(0, coalesce((p_base_state ->> 'grammarQr')::integer, 0))),
    grammar_qt = greatest(0, p.grammar_qt
      + greatest(0, coalesce((p_target_state ->> 'grammarQt')::integer, 0))
      - greatest(0, coalesce((p_base_state ->> 'grammarQt')::integer, 0))),
    wrong_count = greatest(0, p.wrong_count
      + greatest(0, coalesce((p_target_state ->> 'wrongCount')::integer, 0))
      - greatest(0, coalesce((p_base_state ->> 'wrongCount')::integer, 0))),
    reps = greatest(0, p.reps
      + greatest(0, coalesce((p_target_state ->> 'reps')::integer, 0))
      - greatest(0, coalesce((p_base_state ->> 'reps')::integer, 0))),
    correct_count = greatest(0, p.correct_count
      + greatest(0, coalesce((p_target_state ->> 'correctCount')::integer, 0))
      - greatest(0, coalesce((p_base_state ->> 'correctCount')::integer, 0))),
    fuzzy_count = greatest(0, p.fuzzy_count
      + greatest(0, coalesce((p_target_state ->> 'fuzzyCount')::integer, 0))
      - greatest(0, coalesce((p_base_state ->> 'fuzzyCount')::integer, 0))),
    forget_count = greatest(0, p.forget_count
      + greatest(0, coalesce((p_target_state ->> 'forgetCount')::integer, 0))
      - greatest(0, coalesce((p_base_state ->> 'forgetCount')::integer, 0))),
    lapses = greatest(0, p.lapses
      + greatest(0, coalesce((p_target_state ->> 'lapses')::integer, 0))
      - greatest(0, coalesce((p_base_state ->> 'lapses')::integer, 0))),
    seen = case
      when not v_state_is_newer then p.seen
      when p_correction then coalesce((p_target_state ->> 'seen')::boolean, false)
      else p.seen or coalesce((p_target_state ->> 'seen')::boolean, false)
    end,
    seen_via_card = case
      when not v_state_is_newer then p.seen_via_card
      when p_correction then coalesce((p_target_state ->> 'seenViaCard')::boolean, false)
      else p.seen_via_card or coalesce((p_target_state ->> 'seenViaCard')::boolean, false)
    end,
    known = case when v_state_is_newer then coalesce((p_target_state ->> 'known')::boolean, false) else p.known end,
    level = case when v_state_is_newer then coalesce(nullif(p_target_state ->> 'level', ''), 'unknown') else p.level end,
    review_stage = case when v_state_is_newer then greatest(0, coalesce((p_target_state ->> 'reviewStage')::integer, 0)) else p.review_stage end,
    review_count = case when v_state_is_newer then greatest(0, coalesce((p_target_state ->> 'reviewStage')::integer, 0)) else p.review_count end,
    next_review_at = case when v_state_is_newer then (p_target_state ->> 'nextReviewAt')::timestamptz else p.next_review_at end,
    next_review = case when v_state_is_newer then ((p_target_state ->> 'nextReviewAt')::timestamptz)::date else p.next_review end,
    last_reviewed_at = case when v_state_is_newer then (p_target_state ->> 'lastReviewedAt')::timestamptz else p.last_reviewed_at end,
    was_mastered_at = case
      when not v_state_is_newer then p.was_mastered_at
      when p_correction then (p_target_state ->> 'wasMasteredAt')::timestamptz
      else coalesce(p.was_mastered_at, (p_target_state ->> 'wasMasteredAt')::timestamptz)
    end,
    error_streak = case
      when not v_state_is_newer then p.error_streak
      when greatest(0, coalesce((p_target_state ->> 'errorStreak')::integer, 0))
        = greatest(0, coalesce((p_base_state ->> 'errorStreak')::integer, 0)) + 1
        then p.error_streak + 1
      else greatest(0, coalesce((p_target_state ->> 'errorStreak')::integer, 0))
    end,
    correct_streak_since_wrong = case
      when not v_state_is_newer then p.correct_streak_since_wrong
      when greatest(0, coalesce((p_target_state ->> 'correctStreakSinceWrong')::integer, 0))
        = greatest(0, coalesce((p_base_state ->> 'correctStreakSinceWrong')::integer, 0)) + 1
        then p.correct_streak_since_wrong + 1
      else greatest(0, coalesce((p_target_state ->> 'correctStreakSinceWrong')::integer, 0))
    end,
    last_wrong_at = case
      when not v_state_is_newer then p.last_wrong_at
      when p_correction then (p_target_state ->> 'lastWrongAt')::timestamptz
      when p.last_wrong_at is null then (p_target_state ->> 'lastWrongAt')::timestamptz
      when (p_target_state ->> 'lastWrongAt') is null then p.last_wrong_at
      else greatest(p.last_wrong_at, (p_target_state ->> 'lastWrongAt')::timestamptz)
    end,
    weak_cleared_at = case
      when not v_state_is_newer then p.weak_cleared_at
      when p_correction then (p_target_state ->> 'weakClearedAt')::timestamptz
      when p.weak_cleared_at is null then (p_target_state ->> 'weakClearedAt')::timestamptz
      when (p_target_state ->> 'weakClearedAt') is null then p.weak_cleared_at
      else greatest(p.weak_cleared_at, (p_target_state ->> 'weakClearedAt')::timestamptz)
    end,
    card_state = case when v_state_is_newer and p_target_state ->> 'cardState' in ('new', 'learning', 'review', 'reinforcing', 'mastered') then p_target_state ->> 'cardState' else p.card_state end,
    due_at = case when v_state_is_newer then (p_target_state ->> 'dueAt')::timestamptz else p.due_at end,
    interval_days = case when v_state_is_newer then greatest(0, coalesce((p_target_state ->> 'intervalDays')::integer, 0)) else p.interval_days end,
    memory_strength = case when v_state_is_newer then greatest(0, coalesce((p_target_state ->> 'memoryStrength')::integer, 0)) else p.memory_strength end,
    recent_results = case
      when v_state_is_newer and jsonb_typeof(p_target_state -> 'recentResults') = 'array' then p_target_state -> 'recentResults'
      else p.recent_results
    end,
    needs_reinforcement = case when v_state_is_newer then coalesce((p_target_state ->> 'needsReinforcement')::boolean, false) else p.needs_reinforcement end,
    state_updated_at = case when v_state_is_newer then v_event_time else p.state_updated_at end,
    sync_revision = p.sync_revision + 1,
    updated_at = clock_timestamp()
  where p.user_id = v_user_id and p.word_id = p_word_id
  returning p.* into v_row;

  update public.progress p
  set
    quiz_total = greatest(p.quiz_total, p.quiz_right),
    grammar_qt = greatest(p.grammar_qt, p.grammar_qr),
    seen = p.seen or p.known or p.quiz_total > 0 or p.review_stage > 0,
    level = case
      when p.level = 'mastered' then 'mastered'
      when p.seen or p.known or p.quiz_total > 0 or p.review_stage > 0 then 'learning'
      else 'unknown'
    end
  where p.user_id = v_user_id and p.word_id = p_word_id
  returning p.* into v_row;

  return to_jsonb(v_row);
end;
$$;

create or replace function public.merge_legacy_progress_baselines(p_entries jsonb)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_entry jsonb;
  v_word_id integer;
  v_count integer := 0;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if jsonb_typeof(p_entries) <> 'array' then
    raise exception 'Legacy progress entries must be a JSON array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_entries) > 250 then
    raise exception 'Legacy progress batch is too large' using errcode = '22023';
  end if;

  for v_entry in select value from jsonb_array_elements(p_entries)
  loop
    v_word_id := nullif(v_entry ->> 'wordId', '')::integer;
    if v_word_id is null or coalesce(btrim(v_entry ->> 'wordRo'), '') = '' then
      continue;
    end if;

    insert into public.progress (
      user_id, word_id, word_ro, known, quiz_right, quiz_total, level,
      seen, seen_via_card, grammar_qr, grammar_qt, was_mastered_at,
      correct_streak_since_wrong, updated_at
    ) values (
      v_user_id,
      v_word_id,
      v_entry ->> 'wordRo',
      false, 0, 0, 'unknown',
      coalesce((v_entry ->> 'seen')::boolean, false),
      coalesce((v_entry ->> 'seenViaCard')::boolean, false),
      greatest(0, coalesce((v_entry ->> 'grammarQr')::integer, 0)),
      greatest(0, coalesce((v_entry ->> 'grammarQt')::integer, 0)),
      (v_entry ->> 'wasMasteredAt')::timestamptz,
      greatest(0, coalesce((v_entry ->> 'correctStreakSinceWrong')::integer, 0)),
      clock_timestamp()
    )
    on conflict (user_id, word_id) do update
    set
      seen = public.progress.seen or excluded.seen,
      seen_via_card = public.progress.seen_via_card or excluded.seen_via_card,
      grammar_qr = greatest(public.progress.grammar_qr, excluded.grammar_qr),
      grammar_qt = greatest(public.progress.grammar_qt, excluded.grammar_qt, public.progress.grammar_qr, excluded.grammar_qr),
      was_mastered_at = coalesce(public.progress.was_mastered_at, excluded.was_mastered_at),
      correct_streak_since_wrong = greatest(public.progress.correct_streak_since_wrong, excluded.correct_streak_since_wrong);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.apply_progress_sync_event(text, integer, text, timestamptz, jsonb, jsonb, boolean) from public;
revoke all on function public.apply_progress_sync_event(text, integer, text, timestamptz, jsonb, jsonb, boolean) from anon;
grant execute on function public.apply_progress_sync_event(text, integer, text, timestamptz, jsonb, jsonb, boolean) to authenticated;

revoke all on function public.merge_legacy_progress_baselines(jsonb) from public;
revoke all on function public.merge_legacy_progress_baselines(jsonb) from anon;
grant execute on function public.merge_legacy_progress_baselines(jsonb) to authenticated;

comment on table public.progress_sync_events is 'Idempotency log for atomic multi-device progress mutations.';
comment on column public.progress.state_updated_at is 'Client occurrence timestamp of the latest accepted state mutation.';
comment on column public.progress.sync_revision is 'Monotonic server revision incremented for each unique progress event.';

notify pgrst, 'reload schema';
