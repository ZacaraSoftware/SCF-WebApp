insert into public.app_settings (key, value)
values (
  'source_catalog',
  jsonb_build_array(
    jsonb_build_object(
      'id', 'reddit',
      'label', 'Reddit API',
      'priority', 10,
      'color', '#004b93',
      'status', 'active',
      'auth', 'OAuth2 (script app)',
      'endpoint', 'https://oauth.reddit.com/r/{sub}/search',
      'note', 'Subreddits: r/de, r/Ernaehrung, r/Finanzen. Volltext-Kommentare, kostenlos für nicht-kommerzielle Nutzung.'
    ),
    jsonb_build_object(
      'id', 'youtube',
      'label', 'YouTube Data API v3',
      'priority', 20,
      'color', '#e0574a',
      'status', 'active',
      'auth', 'API-Key (Quota)',
      'endpoint', 'https://www.googleapis.com/youtube/v3/commentThreads',
      'note', 'Kommentare unter Videos zu Zucker/Softdrinks. Quota-basiert, sehr ergiebig für Sentiment.'
    ),
    jsonb_build_object(
      'id', 'news',
      'label', 'NewsAPI / GDELT',
      'priority', 30,
      'color', '#6d5ce7',
      'status', 'active',
      'auth', 'API-Key',
      'endpoint', 'https://newsapi.org/v2/everything',
      'note', 'Presseartikel zu Zuckermarkt, Preisen, Politik. Ergänzt das Wettbewerbs-Benchmarking.'
    ),
    jsonb_build_object(
      'id', 'instagram',
      'priority', 40,
      'label', 'Instagram Graph API',
      'color', '#16a37b',
      'status', 'review',
      'auth', 'Business-Account + App-Review',
      'endpoint', 'https://graph.facebook.com/v22.0/ig_hashtag_search',
      'note', 'Nur Hashtag-Suche (max. 30 Hashtags/Woche). Erfordert Business-Account + Meta App-Review (~60 Tage). Basic Display API seit 12/2024 abgeschaltet.'
    )
  )
)
on conflict (key) do update
set value = excluded.value,
    updated_at = now();