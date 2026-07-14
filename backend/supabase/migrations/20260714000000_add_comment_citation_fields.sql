-- Add citation and interaction fields for relevant comments.

alter table public.mentions
  add column if not exists source_context text,
  add column if not exists like_count int,
  add column if not exists reply_count int;

drop function if exists public.match_mentions(vector(384), text, int, timestamptz, int);

create function public.match_mentions (
  query_embedding  vector(384),
  query_text       text       default '',
  match_count      int        default 10,
  since            timestamptz default now() - interval '90 days',
  rrf_k            int        default 60
)
returns table (
  id                     uuid,
  content                text,
  source                 text,
  source_context         text,
  author                 text,
  url                    text,
  like_count             int,
  reply_count            int,
  topic                  text,
  public_sentiment       numeric,
  public_sentiment_label  text,
  business_impact        numeric,
  business_impact_label   text,
  impact_reason          text,
  published_at           timestamptz,
  similarity             float,
  rrf_score              float
)
language sql stable
as $$
  with
  vec_ranked as (
    select
      m.id,
      row_number() over (order by m.embedding <=> query_embedding) as vec_rank,
      1 - (m.embedding <=> query_embedding)                        as vec_sim
    from public.mentions m
    where m.embedding is not null
      and m.published_at >= since
    order by m.embedding <=> query_embedding
    limit match_count * 3
  ),
  kw_ranked as (
    select
      m.id,
      row_number() over (
        order by ts_rank_cd(
          m.content_tsv,
          websearch_to_tsquery('german', query_text)
          || websearch_to_tsquery('english', query_text)
        ) desc
      ) as kw_rank
    from public.mentions m
    where m.published_at >= since
      and m.content_tsv @@ (
        websearch_to_tsquery('german', query_text)
        || websearch_to_tsquery('english', query_text)
      )
    limit match_count * 3
  ),
  fused as (
    select
      coalesce(v.id, k.id) as id,
      coalesce(1.0 / (rrf_k + v.vec_rank), 0)::float +
      coalesce(1.0 / (rrf_k + k.kw_rank),  0)::float    as rrf_score,
      coalesce(v.vec_sim, 0)::float                       as similarity
    from vec_ranked v
    full outer join kw_ranked k on v.id = k.id
  )
  select
    m.id,
    m.content,
    m.source,
    m.source_context,
    m.author,
    m.url,
    coalesce(m.like_count, 0) as like_count,
    coalesce(m.reply_count, 0) as reply_count,
    m.topic,
    coalesce(m.public_sentiment,  m.sentiment)       as public_sentiment,
    coalesce(m.public_sentiment_label, m.sentiment_label) as public_sentiment_label,
    coalesce(m.business_impact,   m.sentiment)       as business_impact,
    coalesce(m.business_impact_label, m.sentiment_label)  as business_impact_label,
    coalesce(m.impact_reason, 'unknown')             as impact_reason,
    m.published_at,
    f.similarity,
    f.rrf_score
  from fused f
  join public.mentions m on m.id = f.id
  order by f.rrf_score desc
  limit match_count;
$$;