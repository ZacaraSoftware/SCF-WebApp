-- Add Twitter source
INSERT INTO public.sources (id, label, status)
VALUES ('twitter', 'X API v2', 'active')
ON CONFLICT (id) DO UPDATE
SET label = excluded.label, status = excluded.status;

-- Create twitter_mentions_raw table
CREATE TABLE IF NOT EXISTS public.twitter_mentions_raw (
  tweet_id TEXT PRIMARY KEY,
  query_used TEXT,
  competitor TEXT,
  author_id TEXT,
  author_username TEXT,
  content TEXT NOT NULL,
  lang TEXT,
  retweet_count INT,
  reply_count INT,
  like_count INT,
  quote_count INT,
  bookmark_count INT,
  impression_count INT,
  url TEXT,
  published_at TIMESTAMPTZ NOT NULL,
  collected_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indices for performance
CREATE INDEX IF NOT EXISTS twitter_mentions_raw_competitor_idx
  ON public.twitter_mentions_raw (competitor, published_at DESC);

CREATE INDEX IF NOT EXISTS twitter_mentions_raw_published_idx
  ON public.twitter_mentions_raw (published_at DESC);

-- Enable RLS
ALTER TABLE public.twitter_mentions_raw ENABLE ROW LEVEL SECURITY;

-- Create read policy for authenticated users
DROP POLICY IF EXISTS "read_twitter_mentions_raw_authenticated" ON public.twitter_mentions_raw;
CREATE POLICY "read_twitter_mentions_raw_authenticated"
  ON public.twitter_mentions_raw FOR SELECT TO authenticated USING (TRUE);
