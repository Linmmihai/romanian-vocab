-- Consolidate proven duplicate legacy progress into an existing stable word row.
-- Only two reversible formatting variants are accepted:
--   1. legacy syllable/stress hyphens removed (for example, con-știIn-ță)
--   2. a trailing parenthetical note removed (for example, Română (accent))
-- Every source and target row is backed up in the private schema before deletion.

create schema if not exists private;
revoke all on schema private from public;
revoke all on schema private from anon;
revoke all on schema private from authenticated;

create table if not exists private.progress_legacy_variant_backup_20260711 as
with word_keys as (
  select
    id,
    public.normalize_ro_progress_key(ro) as base_key,
    replace(public.normalize_ro_progress_key(ro), '-', '') as no_hyphen_key,
    count(*) over (
      partition by replace(public.normalize_ro_progress_key(ro), '-', '')
    ) as no_hyphen_count,
    count(*) over (
      partition by public.normalize_ro_progress_key(ro)
    ) as base_count
  from public.words
),
legacy_candidates as (
  select
    legacy.id as legacy_id,
    current.id as current_id,
    case
      when legacy.word_ro like '%-%'
       and public.normalize_ro_progress_key(legacy.word_ro) <> words.base_key
       and replace(public.normalize_ro_progress_key(legacy.word_ro), '-', '') = words.no_hyphen_key
       and words.no_hyphen_count = 1
       and words.base_key not like '%-%'
        then 'stress_hyphens'
      when public.normalize_ro_progress_key(legacy.word_ro) ~ '[\(\[]'
       and btrim(regexp_replace(
         public.normalize_ro_progress_key(legacy.word_ro),
         '\s*[\(\[].*[\)\]]\s*$',
         ''
       )) = words.base_key
       and words.base_count = 1
        then 'parenthetical_note'
      else null
    end as match_rule
  from public.progress legacy
  join word_keys words
    on (
      legacy.word_ro like '%-%'
      and replace(public.normalize_ro_progress_key(legacy.word_ro), '-', '') = words.no_hyphen_key
    ) or (
      public.normalize_ro_progress_key(legacy.word_ro) ~ '[\(\[]'
      and btrim(regexp_replace(
        public.normalize_ro_progress_key(legacy.word_ro),
        '\s*[\(\[].*[\)\]]\s*$',
        ''
      )) = words.base_key
    )
  join public.progress current
    on current.user_id = legacy.user_id
   and current.word_id = words.id
  where legacy.word_id is null
),
safe_pairs as (
  select legacy_id, current_id, match_rule
  from legacy_candidates
  where match_rule is not null
),
backup_rows as (
  select
    now() as backed_up_at,
    pairs.match_rule,
    'legacy'::text as row_role,
    pairs.legacy_id as pair_legacy_id,
    pairs.current_id as pair_current_id,
    legacy.*
  from safe_pairs pairs
  join public.progress legacy on legacy.id = pairs.legacy_id

  union all

  select
    now() as backed_up_at,
    pairs.match_rule,
    'current'::text as row_role,
    pairs.legacy_id as pair_legacy_id,
    pairs.current_id as pair_current_id,
    current.*
  from safe_pairs pairs
  join public.progress current on current.id = pairs.current_id
)
select * from backup_rows;

revoke all on table private.progress_legacy_variant_backup_20260711 from public;
revoke all on table private.progress_legacy_variant_backup_20260711 from anon;
revoke all on table private.progress_legacy_variant_backup_20260711 from authenticated;

