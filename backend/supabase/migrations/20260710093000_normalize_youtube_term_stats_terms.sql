-- Normalize and deduplicate youtube_term_stats.term values.
-- Goal: merge quoted/unquoted variants like "cosun beet" and cosun beet.

create or replace function public.canonical_youtube_term(input text)
returns text
language sql
immutable
as $$
  select lower(
    regexp_replace(
      regexp_replace(trim(coalesce(input, '')), '\s+', ' ', 'g'),
      '^["'']+|["'']+$',
      '',
      'g'
    )
  );
$$;

create or replace function public.youtube_term_stats_normalize_term_tg()
returns trigger
language plpgsql
as $$
begin
  new.term := public.canonical_youtube_term(new.term);
  if new.term = '' then
    raise exception 'youtube_term_stats.term must not be empty';
  end if;
  return new;
end;
$$;

do $$
begin
  if to_regclass('public.youtube_term_stats') is null then
    raise notice 'Skipping youtube_term_stats normalization: table does not exist.';
    return;
  end if;

  create temp table _youtube_term_stats_merged on commit drop as
  select
    public.canonical_youtube_term(term) as term,
    sum(total_runs)::integer as total_runs,
    sum(total_hits)::integer as total_hits,
    max(last_hits)::integer as last_hits,
    max(ewma_hits)::numeric(10,3) as ewma_hits,
    max(last_run_at) as last_run_at,
    max(updated_at) as updated_at
  from public.youtube_term_stats
  group by 1;

  delete from public.youtube_term_stats;

  insert into public.youtube_term_stats (
    term,
    total_runs,
    total_hits,
    last_hits,
    ewma_hits,
    last_run_at,
    updated_at
  )
  select
    term,
    total_runs,
    total_hits,
    last_hits,
    ewma_hits,
    last_run_at,
    coalesce(updated_at, now())
  from _youtube_term_stats_merged
  where term <> '';

  drop trigger if exists trg_youtube_term_stats_normalize_term
    on public.youtube_term_stats;

  create trigger trg_youtube_term_stats_normalize_term
  before insert or update of term
  on public.youtube_term_stats
  for each row
  execute function public.youtube_term_stats_normalize_term_tg();

  create unique index if not exists youtube_term_stats_term_canonical_uniq
    on public.youtube_term_stats (public.canonical_youtube_term(term));
end
$$;
