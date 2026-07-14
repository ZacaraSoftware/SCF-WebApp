/// <reference types="https://esm.sh/@supabase/functions-js/src/edge-runtime.d.ts" />
import { json } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/supabase.ts";

// Suchbegriffe für alle Quellen (Zucker-Diskurs).
const QUERIES = [
  "zucker",
  "sugarfree",
  "sugar free",
  "zuckerfrei",
  "zuckersteuer",
  "softdrink",
  "cola zero",
  "sprite",
  "fanta",
  "kinderschokolade",
  "puderzucker",
  "rohrzucker",
  "limonade",
  "süßigkeiten",
  "cake",
  "kuchen",
  "backen",
  "gebäck",
  "nordzucker",
  "südzucker",
  "suedzucker",
  "pfeifer langen",
  "pfeifer und langen",
  "cosun beet",
];
const MAX_ITEMS_PER_RUN = 80;
const ADAPTER_TIMEOUT_MS = 60000;
const SOURCE_MAX_AGE_DAYS: Record<string, number> = {
  reddit: 30,
  news: 30,
  youtube: 30,
  facebook: 30,
  instagram: 30,
};
const MAX_YOUTUBE_TERMS_PER_RUN = 19; // Option A: Aggressive - all 19 keywords
const YOUTUBE_QUOTA_SOFT_LIMIT = 3000; // If quota < this, reduce collection
const MAX_YOUTUBE_ITEMS_FOR_PIPELINE = 80;
const MIN_CONTENT_LEN = 25;
const MAX_CONTENT_LEN = 1800;
const MAX_LINKS_PER_TEXT = 3;

const NOISE_PATTERNS = [
  /\bsubscribe\b/i,
  /\bfollow\s+me\b/i,
  /\bpromo\b/i,
  /\bgiveaway\b/i,
  /^\s*(removed|deleted)\s*$/i,
];

const KEYWORD_PATTERNS = [
  /\bzucker\b/i,
  /\bzuckersteuer\b/i,
  /\bsoft\s?drink[s]?\b/i,
  /\blimonade[n]?\b/i,
  /\bsüßigkeiten\b/i,
  /\bsuessigkeiten\b/i,
  /\bsüßware[n]?\b/i,
  /\bsuessware[n]?\b/i,
  /\bcola\b/i,
  /\bdiabetes\b/i,
  /\bkuchen\b/i,
  /\bbacken\b/i,
  /\bgebäck\b/i,
  /\bgebaeck\b/i,
  /\btorte\b/i,
  /\bkeks(e)?\b/i,
  /\bplätzchen\b/i,
  /\bplaetzchen\b/i,
  /\bmuffin(s)?\b/i,
  /\bbrownie(s)?\b/i,
  /\bnordzucker\b/i,
  /\bsüdzucker\b/i,
  /\bsuedzucker\b/i,
  /\bpfeifer\b/i,
  /\blangen\b/i,
  /\bcosun\b/i,
  /\bbeet\b/i,
];

const YOUTUBE_TERMS = [
  "zucker",
  "zuckerfrei",
  "sugarfree",
  "cola zero",
  "sprite",
  "fanta",
  "kinderschokolade",
  "cake",
  "backen",
  "puderzucker",
  "rohrzucker",
  "softdrink",
  "diabetes",
  "nordzucker",
  "südzucker",
  "suedzucker",
  "pfeifer langen",
  "cosun beet",
];

const SIGNAL_TERMS = Array.from(new Set([
  ...QUERIES,
  ...YOUTUBE_TERMS,
  "diet coke",
  "zero sugar",
  "zuckerersatz",
]));

const HIGH_VALUE_TERMS = new Set([
  "cola zero",
  "sprite",
  "fanta",
  "kinderschokolade",
  "puderzucker",
  "rohrzucker",
  "zuckerfrei",
  "sugarfree",
  "softdrink",
  "nordzucker",
  "südzucker",
  "suedzucker",
  "pfeifer langen",
  "cosun beet",
  "nordzucker",
  "südzucker",
  "suedzucker",
  "pfeifer langen",
  "cosun beet",
]);
const COMPETITOR_CONTEXT_TERMS = [
  "zucker",
  "sugar",
  "rübe",
  "ruebe",
  "süß",
  "suess",
  "syrup",
  "sirup",
  "lebensmittel",
];

type CompetitorProfile = {
  name: string;
  aliases: string[];
  query_hints: string[];
  require_context: boolean;
};

let activeCompetitorProfiles: CompetitorProfile[] = [];

type RunInsights = {
  topTerms: Array<{ term: string; count: number }>;
  avgSignalBySource: Record<string, number>;
};

type Raw = {
  source: string;
  external_id: string;
  author: string | null;
  content: string;
  url: string | null;
  published_at: string;
};

type Prepared = Raw & {
  content: string;
  signalScore: number;
  matchedTerms: string[];
};

type FilterStats = {
  incoming: number;
  kept: number;
  dropped: number;
  reasons: Record<string, number>;
};

type AdapterConfig = {
  name: string;
  requiredEnv: string[];
  run: () => Promise<Raw[]>;
};

type AdapterDiag = {
  name: string;
  status: "ok" | "missing_env" | "error";
  count: number;
  missingEnv?: string[];
  error?: string;
  details?: Record<string, unknown>;
};

type YoutubeRunDebug = {
  terms: string[];
  searchHitsByTerm: Record<string, number>;
  videosCollected: number;
  commentThreadsFetched: number;
  acceptedComments: number;
  fallbackVideosUsed: number;
};

