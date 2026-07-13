import { createClient } from "@supabase/supabase-js";

let _client = null;
function client(){
  if (!_client){
    _client = createClient(
      import.meta.env.VITE_SUPABASE_URL,
      import.meta.env.VITE_SUPABASE_ANON_KEY,
    );
  }
  return _client;
}

const DAYMS = 86400000;

function maxRowsForRange(rangeDays){
  if (rangeDays <= 7) return 800;
  if (rangeDays <= 14) return 1400;
  if (rangeDays <= 30) return 2400;
  return 5000;
}

function topicLabelFromId(topicId){
  const normalized = String(topicId ?? "").trim().toLowerCase();
  if (!normalized || ["unknown", "uncategorized", "other", "misc"].includes(normalized)) {
    return "Sonstiges (Nicht klassifiziert)";
  }
  return String(topicId ?? "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase()) || "Unbekannt";
}

export async function supabaseMentions(rangeDays = 60){
  const endExclusiveIso = new Date().toISOString();
  const since = new Date(Date.now() - rangeDays * DAYMS).toISOString();
  const rowLimit = maxRowsForRange(rangeDays);
  const queryWithFlavor = client()
    .from("mentions")
    .select("id, source, author, content, url, published_at, topic, sentiment, sentiment_label, public_sentiment, public_sentiment_label, business_impact, business_impact_label, impact_reason, is_b2b, enrichment_status, primary_flavor, flavor_tags, flavor_confidence")
    .gte("published_at", since)
    .lt("published_at", endExclusiveIso)
    .eq("enrichment_status", "done")
    .order("published_at", { ascending: false })
    .limit(rowLimit);

  let data;
  let error;
  ({ data, error } = await queryWithFlavor);

  // Backward compatibility while migrations are rolling out.
  if (error?.code === "42703" && String(error?.message ?? "").includes("primary_flavor")) {
    ({ data, error } = await client()
      .from("mentions")
      .select("id, source, author, content, url, published_at, topic, sentiment, sentiment_label, public_sentiment, public_sentiment_label, business_impact, business_impact_label, impact_reason, is_b2b, enrichment_status")
      .gte("published_at", since)
      .lt("published_at", endExclusiveIso)
      .eq("enrichment_status", "done")
      .order("published_at", { ascending: false })
      .limit(rowLimit));
  }
  if (error) throw error;
  return (data ?? []).map((m) => {
    const d = new Date(m.published_at);
    const businessImpact = Number(m.business_impact ?? m.sentiment ?? 0);
    const publicSentiment = Number(m.public_sentiment ?? m.sentiment ?? 0);
    return {
      id: m.id, source: m.source, author: m.author, date: d, ts: d.getTime(),
      text: m.content, topic: m.topic, topicLabel: topicLabelFromId(m.topic),
      sentiment: businessImpact,
      sentimentLabel: m.business_impact_label ?? m.sentiment_label ?? "neutral",
      publicSentiment,
      publicSentimentLabel: m.public_sentiment_label ?? m.sentiment_label ?? "neutral",
      impactReason: m.impact_reason ?? "unknown",
      b2b: m.is_b2b,
      primaryFlavor: String(m.primary_flavor ?? "none").trim().toLowerCase() || "none",
      flavorTags: Array.isArray(m.flavor_tags)
        ? m.flavor_tags.map((tag) => String(tag ?? "").trim().toLowerCase()).filter(Boolean)
        : [],
      flavorConfidence: Number(m.flavor_confidence ?? 0),
    };
  });
}

export async function ragChat(payload){
  const body = Array.isArray(payload)
    ? { mode: "chat", messages: payload }
    : { mode: "chat", ...(payload ?? {}) };
  const { data, error } = await client().functions.invoke("ai-query", {
    body,
  });
  if (error) throw error;
  return data;
}

export async function ragConversationHistory(sessionId, limit = 20){
  const { data, error } = await client().functions.invoke("ai-query", {
    body: { mode: "history_list", session_id: sessionId, limit },
  });
  if (error) throw error;
  return data?.conversations ?? [];
}

export async function ragConversationMessages(sessionId, conversationId, limit = 120){
  const { data, error } = await client().functions.invoke("ai-query", {
    body: { mode: "history_get", session_id: sessionId, conversation_id: conversationId, limit },
  });
  if (error) throw error;
  return data;
}

export async function ragRecommendations(summary){
  const { data, error } = await client().functions.invoke("ai-query", {
    body: { mode: "recommendations", summary },
  });
  if (error) throw error;
  return data;
}

export async function supabaseSourceHealth(rangeDays = 90){
  const endExclusiveIso = new Date().toISOString();
  const since = new Date(Date.now() - rangeDays * DAYMS).toISOString();
  const [{ data: sources, error: sourcesError }, { data: mentions, error: mentionsError }] = await Promise.all([
    client().from("sources").select("id, label, status, last_sync").order("id", { ascending: true }),
    client().from("mentions").select("source, published_at").gte("published_at", since).lt("published_at", endExclusiveIso).limit(10000),
  ]);
  if (sourcesError) throw sourcesError;
  if (mentionsError) throw mentionsError;

  const volumeBySource = {};
  for (const row of mentions ?? []) volumeBySource[row.source] = (volumeBySource[row.source] ?? 0) + 1;

  return (sources ?? []).map((s) => ({
    id: s.id,
    label: s.label,
    status: s.status,
    lastSync: s.last_sync,
    volume: volumeBySource[s.id] ?? 0,
  }));
}

export async function supabaseAppSettings(){
  const { data, error } = await client()
    .from("app_settings")
    .select("key, value");
  if (error) throw error;
  return Object.fromEntries((data ?? []).map((r) => [r.key, r.value]));
}

export async function supabaseSaveAppSettings(entries, adminSecret){
  const { data, error } = await client().functions.invoke("admin-settings", {
    body: { entries },
    headers: adminSecret ? { "x-admin-secret": adminSecret } : {},
  });
  if (error) throw error;
  return data;
}

export async function supabaseYoutubeTermStats(limit = 20){
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));
  const { data, error } = await client()
    .from("youtube_term_stats")
    .select("term, total_runs, total_hits, last_hits, ewma_hits, last_run_at, updated_at")
    .order("ewma_hits", { ascending: false })
    .order("total_hits", { ascending: false })
    .limit(safeLimit);
  if (error) throw error;

  const normalizeTerm = (term) => String(term ?? "")
    .trim()
    .replace(/^['"]+|['"]+$/g, "")
    .replace(/\s{2,}/g, " ");

  const byTerm = new Map();
  for (const row of data ?? []) {
    const term = normalizeTerm(row.term);
    if (!term) continue;
    const key = term.toLowerCase();
    const prev = byTerm.get(key);
    const current = {
      term,
      totalRuns: Number(row.total_runs ?? 0),
      totalHits: Number(row.total_hits ?? 0),
      lastHits: Number(row.last_hits ?? 0),
      ewmaHits: Number(row.ewma_hits ?? 0),
      lastRunAt: row.last_run_at,
      updatedAt: row.updated_at,
    };
    if (!prev) {
      byTerm.set(key, current);
      continue;
    }
    byTerm.set(key, {
      term: prev.term.length >= current.term.length ? prev.term : current.term,
      totalRuns: prev.totalRuns + current.totalRuns,
      totalHits: prev.totalHits + current.totalHits,
      lastHits: Math.max(prev.lastHits, current.lastHits),
      ewmaHits: Math.max(prev.ewmaHits, current.ewmaHits),
      lastRunAt: new Date(prev.lastRunAt ?? 0) > new Date(current.lastRunAt ?? 0) ? prev.lastRunAt : current.lastRunAt,
      updatedAt: new Date(prev.updatedAt ?? 0) > new Date(current.updatedAt ?? 0) ? prev.updatedAt : current.updatedAt,
    });
  }

  return Array.from(byTerm.values())
    .sort((a, b) => b.ewmaHits - a.ewmaHits || b.totalHits - a.totalHits)
    .slice(0, safeLimit);
}

export async function supabaseYoutubeQuotaToday(){
  const today = new Date().toISOString().split("T")[0];
  const { data, error } = await client()
    .from("youtube_quota_usage")
    .select("*")
    .eq("date", today)
    .single();
  if (error) throw error;
  return data;
}

export async function supabaseYoutubeQuotaHistory(days = 7){
  const since = new Date(Date.now() - Math.max(1, days) * DAYMS).toISOString().split("T")[0];
  const { data, error } = await client()
    .from("youtube_quota_usage")
    .select("date, quota_consumed, utilization_percent, videos_collected")
    .gte("date", since)
    .order("date", { ascending: false });
  if (error) throw error;
  return data ?? [];
}
