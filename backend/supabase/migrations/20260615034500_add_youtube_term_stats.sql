-- Adaptive YouTube term performance tracking
-- Stores per-term hit performance to improve future term selection.

create table if not exists public.youtube_term_stats (
  term text primary key,
  total_runs integer not null default 0,
  total_hits integer not null default 0,
  last_hits integer not null default 0,
  ewma_hits numeric(10,3) not null default 0,
  last_run_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists youtube_term_stats_updated_idx
  on public.youtube_term_stats (updated_at desc);

alter table public.youtube_term_stats enable row level security;

drop policy if exists youtube_term_stats_read on public.youtube_term_stats;
create policy youtube_term_stats_read
  on public.youtube_term_stats
  for select
  using (true);

drop policy if exists youtube_term_stats_service_write on public.youtube_term_stats;
create policy youtube_term_stats_service_write
  on public.youtube_term_stats
  for all
  using (auth.role() = 'service_role');
