-- Idempotent, tombstone-safe multi-device synchronization for learning evidence.
-- The table is client-readable under RLS. All writes go through the batch RPC so
-- a deletion is permanent and an old offline client cannot recreate the event.

begin;

create table if not exists public.learning_evidence_events (
  user_id uuid not null references auth.users(id) on delete cascade,
  event_id text not null,
  word_id integer,
  word_ro text,
  payload jsonb,
  deleted_at timestamptz,
  deleted boolean generated always as (deleted_at is not null) stored,
  created_at timestamptz not null default clock_timestamp(),
  changed_at timestamptz not null default clock_timestamp(),
  primary key (user_id, event_id),
  constraint learning_evidence_event_id_length
    check (char_length(event_id) between 1 and 200),
  constraint learning_evidence_word_id_positive
    check (word_id is null or word_id > 0),
  constraint learning_evidence_word_ro_length
    check (word_ro is null or char_length(word_ro) between 1 and 1000),
  constraint learning_evidence_live_row_complete check (
    deleted_at is not null or (
      (word_id is not null or word_ro is not null)
      and jsonb_typeof(payload) is not distinct from 'object'
    )
  ),
  constraint learning_evidence_payload_id_matches
    check (payload is null or payload ->> 'id' is not distinct from event_id),
  constraint learning_evidence_payload_size
    check (payload is null or pg_column_size(payload) <= 16384)
);

comment on table public.learning_evidence_events is
  'Per-user learning evidence events with permanent tombstones for multi-device convergence.';
comment on column public.learning_evidence_events.payload is
  'A single event produced by learning-evidence.js; never a per-word evidence history.';
comment on column public.learning_evidence_events.deleted_at is
  'Permanent revocation marker. Once set, the batch RPC never clears it.';

alter table public.learning_evidence_events enable row level security;

drop policy if exists "Users can read own learning evidence events"
  on public.learning_evidence_events;
