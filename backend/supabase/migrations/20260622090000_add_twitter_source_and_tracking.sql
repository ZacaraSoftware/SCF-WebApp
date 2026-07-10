-- Add X/Twitter as first-class source and persist raw tweet metrics for auditability.
insert into public.sources (id, label, status)
values ('twitter', 'X API v2', 'active')
on conflict (id) do update
set
  label = excluded.label,
  status = excluded.status;

create table if not exists public.twitter_mentions_raw (
  tweet_id text primary key,
  query_used text,
  competitor text,
  author_id text,
  author_username text,
  content text not null,
  lang text,
  retweet_count int,
  reply_count int,
  like_count int,
  quote_count int,
  bookmark_count int,
  impression_count int,
  url text,
  published_at timestamptz not null,
  collected_at timestamptz not null default now()
);

create index if not exists twitter_mentions_raw_competitor_idx
  on public.twitter_mentions_raw (competitor, published_at desc);

create index if not exists twitter_mentions_raw_published_idx
  on public.twitter_mentions_raw (published_at desc);

alter table public.twitter_mentions_raw enable row level security;

drop policy if exists "read_twitter_mentions_raw_authenticated" on public.twitter_mentions_raw;
create policy "read_twitter_mentions_raw_authenticated"
  on public.twitter_mentions_raw for select to authenticated using (true);
