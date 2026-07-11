-- Backfill stable word ids for existing daily queues without creating partial arrays.
-- A queue part is updated only when every text reference has one unique word match.

with normalized_words as (
  select
    id,
    public.normalize_ro_progress_key(ro) as ro_key,
    count(*) over (partition by public.normalize_ro_progress_key(ro)) as key_count
  from public.words
),
queue_matches as (
  select
    q.user_id,
    q.queue_date,
    count(*) as reference_count,
    count(w.id) as matched_count,
    array_agg(w.id order by ref.ordinality) filter (where w.id is not null) as matched_ids
  from public.daily_queue q
  cross join lateral unnest(q.word_ro) with ordinality as ref(word_ro, ordinality)
  left join normalized_words w
    on w.ro_key = public.normalize_ro_progress_key(ref.word_ro)
   and w.key_count = 1
  where cardinality(q.word_id) = 0
    and cardinality(q.word_ro) > 0
  group by q.user_id, q.queue_date
)
update public.daily_queue q
set word_id = matches.matched_ids
from queue_matches matches
where q.user_id = matches.user_id
  and q.queue_date = matches.queue_date
  and matches.reference_count = matches.matched_count;

with normalized_words as (
  select
    id,
    public.normalize_ro_progress_key(ro) as ro_key,
    count(*) over (partition by public.normalize_ro_progress_key(ro)) as key_count
  from public.words
),
completed_matches as (
  select
    q.user_id,
    q.queue_date,
    count(*) as reference_count,
    count(w.id) as matched_count,
    array_agg(w.id order by ref.ordinality) filter (where w.id is not null) as matched_ids
  from public.daily_queue q
  cross join lateral unnest(q.completed_word_ro) with ordinality as ref(word_ro, ordinality)
  left join normalized_words w
    on w.ro_key = public.normalize_ro_progress_key(ref.word_ro)
   and w.key_count = 1
  where cardinality(q.completed_word_id) = 0
    and cardinality(q.completed_word_ro) > 0
  group by q.user_id, q.queue_date
)
update public.daily_queue q
set completed_word_id = matches.matched_ids
from completed_matches matches
where q.user_id = matches.user_id
  and q.queue_date = matches.queue_date
  and matches.reference_count = matches.matched_count;

select json_build_object(
  'queue_rows', count(*),
  'queue_rows_with_word_ids', count(*) filter (where cardinality(word_id) > 0),
  'queue_rows_with_completed_word_ids', count(*) filter (where cardinality(completed_word_id) > 0),
  'partial_queue_arrays', count(*) filter (
    where (cardinality(word_id) > 0 and cardinality(word_id) <> cardinality(word_ro))
       or (cardinality(completed_word_id) > 0 and cardinality(completed_word_id) <> cardinality(completed_word_ro))
  )
) as queue_backfill_result
from public.daily_queue;
