-- Follow-up for databases where an ambiguous legacy text row already has a
-- stable progress row. Preserve the legacy row, then remove it from active state.

insert into private.progress_orphan_archive_20260712
select p.*, now(), 'stable_progress_exists_for_ambiguous_word_text'
from public.progress p
where p.word_id is null
  and exists (
    select 1
    from public.progress stable
    join public.words w on w.id = stable.word_id
    where stable.user_id = p.user_id
      and public.normalize_ro_progress_key(w.ro) = public.normalize_ro_progress_key(p.word_ro)
  )
on conflict (id) do nothing;

delete from public.progress p
using private.progress_orphan_archive_20260712 archived
where p.id = archived.id
  and p.word_id is null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'private.progress_legacy_variant_backup_20260711'::regclass
      and contype = 'p'
  ) then
    alter table private.progress_legacy_variant_backup_20260711 add primary key (id);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'private.progress_word_id_duplicate_backup_20260711'::regclass
      and contype = 'p'
  ) then
    alter table private.progress_word_id_duplicate_backup_20260711 add primary key (id);
  end if;
end;
$$;
