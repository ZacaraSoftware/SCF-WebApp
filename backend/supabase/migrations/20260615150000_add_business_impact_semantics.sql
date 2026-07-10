alter table public.mentions
  add column if not exists public_sentiment numeric(4,3),
  add column if not exists public_sentiment_label text,
  add column if not exists business_impact numeric(4,3),
  add column if not exists business_impact_label text,
  add column if not exists impact_reason text;

update public.mentions
set
  public_sentiment = coalesce(public_sentiment, sentiment),
  public_sentiment_label = coalesce(public_sentiment_label, sentiment_label),
  impact_reason = coalesce(impact_reason, 'unknown')
where public_sentiment is null
   or public_sentiment_label is null
   or impact_reason is null;

update public.mentions
set
  business_impact = null,
  business_impact_label = null,
  impact_reason = 'unknown',
  enrichment_status = 'pending',
  enriched_at = null
where enrichment_status = 'done'
  and (business_impact is null or business_impact_label is null);

drop function if exists public.match_mentions(vector(384), int, timestamptz);

create function public.match_mentions (
  query_embedding vector(384),
  match_count     int default 8,
  since           timestamptz default now() - interval '90 days'
)
returns table (
  id                uuid,
  content           text,
  source            text,
  topic             text,
  public_sentiment  numeric,
  business_impact   numeric,
  impact_reason     text,
  published_at      timestamptz,
  similarity        float
)
language sql stable
as $$
  select m.id,
         m.content,
         m.source,
         m.topic,
         coalesce(m.public_sentiment, m.sentiment) as public_sentiment,
         coalesce(m.business_impact, m.sentiment) as business_impact,
         coalesce(m.impact_reason, 'unknown') as impact_reason,
         m.published_at,
         1 - (m.embedding <=> query_embedding) as similarity
  from public.mentions m
  where m.embedding is not null
    and m.published_at >= since
  order by m.embedding <=> query_embedding
  limit match_count;
$$;

create or replace view public.daily_sentiment as
select
  date_trunc('day', published_at)::date                          as day,
  source,
  topic,
  count(*)                                                       as volume,
  round(avg(coalesce(business_impact, sentiment)) * 100)::int    as net_sentiment,
  round(avg((coalesce(business_impact, sentiment) > 0.15)::int) * 100)::int as positive_share
from public.mentions
group by 1, 2, 3;