with pairs as (
  select distinct pair_legacy_id as legacy_id, pair_current_id as current_id
  from private.progress_legacy_variant_backup_20260711
),
merged as (
  select
    pairs.current_id,
    coalesce(current.known, false) or coalesce(legacy.known, false) as known,
    greatest(coalesce(current.quiz_right, 0), coalesce(legacy.quiz_right, 0)) as quiz_right,
    greatest(coalesce(current.quiz_total, 0), coalesce(legacy.quiz_total, 0)) as quiz_total,
    greatest(current.updated_at, legacy.updated_at) as updated_at,
    case
      when current.level = 'mastered' or legacy.level = 'mastered' then 'mastered'
      when current.level = 'learning' or legacy.level = 'learning' then 'learning'
      else 'unknown'
    end as level,
    least(current.next_review, legacy.next_review) as next_review,
    greatest(coalesce(current.review_count, 0), coalesce(legacy.review_count, 0)) as review_count,
    greatest(coalesce(current.review_stage, 0), coalesce(legacy.review_stage, 0)) as review_stage,
    least(current.next_review_at, legacy.next_review_at) as next_review_at,
    greatest(current.last_reviewed_at, legacy.last_reviewed_at) as last_reviewed_at,
    greatest(coalesce(current.wrong_count, 0), coalesce(legacy.wrong_count, 0)) as wrong_count,
    greatest(coalesce(current.error_streak, 0), coalesce(legacy.error_streak, 0)) as error_streak,
    greatest(current.last_wrong_at, legacy.last_wrong_at) as last_wrong_at,
    greatest(current.weak_cleared_at, legacy.weak_cleared_at) as weak_cleared_at,
    case
      when coalesce(current.needs_reinforcement, false)
        or coalesce(legacy.needs_reinforcement, false)
        or current.card_state = 'reinforcing'
        or legacy.card_state = 'reinforcing' then 'reinforcing'
      when current.card_state = 'mastered' or legacy.card_state = 'mastered' then 'mastered'
      when current.card_state = 'review' or legacy.card_state = 'review' then 'review'
      when current.card_state = 'learning' or legacy.card_state = 'learning' then 'learning'
      else 'new'
    end as card_state,
    least(current.due_at, legacy.due_at) as due_at,
    greatest(coalesce(current.interval_days, 0), coalesce(legacy.interval_days, 0)) as interval_days,
    greatest(coalesce(current.memory_strength, 0), coalesce(legacy.memory_strength, 0)) as memory_strength,
    greatest(coalesce(current.reps, 0), coalesce(legacy.reps, 0)) as reps,
    greatest(coalesce(current.correct_count, 0), coalesce(legacy.correct_count, 0)) as correct_count,
    greatest(coalesce(current.fuzzy_count, 0), coalesce(legacy.fuzzy_count, 0)) as fuzzy_count,
    greatest(coalesce(current.forget_count, 0), coalesce(legacy.forget_count, 0)) as forget_count,
    greatest(coalesce(current.lapses, 0), coalesce(legacy.lapses, 0)) as lapses,
    case
      when coalesce(legacy.updated_at, '-infinity'::timestamptz)
         > coalesce(current.updated_at, '-infinity'::timestamptz)
        then coalesce(legacy.recent_results, current.recent_results)
      else coalesce(current.recent_results, legacy.recent_results)
    end as recent_results,
    coalesce(current.needs_reinforcement, false)
      or coalesce(legacy.needs_reinforcement, false) as needs_reinforcement
  from pairs
  join public.progress legacy on legacy.id = pairs.legacy_id
  join public.progress current on current.id = pairs.current_id
)
update public.progress current
set
  known = merged.known,
  quiz_right = merged.quiz_right,
  quiz_total = greatest(merged.quiz_total, merged.quiz_right),
  updated_at = merged.updated_at,
  level = merged.level,
  next_review = merged.next_review,
  review_count = merged.review_count,
  review_stage = merged.review_stage,
  next_review_at = merged.next_review_at,
  last_reviewed_at = merged.last_reviewed_at,
  wrong_count = merged.wrong_count,
  error_streak = merged.error_streak,
  last_wrong_at = merged.last_wrong_at,
  weak_cleared_at = merged.weak_cleared_at,
  card_state = merged.card_state,
  due_at = merged.due_at,
  interval_days = merged.interval_days,
  memory_strength = merged.memory_strength,
  reps = merged.reps,
  correct_count = merged.correct_count,
  fuzzy_count = merged.fuzzy_count,
  forget_count = merged.forget_count,
  lapses = merged.lapses,
  recent_results = merged.recent_results,
  needs_reinforcement = merged.needs_reinforcement
from merged
where current.id = merged.current_id;

delete from public.progress legacy
using private.progress_legacy_variant_backup_20260711 backup
where backup.row_role = 'legacy'
  and legacy.id = backup.id
  and legacy.id = backup.pair_legacy_id
  and legacy.word_id is null;

select json_build_object(
  'backed_up_pairs', count(distinct pair_legacy_id),
  'backed_up_rows', count(*),
  'remaining_progress_without_word_id', (
    select count(*) from public.progress where word_id is null
  )
) as consolidation_result
from private.progress_legacy_variant_backup_20260711;
