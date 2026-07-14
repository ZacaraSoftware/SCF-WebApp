/// <reference types="https://esm.sh/@supabase/functions-js/src/edge-runtime.d.ts" />
import { json } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { embed } from "../_shared/embeddings.ts";
import { callClaude } from "../_shared/llm.ts";

// RAG-Endpunkt. Hält den Anthropic-Key serverseitig.
// Body:
//   { mode: "chat",            messages: [{role,content}], days?: number|null }
//   { mode: "recommendations", summary: string,           days?: number|null }
// Ohne gültiges days-Feld wird der gesamte verfügbare Datenbestand genutzt.

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({ ok: true }, 200, req);

  try {
    const { mode, messages, question, summary, days } = await req.json();
    const safeMode = mode === "recommendations" ? "recommendations" : "chat";
    const normalizedMessages = Array.isArray(messages) && messages.length > 0
      ? messages
      : (typeof question === "string" && question.trim().length > 0
        ? [{ role: "user", content: question.trim() }]
        : []);

    if (safeMode === "chat" && normalizedMessages.length === 0) {
      return json({ error: "chat mode requires messages or question" }, 400, req);
    }

    const db = serviceClient();
    const numericDays = Number(days);
    const hasDayWindow = Number.isFinite(numericDays) && numericDays > 0;
    const since = hasDayWindow
      ? new Date(Date.now() - numericDays * 86400000).toISOString()
      : "1970-01-01T00:00:00.000Z";
    const windowLabel = hasDayWindow ? `letzte ${Math.round(numericDays)} Tage` : "gesamter Datenbestand";

    // Retrieval-Query bestimmen
    const query =
      safeMode === "chat"
        ? (normalizedMessages[normalizedMessages.length - 1]?.content ?? "")
        : "Risiken, Chancen und Stimmungstrends rund um Zucker, Softdrinks und süße Speisen";

    // Top-k relevante Mentions per Vektor-Ähnlichkeit holen
    const qvec = await embed(query);
    const { data: hits } = await db.rpc("match_mentions", {
      query_embedding: qvec,
      match_count: 20,
      since,
    });

    const context = (hits ?? [])
      .map((h: any, i: number) =>
        `[${i + 1}] (${h.source}, ${h.topic}, Public ${h.public_sentiment}, Nordzucker-Impact ${h.business_impact}, Grund ${h.impact_reason}) ${h.content}`)
      .join("\n");

    if (safeMode === "recommendations") {
      const system =
        "Du bist Senior Market-Intelligence-Analyst bei Nordzucker AG. " +
        "WICHTIG: Antworte NUR mit einem JSON-Objekt. Kein Markdown, keine Erklärung, keine Codeblöcke. " +
        'Nur das JSON im Format: {"recommendations":[...],"forecasts":[...]}. ' +
        "Schema recommendations: title (string), rationale (string), priority (hoch|mittel|niedrig), horizon (string). " +
        "Schema forecasts: topic (string), direction (steigend|fallend|stabil), confidence (hoch|mittel|niedrig), statement (string). " +
        "Max 4 recommendations, max 3 forecasts.";
      const user =
        `Kennzahlen und Datenlage (${windowLabel}):\n${summary ?? "(keine)"}\n\n` +
        `Relevante Belege aus den Daten:\n${context}\n\n` +
        "Leite konkrete Handlungsempfehlungen und Prognosen strikt aus Sicht von Nordzucker ab. " +
        "Gewichte business_impact hoeher als public_sentiment. Positive Stimmung fuer zuckerfreie Alternativen ist fuer Nordzucker nicht automatisch positiv. " +
        "Antworte AUSSCHLIESSLICH mit dem JSON-Objekt, nichts anderes.";
      
      try {
        const raw = await callClaude([{ role: "user", content: user }], system, 1200);
        const cleaned = raw.replace(/```json|```|[\r\n]/g, "").trim();
        
        if (!cleaned.startsWith("{")) {
          throw new Error(`Invalid JSON: response doesn't start with '{'. Got: ${cleaned.substring(0, 100)}`);
        }
        
        const parsed = JSON.parse(cleaned);
        
        // Validate structure
        if (!parsed.recommendations || !Array.isArray(parsed.recommendations)) {
          throw new Error("Missing or invalid 'recommendations' array");
        }
        if (!parsed.forecasts || !Array.isArray(parsed.forecasts)) {
          throw new Error("Missing or invalid 'forecasts' array");
        }
        
        await db.from("ai_runs").insert({ kind: "recommendations", prompt: user, response: parsed });
        return json(parsed, 200, req);
      } catch (parseErr) {
        const errMsg = (parseErr as Error).message || String(parseErr);
        console.error("Recommendations JSON parsing failed:", errMsg);
        return json({
          error: `JSON-Parsing fehlgeschlagen: ${errMsg}. Die KI-Antwort konnte nicht als Struktur gelesen werden.`
        }, 400, req);
      }
    }

    // safeMode === "chat"
    const system =
      "Du bist der KI-Analyst der Smart-Customer-Feedback-Plattform von Nordzucker AG. " +
      "Antworte prägnant und geschäftlich auf Deutsch. Interpretiere alles strikt aus Sicht von Nordzucker und seiner Produkte. " +
      "Behandle public_sentiment und Nordzucker-Impact getrennt; fuer Managementaussagen ist Nordzucker-Impact vorrangig. Stütze dich auf die folgenden Belege " +
      `aus den aggregierten Daten:\n\n${context}`;
    const answer = await callClaude(normalizedMessages, system, 800);
    await db.from("ai_runs").insert({
      kind: "chat",
      prompt: normalizedMessages[normalizedMessages.length - 1]?.content,
      response: { answer },
    });
    return json({ answer }, 200, req);
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500, req);
  }
});
