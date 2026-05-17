alter table public.progress
  add column if not exists wrong_count integer not null default 0,
  add column if not exists error_streak integer not null default 0,
  add column if not exists last_wrong_at timestamptz;

comment on column public.progress.wrong_count is 'Number of remembered wrong answers for wrongbook and weak-word priority.';
comment on column public.progress.error_streak is 'Current consecutive wrong-answer streak used by weak-word priority.';
comment on column public.progress.last_wrong_at is 'Timestamp of the latest remembered wrong answer.';
