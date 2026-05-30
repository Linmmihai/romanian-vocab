alter table public.profiles
  add column if not exists watch_enabled boolean not null default true;

comment on column public.profiles.watch_enabled is
  'Whether this user is included in admin weekly attention/follow-up reports.';
