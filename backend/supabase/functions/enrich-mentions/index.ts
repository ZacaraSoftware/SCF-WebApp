/// <reference types="https://esm.sh/@supabase/functions-js/src/edge-runtime.d.ts" />
import { json } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { embed } from "../_shared/embeddings.ts";
import { analyzeBatch } from "../_shared/llm.ts";

const MAX_ENRICH_ITEMS_PER_RUN = 40;
const ENRICH_BATCH_SIZE = 8;
const EMBED_CONCURRENCY = 2;

type MentionRow = {
  id: string;
  source: string;
  content: string;
};

type EnrichUpdateRow = {
  id: string;
  topic: string;
  impact_reason: string;
  public_sentiment_label: string;
  business_impact_label: string;
  analysis_confidence: number;
  enrichment_status: "done" | "failed";
};

type QualityMetrics = {
  sampleSize: number;
  avgConfidence: number;
  lowConfidenceShare: number;
  unknownTopicShare: number;
  unknownReasonShare: number;
  labelDisagreementShare: number;
};

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function computeQualityMetrics(rows: Array<Partial<EnrichUpdateRow>>): QualityMetrics {
  const sampleSize = rows.length;
  if (sampleSize === 0) {
    return {
      sampleSize: 0,
      avgConfidence: 0,
      lowConfidenceShare: 0,
      unknownTopicShare: 0,
      unknownReasonShare: 0,
      labelDisagreementShare: 0,
    };
  }

  let confidenceSum = 0;
  let lowConfidence = 0;
  let unknownTopic = 0;
  let unknownReason = 0;
  let labelDisagreement = 0;

  for (const row of rows) {
    const confidence = Number(row.analysis_confidence ?? 0);
    confidenceSum += confidence;
    if (confidence < 0.45) lowConfidence += 1;

    const topic = String(row.topic ?? "").toLowerCase();
    if (!topic || topic === "unknown") unknownTopic += 1;

    const reason = String(row.impact_reason ?? "").toLowerCase();
    if (!reason || reason === "unknown") unknownReason += 1;

    const publicLabel = String(row.public_sentiment_label ?? "").toLowerCase();
    const businessLabel = String(row.business_impact_label ?? "").toLowerCase();
    if (publicLabel && businessLabel && publicLabel !== businessLabel) labelDisagreement += 1;
  }

  return {
    sampleSize,
    avgConfidence: round3(confidenceSum / sampleSize),
    lowConfidenceShare: round3(lowConfidence / sampleSize),
    unknownTopicShare: round3(unknownTopic / sampleSize),
    unknownReasonShare: round3(unknownReason / sampleSize),
    labelDisagreementShare: round3(labelDisagreement / sampleSize),
  };
}

async function loadBaselineMetrics(db: ReturnType<typeof serviceClient>): Promise<QualityMetrics> {
  const since = new Date(Date.now() - 14 * 86400000).toISOString();
  const { data, error } = await db
    .from("mentions")
    .select("topic, impact_reason, public_sentiment_label, business_impact_label, analysis_confidence")
    .eq("enrichment_status", "done")
    .gte("enriched_at", since)
    .order("enriched_at", { ascending: false })
    .limit(3000);

  if (error) throw error;
  return computeQualityMetrics((data ?? []) as Array<Partial<EnrichUpdateRow>>);
}

function evaluateQuality(current: QualityMetrics, baseline: QualityMetrics) {
  const deltas = {
    avgConfidence: round3(current.avgConfidence - baseline.avgConfidence),
    lowConfidenceShare: round3(current.lowConfidenceShare - baseline.lowConfidenceShare),
    unknownTopicShare: round3(current.unknownTopicShare - baseline.unknownTopicShare),
    unknownReasonShare: round3(current.unknownReasonShare - baseline.unknownReasonShare),
  };

  const findings: string[] = [];
  let severity: "ok" | "warn" | "critical" = "ok";

  if (current.sampleSize >= 12 && deltas.avgConfidence <= -0.08) {
    findings.push("avg_confidence_drop");
    severity = "warn";
  }
  if (current.sampleSize >= 12 && deltas.lowConfidenceShare >= 0.12) {
    findings.push("low_confidence_spike");
    severity = severity === "ok" ? "warn" : severity;
  }
  if (current.sampleSize >= 12 && current.unknownTopicShare >= 0.20) {
    findings.push("unknown_topic_high");
    severity = "critical";
  }
  if (current.sampleSize >= 12 && current.unknownReasonShare >= 0.25) {
    findings.push("unknown_reason_high");
    severity = "critical";
  }

  return { severity, findings, deltas };
}

