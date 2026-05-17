alter table public.words
  add column if not exists example_ro text,
  add column if not exists example_zh text;
