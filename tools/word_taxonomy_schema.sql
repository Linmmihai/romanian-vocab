-- Structured vocabulary taxonomy and one-time legacy cleanup.
-- Safe to rerun: columns, constraints, and index creation are idempotent.

begin;

alter table public.words
  add column if not exists topic text,
  add column if not exists part_of_speech text,
  add column if not exists unit_type text,
  add column if not exists grammar_data jsonb,
  add column if not exists cefr text,
  add column if not exists register text,
  add column if not exists verification_status text,
  add column if not exists source text;

alter table public.pending_words
  add column if not exists topic text,
  add column if not exists part_of_speech text,
  add column if not exists unit_type text,
  add column if not exists grammar_data jsonb,
  add column if not exists cefr text,
  add column if not exists register text,
  add column if not exists verification_status text,
  add column if not exists source text;

-- Preserve learning history while repairing the two imported template rows and
-- merging the only case-insensitive duplicate. Queue ids are authoritative;
-- legacy Romanian-text arrays are updated in parallel for old clients.
update public.daily_queue
set
  word_id = array_remove(array_remove(word_id, 3846), 6907),
  completed_word_id = array_remove(array_remove(completed_word_id, 3846), 6907),
  introduced_word_id = array_remove(array_remove(introduced_word_id, 3846), 6907),
  word_ro = array_remove(
    array_replace(
      array_replace(word_ro, 'Română', 'limba română'),
      'Revoluție Industrială', 'revoluție industrială'
    ),
    '罗马尼亚语'
  ),
  completed_word_ro = array_remove(
    array_replace(
      array_replace(completed_word_ro, 'Română', 'limba română'),
      'Revoluție Industrială', 'revoluție industrială'
    ),
    '罗马尼亚语'
  ),
  introduced_word_ro = array_remove(
    array_replace(
      array_replace(introduced_word_ro, 'Română', 'limba română'),
      'Revoluție Industrială', 'revoluție industrială'
    ),
    '罗马尼亚语'
  )
where
  word_id && array[3846, 6907]
  or completed_word_id && array[3846, 6907]
  or introduced_word_id && array[3846, 6907]
  or word_ro && array['Română', 'Revoluție Industrială', '罗马尼亚语']
  or completed_word_ro && array['Română', 'Revoluție Industrială', '罗马尼亚语']
  or introduced_word_ro && array['Română', 'Revoluție Industrială', '罗马尼亚语'];

update public.progress
set word_ro = case word_id
  when 6191 then 'limba română'
  when 6270 then 'revoluție industrială'
  else word_ro
end
where word_id in (6191, 6270);

delete from public.words where id in (3846, 6907);

update public.words
set
  zh = '罗马尼亚语',
  ro = 'limba română',
  ipa = 'lImba romÂnă',
  hint = 's.f.: limbi române',
  cat = 'Education',
  example_ro = 'Limba română se învață mai ușor cu exemple din viața de zi cu zi.',
  example_zh = '罗马尼亚语通过日常生活例子更容易学习。'
where id = 6191;

update public.words
set
  ro = 'revoluție industrială',
  hint = 's.f.: revoluții industriale'
where id = 6270;

update public.words set hint = 's.n.pl.: formă folosită la plural' where id in (4242, 4566, 4744);
update public.words set hint = 's.f.pl.: formă folosită la plural' where id in (4676, 4948, 5103, 5174, 5192);
update public.words set hint = 'verb: conj. IV (-esc; mă zvârcolesc / te zvârcolești / se zvârcolește)' where id = 8703;
update public.words set hint = 's.n.: moțuri / moațe' where id = 6190;

-- Topic is semantic subject matter. The old cat value remains untouched as a
-- provenance field; the few rows where cat contained a part of speech receive
-- an explicit subject here.
update public.words
set topic = case
  when id in (5722, 5723, 5724) then 'daily_life'
  when id in (6869, 6880, 6881, 6882, 6883, 6904, 6905) then 'people_society'
  when id in (6884, 6885, 6887) then 'philosophy_abstract'
  when id = 6886 then 'science_technology'
  when id = 6888 then 'work_management'
  when lower(trim(cat)) in ('verb', 'adjective', 'adverb', 'conjunction', 'numeral', 'preposition', 'pronoun') then 'education_language'
  when lower(trim(cat)) = 'interjection' then 'people_society'
  when lower(trim(cat)) = 'daily life' then 'daily_life'
  when lower(trim(cat)) = 'education' then 'education_language'
  when lower(trim(cat)) = 'management' then 'work_management'
  when lower(trim(cat)) = 'economics' then 'economics_finance'
  when lower(trim(cat)) = 'law' then 'law_public_affairs'
  when lower(trim(cat)) = 'medicine' then 'health_medicine'
  when lower(trim(cat)) = 'agriculture' then 'nature_agriculture'
  when lower(trim(cat)) in ('science', 'engineering') then 'science_technology'
  when lower(trim(cat)) in ('history', 'literature', 'art') then 'history_culture_arts'
  when lower(trim(cat)) = 'philosophy' then 'philosophy_abstract'
  when lower(trim(cat)) = 'military science' then 'defense_security'
  else 'unclassified'
