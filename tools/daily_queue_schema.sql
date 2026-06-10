-- Optional Supabase schema for persistent daily learning queues.
-- The app falls back to browser storage until this table exists.

create table if not exists public.daily_queue (
  user_id uuid not null references auth.users(id) on delete cascade,
  queue_date date not null,
  goal integer not null default 20 check (goal > 0 and goal <= 5000),
  word_ro text[] not null default '{}',
  completed_word_ro text[] not null default '{}',
  completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, queue_date)
);

alter table public.daily_queue enable row level security;

grant select, insert, update on public.daily_queue to authenticated;
grant select, insert, update on public.daily_log to authenticated;
grant select, insert, update on public.progress to authenticated;
grant select, update on public.profiles to authenticated;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.daily_queue'::regclass
      and conname = 'daily_queue_goal_check'
  ) then
    alter table public.daily_queue drop constraint daily_queue_goal_check;
  end if;
  alter table public.daily_queue
    add constraint daily_queue_goal_check check (goal > 0 and goal <= 5000);
end $$;

drop policy if exists "Users can read own daily queues" on public.daily_queue;
drop policy if exists "Users can insert own daily queues" on public.daily_queue;
drop policy if exists "Users can update own daily queues" on public.daily_queue;

create policy "Users can read own daily queues"
on public.daily_queue for select
to authenticated
using (auth.uid() = user_id);

create policy "Users can insert own daily queues"
on public.daily_queue for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Users can update own daily queues"
on public.daily_queue for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

alter table public.progress
  add column if not exists wrong_count integer not null default 0,
  add column if not exists error_streak integer not null default 0,
  add column if not exists last_wrong_at timestamptz;

alter table public.profiles
  alter column daily_goal set default 20;
