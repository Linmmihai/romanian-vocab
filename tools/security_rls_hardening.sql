-- Harden browser-facing Supabase permissions.
-- Run in Supabase SQL editor after reviewing existing policies.
-- This script keeps ordinary learning writes client-side, but moves role changes
-- behind an admin-checked RPC and blocks raw cross-user learning data reads.

create or replace function public.current_user_is_admin()
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and role = 'admin'
  );
$$;

revoke all on function public.current_user_is_admin() from public;
revoke all on function public.current_user_is_admin() from anon;
grant execute on function public.current_user_is_admin() to authenticated;

create or replace function public.admin_set_user_role(target_user_id uuid, new_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.current_user_is_admin() then
    raise exception 'Only admins can change user roles';
  end if;
  if new_role not in ('pending', 'user', 'admin', 'rejected') then
    raise exception 'Invalid role: %', new_role;
  end if;
  update public.profiles
     set role = new_role
   where id = target_user_id;
end;
$$;

revoke all on function public.admin_set_user_role(uuid, text) from public;
revoke all on function public.admin_set_user_role(uuid, text) from anon;
grant execute on function public.admin_set_user_role(uuid, text) to authenticated;

create or replace function public.admin_delete_user_profile(target_user_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_role text;
begin
  if not public.current_user_is_admin() then
    raise exception 'Only admins can reject user profiles';
  end if;
  if target_user_id = (select auth.uid()) then
    raise exception 'Admins cannot reject their own profile';
  end if;

  select role into target_role
    from public.profiles
   where id = target_user_id;

  if target_role is null then
    return 'missing';
  end if;
  if target_role = 'admin' then
    raise exception 'Admins cannot reject another admin profile';
  end if;
  if target_role = 'pending' then
    delete from public.profiles
     where id = target_user_id
       and role = 'pending';
    return 'deleted';
  end if;

  update public.profiles
     set role = 'rejected'
   where id = target_user_id;
  return 'rejected';
end;
$$;

revoke all on function public.admin_delete_user_profile(uuid) from public;
revoke all on function public.admin_delete_user_profile(uuid) from anon;
grant execute on function public.admin_delete_user_profile(uuid) to authenticated;

create or replace function public.admin_load_all_progress()
returns setof public.progress
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.current_user_is_admin() then
    raise exception 'Only admins can read class progress';
  end if;

  return query
    select *
      from public.progress
     order by updated_at desc;
end;
$$;

revoke all on function public.admin_load_all_progress() from public;
revoke all on function public.admin_load_all_progress() from anon;
grant execute on function public.admin_load_all_progress() to authenticated;

create or replace function public.admin_get_class_recent_logs(days_count integer default 30)
returns setof public.daily_log
language plpgsql
security definer
set search_path = ''
as $$
declare
  since_date date;
begin
  if not public.current_user_is_admin() then
    raise exception 'Only admins can read class logs';
  end if;

  since_date := current_date - greatest(0, coalesce(days_count, 30) - 1);

  return query
    select *
      from public.daily_log
     where log_date >= since_date
     order by log_date desc;
end;
$$;

revoke all on function public.admin_get_class_recent_logs(integer) from public;
revoke all on function public.admin_get_class_recent_logs(integer) from anon;
grant execute on function public.admin_get_class_recent_logs(integer) to authenticated;

-- This function is intended for the auth trigger, not direct Data API calls.
do $$
begin
  if to_regprocedure('public.handle_new_user()') is not null then
    execute 'revoke all on function public.handle_new_user() from public';
    execute 'revoke all on function public.handle_new_user() from anon';
    execute 'revoke all on function public.handle_new_user() from authenticated';
  end if;
end;
$$;

alter table public.profiles enable row level security;
revoke update on public.profiles from authenticated;
grant select on public.profiles to authenticated;
grant update (nickname, daily_goal, watch_enabled) on public.profiles to authenticated;

drop policy if exists "Profiles are readable to signed-in users" on public.profiles;
drop policy if exists "Users can update own safe profile fields" on public.profiles;
drop policy if exists "Admins can update safe profile fields" on public.profiles;
drop policy if exists "own_profile" on public.profiles;
drop policy if exists "read_all_profiles" on public.profiles;
drop policy if exists "admin_update_roles" on public.profiles;

create policy "Profiles are readable to signed-in users"
on public.profiles for select
to authenticated
using (
  id = (select auth.uid())
  or role in ('user', 'admin')
  or public.current_user_is_admin()
);

create policy "Users can update own safe profile fields"
on public.profiles for update
to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

create policy "Admins can update safe profile fields"
on public.profiles for update
to authenticated
using (public.current_user_is_admin())
with check (public.current_user_is_admin());

alter table public.words enable row level security;
grant select on public.words to anon, authenticated;
grant insert, update, delete on public.words to authenticated;

drop policy if exists "Anyone can read words" on public.words;
drop policy if exists "Admins can insert words" on public.words;
drop policy if exists "Admins can update words" on public.words;
drop policy if exists "Admins can delete words" on public.words;
drop policy if exists "read_words" on public.words;
drop policy if exists "admin_write_words" on public.words;

create policy "Anyone can read words"
on public.words for select
to anon, authenticated
using (true);

create policy "Admins can insert words"
on public.words for insert
to authenticated
with check (public.current_user_is_admin());

create policy "Admins can update words"
on public.words for update
to authenticated
using (public.current_user_is_admin())
with check (public.current_user_is_admin());

create policy "Admins can delete words"
on public.words for delete
to authenticated
using (public.current_user_is_admin());

alter table public.word_reports enable row level security;
grant insert, select, update on public.word_reports to authenticated;

drop policy if exists "Users can submit own word reports" on public.word_reports;
drop policy if exists "Admins can read word reports" on public.word_reports;
drop policy if exists "Admins can update word reports" on public.word_reports;
drop policy if exists "submit_report" on public.word_reports;
drop policy if exists "admin_read_reports" on public.word_reports;
drop policy if exists "admin_update_reports" on public.word_reports;

create policy "Users can submit own word reports"
on public.word_reports for insert
to authenticated
with check (reporter_id = (select auth.uid()));

create policy "Admins can read word reports"
on public.word_reports for select
to authenticated
using (public.current_user_is_admin());

create policy "Admins can update word reports"
on public.word_reports for update
to authenticated
using (public.current_user_is_admin())
with check (public.current_user_is_admin());

alter table public.progress enable row level security;
grant select, insert, update on public.progress to authenticated;

drop policy if exists "Users can read own progress" on public.progress;
drop policy if exists "Users can insert own progress" on public.progress;
drop policy if exists "Users can update own progress" on public.progress;
drop policy if exists "Admins can read all progress" on public.progress;
drop policy if exists "own_progress" on public.progress;
drop policy if exists "class_read_progress" on public.progress;

create policy "Users can read own progress"
on public.progress for select
to authenticated
using (user_id = (select auth.uid()));

create policy "Users can insert own progress"
on public.progress for insert
to authenticated
with check (user_id = (select auth.uid()));

create policy "Users can update own progress"
on public.progress for update
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy "Admins can read all progress"
on public.progress for select
to authenticated
using (public.current_user_is_admin());

alter table public.daily_log enable row level security;
grant select, insert, update on public.daily_log to authenticated;

drop policy if exists "Users can read own daily logs" on public.daily_log;
drop policy if exists "Users can insert own daily logs" on public.daily_log;
drop policy if exists "Users can update own daily logs" on public.daily_log;
drop policy if exists "Admins can read all daily logs" on public.daily_log;
drop policy if exists "own_log" on public.daily_log;
drop policy if exists "class_read_daily_log" on public.daily_log;

create policy "Users can read own daily logs"
on public.daily_log for select
to authenticated
using (user_id = (select auth.uid()));

create policy "Users can insert own daily logs"
on public.daily_log for insert
to authenticated
with check (user_id = (select auth.uid()));

create policy "Users can update own daily logs"
on public.daily_log for update
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy "Admins can read all daily logs"
on public.daily_log for select
to authenticated
using (public.current_user_is_admin());
