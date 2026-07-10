# API Integration Guide — Nordzucker SCF

Übersicht aller Datenquellen und deren Setup-Prozesse.

---

## 🔵 Plattformen & Authentifizierung

### 1. **Reddit API** ✅ (Bereits implementiert)

**Zweck:** Sammelt Diskussionen aus deutschen Reddit-Communites  
**Quellen:** r/de, r/Finanzen, r/Ernaehrung, r/fitness

#### Setup:
1. Gehe zu https://www.reddit.com/prefs/apps
2. Klick "Create another app" → "script"
3. Fülle aus:
   - **App name:** `nordzucker-scf`
   - **Redirect URI:** `http://localhost` (lokal reicht)
4. Nach dem Erstellen siehst du:
   - `client_id` (unter App-Name)
   - `client_secret`

```bash
supabase secrets set REDDIT_CLIENT_ID="your_id"
supabase secrets set REDDIT_CLIENT_SECRET="your_secret"
supabase secrets set REDDIT_USER_AGENT="nordzucker-scf/1.0 by u/DEIN_USERNAME"
```

---

### 2. **NewsAPI** ✅ (Bereits implementiert)

**Zweck:** Nachrichten-Monitoring aus deutschsprachigen Medien

#### Setup:
1. Registriere dich auf https://newsapi.org/
2. Kopiere deinen API Key
3. Kostenlos: 100 Anfragen pro Tag

```bash
supabase secrets set NEWSAPI_KEY="your_key"
```

**Suchbegriffe:**  
`zucker, zuckersteuer, softdrink, limonade, süßigkeiten`

---

### 3. **YouTube API** ✅ (Bereits implementiert)

**Zweck:** Video-Kommentare zu Zucker-/Softdrink-Themen

#### Setup:
1. Gehe zu https://console.cloud.google.com/
2. Erstelle ein neues Projekt: `nordzucker-scf`
3. Aktiviere **YouTube Data API v3**
4. Erstelle eine API Key unter "Credentials"

```bash
supabase secrets set YOUTUBE_API_KEY="your_key"
```

**Kostenlimit:** 10.000 Einheiten pro Tag (kostenlos)

---

### 4. **Facebook & Instagram Graph API** 🆕 (Neu hinzugefügt)

**Zweck:** Monitoring von Social-Media-Engagement (Posts, Kommentare)

#### Setup:

1. **Meta App erstellen:**
   - Gehe zu https://developers.facebook.com/
   - Klick "Meine Apps" → "App erstellen"
   - Wähle **"Business"** als Typ
   - Name: `nordzucker-scf`

2. **App konfigurieren:**
   - Wähle **"Instagram Graph API"** und **"Facebook Graph API"** als Produkte
   - Im Dashboard findest du deine **App ID** und **App Secret**

3. **Page Access Token generieren:**
   ```bash
   # Vereinfachte Methode (in der Browser-Console):
   1. Gehe zu https://developers.facebook.com/tools/explorer
   2. Wähle deine App aus
   3. Wähle "Get User Access Token" (with Instagram permissions)
   4. Kopiere den Token
   ```

   **Vollständiger Prozess (sicherer):**
   ```bash
   # 1. Short-lived User Token besorgen
   POST https://graph.facebook.com/v18.0/oauth/access_token
     ?client_id={APP_ID}
     &client_secret={APP_SECRET}
     &redirect_uri={REDIRECT_URI}
     &code={CODE_FROM_FACEBOOK_LOGIN}
   
   # 2. In Long-lived Token konvertieren (gültig für ~60 Tage)
   GET https://graph.facebook.com/v18.0/oauth/access_token
     ?grant_type=fb_exchange_token
     &client_id={APP_ID}
     &client_secret={APP_SECRET}
     &fb_exchange_token={SHORT_LIVED_TOKEN}
   
   # 3. Page Access Token aus User Token generieren
   GET https://graph.facebook.com/v18.0/me/accounts
     ?access_token={USER_ACCESS_TOKEN}
   ```