async function mapConcurrent<T, R>(items: T[], limit: number, fn: (item: T, idx: number) => Promise<R>): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) break;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

Deno.serve(async (req) => {
  try {
    if (req.method === "OPTIONS") return json({ ok: true }, 200, req);

    const secret = Deno.env.get("CRON_SECRET");
    if (secret && req.headers.get("x-cron-secret") !== secret) {
      return json({ error: "unauthorized" }, 401, req);
    }

    const db = serviceClient();

    const { data: candidates, error: selectError } = await db
      .from("mentions")
      .select("id, source, content")
      .in("enrichment_status", ["pending", "failed"])
      .order("published_at", { ascending: false })
      .limit(MAX_ENRICH_ITEMS_PER_RUN);

    if (selectError) {
      return json({ error: selectError.message }, 500, req);
    }

    const queue = (candidates ?? []) as MentionRow[];
    if (queue.length === 0) {
      return json({ processed: 0, done: 0, failed: 0, note: "queue_empty" }, 200, req);
    }

    const ids = queue.map((row) => row.id);
    const { error: claimError } = await db
      .from("mentions")
      .update({ enrichment_status: "in_progress" })
      .in("id", ids)
      .in("enrichment_status", ["pending", "failed"]);

    if (claimError) {
      return json({ error: claimError.message }, 500, req);
    }

    const { data: claimedRows, error: claimedError } = await db
      .from("mentions")
      .select("id, source, content")
      .in("id", ids)
      .eq("enrichment_status", "in_progress")
      .order("published_at", { ascending: false });

    if (claimedError) {
      return json({ error: claimedError.message }, 500, req);
    }

    const claimed = (claimedRows ?? []) as MentionRow[];
    if (claimed.length === 0) {
      return json({ processed: 0, done: 0, failed: 0, note: "nothing_claimed" }, 200, req);
    }

    let done = 0;
    let failed = 0;
    const errors: string[] = [];
    const doneRowsForQuality: EnrichUpdateRow[] = [];

    for (let i = 0; i < claimed.length; i += ENRICH_BATCH_SIZE) {
      const batch = claimed.slice(i, i + ENRICH_BATCH_SIZE);
      let analyses: Array<{
        topic: string;
        public_sentiment: number;
        public_sentiment_label: string;
        business_impact: number;
        business_impact_label: string;
        impact_reason: string;
        is_b2b: boolean;
        confidence: number;
        primary_flavor: string;
        flavor_tags: string[];
        flavor_confidence: number;
      }> = [];

      try {
        analyses = await analyzeBatch(batch.map((row) => row.content));
      } catch (e) {
        const err = String((e as Error)?.message ?? e);
        errors.push(`analyzeBatch: ${err}`);
      }

      const updates = await mapConcurrent(batch, EMBED_CONCURRENCY, async (row, idx) => {
        const fallback = {
          topic: "unknown",
          public_sentiment: 0,
          public_sentiment_label: "neutral",
          business_impact: 0,
          business_impact_label: "neutral",
          impact_reason: "unknown",
          is_b2b: false,
          confidence: 0,
          primary_flavor: "none",
          flavor_tags: [],
          flavor_confidence: 0,
        };
        const analysis = analyses[idx] ?? fallback;

        try {
          const vec = await embed(row.content);
          return {
            id: row.id,
            topic: analysis.topic,
            public_sentiment: Math.max(-1, Math.min(1, analysis.public_sentiment)),
            public_sentiment_label: analysis.public_sentiment_label,
            business_impact: Math.max(-1, Math.min(1, analysis.business_impact)),
            business_impact_label: analysis.business_impact_label,
            impact_reason: analysis.impact_reason,
            sentiment: Math.max(-1, Math.min(1, analysis.business_impact)),
            sentiment_label: analysis.business_impact_label,
            is_b2b: analysis.is_b2b,
            analysis_confidence: Math.max(0, Math.min(1, analysis.confidence ?? 0.5)),
            primary_flavor: String(analysis.primary_flavor ?? "none").trim().toLowerCase() || "none",
            flavor_tags: Array.isArray(analysis.flavor_tags)
              ? analysis.flavor_tags.map((tag) => String(tag ?? "").trim().toLowerCase()).filter(Boolean).slice(0, 8)
              : [],
            flavor_confidence: Math.max(0, Math.min(1, Number(analysis.flavor_confidence ?? analysis.confidence ?? 0.5))),
            embedding: vec,
            enrichment_status: "done",
            enriched_at: new Date().toISOString(),
          };
        } catch (e) {
          const err = String((e as Error)?.message ?? e);
          errors.push(`embed:${row.id}:${err}`);
          return {
            id: row.id,
            topic: analysis.topic,
            public_sentiment: Math.max(-1, Math.min(1, analysis.public_sentiment)),
            public_sentiment_label: analysis.public_sentiment_label,
            business_impact: Math.max(-1, Math.min(1, analysis.business_impact)),
            business_impact_label: analysis.business_impact_label,
            impact_reason: analysis.impact_reason,
            sentiment: Math.max(-1, Math.min(1, analysis.business_impact)),
            sentiment_label: analysis.business_impact_label,
            is_b2b: analysis.is_b2b,
            analysis_confidence: Math.max(0, Math.min(1, analysis.confidence ?? 0.5)),
            primary_flavor: String(analysis.primary_flavor ?? "none").trim().toLowerCase() || "none",
            flavor_tags: Array.isArray(analysis.flavor_tags)
              ? analysis.flavor_tags.map((tag) => String(tag ?? "").trim().toLowerCase()).filter(Boolean).slice(0, 8)
              : [],
            flavor_confidence: Math.max(0, Math.min(1, Number(analysis.flavor_confidence ?? analysis.confidence ?? 0.5))),
            embedding: null,
            enrichment_status: "failed",
            enriched_at: null,
          };
        }
      });

      for (const row of updates) {
        const { id, ...patch } = row;
        const { error: updateError } = await db
          .from("mentions")
          .update(patch)
          .eq("id", id);
        if (updateError) {
          errors.push(`update:${id}:${updateError.message}`);
          failed += 1;
          await db
            .from("mentions")
            .update({ enrichment_status: "failed", enriched_at: null })
            .eq("id", id);
          continue;
        }
        if (row.enrichment_status === "done") done += 1;
        else failed += 1;

        if (row.enrichment_status === "done") {
          doneRowsForQuality.push({
            id,
            topic: String(row.topic ?? "unknown"),
            impact_reason: String(row.impact_reason ?? "unknown"),
            public_sentiment_label: String(row.public_sentiment_label ?? "neutral"),
            business_impact_label: String(row.business_impact_label ?? "neutral"),
            analysis_confidence: Number(row.analysis_confidence ?? 0),
            enrichment_status: "done",
          });
        }
      }
    }

    let qualityAudit: Record<string, unknown> | null = null;
    try {
      const currentMetrics = computeQualityMetrics(doneRowsForQuality);
      const baselineMetrics = await loadBaselineMetrics(db);
      const evaluated = evaluateQuality(currentMetrics, baselineMetrics);

      qualityAudit = {
        current: currentMetrics,
        baseline14d: baselineMetrics,
        deltas: evaluated.deltas,
        severity: evaluated.severity,
        findings: evaluated.findings,
      };

      await db.from("ai_runs").insert({
        kind: "enrich_qc",
        prompt: `processed=${claimed.length};done=${done};failed=${failed}`,
        response: qualityAudit,
      });
    } catch (e) {
      errors.push(`quality_audit:${String((e as Error)?.message ?? e)}`);
    }

    return json({
      processed: claimed.length,
      done,
      failed,
      errors: errors.slice(0, 8),
      qualityAudit,
    }, 200, req);
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500, req);
  }
});
