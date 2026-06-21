-- Add lightweight Momo-style scheduling fields to progress.
-- Additive only: legacy review_stage / next_review_at / review_count / next_review remain intact.

alter table public.progress
  add column if not exists card_state text not null default 'new',
  add column if not exists due_at timestamptz,
  add column if not exists interval_days integer not null default 0,
  add column if not exists memory_strength integer not null default 0,
  add column if not exists reps integer not null default 0,
  add column if not exists correct_count integer not null default 0,
  add column if not exists fuzzy_count integer not null default 0,
  add column if not exists forget_count integer not null default 0,
  add column if not exists lapses integer not null default 0,
  add column if not exists recent_results jsonb not null default '[]'::jsonb,
  add column if not exists needs_reinforcement boolean not null default false,
  add column if not exists last_reviewed_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'progress_card_state_check'
      and conrelid = 'public.progress'::regclass
  ) then
    alter table public.progress
      add constraint progress_card_state_check
      check (card_state in ('new', 'learning', 'review', 'reinforcing', 'mastered'))
      not valid;
  end if;
end $$;

update public.progress
set
  due_at = coalesce(due_at, next_review_at, next_review::timestamptz),
  interval_days = greatest(interval_days, case
    when review_stage >= 6 or review_count >= 6 then 60
    when review_stage = 5 or review_count = 5 then 30
    when review_stage = 4 or review_count = 4 then 15
    when review_stage = 3 or review_count = 3 then 7
    when review_stage = 2 or review_count = 2 then 3
    when review_stage = 1 or review_count = 1 then 1
    else 0
  end),
  reps = greatest(reps, coalesce(quiz_total, 0)),
  correct_count = greatest(correct_count, coalesce(quiz_right, 0)),
  forget_count = greatest(forget_count, greatest(coalesce(quiz_total, 0) - coalesce(quiz_right, 0), 0)),
  memory_strength = greatest(memory_strength, least(100, case
    when coalesce(quiz_total, 0) = 0 then 0
    else round((coalesce(quiz_right, 0)::numeric / greatest(coalesce(quiz_total, 0), 1)) * 60
      + least(greatest(review_stage, review_count, 0), 6) * 7)
  end)),
  card_state = case
    when needs_reinforcement then 'reinforcing'
    when level = 'mastered' then 'review'
    when coalesce(quiz_total, 0) > 0 or known or review_stage > 0 or review_count > 0 then 'learning'
    else card_state
  end,
  last_reviewed_at = coalesce(last_reviewed_at, updated_at, now())
where true;

comment on column public.progress.card_state is 'Scheduler state: new, learning, review, reinforcing, mastered.';
comment on column public.progress.due_at is 'Canonical next due timestamp for the lightweight scheduler.';
comment on column public.progress.interval_days is 'Current review interval in days.';
comment on column public.progress.memory_strength is 'Internal 0-100 memory strength score.';
comment on column public.progress.recent_results is 'Recent scheduler outcomes: unknown, fuzzy, known.';
