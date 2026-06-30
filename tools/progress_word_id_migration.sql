-- Migrate progress identity from editable Romanian text to stable words.id.
-- Run in the Supabase SQL editor. This is additive and keeps progress.word_ro.

create or replace function public.normalize_ro_progress_key(value text)
returns text
language sql
immutable
as $$
  select lower(
    replace(
      replace(
        replace(
          replace(
            btrim(regexp_replace(normalize(coalesce(value, ''), NFC), '\s+', ' ', 'g')),
            'ş', 'ș'
          ),
          'Ş', 'ș'
        ),
        'ţ', 'ț'
      ),
      'Ţ', 'ț'
    )
  );
$$;

alter table public.progress
  add column if not exists word_id integer references public.words(id);

create unique index if not exists progress_user_word_id_unique_idx
  on public.progress (user_id, word_id);

create index if not exists progress_word_id_idx
  on public.progress (word_id);

-- Optional but recommended for id-stable daily queues. The app falls back if these
-- columns are not present, but they prevent spelling edits from invalidating today state.
alter table public.daily_queue
  add column if not exists word_id integer[] not null default '{}',
  add column if not exists completed_word_id integer[] not null default '{}';

with normalized_words as (
  select
    id,
    normalize_ro_progress_key(ro) as ro_key,
    count(*) over (partition by normalize_ro_progress_key(ro)) as key_count
  from public.words
),
matched_progress as (
  select p.ctid as progress_ctid, w.id as matched_word_id
  from public.progress p
  join normalized_words w
    on w.ro_key = normalize_ro_progress_key(p.word_ro)
   and w.key_count = 1
  where p.word_id is null
    and nullif(normalize_ro_progress_key(p.word_ro), '') is not null
)
update public.progress p
set word_id = m.matched_word_id
from matched_progress m
where p.ctid = m.progress_ctid
  and not exists (
    select 1
    from public.progress existing
    where existing.user_id = p.user_id
      and existing.word_id = m.matched_word_id
      and existing.ctid <> p.ctid
  );

-- Backfill/orphan report. Save these counts before and after the update.
select
  count(*) filter (where word_id is not null) as rows_with_word_id,
  count(*) filter (where word_id is null) as rows_without_word_id
from public.progress;

-- Rows still null are either orphaned text, empty word_ro, or ambiguous duplicate word text.
select
  p.user_id,
  p.word_ro,
  p.updated_at,
  case
    when nullif(normalize_ro_progress_key(p.word_ro), '') is null then 'empty_word_ro'
    when exists (
      select 1
      from public.progress existing
      join public.words w on w.id = existing.word_id
      where existing.user_id = p.user_id
        and normalize_ro_progress_key(w.ro) = normalize_ro_progress_key(p.word_ro)
    ) then 'duplicate_user_word_progress_kept_legacy'
    when exists (
      select 1
      from public.words w
      where normalize_ro_progress_key(w.ro) = normalize_ro_progress_key(p.word_ro)
    ) then 'ambiguous_duplicate_word_text'
    else 'no_current_word_match'
  end as unmatched_reason
from public.progress p
where p.word_id is null
order by p.updated_at desc nulls last, p.user_id, p.word_ro;
