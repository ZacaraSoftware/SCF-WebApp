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
      }
    }

    return json({
      processed: claimed.length,
      done,
      failed,
      errors: errors.slice(0, 8),
    }, 200, req);
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500, req);
  }
});
