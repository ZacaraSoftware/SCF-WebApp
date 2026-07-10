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
  const { data, error } = await client()
    .from("mentions")
    .select("id, source, author, content, url, published_at, topic, sentiment, sentiment_label, public_sentiment, public_sentiment_label, business_impact, business_impact_label, impact_reason, is_b2b, enrichment_status")
    .gte("published_at", since)
    .lt("published_at", endExclusiveIso)
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

function normalizeForMatch(input){
  return ` ${String(input ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()} `;
}

function weekStartUTC(isoDate){
  const date = new Date(isoDate);
  date.setUTCHours(0, 0, 0, 0);
  const day = date.getUTCDay();
  const diffToMonday = (day + 6) % 7;
  date.setUTCDate(date.getUTCDate() - diffToMonday);
  return date.toISOString().slice(0, 10);
}

function isoWeekLabel(weekStartDate){
  const date = new Date(`${weekStartDate}T00:00:00Z`);
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7));
  const week1 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const weekNo = 1 + Math.round(((d.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getUTCDay() + 6) % 7)) / 7);
  return `KW${String(weekNo).padStart(2, "0")}`;
}

function mentionCompetitors(content, profiles){
  const normalized = normalizeForMatch(content);
  const contextTerms = ["zucker", "sugar", "rube", "beet", "softdrink", "suess", "suss", "sirup", "syrup"];
  const hasContext = contextTerms.some((term) => normalized.includes(` ${term} `));
  const hits = [];
  for (const profile of profiles){
    const aliases = Array.isArray(profile.aliases) && profile.aliases.length > 0
      ? profile.aliases
      : [profile.name];
    const found = aliases.some((alias) => normalized.includes(` ${normalizeForMatch(alias).trim()} `));
    if (!found) continue;
    if (profile.require_context && !hasContext) continue;
    hits.push(profile.name);
  }
  return hits;
}

function looksIncomplete(rows){
  if (!rows || rows.length === 0) return true;
  const weeks = [...new Set(rows.map((r) => r.week))].sort();
  const latestWeek = weeks[weeks.length - 1];
  const latestRows = rows.filter((r) => r.week === latestWeek);
  const active = latestRows.filter((r) => Number(r.share_of_voice ?? 0) > 0.01).length;
  return active <= 1;
}

function computeRowsFromMentions(mentions, profiles){
  const byWeek = new Map();

  for (const row of mentions ?? []){
    const matched = mentionCompetitors(row.content ?? "", profiles);
    if (matched.length === 0) continue;

    const week = weekStartUTC(row.published_at);
    const bucket = byWeek.get(week) ?? {
      total: 0,
      byCompetitor: Object.fromEntries(profiles.map((p) => [p.name, { count: 0, sumSent: 0 }])),
    };

    for (const comp of matched){
      bucket.total += 1;
      const slot = bucket.byCompetitor[comp];
      slot.count += 1;
      slot.sumSent += Number(row.public_sentiment ?? row.sentiment ?? 0);
    }

    byWeek.set(week, bucket);
  }

  return Array.from(byWeek.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .flatMap(([week, bucket]) => profiles.map((profile) => {
      const slot = bucket.byCompetitor[profile.name] ?? { count: 0, sumSent: 0 };
      const netSent = slot.count > 0 ? Math.round((slot.sumSent / slot.count) * 100) : 0;
      const sov = bucket.total > 0 ? +((slot.count / bucket.total) * 100).toFixed(2) : 0;
      return {
        competitor: profile.name,
        week,
        net_sentiment: netSent,
        share_of_voice: sov,
      };
    }));
}

export async function supabaseComp(rangeDays = 90){
  const safeRange = Math.max(14, Number(rangeDays) || 90);
  const endExclusiveIso = new Date().toISOString();
  const sinceIso = new Date(Date.now() - safeRange * DAYMS).toISOString();
  const [{ data: metrics }, { data: profiles }, { data: mentions }] = await Promise.all([
    client()
      .from("competitor_metrics")
      .select("competitor, week, net_sentiment, share_of_voice")
      .gte("week", sinceIso.slice(0, 10))
      .order("week", { ascending: true }),
    client()
      .from("competitor_profiles")
      .select("name, aliases, require_context, color")
      .eq("active", true)
      .order("name", { ascending: true }),
    client()
      .from("mentions")
      .select("content, public_sentiment, sentiment, published_at")
      .eq("enrichment_status", "done")
      .gte("published_at", sinceIso)
      .lt("published_at", endExclusiveIso)
      .order("published_at", { ascending: false })
      .limit(8000),
  ]);

  const profileRows = profiles ?? [];
  let rows = metrics ?? [];
  if (profileRows.length > 0 && looksIncomplete(rows)) {
    rows = computeRowsFromMentions(mentions ?? [], profileRows);
  }

  const profileColor = Object.fromEntries((profiles ?? []).map((p) => [p.name, p.color]).filter(([, c]) => !!c));
  const competitorNames = profileRows.length > 0
    ? profileRows.map((p) => p.name)
    : [...new Set(rows.map((r) => r.competitor))];

  if (competitorNames.length === 0) return { names: [], series: [] };

  const byWeekAndComp = new Map(rows.map((r) => [`${r.week}|${r.competitor}`, r]));
  const weeks = [...new Set(rows.map(r => r.week))].sort();
  const recentWeeks = weeks.slice(-6);

  const sovRawByCompetitor = Object.fromEntries(competitorNames.map((name) => [name, 0]));
  for (const name of competitorNames) {
    const values = recentWeeks.map((week) => {
      const hit = byWeekAndComp.get(`${week}|${name}`);
      return Number(hit?.share_of_voice ?? 0);
    });
    const avg = values.length > 0
      ? values.reduce((sum, value) => sum + value, 0) / values.length
      : 0;
    sovRawByCompetitor[name] = avg;
  }

  const sovTotal = competitorNames.reduce((sum, name) => sum + sovRawByCompetitor[name], 0);

  const names = competitorNames.map((name) => ({
    id: toId(name),
    name,
    color: profileColor[name] ?? colorFor(name),
    sov: sovTotal > 0 ? +((sovRawByCompetitor[name] / sovTotal) * 100).toFixed(2) : 0,
  }));

  const series = weeks.map((w) => {
    const row = { week: isoWeekLabel(w) };
    names.forEach((n) => {
      const hit = byWeekAndComp.get(`${w}|${n.name}`);
      row[n.id] = hit ? hit.net_sentiment : 0;
      row[`${n.id}__sov`] = hit ? Number(hit.share_of_voice ?? 0) : 0;
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

export async function ragCommercialActions(summary){
  const { data, error } = await client().functions.invoke("ai-query", {
    body: { mode: "commercial_actions", summary },
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