end;

update public.words
set part_of_speech = case
  when lower(trim(cat)) in ('verb', 'adjective', 'adverb', 'pronoun', 'preposition', 'conjunction', 'numeral', 'interjection')
    then lower(trim(cat))
  when lower(coalesce(hint, '')) ~ '^s\.[fmn](\.pl)?\.?\s*[:(]' then 'noun'
  when lower(coalesce(hint, '')) like 'verb%'
    or lower(coalesce(hint, '')) like 'vb.%'
    or coalesce(hint, '') ~ '(动词|变位)' then 'verb'
  when regexp_replace(lower(coalesce(hint, '')), '^loc\.\s*', '') like 'adj%' then 'adjective'
  when regexp_replace(lower(coalesce(hint, '')), '^loc\.\s*', '') like 'adv%' then 'adverb'
  when lower(coalesce(hint, '')) like 'conj%'
    or lower(coalesce(hint, '')) like 'locuțiune conjunc%' then 'conjunction'
  when lower(coalesce(hint, '')) like 'prep%'
    or lower(coalesce(hint, '')) like 'loc. prep.%'
    or lower(coalesce(hint, '')) like 'locuțiune prepozi%' then 'preposition'
  when lower(coalesce(hint, '')) like 'pron%' then 'pronoun'
  when lower(coalesce(hint, '')) like 'numeral%'
    or lower(coalesce(hint, '')) like 'num.%' then 'numeral'
  when lower(coalesce(hint, '')) like 'interjec%' then 'interjection'
  when lower(coalesce(hint, '')) like 'expr%'
    or lower(coalesce(hint, '')) like '= %'
    or lower(coalesce(hint, '')) like 'loc. lat.%' then 'expression'
  when coalesce(hint, '') ~ '艺术风格' then 'proper_noun'
  when lower(trim(ro)) ~ '^a\s+(se\s+)?[[:alpha:]ăâîșțşţ-]+$' then 'verb'
  else 'other'
end;

update public.words
set unit_type = case
  when part_of_speech = 'proper_noun' then 'proper_name'
  when part_of_speech = 'expression' then 'expression'
  when part_of_speech = 'verb'
    and lower(trim(ro)) ~ '^a\s+(se\s+)?[[:alpha:]ăâîșțşţ-]+$' then 'word'
  when part_of_speech = 'verb' then 'verb_phrase'
  when cardinality(regexp_split_to_array(trim(ro), '\s+')) <= 1 then 'word'
  when part_of_speech in ('adverb', 'preposition', 'conjunction', 'interjection') then 'expression'
  when cardinality(regexp_split_to_array(trim(ro), '\s+')) > 8 or ro ~ '[.…]' then 'sentence_pattern'
  else 'term'
end;

update public.words
set grammar_data = jsonb_strip_nulls(jsonb_build_object(
  'part_of_speech', part_of_speech,
  'raw_hint', coalesce(hint, ''),
  'gender', case
    when part_of_speech = 'noun' and lower(hint) ~ '^s\.f' then 'feminine'
    when part_of_speech = 'noun' and lower(hint) ~ '^s\.m' then 'masculine'
    when part_of_speech = 'noun' and lower(hint) ~ '^s\.n' then 'neuter'
    else null
  end,
  'number', case
    when part_of_speech = 'noun' and lower(hint) ~ '^s\.[fmn]\.pl' then 'plural'
    when part_of_speech = 'noun' then 'singular'
    else null
  end,
  'plural_only', case
    when part_of_speech = 'noun' and lower(hint) ~ '^s\.[fmn]\.pl' then true
    else null
  end,
  'invariant', case
    when part_of_speech = 'noun'
      and lower(hint) !~ '^s\.[fmn]\.pl'
      and lower(hint) like '%fără plural%' then true
    when part_of_speech in ('adverb', 'preposition', 'conjunction', 'interjection', 'expression') then true
    else null
  end,
  'plural', case
    when part_of_speech = 'noun'
      and lower(hint) !~ '^s\.[fmn]\.pl'
      and lower(hint) not like '%fără plural%'
      and position(':' in hint) > 0
      then nullif(trim(substring(hint from position(':' in hint) + 1)), '')
    else null
  end,
  'forms', case
    when part_of_speech = 'adjective' and position(':' in hint) > 0
      then nullif(trim(substring(hint from position(':' in hint) + 1)), '')
    else null
  end,
  'reflexive', case
    when part_of_speech = 'verb' then lower(trim(ro)) like 'a se %'
    else null
  end
));

