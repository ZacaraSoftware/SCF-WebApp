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
  return String(topicId ?? "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase()) || "Unbekannt";
}

export async function supabaseMentions(rangeDays = 60){
  const since = new Date(Date.now() - rangeDays * DAYMS).toISOString();
  const rowLimit = maxRowsForRange(rangeDays);
  const { data, error } = await client()
    .from("mentions")
    .select("id, source, author, content, url, published_at, topic, sentiment, sentiment_label, public_sentiment, public_sentiment_label, business_impact, business_impact_label, impact_reason, is_b2b, enrichment_status")
    .gte("published_at", since)
    .eq("enrichment_status", "done")
    .order("published_at", { ascending: false })
    .limit(rowLimit);
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
    };
  });
}

const COMP_PALETTE = ["#004b93", "#8a6d3b", "#6d5ce7", "#16a37b", "#0a6cd4", "#a35f00"];

function toId(name){
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "") || "competitor";
}

function colorFor(name){
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return COMP_PALETTE[Math.abs(hash) % COMP_PALETTE.length];
}

export async function supabaseComp(){
  const [{ data: metrics }, { data: profiles }] = await Promise.all([
    client()
      .from("competitor_metrics")
      .select("competitor, week, net_sentiment, share_of_voice")
      .order("week", { ascending: true }),
    client()
      .from("competitor_profiles")
      .select("name, color")
      .eq("active", true)
      .order("name", { ascending: true }),
  ]);

  const rows = metrics ?? [];
  const profileColor = Object.fromEntries((profiles ?? []).map((p) => [p.name, p.color]).filter(([, c]) => !!c));
  const competitorNames = [...new Set(rows.map((r) => r.competitor))];

  if (competitorNames.length === 0) return { names: [], series: [] };

  const byWeekAndComp = new Map(rows.map((r) => [`${r.week}|${r.competitor}`, r]));

  const names = competitorNames.map((name) => ({
    id: toId(name),
    name,
    color: profileColor[name] ?? colorFor(name),
    sov: rows.filter((r) => r.competitor === name).slice(-1)[0]?.share_of_voice ?? 0,
  }));

  const weeks = [...new Set(rows.map(r => r.week))];
  const series = weeks.map((w) => {
    const row = { week: `KW${new Date(w).getUTCDate()}` };
    names.forEach((n) => {
      const hit = byWeekAndComp.get(`${w}|${n.name}`);
      row[n.id] = hit ? hit.net_sentiment : 0;
    });
    return row;
  });
  return { names, series };
}

export async function ragChat(messages){
  const { data, error } = await client().functions.invoke("ai-query", {
    body: { mode: "chat", messages },
  });
  if (error) throw error;
  return data.answer;
}

export async function ragRecommendations(summary){
  const { data, error } = await client().functions.invoke("ai-query", {
    body: { mode: "recommendations", summary },
  });
  if (error) throw error;
  return data;
}

export async function supabaseSourceHealth(rangeDays = 30){
  const since = new Date(Date.now() - rangeDays * DAYMS).toISOString();
  const [{ data: sources, error: sourcesError }, { data: mentions, error: mentionsError }] = await Promise.all([
    client().from("sources").select("id, label, status, last_sync").order("id", { ascending: true }),
    client().from("mentions").select("source, published_at").gte("published_at", since).limit(10000),
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
  return (data ?? []).map((row) => ({
    term: row.term,
    totalRuns: Number(row.total_runs ?? 0),
    totalHits: Number(row.total_hits ?? 0),
    lastHits: Number(row.last_hits ?? 0),
    ewmaHits: Number(row.ewma_hits ?? 0),
    lastRunAt: row.last_run_at,
    updatedAt: row.updated_at,
  }));
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
