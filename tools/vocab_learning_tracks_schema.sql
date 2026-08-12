-- Independent learning tracks for the shared Romanian vocabulary.
-- Topic, part of speech and lexical unit remain separate taxonomy axes.

alter table public.words
  add column if not exists learning_track text not null default 'quarantine',
  add column if not exists specialist_book text,
  add column if not exists content_status text not null default 'needs_review',
  add column if not exists naturalness_status text not null default 'needs_review',
  add column if not exists corpus_frequency bigint,
  add column if not exists news_frequency integer not null default 0,
  add column if not exists news_document_count integer not null default 0,
  add column if not exists news_category_count integer not null default 0,
  add column if not exists corpus_snapshot text,
  add column if not exists curation_reason text;

alter table public.daily_queue
  add column if not exists collection_id text not null default 'news_core';

-- A private, point-in-time copy makes the content migration fully reversible
-- without exposing the backup through the public API schema.
create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;
create table if not exists app_private.words_backup_20260812 as table public.words;
revoke all on table app_private.words_backup_20260812 from public, anon, authenticated;
comment on table app_private.words_backup_20260812 is
  'Pre-publication backup for the 2026-08-12 Romanian vocabulary learning-track rebuild.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'words_learning_track_valid_ck') then
    alter table public.words add constraint words_learning_track_valid_ck check (
      learning_track in ('news_core', 'news_extension', 'specialist', 'scenario_phrasebook', 'quarantine')
    );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'words_content_status_valid_ck') then
    alter table public.words add constraint words_content_status_valid_ck check (
      content_status in ('active', 'needs_review', 'archived')
    );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'words_naturalness_status_valid_ck') then
    alter table public.words add constraint words_naturalness_status_valid_ck check (
      naturalness_status in ('verified', 'revised', 'corpus_attested', 'needs_review')
    );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'words_specialist_book_valid_ck') then
    alter table public.words add constraint words_specialist_book_valid_ck check (
      specialist_book is null or specialist_book in (
        'specialist_law_public_affairs', 'specialist_economics_finance',
        'specialist_health_medicine', 'specialist_science_technology',
        'specialist_environment_agriculture', 'specialist_defense_security',
        'specialist_work_management', 'specialist_history_culture',
        'specialist_education_language', 'specialist_philosophy'
      )
    );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'daily_queue_collection_valid_ck') then
    alter table public.daily_queue add constraint daily_queue_collection_valid_ck check (
      collection_id in (
        'news_core', 'news_extension', 'scenario_phrasebook',
        'specialist_law_public_affairs', 'specialist_economics_finance',
        'specialist_health_medicine', 'specialist_science_technology',
        'specialist_environment_agriculture', 'specialist_defense_security',
        'specialist_work_management', 'specialist_history_culture',
        'specialist_education_language', 'specialist_philosophy'
      )
    );
  end if;
end $$;

create index if not exists words_learning_track_idx on public.words (learning_track) where content_status = 'active';
create index if not exists words_specialist_book_idx on public.words (specialist_book) where content_status = 'active';
create index if not exists words_frequency_rank_idx on public.words (frequency_rank) where content_status = 'active';

comment on column public.words.learning_track is 'Primary learner-facing track; independent from subject topic and lexical unit.';
comment on column public.words.specialist_book is 'Optional specialist book; core words may also be found through their specialist topic.';
comment on column public.words.content_status is 'Active, needs_review, or archived content lifecycle state.';
comment on column public.words.naturalness_status is 'Romanian form and usage review state.';
comment on column public.words.corpus_snapshot is 'Versioned evidence snapshot used for frequency and track assignment.';
comment on column public.daily_queue.collection_id is 'Learner-selected vocabulary collection for the open daily queue.';
