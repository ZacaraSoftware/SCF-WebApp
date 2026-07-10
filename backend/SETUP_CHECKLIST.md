# ✅ API Setup Checkliste — Nordzucker SCF

Nutze diese Checkliste, um alle APIs schnell einzurichten.

---

## 🚀 Phase 1: Vorbereitung

- [ ] Supabase CLI installiert: `npm install -g supabase`
- [ ] Mit Supabase verbunden: `supabase login` + `supabase link --project-ref <REF>`
- [ ] Im `backend/` Ordner: `cd backend/supabase/`

---

## 🔑 Phase 2: API Keys beschaffen

### Reddit ✅
- [ ] Besuche: https://www.reddit.com/prefs/apps
- [ ] Klick "Create another app" → Typ: **script**
- [ ] Kopiere: `client_id`, `client_secret`
- [ ] Generiere einen `user_agent` (z.B. `nordzucker-scf/1.0 by u/DEIN_USERNAME`)

### NewsAPI ✅
- [ ] Besuche: https://newsapi.org/
- [ ] Registriere dich (kostenlos)
- [ ] Kopiere deinen **API Key**

### YouTube ✅
- [ ] Besuche: https://console.cloud.google.com/
- [ ] Erstelle neues Projekt: `nordzucker-scf`
- [ ] Aktiviere **YouTube Data API v3**
- [ ] Erstelle API Key unter "Credentials"
- [ ] Kopiere den **API Key**

### Facebook/Instagram 🆕
- [ ] Besuche: https://developers.facebook.com/
- [ ] Erstelle Meta App
- [ ] Aktiviere Produkte: Instagram Graph API + Facebook Graph API
- [ ] Erstelle **Page Access Token** (oder User Access Token → Page Token)
- [ ] Finde deine **Page ID** und **Business Account ID**
- [ ] Kopiere: `access_token`, `page_id`, `business_account_id`

---

## 🔧 Phase 3: Secrets in Supabase speichern

### Option A: Interaktives Setup (empfohlen)

**Windows:**
```bash
cd backend
./setup-apis.bat
```

**macOS/Linux:**
```bash
cd backend
bash setup-apis.sh
```

### Option B: Manuell (Command Line)

```bash
supabase secrets set \
  ANTHROPIC_API_KEY="sk-ant-..." \
  REDDIT_CLIENT_ID="xxx" \
  REDDIT_CLIENT_SECRET="yyy" \
  REDDIT_USER_AGENT="nordzucker-scf/1.0 by u/deinuser" \
  NEWSAPI_KEY="xxx" \
  YOUTUBE_API_KEY="xxx" \
  FACEBOOK_ACCESS_TOKEN="xxx" \
  FACEBOOK_PAGE_ID="xxx" \
  INSTAGRAM_BUSINESS_ACCOUNT_ID="xxx"
```

### Verifikation

```bash
supabase secrets list
# Output sollte alle Keys zeigen
```

---

## 🚀 Phase 4: Edge Functions Deployment

### Deploye die Funktionen

```bash
supabase functions deploy ingest
supabase functions deploy ai-query
```

### Aktiviere Cron Job (alle 4 Stunden)

```bash
supabase functions deploy ingest --schedule "0 */4 * * *"
```

Alternativen:
- `"0 0 * * *"` = täglich um 00:00 UTC
- `"0 */6 * * *"` = alle 6 Stunden
- `"30 9 * * 1"` = Montags um 09:30 UTC

---

## 🧪 Phase 5: Test

### Manueller Ingest-Test (lokal)

```bash
supabase functions invoke ingest --no-verify-jwt
```

**Erwartetes Output:**
```json
{
  "ingested": 42,
  "perSource": {
    "reddit": 10,
    "news": 15,
    "youtube": 8,
    "facebook": 5,
    "instagram": 4
  },
  "adapterDiagnostics": [
    { "name": "youtube", "status": "ok", "count": 8 }
  }
}
```

### Live-Logs anschauen

```bash
supabase functions logs ingest
```

### Frontend Test

1. Lade die Webapp neu: http://localhost:5173/
2. Dashboard sollte Daten aus allen Quellen anzeigen
3. Sidebar zeigt "Quellen" und "Erwähnungen"

---

## 🎯 Phase 6: Production-Ready Checklist

- [ ] Alle Secrets gespeichert (keine Fehler in `supabase secrets list`)
- [ ] Funktionen erfolgreich deployed
- [ ] Cron-Job aktiv (im Dashboard unter Functions sichtbar)
- [ ] Manueller Test erfolgreich
- [ ] Keine Errors in den Logs
- [ ] Frontend zeigt Daten aus mindestens 3 Quellen
- [ ] Rate Limits beachtet (z.B. Reddit: 60 req/min)

---

## 🐛 Troubleshooting

### "Error: Secret not found"
→ Hast du `supabase secrets set` richtig ausgeführt? Überprüfe mit `supabase secrets list`

### "403 Unauthorized" für Reddit
→ Überprüfe `client_id`, `client_secret` und `user_agent`

### "429 Too Many Requests"
→ Du hast das Rate Limit einer API erreicht. Warte oder upgraden zu Pro-Plan

### "Invalid Facebook Token"
→ Access Token ist abgelaufen? Generiere einen neuen auf https://developers.facebook.com/tools/explorer

### Google Trends funktioniert nicht
→ Nicht relevant: Google Trends ist aktuell nicht als Datenquelle implementiert.

### YouTube liefert 0 Treffer
→ Prüfe `YOUTUBE_API_KEY` mit `supabase secrets list` und teste den Ingest manuell.
→ Achte auf `adapterDiagnostics` im Response (`missing_env`, `error`, `ok`).
→ Bei Quota-/Permission-Fehlern kommt jetzt die YouTube-API-Fehlermeldung direkt im Ingest-Resultat.

### Keine Daten im Frontend
→ Wurde der Cron Job schon ausgeführt? Logs anschauen mit `supabase functions logs ingest`

---

## 📚 Weitere Ressourcen

- **Detailliertes Setup Guide:** [API_SETUP_GUIDE.md](./API_SETUP_GUIDE.md)
- **Backend README:** [README.md](./README.md)
- **Edge Function Code:** [functions/ingest/index.ts](./supabase/functions/ingest/index.ts)
- **Supabase Docs:** https://supabase.com/docs

---

## ✨ Done!

Wenn du bis hierher gekommen bist, sollte alles laufen! 🎉

Fragen? Schau in den Code oder kontaktiere das Team!