create policy "Users can read own learning evidence events"
  on public.learning_evidence_events
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- SECURITY DEFINER is intentional: authenticated clients receive table SELECT
-- only, so they cannot bypass the RPC's validation or clear a tombstone. The
-- function derives user_id exclusively from auth.uid() and fully qualifies all
-- database objects while using an empty search_path.
create or replace function public.apply_learning_evidence_batch(p_events jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_entry jsonb;
  v_event_id text;
  v_word_id integer;
  v_word_ro text;
  v_payload jsonb;
  v_deleted boolean;
  v_at timestamptz;
  v_date date;
  v_row public.learning_evidence_events%rowtype;
  v_results jsonb := '[]'::jsonb;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if jsonb_typeof(p_events) is distinct from 'array' then
    raise exception 'Learning evidence batch must be a JSON array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_events) < 1 or jsonb_array_length(p_events) > 200 then
    raise exception 'Learning evidence batch size must be between 1 and 200' using errcode = '22023';
  end if;

  for v_entry in select value from jsonb_array_elements(p_events)
  loop
    if jsonb_typeof(v_entry) <> 'object' then
      raise exception 'Each learning evidence batch item must be an object' using errcode = '22023';
    end if;

    v_event_id := btrim(coalesce(v_entry ->> 'event_id', ''));
    if char_length(v_event_id) < 1 or char_length(v_event_id) > 200 then
      raise exception 'Invalid learning evidence event id' using errcode = '22023';
    end if;
    if v_entry ? 'deleted' and jsonb_typeof(v_entry -> 'deleted') <> 'boolean' then
      raise exception 'Learning evidence deleted must be boolean' using errcode = '22023';
    end if;
    v_deleted := coalesce((v_entry ->> 'deleted')::boolean, false);

    if v_deleted then
      -- Insert a payload-free tombstone when deletion reaches the server before
      -- its event. A later offline replay conflicts with this row and stays dead.
      insert into public.learning_evidence_events (
        user_id, event_id, deleted_at
      ) values (
        v_user_id, v_event_id, clock_timestamp()
      )
      on conflict (user_id, event_id) do update
      set
        deleted_at = coalesce(
          public.learning_evidence_events.deleted_at,
          excluded.deleted_at
        ),
        changed_at = case
          when public.learning_evidence_events.deleted_at is null then excluded.changed_at
          else public.learning_evidence_events.changed_at
        end
      returning * into v_row;
    else
      v_payload := v_entry -> 'payload';
      if jsonb_typeof(v_payload) <> 'object' then
        raise exception 'Learning evidence payload must be an object' using errcode = '22023';
      end if;
      if pg_column_size(v_payload) > 16384 then
        raise exception 'Learning evidence payload is too large' using errcode = '22023';
      end if;
      if coalesce(v_payload ->> 'id', '') <> v_event_id then
        raise exception 'Learning evidence payload id must match event_id' using errcode = '22023';
      end if;
      if coalesce(btrim(v_payload ->> 'interaction'), '') = ''
        or char_length(v_payload ->> 'interaction') > 200 then
        raise exception 'Learning evidence interaction is required' using errcode = '22023';
      end if;

      begin
        v_at := (v_payload ->> 'at')::timestamptz;
        v_date := (v_payload ->> 'date')::date;
      exception when others then
        raise exception 'Learning evidence at and date must be valid' using errcode = '22023';
      end;
      if v_at is null or v_date is null
        or v_payload ->> 'date' !~ '^\d{4}-\d{2}-\d{2}$' then
        raise exception 'Learning evidence at and date are required' using errcode = '22023';
      end if;

      begin
        v_word_id := coalesce(
          nullif(v_entry ->> 'word_id', '')::integer,
          nullif(v_payload ->> 'wordId', '')::integer
        );
      exception when others then
        raise exception 'Learning evidence word_id must be an integer' using errcode = '22023';
      end;
      v_word_ro := coalesce(
        nullif(btrim(v_entry ->> 'word_ro'), ''),
        nullif(btrim(v_payload ->> 'wordRo'), '')
      );

      if v_word_id is not null and v_word_id <= 0 then
        raise exception 'Learning evidence word_id must be positive' using errcode = '22023';
      end if;
      if v_word_ro is not null and char_length(v_word_ro) > 1000 then
        raise exception 'Learning evidence word_ro is too long' using errcode = '22023';
      end if;
      if v_word_id is null and v_word_ro is null then
        raise exception 'Learning evidence requires word_id or word_ro' using errcode = '22023';
      end if;
      if v_entry ? 'word_id' and v_payload ? 'wordId'
        and (v_entry ->> 'word_id')::integer <> (v_payload ->> 'wordId')::integer then
        raise exception 'Learning evidence word_id conflicts with payload' using errcode = '22023';
      end if;
      if v_entry ? 'word_ro' and v_payload ? 'wordRo'
        and btrim(v_entry ->> 'word_ro') <> btrim(v_payload ->> 'wordRo') then
        raise exception 'Learning evidence word_ro conflicts with payload' using errcode = '22023';
      end if;

      insert into public.learning_evidence_events (
        user_id, event_id, word_id, word_ro, payload
      ) values (
        v_user_id, v_event_id, v_word_id, v_word_ro, v_payload
      )
      on conflict (user_id, event_id) do nothing
      returning * into v_row;

      if not found then
        select e.* into strict v_row
        from public.learning_evidence_events e
        where e.user_id = v_user_id and e.event_id = v_event_id;
      end if;
    end if;

    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'event_id', v_row.event_id,
      'word_id', v_row.word_id,
      'word_ro', v_row.word_ro,
      'payload', v_row.payload,
      'deleted', v_row.deleted,
      'changed_at', v_row.changed_at
    ));
  end loop;

  return jsonb_build_object('results', v_results);
end;
$$;

revoke all on table public.learning_evidence_events from public;
revoke all on table public.learning_evidence_events from anon;
revoke all on table public.learning_evidence_events from authenticated;
grant select on table public.learning_evidence_events to authenticated;

revoke all on function public.apply_learning_evidence_batch(jsonb) from public;
revoke all on function public.apply_learning_evidence_batch(jsonb) from anon;
grant execute on function public.apply_learning_evidence_batch(jsonb) to authenticated;

notify pgrst, 'reload schema';

commit;
