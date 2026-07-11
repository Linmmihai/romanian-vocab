-- Migrate progress identity from editable Romanian text to stable words.id.
-- Run in the Supabase SQL editor. This is additive and keeps progress.word_ro.

create or replace function public.normalize_ro_progress_key(value text)
returns text
language sql
immutable
set search_path = ''
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

revoke all on function public.normalize_ro_progress_key(text) from public;
revoke all on function public.normalize_ro_progress_key(text) from anon;
revoke all on function public.normalize_ro_progress_key(text) from authenticated;

create schema if not exists private;
revoke all on schema private from public;
revoke all on schema private from anon;
revoke all on schema private from authenticated;

alter table public.progress
  add column if not exists word_id integer references public.words(id);

-- Optional but recommended for id-stable daily queues. The app falls back if these
-- columns are not present, but they prevent spelling edits from invalidating today state.
alter table public.daily_queue
  add column if not exists word_id integer[] not null default '{}',
  add column if not exists completed_word_id integer[] not null default '{}';

-- Preserve every source row in duplicate semantic groups before consolidation.
-- The backup is kept outside the exposed Data API schema and makes the merge reversible.
create table if not exists private.progress_word_id_duplicate_backup_20260711 as
with normalized_words as (
  select
    id,
    public.normalize_ro_progress_key(ro) as ro_key,
    count(*) over (partition by public.normalize_ro_progress_key(ro)) as key_count
  from public.words
),
ranked_candidates as (
  select
    p.*,
    w.id as matched_word_id,
    row_number() over (
      partition by p.user_id, w.id
      order by
        (p.level = 'mastered') desc,
        coalesce(p.known, false) desc,
        coalesce(p.quiz_total, 0) desc,
        p.updated_at desc nulls last,
        p.id
    ) as candidate_rank,
    count(*) over (partition by p.user_id, w.id) as candidate_count
  from public.progress p
  join normalized_words w
    on w.ro_key = public.normalize_ro_progress_key(p.word_ro)
   and w.key_count = 1
  where p.word_id is null
)
select now() as backed_up_at, ranked_candidates.*
from ranked_candidates
where candidate_count > 1;

revoke all on table private.progress_word_id_duplicate_backup_20260711 from public;
revoke all on table private.progress_word_id_duplicate_backup_20260711 from anon;
revoke all on table private.progress_word_id_duplicate_backup_20260711 from authenticated;

-- Merge the strongest durable evidence into one row per user and stable word id.
with merged_duplicates as (
  select
    user_id,
    matched_word_id,
    (array_agg(id order by candidate_rank))[1] as winner_id,
    coalesce(bool_or(coalesce(known, false)), false) as known,
    max(coalesce(quiz_right, 0)) as quiz_right,
    max(coalesce(quiz_total, 0)) as quiz_total,
    max(updated_at) as updated_at,
    case
      when bool_or(level = 'mastered') then 'mastered'
      when bool_or(level = 'learning') then 'learning'
      else 'unknown'
    end as level,
    min(next_review) as next_review,
    max(coalesce(review_count, 0)) as review_count,
    max(coalesce(review_stage, 0)) as review_stage,
    min(next_review_at) as next_review_at,
    max(last_reviewed_at) as last_reviewed_at,
    max(coalesce(wrong_count, 0)) as wrong_count,
    max(coalesce(error_streak, 0)) as error_streak,
    max(last_wrong_at) as last_wrong_at,
    max(weak_cleared_at) as weak_cleared_at
  from private.progress_word_id_duplicate_backup_20260711
  group by user_id, matched_word_id
)
update public.progress p
set
  word_id = m.matched_word_id,
  known = m.known,
  quiz_right = m.quiz_right,
  quiz_total = greatest(m.quiz_total, m.quiz_right),
  updated_at = coalesce(m.updated_at, p.updated_at),
  level = m.level,
  next_review = coalesce(m.next_review, p.next_review),
  review_count = m.review_count,
  review_stage = m.review_stage,
  next_review_at = coalesce(m.next_review_at, p.next_review_at),
  last_reviewed_at = coalesce(m.last_reviewed_at, p.last_reviewed_at),
  wrong_count = m.wrong_count,
  error_streak = m.error_streak,
  last_wrong_at = coalesce(m.last_wrong_at, p.last_wrong_at),
  weak_cleared_at = coalesce(m.weak_cleared_at, p.weak_cleared_at)
from merged_duplicates m
where p.id = m.winner_id
  and p.word_id is null;

delete from public.progress p
using private.progress_word_id_duplicate_backup_20260711 backup
where backup.candidate_rank > 1
  and p.id = backup.id;

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

create unique index if not exists progress_user_word_id_unique_idx
  on public.progress (user_id, word_id);

create index if not exists progress_word_id_idx
  on public.progress (word_id);

-- Backfill/orphan report. Save these counts before and after the update.
select
  count(*) filter (where word_id is not null) as rows_with_word_id,
  count(*) filter (where word_id is null) as rows_without_word_id
from public.progress;

-- Rows still null are either orphaned text or ambiguous duplicate word text.
-- Return aggregate counts only so migration logs do not expose user learning data.
with unmatched as (
  select case
    when nullif(public.normalize_ro_progress_key(p.word_ro), '') is null then 'empty_word_ro'
    when exists (
      select 1
      from public.progress existing
      join public.words w on w.id = existing.word_id
      where existing.user_id = p.user_id
        and public.normalize_ro_progress_key(w.ro) = public.normalize_ro_progress_key(p.word_ro)
    ) then 'duplicate_user_word_progress_kept_legacy'
    when exists (
      select 1
      from public.words w
      where public.normalize_ro_progress_key(w.ro) = public.normalize_ro_progress_key(p.word_ro)
    ) then 'ambiguous_duplicate_word_text'
    else 'no_current_word_match'
  end as unmatched_reason
  from public.progress p
  where p.word_id is null
)
select unmatched_reason, count(*) as row_count
from unmatched
group by unmatched_reason
order by unmatched_reason;
