#!/bin/bash

# ============================================================================
# API Setup Script — Nordzucker SCF
# Automatisiert das Setzen aller Supabase Secrets
# ============================================================================

echo "🚀 Nordzucker SCF — API Setup Script"
echo "===================================="
echo ""

# Check ob Supabase CLI installed ist
if ! command -v supabase &> /dev/null; then
    echo "❌ Supabase CLI nicht gefunden!"
    echo "Install: npm install -g supabase"
    exit 1
fi

echo "📝 Gebe deine API Keys ein (oder leave leer zum Überspringen)"
echo ""

# ============================================================================
# Anthropic Claude (Pflicht)
# ============================================================================
read -p "🤖 ANTHROPIC_API_KEY (sk-ant-...): " ANTHROPIC_API_KEY
if [ -n "$ANTHROPIC_API_KEY" ]; then
    supabase secrets set ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY"
    echo "✅ Anthropic API Key gespeichert"
fi

# ============================================================================
# Cron Secret (Pflicht)
# ============================================================================
read -p "🔐 CRON_SECRET (oder press Enter für auto-generated): " CRON_SECRET
if [ -z "$CRON_SECRET" ]; then
    CRON_SECRET=$(openssl rand -hex 24)
    echo "   (Auto-generated: $CRON_SECRET)"
fi
supabase secrets set CRON_SECRET="$CRON_SECRET"
echo "✅ Cron Secret gespeichert"

# ============================================================================
# Reddit API
# ============================================================================
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Reddit API (https://www.reddit.com/prefs/apps)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
read -p "📱 REDDIT_CLIENT_ID: " REDDIT_CLIENT_ID
if [ -n "$REDDIT_CLIENT_ID" ]; then
    read -p "   REDDIT_CLIENT_SECRET: " REDDIT_CLIENT_SECRET
    read -p "   REDDIT_USER_AGENT (e.g. nordzucker-scf/1.0 by u/username): " REDDIT_USER_AGENT
    
    supabase secrets set REDDIT_CLIENT_ID="$REDDIT_CLIENT_ID"
    supabase secrets set REDDIT_CLIENT_SECRET="$REDDIT_CLIENT_SECRET"
    supabase secrets set REDDIT_USER_AGENT="$REDDIT_USER_AGENT"
    echo "✅ Reddit API Keys gespeichert"
fi

# ============================================================================
# NewsAPI
# ============================================================================
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "NewsAPI (https://newsapi.org/)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
read -p "📰 NEWSAPI_KEY: " NEWSAPI_KEY
if [ -n "$NEWSAPI_KEY" ]; then
    supabase secrets set NEWSAPI_KEY="$NEWSAPI_KEY"
    echo "✅ NewsAPI Key gespeichert"
fi

# ============================================================================
# YouTube API
# ============================================================================
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "YouTube API (https://console.cloud.google.com/)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
read -p "📹 YOUTUBE_API_KEY: " YOUTUBE_API_KEY
if [ -n "$YOUTUBE_API_KEY" ]; then
    supabase secrets set YOUTUBE_API_KEY="$YOUTUBE_API_KEY"
    echo "✅ YouTube API Key gespeichert"
fi

# ============================================================================
# Google Trends API (RapidAPI)
# ============================================================================
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Google Trends (https://rapidapi.com/api/google-trends)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
read -p "📊 GOOGLE_TRENDS_API_KEY (RapidAPI): " GOOGLE_TRENDS_API_KEY
if [ -n "$GOOGLE_TRENDS_API_KEY" ]; then
    supabase secrets set GOOGLE_TRENDS_API_KEY="$GOOGLE_TRENDS_API_KEY"
    supabase secrets set GOOGLE_TRENDS_API_HOST="google-trends1.p.rapidapi.com"
    echo "✅ Google Trends API Keys gespeichert"
fi

# ============================================================================
# Facebook & Instagram Graph API
# ============================================================================
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Meta Graph API (Facebook/Instagram)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
read -p "👥 FACEBOOK_ACCESS_TOKEN: " FACEBOOK_ACCESS_TOKEN
if [ -n "$FACEBOOK_ACCESS_TOKEN" ]; then
    read -p "   FACEBOOK_PAGE_ID: " FACEBOOK_PAGE_ID
    read -p "   INSTAGRAM_BUSINESS_ACCOUNT_ID: " INSTAGRAM_BUSINESS_ACCOUNT_ID
    
    supabase secrets set FACEBOOK_ACCESS_TOKEN="$FACEBOOK_ACCESS_TOKEN"
    supabase secrets set FACEBOOK_PAGE_ID="$FACEBOOK_PAGE_ID"
    supabase secrets set INSTAGRAM_BUSINESS_ACCOUNT_ID="$INSTAGRAM_BUSINESS_ACCOUNT_ID"
    echo "✅ Meta Graph API Keys gespeichert"
fi

# ============================================================================
# Newsletter Monitor (Optional)
# ============================================================================
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Newsletter/Blog Monitor (Optional)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
read -p "📧 NEWSLETTER_MONITOR_KEY (optional): " NEWSLETTER_MONITOR_KEY
if [ -n "$NEWSLETTER_MONITOR_KEY" ]; then
    supabase secrets set NEWSLETTER_MONITOR_KEY="$NEWSLETTER_MONITOR_KEY"
    echo "✅ Newsletter Monitor Key gespeichert"
fi

# ============================================================================
# Summary
# ============================================================================
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Setup abgeschlossen!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📋 Nächste Schritte:"
echo "  1. Überprüfe alle Keys mit: supabase secrets list"
echo "  2. Deploye die Edge Functions:"
echo "     supabase functions deploy ingest"
echo "     supabase functions deploy ai-query"
echo "  3. Aktiviere den Cron-Job (alle 4h):"
echo "     supabase functions deploy ingest --schedule '0 */4 * * *'"
echo "  4. Teste manuell:"
echo "     supabase functions invoke ingest --no-verify-jwt"
echo ""
echo "🚀 Viel Erfolg!"
