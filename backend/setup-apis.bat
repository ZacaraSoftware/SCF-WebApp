@echo off
REM ============================================================================
REM API Setup Script — Nordzucker SCF (Windows PowerShell Version)
REM Automatisiert das Setzen aller Supabase Secrets
REM ============================================================================

setlocal enabledelayedexpansion

echo.
echo 🚀 Nordzucker SCF — API Setup Script (Windows)
echo ====================================

REM Check ob Supabase CLI installed ist
where supabase >nul 2>nul
if errorlevel 1 (
    echo ❌ Supabase CLI nicht gefunden!
    echo Install: npm install -g supabase
    exit /b 1
)

echo 📝 Gebe deine API Keys ein (oder leave leer zum Überspringen)
echo.

REM ============================================================================
REM Anthropic Claude (Pflicht)
REM ============================================================================
set /p ANTHROPIC_API_KEY="🤖 ANTHROPIC_API_KEY (sk-ant-...): "
if not "!ANTHROPIC_API_KEY!"=="" (
    call supabase secrets set ANTHROPIC_API_KEY="!ANTHROPIC_API_KEY!"
    echo ✅ Anthropic API Key gespeichert
)

REM ============================================================================
REM Cron Secret (Pflicht)
REM ============================================================================
set /p CRON_SECRET="🔐 CRON_SECRET (oder press Enter für auto-generated): "
if "!CRON_SECRET!"=="" (
    REM Generate random hex string (simplified for Windows)
    for /f %%A in ('powershell -Command "[guid]::NewGuid().ToString().Replace('-','')"') do set CRON_SECRET=%%A
    echo    (Auto-generated: !CRON_SECRET!)
)
call supabase secrets set CRON_SECRET="!CRON_SECRET!"
echo ✅ Cron Secret gespeichert

REM ============================================================================
REM Reddit API
REM ============================================================================
echo.
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo Reddit API ^(https://www.reddit.com/prefs/apps^)
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
set /p REDDIT_CLIENT_ID="📱 REDDIT_CLIENT_ID: "
if not "!REDDIT_CLIENT_ID!"=="" (
    set /p REDDIT_CLIENT_SECRET="   REDDIT_CLIENT_SECRET: "
    set /p REDDIT_USER_AGENT="   REDDIT_USER_AGENT (e.g. nordzucker-scf/1.0 by u/username): "
    
    call supabase secrets set REDDIT_CLIENT_ID="!REDDIT_CLIENT_ID!"
    call supabase secrets set REDDIT_CLIENT_SECRET="!REDDIT_CLIENT_SECRET!"
    call supabase secrets set REDDIT_USER_AGENT="!REDDIT_USER_AGENT!"
    echo ✅ Reddit API Keys gespeichert
)

REM ============================================================================
REM NewsAPI
REM ============================================================================
echo.
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo NewsAPI ^(https://newsapi.org/^)
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
set /p NEWSAPI_KEY="📰 NEWSAPI_KEY: "
if not "!NEWSAPI_KEY!"=="" (
    call supabase secrets set NEWSAPI_KEY="!NEWSAPI_KEY!"
    echo ✅ NewsAPI Key gespeichert
)

REM ============================================================================
REM YouTube API
REM ============================================================================
echo.
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo YouTube API ^(https://console.cloud.google.com/^)
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
set /p YOUTUBE_API_KEY="📹 YOUTUBE_API_KEY: "
if not "!YOUTUBE_API_KEY!"=="" (
    call supabase secrets set YOUTUBE_API_KEY="!YOUTUBE_API_KEY!"
    echo ✅ YouTube API Key gespeichert
)

REM ============================================================================
REM Google Trends API (RapidAPI)
REM ============================================================================
echo.
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo Google Trends ^(https://rapidapi.com/api/google-trends^)
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
set /p GOOGLE_TRENDS_API_KEY="📊 GOOGLE_TRENDS_API_KEY (RapidAPI): "
if not "!GOOGLE_TRENDS_API_KEY!"=="" (
    call supabase secrets set GOOGLE_TRENDS_API_KEY="!GOOGLE_TRENDS_API_KEY!"
    call supabase secrets set GOOGLE_TRENDS_API_HOST="google-trends1.p.rapidapi.com"
    echo ✅ Google Trends API Keys gespeichert
)

REM ============================================================================
REM Facebook & Instagram Graph API
REM ============================================================================
echo.
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo Meta Graph API ^(Facebook/Instagram^)
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
set /p FACEBOOK_ACCESS_TOKEN="👥 FACEBOOK_ACCESS_TOKEN: "
if not "!FACEBOOK_ACCESS_TOKEN!"=="" (
    set /p FACEBOOK_PAGE_ID="   FACEBOOK_PAGE_ID: "
    set /p INSTAGRAM_BUSINESS_ACCOUNT_ID="   INSTAGRAM_BUSINESS_ACCOUNT_ID: "
    
    call supabase secrets set FACEBOOK_ACCESS_TOKEN="!FACEBOOK_ACCESS_TOKEN!"
    call supabase secrets set FACEBOOK_PAGE_ID="!FACEBOOK_PAGE_ID!"
    call supabase secrets set INSTAGRAM_BUSINESS_ACCOUNT_ID="!INSTAGRAM_BUSINESS_ACCOUNT_ID!"
    echo ✅ Meta Graph API Keys gespeichert
)

REM ============================================================================
REM Newsletter Monitor (Optional)
REM ============================================================================
echo.
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo Newsletter/Blog Monitor ^(Optional^)
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
set /p NEWSLETTER_MONITOR_KEY="📧 NEWSLETTER_MONITOR_KEY (optional): "
if not "!NEWSLETTER_MONITOR_KEY!"=="" (
    call supabase secrets set NEWSLETTER_MONITOR_KEY="!NEWSLETTER_MONITOR_KEY!"
    echo ✅ Newsletter Monitor Key gespeichert
)

REM ============================================================================
REM Summary
REM ============================================================================
echo.
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo ✅ Setup abgeschlossen!
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo.
echo 📋 Nächste Schritte:
echo   1. Überprüfe alle Keys mit: supabase secrets list
echo   2. Deploye die Edge Functions:
echo      supabase functions deploy ingest
echo      supabase functions deploy ai-query
echo   3. Aktiviere den Cron-Job ^(alle 4h^):
echo      supabase functions deploy ingest --schedule "0 */4 * * *"
echo   4. Teste manuell:
echo      supabase functions invoke ingest --no-verify-jwt
echo.
echo 🚀 Viel Erfolg!
echo.
pause
