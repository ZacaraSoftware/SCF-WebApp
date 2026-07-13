# Smart Customer Feedback — Nordzucker AG · Deployment (Supabase)

Production-Setup für die Sentiment- & Trend-Plattform: Postgres + **pgvector** (RAG),
**Edge Functions** für Ingestion und LLM-Calls, **pg_cron** für die geplante Datenaufnahme,
**RLS** für Zugriffsschutz. Das React-Frontend (Artifact `SmartCustomerFeedback.jsx`)
wird per `frontend/dataClient.ts` angebunden.

## Architektur

```
Quellen (Reddit/News/YouTube/Facebook/Instagram)   Frontend (React, Vercel)
        │  HTTP                                      │  anon key (RLS)
        ▼                                            ▼
┌─ Edge Function: ingest ─┐              ┌─ Edge Function: ai-query ─┐
│ fetch → Claude (Sentiment/Topic)       │ embed(query) → match_mentions │
│       → embed (gte-small)              │ → Claude (RAG-Antwort)        │
│       → upsert mentions │              └───────────────┬──────────────┘
└────────────┬───────────┘                              │
   pg_cron (alle 6 h)                                    │
        ▼                                                ▼
        └──────────────►  Postgres + pgvector  ◄─────────┘
              mentions · embeddings
```

Der **Anthropic-Key liegt ausschließlich serverseitig**. Das Frontend ruft nie direkt
das LLM auf, sondern die `ai-query`-Function.

---

## Voraussetzungen
- Supabase-Projekt (Pro-Plan empfohlen wegen pg_cron/pg_net)
- Supabase CLI: `npm i -g supabase`
- Anthropic-API-Key; optional Reddit-/NewsAPI-/YouTube-/Meta-Keys

## 1 · Projekt verbinden
```bash
supabase login
supabase link --project-ref <your-project-ref>
```

## 2 · Secrets setzen (serverseitig)
```bash
supabase secrets set \
  ANTHROPIC_API_KEY=sk-ant-... \
  ANTHROPIC_MODEL=claude-sonnet-4-6 \
  CRON_SECRET=$(openssl rand -hex 24) \
  REDDIT_CLIENT_ID=... REDDIT_CLIENT_SECRET=... \
  REDDIT_USER_AGENT="nordzucker-scf/1.0 by u/deinuser" \
  NEWSAPI_KEY=... YOUTUBE_API_KEY=... \
  FACEBOOK_ACCESS_TOKEN=... FACEBOOK_PAGE_ID=... \
  INSTAGRAM_BUSINESS_ACCOUNT_ID=...
```
> Notiere dir das `CRON_SECRET` — es muss gleich auch ins Vault (Schritt 4).

### Verfügbare Datenquellen:
- ✅ **Reddit** (Reddit API, OAuth2)
- ✅ **NewsAPI** (Nachrichten-Monitoring)
- ✅ **YouTube** (Video-Kommentare)
- 🆕 **Facebook/Instagram** (Meta Graph API)

**→ Vollständige Setup-Anleitung:** Siehe [API_SETUP_GUIDE.md](./API_SETUP_GUIDE.md)

## 3 · Schema deployen
```bash
supabase db push
```
Legt Tabellen, pgvector, `match_mentions`, RLS und den Cron-Job an.

## 4 · Vault-Secrets für den Cron (im SQL-Editor)
```sql
select vault.create_secret('https://<your-project-ref>.supabase.co', 'project_url');
select vault.create_secret('<dasselbe CRON_SECRET wie oben>',          'cron_secret');
```

## 5 · Edge Functions deployen
```bash
supabase functions deploy ingest
supabase functions deploy ai-query
```

## 6 · Erstbefüllung testen
```bash
curl -X POST https://<ref>.supabase.co/functions/v1/ingest \
  -H "x-cron-secret: <CRON_SECRET>"
# -> {"ingested": N, "perSource": {...}}
```
Danach läuft die Aufnahme automatisch alle 6 h (anpassbar in der Migration:
`'0 */6 * * *'`). Cron-Status prüfen: `select * from cron.job;`

## 7 · Frontend anbinden
1. `frontend/dataClient.ts` ins Frontend-Projekt übernehmen, `@supabase/supabase-js` installieren.
2. Im Artifact die Demo-Funktionen ersetzen:
   - `ingestAll(range)` → Import aus `dataClient.ts` (gleiche Rückgabeform, `aggregate()` bleibt).
   - `askAI(...)` im KI-Assistenten → `ragChat(messages)`.
  - In *Empfehlungen & Prognosen* → `ragRecommendations(summary)`.
3. `.env` mit `VITE_SUPABASE_URL` und `VITE_SUPABASE_ANON_KEY`.
4. Deploy z. B. auf Vercel; CORS-Origin in `_shared/cors.ts` auf die Domain einschränken.

---

## Deutschsprachige Embeddings (Qualitäts-Upgrade)
Das eingebaute `gte-small` ist EN-optimiert. Für bessere DE-Treffer in
`_shared/embeddings.ts` den OpenAI-Block aktivieren **und** in der Migration
`vector(384)` → `vector(1536)` ändern (Index neu bauen, Tabelle neu embedden).

## Sicherheit (Kurzcheck)
- Service-Role- und Anthropic-Key nie im Frontend.
- RLS aktiv; Schreibzugriff nur über Edge Functions (service_role).
- `ingest` ist über `CRON_SECRET` + `verify_jwt = false` geschützt.
- Rate-/Quota-Limits der Quellen beachten (Instagram benötigt Business-Account + App-Review).