update public.words
set
  cefr = case when upper(trim(coalesce(level, ''))) in ('A1', 'A2', 'B1', 'B2', 'C1', 'C2') then upper(trim(level)) else null end,
  register = null,
  verification_status = coalesce(nullif(verification_status, ''), 'imported'),
  source = coalesce(nullif(source, ''), 'legacy_cloud');

-- Historical review records are retained, but they receive the same independent
-- fields so an approved row never needs to overload cat again.
update public.pending_words
set
  topic = case
    when lower(trim(coalesce(cat, ''))) = 'daily life' then 'daily_life'
    when lower(trim(coalesce(cat, ''))) = 'education' then 'education_language'
    when lower(trim(coalesce(cat, ''))) = 'management' then 'work_management'
    when lower(trim(coalesce(cat, ''))) = 'economics' then 'economics_finance'
    when lower(trim(coalesce(cat, ''))) = 'law' then 'law_public_affairs'
    when lower(trim(coalesce(cat, ''))) = 'medicine' then 'health_medicine'
    when lower(trim(coalesce(cat, ''))) = 'agriculture' then 'nature_agriculture'
    when lower(trim(coalesce(cat, ''))) in ('science', 'engineering') then 'science_technology'
    when lower(trim(coalesce(cat, ''))) in ('history', 'literature', 'art') then 'history_culture_arts'
    when lower(trim(coalesce(cat, ''))) = 'philosophy' then 'philosophy_abstract'
    when lower(trim(coalesce(cat, ''))) = 'military science' then 'defense_security'
    else 'unclassified'
  end,
  part_of_speech = case
    when lower(trim(coalesce(cat, ''))) in ('verb', 'adjective', 'adverb', 'pronoun', 'preposition', 'conjunction', 'numeral', 'interjection')
      then lower(trim(cat))
    when lower(coalesce(hint, '')) ~ '^s\.[fmn](\.pl)?\.?\s*[:(]' then 'noun'
    when lower(coalesce(hint, '')) like 'verb%' or coalesce(hint, '') ~ '(动词|变位)' then 'verb'
    when regexp_replace(lower(coalesce(hint, '')), '^loc\.\s*', '') like 'adj%' then 'adjective'
    when regexp_replace(lower(coalesce(hint, '')), '^loc\.\s*', '') like 'adv%' then 'adverb'
    when lower(coalesce(hint, '')) like 'conj%' then 'conjunction'
    when lower(coalesce(hint, '')) like 'prep%' or lower(coalesce(hint, '')) like 'loc. prep.%' then 'preposition'
    when lower(coalesce(hint, '')) like 'pron%' then 'pronoun'
    when lower(coalesce(hint, '')) like 'numeral%' then 'numeral'
    when lower(coalesce(hint, '')) like 'interjec%' then 'interjection'
    when lower(coalesce(hint, '')) like 'expr%' then 'expression'
    when lower(trim(ro)) ~ '^a\s+(se\s+)?[[:alpha:]ăâîșțşţ-]+$' then 'verb'
    else 'other'
  end,
  unit_type = coalesce(nullif(unit_type, ''), 'word'),
  grammar_data = coalesce(grammar_data, '{}'::jsonb)
    || jsonb_build_object('raw_hint', coalesce(hint, '')),
  verification_status = coalesce(nullif(verification_status, ''), 'imported'),
  source = coalesce(nullif(source, ''), 'legacy_pending');

update public.pending_words
set grammar_data = grammar_data || jsonb_build_object('part_of_speech', part_of_speech);

alter table public.words
  alter column topic set not null,
  alter column part_of_speech set not null,
  alter column unit_type set not null,
  alter column grammar_data set not null,
  alter column verification_status set default 'imported',
  alter column verification_status set not null,
  alter column source set default 'legacy_cloud',
  alter column source set not null;

alter table public.pending_words
  alter column topic set default 'unclassified',
  alter column part_of_speech set default 'other',
  alter column unit_type set default 'word',
  alter column grammar_data set default '{}'::jsonb,
  alter column verification_status set default 'imported',
  alter column source set default 'admin_submission';

