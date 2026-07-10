-- ============================================================================
-- Hybrid Search: pgvector (semantisch) + tsvector (BM25 / Keyword)
-- Ergebnis-Fusion per Reciprocal Rank Fusion (RRF, k=60).
-- Findet sowohl semantisch ähnliche als auch exakt passende Mentions.
-- ============================================================================

-- Volltext-Suchindex auf content (deutsch + englisch)
alter table public.mentions
  add column if not exists content_tsv tsvector
    generated always as (
      to_tsvector('german', coalesce(content, ''))
      || to_tsvector('english', coalesce(content, ''))
    ) stored;

create index if not exists mentions_content_tsv_idx
  on public.mentions using gin (content_tsv);

-- Token-Nutzung pro KI-Aufruf (Spalte existiert in Schema, wurde bisher nicht befüllt)
alter table public.ai_runs
  add column if not exists input_tokens  int,
  add column if not exists output_tokens int;

-- Konfidenz-Score aus Claude-Analyse
alter table public.mentions
  add column if not exists analysis_confidence numeric(4,3);

-- Index für Low-Confidence-Filtering (Qualitätssicherung / Monitoring)
create index if not exists mentions_confidence_idx
  on public.mentions (analysis_confidence)
  where analysis_confidence is not null;

-- ============================================================================
-- match_mentions: Hybrid-Version (RRF-Fusion)
-- Parameter:
--   query_embedding  — Vektor der Nutzeranfrage
--   query_text       — Originaltext für BM25-Suche
--   match_count      — Anzahl Ergebnisse
--   since            — Zeitfenster
--   rrf_k            — RRF-Dämpfungsparameter (Standard 60, bewährt in Praxis)
-- ============================================================================
drop function if exists public.match_mentions(vector(384), int, timestamptz);
drop function if exists public.match_mentions(vector(384), text, int, timestamptz, int);

create function public.match_mentions (
  query_embedding  vector(384),
  query_text       text       default '',
  match_count      int        default 10,
  since            timestamptz default now() - interval '90 days',
  rrf_k            int        default 60
)
returns table (
  id                    uuid,
  content               text,
  source                text,
  topic                 text,
  public_sentiment      numeric,
  public_sentiment_label text,
  business_impact       numeric,
  business_impact_label text,
  impact_reason         text,
  published_at          timestamptz,
  similarity            float,
  rrf_score             float
)
language sql stable
as $$
  with
  -- Semantische Suche: cosine similarity per pgvector
  vec_ranked as (
    select
      m.id,
      row_number() over (order by m.embedding <=> query_embedding) as vec_rank,
      1 - (m.embedding <=> query_embedding)                        as vec_sim
    from public.mentions m
    where m.embedding is not null
      and m.published_at >= since
    order by m.embedding <=> query_embedding
    limit match_count * 3   -- Kandidaten-Pool für Fusion
  ),
  -- Keyword-Suche: BM25 via tsvector (nur wenn query_text gegeben)
  kw_ranked as (
    select
      m.id,
      row_number() over (
        order by ts_rank_cd(m.content_tsv,
                            websearch_to_tsquery('german', query_text)
                            || websearch_to_tsquery('english', query_text)) desc
      ) as kw_rank
    from public.mentions m
    where m.published_at >= since
      and m.content_tsv @@ (
            websearch_to_tsquery('german', query_text)
            || websearch_to_tsquery('english', query_text)
          )
    limit match_count * 3
  ),
  -- RRF-Fusion: 1/(k + rank) für beide Kanäle
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
