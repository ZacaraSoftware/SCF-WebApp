-- ============================================================================
-- Smart Customer Feedback — Nordzucker AG
-- Initiales Schema: Mentions, Embeddings (pgvector/RAG), Wettbewerb, RLS, Cron
-- ----------------------------------------------------------------------------
-- Embedding-Dimension: 384  (Supabase gte-small, kostenlos, EN-optimiert)
--   -> Für deutschsprachige Inhalte ggf. auf ein mehrsprachiges Modell wechseln
--      (z. B. OpenAI text-embedding-3-small = 1536). Dann hier vector(1536)
--      und in functions/_shared/embeddings.ts den Provider tauschen.
-- ============================================================================

create extension if not exists vector;
create extension if not exists pg_net;
create extension if not exists pg_cron;

-- ---------- Stammdaten Quellen --------------------------------------------------
create table if not exists public.sources (
  id          text primary key,            -- canonical source id (e.g. reddit, youtube, news, instagram, facebook)
  label       text not null,
  status      text not null default 'active',
  last_sync   timestamptz
);

insert into public.sources (id, label, status) values
  ('reddit',    'Reddit API',            'active'),
  ('youtube',   'YouTube Data API v3',   'active'),
  ('news',      'NewsAPI',               'active'),
  ('instagram', 'Instagram Graph API',   'review')
on conflict (id) do nothing;

-- ---------- Mentions (Kern) -----------------------------------------------------
create table if not exists public.mentions (
  id              uuid primary key default gen_random_uuid(),
  source          text not null references public.sources(id),
  external_id     text not null,                  -- ID bei der Quelle (Dedupe)
  author          text,
  content         text not null,
  url             text,
  published_at    timestamptz not null,
  topic           text,                           -- zuckersteuer | softdrinks | saisonal | ...
  sentiment       numeric(4,3),                   -- -1.000 .. +1.000
  sentiment_label text,                           -- positiv | neutral | negativ
  is_b2b          boolean default false,          -- B2B-Großkundenbezug (z. B. Cola-Abfüller)
  embedding       vector(384),                    -- RAG-Vektor (siehe Kopf)
  created_at      timestamptz not null default now(),
  unique (source, external_id)
);

create index if not exists mentions_published_idx on public.mentions (published_at desc);
create index if not exists mentions_topic_idx      on public.mentions (topic);
create index if not exists mentions_source_idx      on public.mentions (source);
-- Vektor-Index (ANN). lists ~ sqrt(zeilen); bei größerem Datenbestand neu bauen.
create index if not exists mentions_embedding_idx
  on public.mentions using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- ---------- Wettbewerbs-Benchmark ----------------------------------------------
create table if not exists public.competitor_metrics (
  id             uuid primary key default gen_random_uuid(),
  competitor     text not null,                   -- Nordzucker | Südzucker | Pfeifer & Langen | Cosun Beet
  week           date not null,
  net_sentiment  int not null,                    -- -100 .. +100
  share_of_voice numeric(5,2),                    -- %
  unique (competitor, week)
);

-- ---------- Audit der KI-Aufrufe (optional, hilfreich für Nachvollziehbarkeit) --
create table if not exists public.ai_runs (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null,                       -- 'chat' | 'recommendations'
  prompt     text,
  response   jsonb,
  tokens     int,
  created_at timestamptz not null default now()
);

-- ============================================================================
-- RAG: semantische Suche über Mentions
-- ============================================================================
create or replace function public.match_mentions (
  query_embedding vector(384),
  match_count     int default 8,
  since           timestamptz default now() - interval '90 days'
)
returns table (
  id           uuid,
  content      text,
  source       text,
  topic        text,
  sentiment    numeric,
  published_at timestamptz,
  similarity   float
)
language sql stable
as $$
  select m.id, m.content, m.source, m.topic, m.sentiment, m.published_at,
         1 - (m.embedding <=> query_embedding) as similarity
  from public.mentions m
  where m.embedding is not null
    and m.published_at >= since
  order by m.embedding <=> query_embedding
  limit match_count;
$$;

-- ============================================================================
-- Aggregat-View fürs Dashboard (Netto-Stimmung & Volumen je Tag)
-- ============================================================================
create or replace view public.daily_sentiment as
select
  date_trunc('day', published_at)::date          as day,
  source,
  topic,
  count(*)                                        as volume,
  round(avg(sentiment) * 100)::int                as net_sentiment,
  round(avg((sentiment > 0.15)::int) * 100)::int  as positive_share
from public.mentions
group by 1, 2, 3;

-- ============================================================================
-- Row Level Security
--   - Lesen: nur eingeloggte Nutzer (authenticated).
--   - Schreiben: ausschließlich service_role (Edge Functions) -> umgeht RLS.
--   Wenn das Dashboard öffentlich sein soll: Policy zusätzlich für 'anon'.
-- ============================================================================
alter table public.mentions           enable row level security;
alter table public.competitor_metrics enable row level security;
alter table public.sources            enable row level security;

create policy "read_mentions_authenticated"
  on public.mentions for select to authenticated using (true);
create policy "read_competitors_authenticated"
  on public.competitor_metrics for select to authenticated using (true);
create policy "read_sources_authenticated"
  on public.sources for select to authenticated using (true);

-- ============================================================================
-- Cron: Ingestion alle 6 Stunden
-- ----------------------------------------------------------------------------
-- Voraussetzung: Vault-Secrets 'project_url' und 'cron_secret' anlegen
--   select vault.create_secret('https://<ref>.supabase.co', 'project_url');
--   select vault.create_secret('<starkes-zufalls-secret>', 'cron_secret');
-- Das gleiche cron_secret als Edge-Function-Secret CRON_SECRET hinterlegen.
-- ============================================================================
select cron.schedule(
  'scf-ingest-6h',
  '0 */6 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
           || '/functions/v1/ingest',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
