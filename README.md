# Smart Customer Feedback — Nordzucker AG

KI-gestützte Plattform zur Analyse der öffentlichen Stimmung gegenüber Zucker, Süßgetränken
und süßen Speisen. Aggregiert öffentliches Feedback (Reddit, YouTube, News), wertet es per
Sentiment-Analyse aus, erkennt Trends und Risiken (z. B. B2B-Exposure im Softdrink-Segment),
und liefert KI-Empfehlungen und -Prognosen.

```
nordzucker-scf/
├── frontend/   React-Dashboard (Vite). Läuft sofort im Demo-Modus.
└── backend/    Supabase: Postgres + pgvector (RAG), Edge Functions, Cron.
```

## Schnellstart (Demo, ohne Backend)

```bash
cd frontend
npm install
npm run dev          # http://localhost:5173
```

Die App startet mit deterministischen Beispieldaten — alle Ansichten (Dashboard, Trends,
Datenquellen) funktionieren. Die KI-Ansichten zeigen einen Hinweis, bis das
Backend verbunden ist.

## Live-Modus (mit Supabase)

1. Backend nach `backend/README.md` deployen (Schema, Edge Functions, Cron, Secrets).
2. Im Frontend `.env` anlegen:
   ```
   VITE_SUPABASE_URL=https://<ref>.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJ...
   ```
3. `npm run dev` — die App erkennt die Variablen und wechselt automatisch auf Live-Daten:
   Mentions aus Postgres, KI-Antworten über die `ai-query` Edge Function (RAG via pgvector).

Es ist kein Code-Umbau nötig — die Datenschicht (`frontend/src/data/`) schaltet selbst um.

## Deployment Frontend
`npm run build` erzeugt `dist/`. Deploybar auf Vercel/Netlify/Cloudflare Pages.
Env-Variablen (`VITE_SUPABASE_*`) dort im Projekt setzen. CORS-Origin in
`backend/supabase/functions/_shared/cors.ts` auf die Domain einschränken.

## Sicherheit
- Anthropic- und Service-Role-Key liegen ausschließlich serverseitig (Supabase Secrets).
- Das Frontend nutzt nur den `anon`-Key; Schreibzugriff ist per RLS auf die Edge Functions beschränkt.

## Stack
React 18 · Vite · Recharts · lucide-react · Supabase (Postgres, pgvector, Edge Functions/Deno) ·
Anthropic Claude (Sentiment, RAG, Empfehlungen).

## Prototype Freeze
Der Prototyp ist ab 2026-07-10 im Freeze-Status.
Details und Regeln: `PROTOTYPE_FREEZE.md`.