4. **Berechtigungen setzen:**
   - Im App-Dashboard unter "Settings" → "Basic"
   - Scrolle zu "Berechtigungen" und stelle sicher, dass folgende aktiv sind:
     - `pages_read_engagement`
     - `pages_read_user_content`
     - `instagram_basic`
     - `instagram_manage_insights`

5. **Secrets setzen:**
```bash
supabase secrets set FACEBOOK_ACCESS_TOKEN="your_long_lived_token"
supabase secrets set FACEBOOK_PAGE_ID="your_page_id"
supabase secrets set INSTAGRAM_BUSINESS_ACCOUNT_ID="your_business_account_id"
```

**Finde deine IDs:**
```bash
# Page ID:
GET https://graph.facebook.com/v18.0/me?access_token={TOKEN}
# -> "id": "YOUR_PAGE_ID"

# Instagram Business Account ID:
GET https://graph.facebook.com/v18.0/{PAGE_ID}/instagram_business_account
    ?access_token={TOKEN}
```

---

## 🚀 Deployment in Supabase

### Secrets lokal speichern:
```bash
# Wechsel in backend-Ordner
cd backend/supabase

# Füge alle Secrets ein (einzeln oder Batch)
supabase secrets set REDDIT_CLIENT_ID="xxx"
supabase secrets set REDDIT_CLIENT_SECRET="yyy"
# ... etc
```

### Überprüfe, welche Secrets gespeichert sind:
```bash
supabase secrets list
```

### Starte den Cron-Job (manuell testen):
```bash
# Lokal:
supabase functions invoke ingest --no-verify-jwt

# In Production:
curl -X POST https://your-project.supabase.co/functions/v1/ingest \
  -H "x-cron-secret: YOUR_CRON_SECRET"
```

---

## 🔄 Cron-Job-Konfiguration

Um die Dataigest regelmäßig auszuführen, richte einen Cron-Job in Supabase ein:

### Via Supabase Dashboard:
1. Gehe zu **Functions** → **ingest**
2. Klick auf die drei Punkte → **Edit Function Configuration**
3. Setze Schedule (z.B. `0 */4 * * *` für alle 4 Stunden)
4. Speichern

### Via CLI:
```bash
supabase functions deploy ingest --schedule "0 */4 * * *"
```

---

## 📊 Monitoring & Debugging

### Logs anschauen:
```bash
supabase functions list
supabase functions describe ingest

# Live-Logs:
supabase functions download ingest
tail -f ingest_logs.txt
```

### Manuell testen (mit Secret-Header):
```bash
curl -X POST http://localhost:54321/functions/v1/ingest \
  -H "x-cron-secret: your_cron_secret_here"
```

---

## 🛡️ Sicherheit & Best Practices

1. **Keys niemals ins Repo committen**
   - Nutze `.env.local` (lokal)
   - Nutze `supabase secrets` (Production)

2. **Rate Limits beachten**
   - Reddit: 60 requests/min
   - NewsAPI: 100 req/day (kostenlos)
   - YouTube: 10.000 units/day (kostenlos)
   - Meta Graph API: 200 req/hour (kostenlos)

3. **Error Handling**
   - Der Ingest-Prozess fängt Fehler ab und loggt sie
   - Wenn eine Quelle fehlschlägt, werden die anderen fortgesetzt

4. **Deduplizierung**
   - `(source, external_id)` ist unique key
   - Keine Duplikate in der DB

---

## 🎯 Nächste Schritte

1. ✅ Meta Graph API Keys generieren
2. ✅ Reddit-/NewsAPI-/YouTube-Keys generieren
3. ✅ `supabase secrets set` für alle Keys ausführen
4. ✅ Cron-Job im Dashboard aktivieren
5. ✅ Logs überprüfen → `supabase functions logs ingest`
6. 🚀 Webapp neu laden und Daten im Dashboard sehen!

---

## Fragen?

Schau in `backend/supabase/functions/ingest/index.ts` für die Implementierung oder  
kontaktiere das Dev-Team!
