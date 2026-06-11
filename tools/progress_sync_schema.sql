-- Fix cloud progress sync for the browser app.
-- Run this in the Supabase SQL editor for the project.

alter table public.progress
  add column if not exists known boolean not null default false,
  add column if not exists quiz_right integer not null default 0,
  add column if not exists quiz_total integer not null default 0,
  add column if not exists level text not null default 'unknown',
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists review_stage integer not null default 0,
  add column if not exists next_review_at timestamptz not null default now(),
  add column if not exists last_reviewed_at timestamptz not null default now(),
  add column if not exists wrong_count integer not null default 0,
  add column if not exists error_streak integer not null default 0,
  add column if not exists last_wrong_at timestamptz,
  add column if not exists weak_cleared_at timestamptz,
  add column if not exists review_count integer not null default 0,
  add column if not exists next_review date;

create unique index if not exists progress_user_word_unique_idx
  on public.progress (user_id, word_ro);

alter table public.progress enable row level security;

grant select, insert, update on public.progress to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'progress'
      and policyname = 'Users can read own progress'
  ) then
    create policy "Users can read own progress"
    on public.progress for select
    to authenticated
    using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'progress'
      and policyname = 'Users can insert own progress'
  ) then
    create policy "Users can insert own progress"
    on public.progress for insert
    to authenticated
    with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'progress'
      and policyname = 'Users can update own progress'
  ) then
    create policy "Users can update own progress"
    on public.progress for update
    to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);
  end if;
end $$;
