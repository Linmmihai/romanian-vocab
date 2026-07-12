-- Reliability migration: archive unusable legacy state, optimize policy paths,
-- and add privacy-safe client diagnostics.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.progress_orphan_archive_20260712 as
select p.*, now() as archived_at, ''::text as archive_reason
from public.progress p
with no data;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'private.progress_orphan_archive_20260712'::regclass
      and contype = 'p'
  ) then
    alter table private.progress_orphan_archive_20260712 add primary key (id);
  end if;
end;
$$;

insert into private.progress_orphan_archive_20260712
select p.*, now(), 'no_current_word_match'
from public.progress p
where p.word_id is null
  and (
    not exists (
      select 1 from public.words w
      where public.normalize_ro_progress_key(w.ro) = public.normalize_ro_progress_key(p.word_ro)
    )
    or exists (
      select 1
      from public.progress stable
      join public.words w on w.id = stable.word_id
      where stable.user_id = p.user_id
        and public.normalize_ro_progress_key(w.ro) = public.normalize_ro_progress_key(p.word_ro)
    )
  )
on conflict (id) do nothing;

delete from public.progress p
using private.progress_orphan_archive_20260712 archived
where p.id = archived.id
  and p.word_id is null;

revoke all on table private.progress_orphan_archive_20260712 from public, anon, authenticated;

create table if not exists private.daily_queue_legacy_archive_20260712 as
select q.*, now() as archived_at, ''::text as archive_reason
from public.daily_queue q
with no data;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'private.daily_queue_legacy_archive_20260712'::regclass
      and contype = 'p'
  ) then
    alter table private.daily_queue_legacy_archive_20260712 add primary key (user_id, queue_date);
  end if;
end;
$$;

insert into private.daily_queue_legacy_archive_20260712
select q.*, now(), 'stale_incomplete_stable_ids'
from public.daily_queue q
where q.queue_date < current_date
  and (
    cardinality(q.word_id) < cardinality(q.word_ro)
    or cardinality(q.completed_word_id) < cardinality(q.completed_word_ro)
  )
on conflict (user_id, queue_date) do nothing;

delete from public.daily_queue q
using private.daily_queue_legacy_archive_20260712 archived
where q.user_id = archived.user_id
  and q.queue_date = archived.queue_date
  and q.queue_date < current_date;

revoke all on table private.daily_queue_legacy_archive_20260712 from public, anon, authenticated;

create index if not exists pending_words_reviewed_by_idx on public.pending_words (reviewed_by);
create index if not exists pending_words_submitted_by_idx on public.pending_words (submitted_by);
create index if not exists word_reports_reporter_id_idx on public.word_reports (reporter_id);
create index if not exists word_reports_word_id_idx on public.word_reports (word_id);
alter table public.daily_log drop constraint if exists daily_log_user_date_unique;

drop policy if exists "Users can read own daily queues" on public.daily_queue;
drop policy if exists "Users can insert own daily queues" on public.daily_queue;
drop policy if exists "Users can update own daily queues" on public.daily_queue;
create policy "Users can read own daily queues" on public.daily_queue for select to authenticated
using ((select auth.uid()) = user_id);
create policy "Users can insert own daily queues" on public.daily_queue for insert to authenticated
with check ((select auth.uid()) = user_id);
create policy "Users can update own daily queues" on public.daily_queue for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Admins can read pending words" on public.pending_words;
drop policy if exists "Admins can submit pending words" on public.pending_words;
drop policy if exists "Admins can review pending words" on public.pending_words;
create policy "Admins can read pending words" on public.pending_words for select to authenticated
using ((select public.current_user_is_admin()));
create policy "Admins can submit pending words" on public.pending_words for insert to authenticated
with check ((select public.current_user_is_admin()));
create policy "Admins can review pending words" on public.pending_words for update to authenticated
using ((select public.current_user_is_admin()))
with check ((select public.current_user_is_admin()));

drop policy if exists "Users can read own progress" on public.progress;
drop policy if exists "Admins can read all progress" on public.progress;
create policy "Users or admins can read progress" on public.progress for select to authenticated
using (user_id = (select auth.uid()) or (select public.current_user_is_admin()));

drop policy if exists "Users can read own daily logs" on public.daily_log;
drop policy if exists "Admins can read all daily logs" on public.daily_log;
create policy "Users or admins can read daily logs" on public.daily_log for select to authenticated
using (user_id = (select auth.uid()) or (select public.current_user_is_admin()));

drop policy if exists "Users can update own safe profile fields" on public.profiles;
drop policy if exists "Admins can update safe profile fields" on public.profiles;
create policy "Users or admins can update safe profile fields" on public.profiles for update to authenticated
using (id = (select auth.uid()) or (select public.current_user_is_admin()))
with check (id = (select auth.uid()) or (select public.current_user_is_admin()));

drop policy if exists "Profiles are readable to signed-in users" on public.profiles;
create policy "Profiles are readable to signed-in users" on public.profiles for select to authenticated
using (
  id = (select auth.uid())
  or role in ('user', 'admin')
  or (select public.current_user_is_admin())
);

create table if not exists public.client_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null check (event_type ~ '^[A-Za-z0-9_]{1,48}$'),
  details jsonb not null default '{}'::jsonb,
  app_version text not null default 'unknown',
  created_at timestamptz not null default now()
);

create index if not exists client_events_created_at_idx on public.client_events (created_at desc);
create index if not exists client_events_user_id_idx on public.client_events (user_id);
alter table public.client_events enable row level security;
revoke all on table public.client_events from public, anon;
grant insert on table public.client_events to authenticated;
grant usage, select on sequence public.client_events_id_seq to authenticated;

drop policy if exists "Users can insert own client events" on public.client_events;
create policy "Users can insert own client events" on public.client_events for insert to authenticated
with check (user_id = (select auth.uid()));

create or replace function public.admin_get_client_event_summary(days_count integer default 7)
returns table(event_type text, event_count bigint, affected_users bigint, last_seen timestamptz, app_version text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.current_user_is_admin() then
    raise exception 'Only admins can read client diagnostics';
  end if;
  return query
  select e.event_type,
         count(*)::bigint,
         count(distinct e.user_id)::bigint,
         max(e.created_at),
         (array_agg(e.app_version order by e.created_at desc))[1]
  from public.client_events e
  where e.created_at >= now() - make_interval(days => greatest(1, least(coalesce(days_count, 7), 30)))
  group by e.event_type
  order by count(*) desc, max(e.created_at) desc;
end;
$$;

revoke all on function public.admin_get_client_event_summary(integer) from public, anon;
grant execute on function public.admin_get_client_event_summary(integer) to authenticated;