do $constraints$
begin
  if not exists (select 1 from pg_constraint where conname = 'words_topic_valid_ck') then
    alter table public.words add constraint words_topic_valid_ck check (
      topic in ('daily_life', 'people_society', 'education_language', 'work_management',
        'economics_finance', 'law_public_affairs', 'health_medicine', 'nature_agriculture',
        'science_technology', 'history_culture_arts', 'philosophy_abstract', 'defense_security',
        'unclassified')
    );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'words_part_of_speech_valid_ck') then
    alter table public.words add constraint words_part_of_speech_valid_ck check (
      part_of_speech in ('noun', 'verb', 'adjective', 'adverb', 'pronoun', 'preposition',
        'conjunction', 'numeral', 'interjection', 'expression', 'proper_noun', 'other')
    );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'words_unit_type_valid_ck') then
    alter table public.words add constraint words_unit_type_valid_ck check (
      unit_type in ('word', 'verb_phrase', 'collocation', 'expression', 'sentence_pattern',
        'term', 'proper_name')
    );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'words_cefr_valid_ck') then
    alter table public.words add constraint words_cefr_valid_ck check (
      cefr is null or cefr in ('A1', 'A2', 'B1', 'B2', 'C1', 'C2')
    );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'words_register_valid_ck') then
    alter table public.words add constraint words_register_valid_ck check (
      register is null or register in ('neutral', 'formal', 'informal', 'colloquial', 'literary', 'technical')
    );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'words_verification_status_valid_ck') then
    alter table public.words add constraint words_verification_status_valid_ck check (
      verification_status in ('verified', 'imported', 'needs_review')
    );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'words_grammar_data_object_ck') then
    alter table public.words add constraint words_grammar_data_object_ck check (
      jsonb_typeof(grammar_data) = 'object'
    );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'words_required_text_ck') then
    alter table public.words add constraint words_required_text_ck check (
      btrim(zh) <> '' and btrim(ro) <> ''
    );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'words_ro_no_cjk_ck') then
    alter table public.words add constraint words_ro_no_cjk_ck check (
      ro !~ '[一-龥]'
    );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'words_no_template_headers_ck') then
    alter table public.words add constraint words_no_template_headers_ck check (
      lower(btrim(ro)) not in ('罗马尼亚语', 'română')
      and lower(btrim(zh)) not like '# 格式:%'
      and lower(btrim(zh)) <> '汉字'
    );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pending_words_topic_valid_ck') then
    alter table public.pending_words add constraint pending_words_topic_valid_ck check (
      topic is null or topic in ('daily_life', 'people_society', 'education_language', 'work_management',
        'economics_finance', 'law_public_affairs', 'health_medicine', 'nature_agriculture',
        'science_technology', 'history_culture_arts', 'philosophy_abstract', 'defense_security',
        'unclassified')
    );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pending_words_part_of_speech_valid_ck') then
    alter table public.pending_words add constraint pending_words_part_of_speech_valid_ck check (
      part_of_speech is null or part_of_speech in ('noun', 'verb', 'adjective', 'adverb',
        'pronoun', 'preposition', 'conjunction', 'numeral', 'interjection', 'expression',
        'proper_noun', 'other')
    );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pending_words_unit_type_valid_ck') then
    alter table public.pending_words add constraint pending_words_unit_type_valid_ck check (
      unit_type is null or unit_type in ('word', 'verb_phrase', 'collocation', 'expression',
        'sentence_pattern', 'term', 'proper_name')
    );
  end if;
end
$constraints$;

create unique index if not exists words_ro_normalized_unique
  on public.words ((lower(btrim(ro))));

create index if not exists words_topic_idx on public.words (topic);
create index if not exists words_part_of_speech_idx on public.words (part_of_speech);

-- Old clients can keep a deleted word id in memory and later upsert it back into
-- today's queue. Sanitize every queue write at the database boundary so array
-- ids and display text remain parallel and only reference live vocabulary.
create or replace function public.sanitize_daily_queue_word_refs()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
begin
  select
    coalesce(array_agg(x.id order by x.ord), '{}'::int[]),
    coalesce(array_agg(w.ro order by x.ord), '{}'::text[])
  into new.word_id, new.word_ro
  from unnest(coalesce(new.word_id, '{}'::int[])) with ordinality as x(id, ord)
  join public.words w on w.id = x.id;

  select
    coalesce(array_agg(x.id order by x.ord), '{}'::int[]),
    coalesce(array_agg(w.ro order by x.ord), '{}'::text[])
  into new.completed_word_id, new.completed_word_ro
  from unnest(coalesce(new.completed_word_id, '{}'::int[])) with ordinality as x(id, ord)
  join public.words w on w.id = x.id;

  select
    coalesce(array_agg(x.id order by x.ord), '{}'::int[]),
    coalesce(array_agg(w.ro order by x.ord), '{}'::text[])
  into new.introduced_word_id, new.introduced_word_ro
  from unnest(coalesce(new.introduced_word_id, '{}'::int[])) with ordinality as x(id, ord)
  join public.words w on w.id = x.id;

  return new;
end
$function$;

drop trigger if exists daily_queue_sanitize_word_refs on public.daily_queue;
create trigger daily_queue_sanitize_word_refs
before insert or update of
  word_id, word_ro,
  completed_word_id, completed_word_ro,
  introduced_word_id, introduced_word_ro
on public.daily_queue
for each row execute function public.sanitize_daily_queue_word_refs();

commit;
