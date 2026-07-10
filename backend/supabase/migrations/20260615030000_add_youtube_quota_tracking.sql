-- YouTube API Quota Tracking Table
-- Tracks daily quota usage to ensure maximum efficiency

create table if not exists public.youtube_quota_usage (
  id bigserial primary key,
  date date not null default current_date,
  quota_available integer default 10000,
  quota_consumed integer default 0,
  quota_remaining integer default 10000,
  utilization_percent numeric(5, 2) default 0,
  ingest_runs_completed integer default 0,
  videos_collected integer default 0,
  comments_collected integer default 0,
  notes text,
  created_at timestamp default now(),
  updated_at timestamp default now(),
  constraint unique_quota_date unique (date)
);

-- Index for fast lookups
create index if not exists idx_youtube_quota_date on public.youtube_quota_usage (date desc);

-- Enable RLS
alter table public.youtube_quota_usage enable row level security;

-- RLS policy: anon can read
drop policy if exists "anon_read_quota" on public.youtube_quota_usage;
create policy anon_read_quota on public.youtube_quota_usage
  for select using (true);

-- RLS policy: service role can write
drop policy if exists "service_write_quota" on public.youtube_quota_usage;
create policy service_write_quota on public.youtube_quota_usage
  for all using (auth.role() = 'service_role');

-- Function to record quota usage
create or replace function record_youtube_quota_usage(
  consumed_units integer,
  videos_count integer default 0,
  comments_count integer default 0,
  run_notes text default null
) returns void as $$
declare
  today date;
  remaining integer;
begin
  today := current_date;
  
  -- Update or insert today's quota record
  insert into public.youtube_quota_usage (
    date,
    quota_available,
    quota_consumed,
    ingest_runs_completed,
    videos_collected,
    comments_collected,
    notes,
    updated_at
  ) values (
    today,
    10000,
    consumed_units,
    1,
    videos_count,
    comments_count,
    run_notes,
    now()
  )
  on conflict (date) do update set
    quota_consumed = youtube_quota_usage.quota_consumed + excluded.quota_consumed,
    ingest_runs_completed = youtube_quota_usage.ingest_runs_completed + 1,
    videos_collected = youtube_quota_usage.videos_collected + excluded.videos_collected,
    comments_collected = youtube_quota_usage.comments_collected + excluded.comments_collected,
    updated_at = now();
  
  -- Calculate remaining quota
  update public.youtube_quota_usage
  set 
    quota_remaining = (10000 - quota_consumed),
    utilization_percent = round((quota_consumed::numeric / 10000) * 100, 2)
  where date = today;
end;
$$ language plpgsql;