type YoutubeQuotaStrategy = {
  maxTerms: number;              // How many search terms to use in this run
  maxVideosPerTerm: number;      // How many videos to fetch per search term
  maxVideosTotal: number;         // Max total videos in this run
  maxCommentsPerVideo: number;    // How many comment threads per video
  availableQuota: number;         // Remaining quota for this run
  estimatedQuotaCost: number;     // Estimated quota this run will consume
};

type YoutubeTermStat = {
  term: string;
  total_runs: number;
  total_hits: number;
  last_hits: number;
  ewma_hits: number;
};

let lastYoutubeRunDebug: YoutubeRunDebug | null = null;

async function loadCompetitorProfiles(db: ReturnType<typeof serviceClient>): Promise<CompetitorProfile[]> {
  const { data, error } = await db
    .from("competitor_profiles")
    .select("name, aliases, query_hints, require_context")
    .eq("active", true)
    .order("name", { ascending: true });

  if (error) {
    console.error("load competitor profiles failed:", error.message);
    return [];
  }

  return (data ?? []).map((row: any) => ({
    name: row.name,
    aliases: Array.isArray(row.aliases) ? row.aliases : [],
    query_hints: Array.isArray(row.query_hints) ? row.query_hints : [],
    require_context: !!row.require_context,
  }));
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: number | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timeout after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function normalizeText(input: string): string {
  const noUrls = input.replace(/https?:\/\/\S+/gi, " ");
  return noUrls
    .replace(/[\t\r\n]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function countLinks(input: string): number {
  return (input.match(/https?:\/\//gi) ?? []).length;
}

function isRelevant(text: string): boolean {
  return KEYWORD_PATTERNS.some((rx) => rx.test(text));
}

function noiseReason(text: string, source: string): string | null {
  if (text.length < MIN_CONTENT_LEN) return "too_short";
  if (text.length > MAX_CONTENT_LEN) return "too_long";
  if (countLinks(text) > MAX_LINKS_PER_TEXT) return "too_many_links";
  if (NOISE_PATTERNS.some((rx) => rx.test(text))) return "noise_pattern";
  // YouTube comments are often short/implicit; source query already scopes videos.
  if (source !== "news" && source !== "youtube" && !isRelevant(text)) return "out_of_scope";
  return null;
}

function parsePublishedAt(value: string): number | null {
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return null;
  return ts;
}

function isFreshForSource(source: string, publishedAtTs: number): boolean {
  const maxAgeDays = SOURCE_MAX_AGE_DAYS[source] ?? 30;
  const oldestAllowed = Date.now() - (maxAgeDays * DAYMS);
  return publishedAtTs >= oldestAllowed;
}

async function fetchJsonChecked(url: string, timeoutMs = 3200): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
  const payload = await res.json();
  if (!res.ok) {
    const msg = payload?.error?.message ?? payload?.message ?? `HTTP ${res.status}`;
    throw new Error(msg);
  }
  if (payload?.error?.message) throw new Error(payload.error.message);
  return payload;
}

function prepareItems(items: Raw[]): { prepared: Prepared[]; stats: FilterStats } {
  const stats: FilterStats = {
    incoming: items.length,
    kept: 0,
    dropped: 0,
    reasons: {},
  };

  const prepared: Prepared[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    const publishedAtTs = parsePublishedAt(item.published_at);
    if (publishedAtTs === null) {
      stats.dropped += 1;
      stats.reasons.invalid_published_at = (stats.reasons.invalid_published_at ?? 0) + 1;
      continue;
    }
    if (!isFreshForSource(item.source, publishedAtTs)) {
      stats.dropped += 1;
      stats.reasons.stale_published_at = (stats.reasons.stale_published_at ?? 0) + 1;
      continue;
    }

    const content = normalizeText(item.content ?? "");
    const key = `${item.source}|${item.external_id}|${content.toLowerCase()}`;
    if (seen.has(key)) {
      stats.dropped += 1;
      stats.reasons.duplicate = (stats.reasons.duplicate ?? 0) + 1;
      continue;
    }
    seen.add(key);

    const reason = noiseReason(content, item.source);
    if (reason) {
      stats.dropped += 1;
      stats.reasons[reason] = (stats.reasons[reason] ?? 0) + 1;
      continue;
    }

    const signal = computeSignal(content);
    if (item.source === "youtube" && signal.score === 0) {
      stats.dropped += 1;
      stats.reasons.low_signal = (stats.reasons.low_signal ?? 0) + 1;
      continue;
    }

    prepared.push({
      ...item,
      content,
      signalScore: signal.score,
      matchedTerms: signal.matchedTerms,
    });
  }

  stats.kept = prepared.length;
  return { prepared, stats };
}

function selectBalancedItems(items: Prepared[], limit: number): Prepared[] {
  if (items.length <= limit) return items;
  const bySource = new Map<string, Prepared[]>();
  for (const item of items) {
    const bucket = bySource.get(item.source) ?? [];
    bucket.push(item);
    bySource.set(item.source, bucket);
  }
  for (const bucket of bySource.values()) {
    bucket.sort((a, b) => {
      if (b.signalScore !== a.signalScore) return b.signalScore - a.signalScore;
      return new Date(b.published_at).getTime() - new Date(a.published_at).getTime();
    });
  }
  const sources = Array.from(bySource.keys()).sort();
  const out: Prepared[] = [];
  while (out.length < limit) {
    let progressed = false;
    for (const src of sources) {
      const bucket = bySource.get(src);
      if (!bucket || bucket.length === 0) continue;
      out.push(bucket.shift() as Prepared);
      progressed = true;
      if (out.length >= limit) break;
    }
    if (!progressed) break;
  }
  // Keep the freshest subset for downstream NLP/embedding to avoid worker resource limits.
  const capped = out
    .sort((a, b) => new Date(b.published_at ?? 0).getTime() - new Date(a.published_at ?? 0).getTime())
    .slice(0, MAX_YOUTUBE_ITEMS_FOR_PIPELINE);
  return capped;
}

function pickRotatingTerms(pool: string[], count: number): string[] {
  if (pool.length <= count) return pool;
  const daySeed = Math.floor(Date.now() / 86400000);
  const start = daySeed % pool.length;
  const out: string[] = [];
  for (let i = 0; i < count; i += 1) out.push(pool[(start + i) % pool.length]);
  return out;
}

function buildCompetitorTerms(profiles: CompetitorProfile[]): string[] {
  const terms = profiles.flatMap((p) => p.query_hints?.length ? p.query_hints : p.aliases.slice(0, 1));
  return Array.from(new Set(terms.map((t) => t.trim()).filter(Boolean)));
}

function stableHash(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) - hash) + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function buildYoutubeTermPool(): string[] {
  const competitor = buildCompetitorTerms(activeCompetitorProfiles);
  return Array.from(new Set([...YOUTUBE_TERMS, ...competitor]))
    .map((term) => term.trim())
    .filter(Boolean);
}

async function loadYoutubeTermStats(terms: string[]): Promise<Map<string, YoutubeTermStat>> {
  if (!terms.length) return new Map();
  const { data, error } = await serviceClient()
    .from("youtube_term_stats")
    .select("term, total_runs, total_hits, last_hits, ewma_hits")
    .in("term", terms);
  if (error) {
    console.warn("loadYoutubeTermStats failed:", error.message);
    return new Map();
  }
  const map = new Map<string, YoutubeTermStat>();
  for (const row of data ?? []) {
    map.set(row.term, {
      term: row.term,
      total_runs: Number(row.total_runs ?? 0),
      total_hits: Number(row.total_hits ?? 0),
      last_hits: Number(row.last_hits ?? 0),
      ewma_hits: Number(row.ewma_hits ?? 0),
    });
  }
  return map;
}

function pickAdaptiveYoutubeTerms(maxTerms: number, pool: string[], stats: Map<string, YoutubeTermStat>): string[] {
  if (maxTerms <= 0 || pool.length === 0) return [];
  const daySeed = Math.floor(Date.now() / 86400000);
  const scored = pool.map((term) => {
    const row = stats.get(term);
    const ewma = row?.ewma_hits ?? 0;
    const runs = row?.total_runs ?? 0;
    const novelty = row ? Math.max(0, 1 - Math.min(runs, 30) / 30) : 1.15;
    const diversity = (stableHash(`${term}:${daySeed}`) % 1000) / 1000;
    const score = (ewma * 1.6) + novelty + (diversity * 0.12);
    return { term, score };
  }).sort((a, b) => b.score - a.score);

  const exploitCount = Math.max(1, Math.floor(maxTerms * 0.7));
  const exploit = scored.slice(0, exploitCount).map((entry) => entry.term);
  const rest = scored.slice(exploitCount).map((entry) => entry.term);
  const rotatedRest = pickRotatingTerms(rest, Math.max(0, maxTerms - exploit.length));
  return Array.from(new Set([...exploit, ...rotatedRest])).slice(0, maxTerms);
}

async function persistYoutubeTermStats(searchHitsByTerm: Record<string, number>): Promise<void> {
  const terms = Object.keys(searchHitsByTerm);
  if (!terms.length) return;
  const existing = await loadYoutubeTermStats(terms);
  const rows = terms.map((term) => {
    const hits = Number(searchHitsByTerm[term] ?? 0);
    const prev = existing.get(term);
    const nextRuns = (prev?.total_runs ?? 0) + 1;
    const nextTotalHits = (prev?.total_hits ?? 0) + hits;
    const prevEwma = Number(prev?.ewma_hits ?? 0);
    const nextEwma = ((prevEwma * 0.7) + (hits * 0.3));
    return {
      term,
      total_runs: nextRuns,
      total_hits: nextTotalHits,
      last_hits: hits,
      ewma_hits: Number(nextEwma.toFixed(3)),
      last_run_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  });
  const { error } = await serviceClient()
    .from("youtube_term_stats")
    .upsert(rows, { onConflict: "term", ignoreDuplicates: false });
  if (error) console.warn("persistYoutubeTermStats failed:", error.message);
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeForMatch(input: string): string {
  return ` ${input
    .toLowerCase()
    .replace(/[^a-z0-9äöüß]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()} `;
}

function mentionCompetitors(content: string, profiles: CompetitorProfile[]): string[] {
  const normalized = normalizeForMatch(content);
  const matched: string[] = [];
  const hasContext = COMPETITOR_CONTEXT_TERMS.some((term) => normalized.includes(` ${term} `));
  for (const competitor of profiles) {
    const hit = competitor.aliases.some((alias) => normalized.includes(` ${normalizeForMatch(alias).trim()} `));
    if (competitor.require_context && hit && !hasContext) {
      continue;
    }
    if (hit) matched.push(competitor.name);
  }
  return matched;
}

function weekStartUTC(input: string): string {
  const date = new Date(input);
  date.setUTCHours(0, 0, 0, 0);
  const day = date.getUTCDay();
  const diffToMonday = (day + 6) % 7;
  date.setUTCDate(date.getUTCDate() - diffToMonday);
  return date.toISOString().slice(0, 10);
}

async function updateCompetitorMetrics(
  db: ReturnType<typeof serviceClient>,
  profiles: CompetitorProfile[],
): Promise<{ weeks: number; rows: number }> {
  if (profiles.length === 0) return { weeks: 0, rows: 0 };
  const sinceIso = new Date(Date.now() - 84 * 86400000).toISOString();
  const sinceDate = sinceIso.slice(0, 10);
  const { data, error } = await db
    .from("mentions")
    .select("content, public_sentiment, sentiment, published_at")
    .eq("enrichment_status", "done")
    .gte("published_at", sinceIso)
    .order("published_at", { ascending: false })
    .limit(8000);

  if (error) throw new Error(`competitor metrics source read failed: ${error.message}`);

  type WeekBucket = {
    total: number;
    byCompetitor: Record<string, { count: number; sumSent: number }>;
  };

  const byWeek = new Map<string, WeekBucket>();
  for (const row of data ?? []) {
    const matched = mentionCompetitors(row.content ?? "", profiles);
    if (matched.length === 0) continue;
    const week = weekStartUTC(row.published_at);
    const bucket = byWeek.get(week) ?? {
      total: 0,
      byCompetitor: Object.fromEntries(profiles.map((c) => [c.name, { count: 0, sumSent: 0 }])),
    };

    for (const comp of matched) {
      bucket.total += 1;
      const slot = bucket.byCompetitor[comp];
      slot.count += 1;
      slot.sumSent += Number(row.public_sentiment ?? row.sentiment ?? 0);
    }
    byWeek.set(week, bucket);
  }

  const { error: clearError } = await db
    .from("competitor_metrics")
    .delete()
    .gte("week", sinceDate);
  if (clearError) throw new Error(`competitor metrics cleanup failed: ${clearError.message}`);

  if (byWeek.size === 0) return { weeks: 0, rows: 0 };

  const rows = Array.from(byWeek.entries()).flatMap(([week, bucket]) => {
    return profiles.map((competitor) => {
      const slot = bucket.byCompetitor[competitor.name] ?? { count: 0, sumSent: 0 };
      const netSentiment = slot.count > 0 ? Math.round((slot.sumSent / slot.count) * 100) : 0;
      const shareOfVoice = bucket.total > 0 ? +((slot.count / bucket.total) * 100).toFixed(2) : 0;
      return {
        competitor: competitor.name,
        week,
        net_sentiment: netSentiment,
        share_of_voice: shareOfVoice,
      };
    });
  });

  const { error: upsertError } = await db
    .from("competitor_metrics")
    .upsert(rows, { onConflict: "competitor,week" });
  if (upsertError) throw new Error(`competitor metrics upsert failed: ${upsertError.message}`);

  return { weeks: byWeek.size, rows: rows.length };
}

function computeSignal(content: string): { score: number; matchedTerms: string[] } {
  const text = content.toLowerCase();
  const matchedTerms: string[] = [];
  let score = 0;
  for (const term of SIGNAL_TERMS) {
    const rx = new RegExp(
      `(?:^|[^a-z0-9äöüß])${escapeRegex(term.toLowerCase())}(?:$|[^a-z0-9äöüß])`,
      "i",
    );
    if (!rx.test(text)) continue;
    matchedTerms.push(term);
    score += HIGH_VALUE_TERMS.has(term) ? 3 : 1;
  }
  return { score, matchedTerms };
}

function buildRunInsights(prepared: Prepared[]): RunInsights {
  const termCount = new Map<string, number>();
  const scoreBySource = new Map<string, { sum: number; count: number }>();

  for (const item of prepared) {
    for (const term of item.matchedTerms) {
      termCount.set(term, (termCount.get(term) ?? 0) + 1);
    }
    const row = scoreBySource.get(item.source) ?? { sum: 0, count: 0 };
    row.sum += item.signalScore;
    row.count += 1;
    scoreBySource.set(item.source, row);
  }

  const topTerms = Array.from(termCount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([term, count]) => ({ term, count }));

  const avgSignalBySource: Record<string, number> = {};
  for (const [source, row] of scoreBySource.entries()) {
    avgSignalBySource[source] = +(row.sum / Math.max(1, row.count)).toFixed(2);
  }

  return { topTerms, avgSignalBySource };
}

// ---------------------------------------------------------------------------
// Quellen-Adapter — einheitliches Interface: fetch(): Promise<Raw[]>
// ---------------------------------------------------------------------------

async function reddit(): Promise<Raw[]> {
  const id = Deno.env.get("REDDIT_CLIENT_ID");
  const secret = Deno.env.get("REDDIT_CLIENT_SECRET");
  const ua = Deno.env.get("REDDIT_USER_AGENT") ?? "nordzucker-scf/1.0";
  if (!id || !secret) return [];

  // OAuth2 (client_credentials)
  const tok = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      Authorization: "Basic " + btoa(`${id}:${secret}`),
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": ua,
    },
    body: "grant_type=client_credentials",
  }).then((r) => r.json());
  const token = tok.access_token;
  if (!token) return [];

  const subs = ["de", "Finanzen", "Ernaehrung", "fitness"];
  const sinceTs = Date.now() - ((SOURCE_MAX_AGE_DAYS.reddit ?? 30) * DAYMS);
  const out: Raw[] = [];
  for (const sub of subs) {
    const q = encodeURIComponent(QUERIES.join(" OR "));
    const res = await fetch(
      `https://oauth.reddit.com/r/${sub}/search?q=${q}&restrict_sr=1&sort=new&t=month&limit=10`,
      { headers: { Authorization: `Bearer ${token}`, "User-Agent": ua } },
    ).then((r) => r.json());
    for (const c of res?.data?.children ?? []) {
      const d = c.data;
      const publishedAtTs = Number(d.created_utc ?? 0) * 1000;
      if (!publishedAtTs || publishedAtTs < sinceTs) continue;
      const text = `${d.title ?? ""} ${d.selftext ?? ""}`.trim();
      if (!text) continue;
      out.push({
        source: "reddit",
        external_id: d.id,
        author: d.author ?? null,
        content: text.slice(0, 2000),
        url: `https://reddit.com${d.permalink}`,
        published_at: new Date(d.created_utc * 1000).toISOString(),
      });
    }
  }
  return out;
}

async function news(): Promise<Raw[]> {
  const key = Deno.env.get("NEWSAPI_KEY");
  if (!key) return [];
  const out: Raw[] = [];
  const from = new Date(Date.now() - ((SOURCE_MAX_AGE_DAYS.news ?? 30) * DAYMS)).toISOString().slice(0, 10);

  const broadQ = encodeURIComponent(QUERIES.join(" OR "));
  const broadRes = await fetch(
    `https://newsapi.org/v2/everything?q=${broadQ}&language=de&sortBy=publishedAt&pageSize=10&from=${from}&apiKey=${key}`,
  ).then((r) => r.json());
  out.push(...(broadRes?.articles ?? []).map((a: any): Raw => ({
    source: "news",
    external_id: a.url,
    author: a.source?.name ?? null,
    content: `${a.title ?? ""} ${a.description ?? ""}`.trim().slice(0, 2000),
    url: a.url,
    published_at: a.publishedAt,
  })).filter((r: Raw) => r.content));

  const competitorQueries = activeCompetitorProfiles.map((profile) => {
    const base = profile.query_hints?.[0] || profile.aliases?.[0] || profile.name;
    const query = profile.require_context
      ? `${base} AND (zucker OR sugar OR rübe OR ruebe)`
      : base;
    return { tag: base, query };
  });

  for (const item of competitorQueries) {
    try {
      const q = encodeURIComponent(item.query);
      const res = await fetch(
        `https://newsapi.org/v2/everything?q=${q}&language=de&sortBy=publishedAt&pageSize=4&from=${from}&apiKey=${key}`,
      ).then((r) => r.json());

      out.push(...(res?.articles ?? []).map((a: any): Raw => ({
        source: "news",
        external_id: a.url,
        author: a.source?.name ?? null,
        content: `${item.tag} ${a.title ?? ""} ${a.description ?? ""}`.trim().slice(0, 2000),
        url: a.url,
        published_at: a.publishedAt,
      })).filter((r: Raw) => r.content));
    } catch (e) {
      console.warn(`news competitor term skipped for '${item.tag}':`, String((e as Error)?.message ?? e));
    }
  }

  return out;
}

// Get today's YouTube quota usage from database
async function getTodayYoutubeQuota(): Promise<{ consumed: number; remaining: number }> {
  try {
    const { data, error } = await serviceClient()
      .from("youtube_quota_usage")
      .select("quota_consumed, quota_remaining")
      .eq("date", new Date().toISOString().split("T")[0])
      .single();
    
    if (error || !data) {
      // No record yet today, so full 10000 available
      return { consumed: 0, remaining: 10000 };
    }
    
    return {
      consumed: data.quota_consumed || 0,
      remaining: data.quota_remaining || 10000,
    };
  } catch (e) {
    console.warn("Failed to get YouTube quota:", e);
    return { consumed: 0, remaining: 10000 };
  }
}

// Calculate optimal YouTube collection strategy based on available quota
async function calculateYoutubeQuotaStrategy(): Promise<YoutubeQuotaStrategy> {
  const { remaining } = await getTodayYoutubeQuota();
  
  // Quota costs:
  // - search() = 100 units per call
  // - commentThreads() = 3 units per video
  // Estimate: 1 search per term + 3 comments per video
  
  let maxTerms = MAX_YOUTUBE_TERMS_PER_RUN;
  let maxVideosPerTerm = 2;
  let maxCommentsPerVideo = 2;
  
  if (remaining < YOUTUBE_QUOTA_SOFT_LIMIT) {
    // Low quota: reduce aggressively and preserve tail budget.
    maxTerms = 8;
    maxVideosPerTerm = 1;
    maxCommentsPerVideo = 1;
  } else if (remaining < 5500) {
    // Medium quota: moderate collection.
    maxTerms = 12;
    maxVideosPerTerm = 2;
    maxCommentsPerVideo = 1;
  }
  
  // Calculate estimated cost for this run
  const numTerms = maxTerms;
  const estimatedSearchCost = numTerms * 100;  // 1 search per term
  const estimatedVideos = numTerms * maxVideosPerTerm;
  const maxVideosByRemainingQuota = Math.max(8, Math.floor(Math.max(0, remaining - estimatedSearchCost) / 3));
  
  const maxVideosTotal = Math.min(
    15,
    estimatedVideos,
    maxVideosByRemainingQuota,
  );
  const estimatedQuotaCost = estimatedSearchCost + (maxVideosTotal * 3);
  
  return {
    maxTerms,
    maxVideosPerTerm,
    maxVideosTotal,
    maxCommentsPerVideo,
    availableQuota: remaining,
    estimatedQuotaCost,
  };
}

async function youtube(): Promise<Raw[]> {
  const key = Deno.env.get("YOUTUBE_API_KEY");
  if (!key) return [];
  
  // Get quota strategy based on today's usage
  const strategy = await calculateYoutubeQuotaStrategy();
  const pool = buildYoutubeTermPool();
  const termStats = await loadYoutubeTermStats(pool);
  const termList = pickAdaptiveYoutubeTerms(strategy.maxTerms, pool, termStats);
  console.log(`[YouTube] Adaptive Strategy: ${termList.length}/${pool.length} terms, ${strategy.maxVideosPerTerm} videos/term, max ${strategy.maxVideosTotal} total, ${strategy.maxCommentsPerVideo} comments/video. Available quota: ${strategy.availableQuota}`);
  
  const publishedAfter = encodeURIComponent(new Date(Date.now() - ((SOURCE_MAX_AGE_DAYS.youtube ?? 30) * DAYMS)).toISOString());
  lastYoutubeRunDebug = {
    terms: [...termList],
    searchHitsByTerm: {},
    videosCollected: 0,
    commentThreadsFetched: 0,
    acceptedComments: 0,
    fallbackVideosUsed: 0,
  };
  const videoMap = new Map<string, any>();
  for (const term of termList) {
    if (videoMap.size >= strategy.maxVideosTotal) break;
    const q = encodeURIComponent(term);
    let search: any = { items: [] };
    try {
      search = await fetchJsonChecked(
        `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&order=date&maxResults=${strategy.maxVideosPerTerm}&publishedAfter=${publishedAfter}&q=${q}&relevanceLanguage=de&key=${key}`,
      );
      if (!(search?.items?.length > 0)) {
        search = await fetchJsonChecked(
          `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&order=relevance&maxResults=${strategy.maxVideosPerTerm}&publishedAfter=${publishedAfter}&q=${q}&key=${key}`,
        );
      }
    } catch (e) {
      console.warn(`youtube search skipped for term '${term}':`, String((e as Error)?.message ?? e));
      lastYoutubeRunDebug.searchHitsByTerm[term] = 0;
      continue;
    }
    lastYoutubeRunDebug.searchHitsByTerm[term] = search?.items?.length ?? 0;
    for (const item of search?.items ?? []) {
      if (videoMap.size >= strategy.maxVideosTotal) break;
      const vid = item.id?.videoId;
      if (!vid) continue;
      if (!videoMap.has(vid)) videoMap.set(vid, item);
    }
  }

  const videos = Array.from(videoMap.values());
  lastYoutubeRunDebug.videosCollected = videos.length;
  const out: Raw[] = [];
  let totalQuotaConsumed = (strategy.maxTerms * 100); // Search costs
  
  for (const v of videos) {
    const vid = v.id?.videoId;
    if (!vid) continue;
    let ct: any = { items: [] };
    try {
      ct = await fetchJsonChecked(
        `https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&maxResults=${strategy.maxCommentsPerVideo}&videoId=${vid}&textFormat=plainText&key=${key}`,
      );
    } catch (e) {
      console.warn(`youtube comments skipped for video '${vid}':`, String((e as Error)?.message ?? e));
    }
    lastYoutubeRunDebug.commentThreadsFetched += 1;
    totalQuotaConsumed += 3; // commentThreads costs 3 units
    
    let commentCount = 0;
    for (const t of ct?.items ?? []) {
      const s = t.snippet?.topLevelComment?.snippet;
      if (!s?.textOriginal) continue;
      const videoTitle = v.snippet?.title ? `${v.snippet.title} ` : "";
      out.push({
        source: "youtube",
        external_id: t.id,
        author: s.authorDisplayName ?? null,
        content: `${videoTitle}${s.textOriginal}`.slice(0, 2000),
        url: `https://youtube.com/watch?v=${vid}`,
        published_at: s.publishedAt,
      });
      commentCount += 1;
      lastYoutubeRunDebug.acceptedComments += 1;
    }

    if (commentCount === 0) {
      const title = v.snippet?.title ?? "";
      const desc = v.snippet?.description ?? "";
      const content = `${title} ${desc}`.trim();
      if (content) {
        out.push({
          source: "youtube",
          external_id: `video_${vid}`,
          author: v.snippet?.channelTitle ?? null,
          content: content.slice(0, 2000),
          url: `https://youtube.com/watch?v=${vid}`,
          published_at: v.snippet?.publishedAt ?? new Date().toISOString(),
        });
        lastYoutubeRunDebug.fallbackVideosUsed += 1;
      }
    }
  }
  
  // Record quota usage for this run
  try {
    await serviceClient().rpc("record_youtube_quota_usage", {
      consumed_units: totalQuotaConsumed,
      videos_count: videos.length,
      comments_count: out.length,
      run_notes: `Strategy: ${strategy.maxVideosPerTerm} videos/term, ${strategy.maxCommentsPerVideo} comments/video`,
    });
  } catch (e) {
    console.warn("Failed to record YouTube quota usage:", e);
  }

  await persistYoutubeTermStats(lastYoutubeRunDebug.searchHitsByTerm);
  
  return out;
}

// Facebook/Instagram Graph API Adapter
async function facebookInstagram(): Promise<Raw[]> {
  const accessToken = Deno.env.get("FACEBOOK_ACCESS_TOKEN");
  const pageId = Deno.env.get("FACEBOOK_PAGE_ID");
  const instagramBusinessAccountId = Deno.env.get("INSTAGRAM_BUSINESS_ACCOUNT_ID");

  if (!accessToken || !pageId) return [];

  const out: Raw[] = [];
  const sinceIso = new Date(Date.now() - ((SOURCE_MAX_AGE_DAYS.facebook ?? 30) * DAYMS)).toISOString();
  const sinceEpoch = Math.floor(new Date(sinceIso).getTime() / 1000);

  try {
    const postsRes = await fetch(
      `https://graph.facebook.com/v18.0/${pageId}/feed?fields=id,message,created_time,permalink_url&since=${sinceEpoch}&limit=10&access_token=${accessToken}`,
    ).then((r) => r.json());

    for (const post of postsRes?.data ?? []) {
      if (!post.message) continue;
      if (parsePublishedAt(post.created_time) === null) continue;

      out.push({
        source: "facebook",
        external_id: post.id,
        author: "Facebook Post",
        content: post.message.slice(0, 2000),
        url: post.permalink_url ?? null,
        published_at: post.created_time,
      });

      const commentsRes = await fetch(
        `https://graph.facebook.com/v18.0/${post.id}/comments?fields=id,message,from,created_time&since=${sinceEpoch}&limit=5&access_token=${accessToken}`,
      ).then((r) => r.json());

      for (const comment of commentsRes?.data ?? []) {
        if (!comment.message) continue;
        if (parsePublishedAt(comment.created_time) === null) continue;
        out.push({
          source: "facebook",
          external_id: `comment_${comment.id}`,
          author: comment.from?.name ?? null,
          content: comment.message.slice(0, 2000),
          url: post.permalink_url ?? null,
          published_at: comment.created_time,
        });
      }
    }

    const igId = instagramBusinessAccountId ?? (await fetch(
      `https://graph.facebook.com/v18.0/${pageId}?fields=instagram_business_account&access_token=${accessToken}`,
    ).then((r) => r.json())).instagram_business_account?.id;

    if (!igId) return out;

    const mediaRes = await fetch(
      `https://graph.facebook.com/v18.0/${igId}/media?fields=id,caption,media_type,media_url,permalink,timestamp&limit=10&access_token=${accessToken}`,
    ).then((r) => r.json());

    for (const media of mediaRes?.data ?? []) {
      const mediaTs = parsePublishedAt(media.timestamp);
      if (mediaTs === null || !isFreshForSource("instagram", mediaTs)) continue;
      if (media.caption) {
        out.push({
          source: "instagram",
          external_id: media.id,
          author: "Instagram Post",
          content: media.caption.slice(0, 2000),
          url: media.permalink ?? null,
          published_at: media.timestamp,
        });
      }

      const commentsRes = await fetch(
        `https://graph.facebook.com/v18.0/${media.id}/comments?fields=id,text,username,timestamp&since=${sinceEpoch}&limit=5&access_token=${accessToken}`,
      ).then((r) => r.json());

      for (const comment of commentsRes?.data ?? []) {
        if (!comment.text) continue;
        out.push({
          source: "instagram",
          external_id: `comment_${comment.id}`,
          author: comment.username ?? null,
          content: comment.text.slice(0, 2000),
          url: media.permalink ?? null,
          published_at: comment.timestamp,
        });
      }
    }
  } catch (e) {
    console.error("facebook_instagram error:", e);
  }

  return out;
}

const ADAPTERS: AdapterConfig[] = [
  { name: "reddit", requiredEnv: ["REDDIT_CLIENT_ID", "REDDIT_CLIENT_SECRET"], run: reddit },
  { name: "news", requiredEnv: ["NEWSAPI_KEY"], run: news },
  { name: "youtube", requiredEnv: ["YOUTUBE_API_KEY"], run: youtube },
  {
    name: "facebook_instagram",
    requiredEnv: ["FACEBOOK_ACCESS_TOKEN", "FACEBOOK_PAGE_ID"],
    run: facebookInstagram,
  },
];

// ---------------------------------------------------------------------------
Deno.serve(async (req) => {
  try {
    if (req.method === "OPTIONS") return json({ ok: true }, 200, req);
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const dryRun = body?.dryRun === true;

    // Cron-Schutz: nur mit gültigem Secret aufrufbar (verify_jwt = false).
    const secret = Deno.env.get("CRON_SECRET");
    if (secret && req.headers.get("x-cron-secret") !== secret) {
      return json({ error: "unauthorized" }, 401, req);
    }

    const db = serviceClient();
    activeCompetitorProfiles = await loadCompetitorProfiles(db);
    const collected: Raw[] = [];
    const perSource: Record<string, number> = {};
    const adapterDiagnostics: AdapterDiag[] = [];

    await Promise.all(
      ADAPTERS.map(async (adapter, idx) => {
        const missingEnv = adapter.requiredEnv.filter((name) => !Deno.env.get(name));
        if (missingEnv.length > 0) {
          adapterDiagnostics.push({
            name: adapter.name,
            status: "missing_env",
            count: 0,
            missingEnv,
          });
          return;
        }
        try {
          const items = await withTimeout(adapter.run(), ADAPTER_TIMEOUT_MS, `adapter-${idx}`);
          adapterDiagnostics.push({
            name: adapter.name,
            status: "ok",
            count: items.length,
            details: adapter.name === "youtube" && lastYoutubeRunDebug ? { ...lastYoutubeRunDebug } : undefined,
          });
          collected.push(...items);
          for (const item of items) {
            perSource[item.source] = (perSource[item.source] ?? 0) + 1;
          }
        } catch (e) {
          console.error("adapter error:", e);
          adapterDiagnostics.push({
            name: adapter.name,
            status: "error",
            count: 0,
            error: String((e as Error)?.message ?? e),
            details: adapter.name === "youtube" && lastYoutubeRunDebug ? { ...lastYoutubeRunDebug } : undefined,
          });
        }
      }),
    );

    if (collected.length === 0) {
      return json({
        ingested: 0,
        note: "Keine Items (Quellen-Keys gesetzt?)",
        perSource,
        adapterDiagnostics,
      }, 200, req);
    }

    const { prepared, stats } = prepareItems(collected);
    const runInsights = buildRunInsights(prepared);
    if (prepared.length === 0) {
      return json({
        ingested: 0,
        note: "Alle Items durch Qualitäts-/Relevanzfilter entfernt",
        perSource,
        filterStats: stats,
        runInsights,
      }, 200, req);
    }

    if (dryRun) {
      const sampleBySource: Record<string, unknown[]> = {};
      for (const item of prepared.slice(0, 40)) {
        if (!sampleBySource[item.source]) sampleBySource[item.source] = [];
        if ((sampleBySource[item.source] as unknown[]).length >= 3) continue;
        (sampleBySource[item.source] as unknown[]).push({
          external_id: item.external_id,
          content_preview: item.content.slice(0, 120),
          published_at: item.published_at,
        });
      }
      return json({
        dryRun: true,
        collected: collected.length,
        prepared: prepared.length,
        perSource,
        filterStats: stats,
        adapterDiagnostics,
        runInsights,
        sampleBySource,
      }, 200, req);
    }

    const { data: knownSourceRows } = await db.from("sources").select("id");
    const knownSources = new Set((knownSourceRows ?? []).map((r) => r.id));
    const validPrepared = prepared.filter((row) => knownSources.has(row.source));
    const droppedUnknownSource = prepared.length - validPrepared.length;
    const limited = selectBalancedItems(validPrepared, MAX_ITEMS_PER_RUN);

    if (limited.length === 0) {
      return json({
        ingested: 0,
        note: "Alle Items entfernt (unbekannte Quellen oder Filter).",
        perSource,
        filterStats: {
          ...stats,
          dropped: stats.dropped + droppedUnknownSource,
          reasons: {
            ...stats.reasons,
            unknown_source: (stats.reasons.unknown_source ?? 0) + droppedUnknownSource,
          },
        },
        adapterDiagnostics,
      }, 200, req);
    }

    // Fast path: store raw items immediately and enqueue async enrichment.
    const rows = limited.map((item) => ({
      source: item.source,
      external_id: item.external_id,
      author: item.author,
      content: item.content,
      url: item.url,
      published_at: item.published_at,
      topic: "unknown",
      sentiment: 0,
      sentiment_label: "neutral",
      is_b2b: false,
      embedding: null,
      enrichment_status: "pending",
      enriched_at: null,
    }));

    const upsertErrors: string[] = [];
    const { error: upsertError } = await db.from("mentions").upsert(rows, {
      onConflict: "source,external_id",
      ignoreDuplicates: true,
    });
    if (upsertError) {
      console.error("upsert:", upsertError.message);
      upsertErrors.push(upsertError.message);
    }
    const ingested = upsertError ? 0 : rows.length;

    // last_sync je Quelle aktualisieren
    for (const src of Object.keys(perSource)) {
      await db.from("sources").update({ last_sync: new Date().toISOString() }).eq("id", src);
    }

    let competitorMetrics = {
      weeks: 0,
      rows: 0,
      profiles: activeCompetitorProfiles.length,
      error: undefined as string | undefined,
    };
    try {
      const computed = await updateCompetitorMetrics(db, activeCompetitorProfiles);
      competitorMetrics = { ...computed, profiles: activeCompetitorProfiles.length, error: undefined };
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      console.error("competitor metrics update failed:", msg);
      competitorMetrics = { weeks: 0, rows: 0, profiles: activeCompetitorProfiles.length, error: msg };
    }

    return json({
      ingested,
      perSource,
      selectedForRun: limited.length,
      filterStats: {
        ...stats,
        dropped: stats.dropped + droppedUnknownSource,
        reasons: {
          ...stats.reasons,
          unknown_source: (stats.reasons.unknown_source ?? 0) + droppedUnknownSource,
        },
      },
      runInsights,
      competitorMetrics,
      enrichmentQueued: rows.length,
      upsertErrors: upsertErrors.slice(0, 5),
      adapterDiagnostics,
      note: ingested === 0 && upsertErrors.length > 0 ? "DB upsert errors present" : undefined,
    }, 200, req);
  } catch (e) {
    console.error("ingest fatal:", e);
    return json({ error: String((e as Error)?.message ?? e) }, 500, req);
  }
});
