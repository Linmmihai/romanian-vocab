-- Restore reinforcement state for rows affected by the first legacy consolidation.
-- The private backup is the source of truth, so no word matching or guessing occurs.

with affected_pairs as (
  select pair_current_id
  from private.progress_legacy_variant_backup_20260711
  group by pair_current_id
  having bool_or(card_state = 'reinforcing')
      or bool_or(coalesce(needs_reinforcement, false))
)
update public.progress current
set
  card_state = 'reinforcing',
  needs_reinforcement = true
from affected_pairs
where current.id = affected_pairs.pair_current_id
  and (
    current.card_state <> 'reinforcing'
    or not coalesce(current.needs_reinforcement, false)
  );

select json_build_object(
  'remaining_state_mismatches', count(*)
) as repair_result
from (
  select backup.pair_current_id
  from private.progress_legacy_variant_backup_20260711 backup
  join public.progress current on current.id = backup.pair_current_id
  group by backup.pair_current_id, current.card_state, current.needs_reinforcement
  having (
    bool_or(backup.card_state = 'reinforcing')
    or bool_or(coalesce(backup.needs_reinforcement, false))
  ) and (
    current.card_state <> 'reinforcing'
    or not coalesce(current.needs_reinforcement, false)
  )
) mismatches;
