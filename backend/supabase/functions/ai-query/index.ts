/// <reference types="https://esm.sh/@supabase/functions-js/src/edge-runtime.d.ts" />
import { json } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { embed } from "../_shared/embeddings.ts";
import { callClaude } from "../_shared/llm.ts";

// RAG-Endpunkt. Hält den Anthropic-Key serverseitig.
// Body:
//   { mode: "chat",            messages: [{role,content}], days?: number }
//   { mode: "recommendations", summary: string,           days?: number }
//   { mode: "commercial_actions", summary: string,         days?: number }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({ ok: true }, 200, req);

  try {
    const { mode, messages, question, summary, days = 90 } = await req.json();
    const safeMode = mode === "recommendations"
      ? "recommendations"
      : mode === "commercial_actions"
        ? "commercial_actions"
        : "chat";
    const normalizedMessages = Array.isArray(messages) && messages.length > 0
      ? messages
      : (typeof question === "string" && question.trim().length > 0
        ? [{ role: "user", content: question.trim() }]
        : []);

    if (safeMode === "chat" && normalizedMessages.length === 0) {
      return json({ error: "chat mode requires messages or question" }, 400, req);
    }

    const db = serviceClient();
    const since = new Date(Date.now() - days * 86400000).toISOString();

    // Retrieval-Query bestimmen
    const query =
      safeMode === "chat"
        ? (normalizedMessages[normalizedMessages.length - 1]?.content ?? "")
        : "Risiken, Chancen und Stimmungstrends rund um Zucker, Softdrinks und süße Speisen";

    // Top-k relevante Mentions per Hybrid-Suche (RRF: Semantik + BM25)
    const qvec = await embed(query);
    const { data: hits } = await db.rpc("match_mentions", {
      query_embedding: qvec,
      query_text: query,
      match_count: safeMode === "recommendations" ? 20 : safeMode === "commercial_actions" ? 24 : 10,
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
        `Kennzahlen und Datenlage (letzte ${days} Tage):\n${summary ?? "(keine)"}\n\n` +
        `Relevante Belege aus den Daten:\n${context}\n\n` +
        "Leite konkrete Handlungsempfehlungen und Prognosen strikt aus Sicht von Nordzucker ab. " +
        "Gewichte business_impact hoeher als public_sentiment. Positive Stimmung fuer zuckerfreie Alternativen ist fuer Nordzucker nicht automatisch positiv. " +
        "Antworte AUSSCHLIESSLICH mit dem JSON-Objekt, nichts anderes.";
      
      try {
        const raw = await callClaude([{ role: "user", content: user }], system, 1200);
        const cleaned = raw.text.replace(/```json|```|[\r\n]/g, "").trim();
        
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
        
        await db.from("ai_runs").insert({
          kind: "recommendations",
          prompt: user,
          response: parsed,
          input_tokens: raw.inputTokens,
          output_tokens: raw.outputTokens,
        });
        return json(parsed, 200, req);
      } catch (parseErr) {
        const errMsg = (parseErr as Error).message || String(parseErr);
        console.error("Recommendations JSON parsing failed:", errMsg);
        return json({
          error: `JSON-Parsing fehlgeschlagen: ${errMsg}. Die KI-Antwort konnte nicht als Struktur gelesen werden.`
        }, 400, req);
      }
    }

    if (safeMode === "commercial_actions") {
      const MIN_CONFIDENCE = Number(Deno.env.get("COMMERCIAL_ACTION_MIN_CONFIDENCE") ?? 0.62);
      const system =
        "Du bist Senior Commercial-Advisor für Nordzucker (Fokus Marketing und Vertrieb). " +
        "WICHTIG: Antworte NUR mit einem JSON-Objekt, kein Markdown, keine Erklärtexte. " +
        "Format exakt: {\"strategy_mode\":{...},\"actions\":[...]}. " +
        "strategy_mode Schema: title (Defensiv steuern|Balanciert aussteuern|Offensiv wachsen), text (string). " +
        "actions Schema je Objekt: id (string, kebab-case), score (0-100), priority (Hoch|Mittel|Niedrig), owner (string), horizon (string), objective (string), trigger (string), action (string), expected_effect (string), kpi (string), channel (string), confidence (0..1), evidence_refs (array von Zahlen, referenziert Kontextzeilen [1]..[N]). " +
        "Liefere 4 bis 7 konkrete Maßnahmen, nur solche mit unmittelbarer Umsetzbarkeit in Marketing/Vertrieb. " +
        "Formuliere trigger datenbasiert aus dem Kontext (Thema, Impact, Volumen, Wettbewerb).";

      const user =
        `Kennzahlen und Datenlage (letzte ${days} Tage):\n${summary ?? "(keine)"}\n\n` +
        `Relevante Belege aus den Daten:\n${context}\n\n` +
        "Ziel: Kundennähe erhöhen, Abwanderungsrisiken senken, Conversion und Bindung verbessern. " +
        "Gewichte Nordzucker-Business-Impact stärker als reine öffentliche Tonalität. " +
        "Wenn Wettbewerbsdruck steigt, priorisiere Gegenmaßnahmen in Key Accounts. " +
        "Wenn Chancensignale dominieren, priorisiere Skalierung und Aktivierung. " +
        "Antworte ausschließlich als JSON im geforderten Format.";

      try {
        const raw = await callClaude([{ role: "user", content: user }], system, 1600);
        const cleaned = raw.text.replace(/```json|```|[\r\n]/g, "").trim();
        if (!cleaned.startsWith("{")) {
          throw new Error(`Invalid JSON: response doesn't start with '{'. Got: ${cleaned.substring(0, 120)}`);
        }
        const parsed = JSON.parse(cleaned);
        if (!parsed?.strategy_mode || typeof parsed.strategy_mode !== "object") {
          throw new Error("Missing or invalid 'strategy_mode'");
        }
        if (!Array.isArray(parsed?.actions) || parsed.actions.length === 0) {
          throw new Error("Missing or invalid 'actions' array");
        }

        const evidenceByRef = new Map<number, string>();
        (hits ?? []).forEach((h: any, idx: number) => {
          evidenceByRef.set(idx + 1, `[${idx + 1}] ${String(h?.content ?? "").slice(0, 220)}`);
        });

        const actions = parsed.actions
          .map((item: any, idx: number) => ({
            id: String(item?.id ?? `ai-action-${idx + 1}`)
              .toLowerCase()
              .replace(/[^a-z0-9-]+/g, "-")
              .replace(/(^-|-$)/g, ""),
            score: Math.max(0, Math.min(100, Number(item?.score ?? 60))),
            priority: ["Hoch", "Mittel", "Niedrig"].includes(String(item?.priority ?? "")) ? item.priority : "Mittel",
            owner: String(item?.owner ?? "Marketing + Vertrieb"),
            horizon: String(item?.horizon ?? "14-30 Tage"),
            objective: String(item?.objective ?? "Kundennähe steigern"),
            trigger: String(item?.trigger ?? "Datenindiz aus dem aktuellen Zeitraum"),
            action: String(item?.action ?? "Maßnahme definieren"),
            expected_effect: String(item?.expected_effect ?? "Positive Wirkung auf Kundenbindung"),
            kpi: String(item?.kpi ?? "Business Impact verbessern"),
            channel: String(item?.channel ?? "Sales + Marketing"),
            confidence: Math.max(0, Math.min(1, Number(item?.confidence ?? 0.55))),
            evidence_refs: Array.isArray(item?.evidence_refs)
              ? item.evidence_refs.map((v: any) => Number(v)).filter((v: number) => Number.isInteger(v) && evidenceByRef.has(v)).slice(0, 4)
              : [],
          }))
          .filter((item: any) => item.id && item.action)
          .slice(0, 8);

        const gatedActions = actions.filter((item: any) => item.confidence >= MIN_CONFIDENCE).map((item: any) => ({
          ...item,
          evidence: item.evidence_refs.map((ref: number) => evidenceByRef.get(ref)).filter(Boolean),
        }));

        const responsePayload = {
          strategy_mode: {
            title: ["Defensiv steuern", "Balanciert aussteuern", "Offensiv wachsen"].includes(String(parsed.strategy_mode?.title ?? ""))
              ? parsed.strategy_mode.title
              : "Balanciert aussteuern",
            text: String(parsed.strategy_mode?.text ?? "Chancen und Risiken datenbasiert aussteuern."),
          },
          actions: gatedActions,
          governance: {
            min_confidence: MIN_CONFIDENCE,
            total_actions: actions.length,
            accepted_actions: gatedActions.length,
            dropped_actions: Math.max(0, actions.length - gatedActions.length),
          },
          audit: {
            generated_at: new Date().toISOString(),
            query_days: days,
            context_hits: (hits ?? []).length,
            version_id: crypto.randomUUID(),
          },
        };

        const { data: runRow } = await db.from("ai_runs").insert({
          kind: "commercial_actions",
          prompt: user,
          response: responsePayload,
          input_tokens: raw.inputTokens,
          output_tokens: raw.outputTokens,
        }).select("id").single();

        return json({
          ...responsePayload,
          audit: {
            ...responsePayload.audit,
            run_id: runRow?.id ?? null,
          },
        }, 200, req);
      } catch (parseErr) {
        const errMsg = (parseErr as Error).message || String(parseErr);
        console.error("Commercial actions JSON parsing failed:", errMsg);
        return json({
          error: `Commercial-Actions Parsing fehlgeschlagen: ${errMsg}`,
        }, 400, req);
      }
    }

    // safeMode === "chat"
    // Kontextfenster-Kompression: bei langen Gesprächen ältere Turns zusammenfassen
    const WINDOW = 6;
    let chatMessages = normalizedMessages;
    if (normalizedMessages.length > WINDOW) {
      const older = normalizedMessages.slice(0, -WINDOW);
      const recent = normalizedMessages.slice(-WINDOW);
      const summaryPrompt =
        "Fasse diesen Gesprächsverlauf in 2-3 Sätzen zusammen, nur die wesentlichen Fakten und Schlussfolgerungen:\n" +
        older.map((m: any) => `${m.role}: ${m.content}`).join("\n");
      const summaryResult = await callClaude(
        [{ role: "user", content: summaryPrompt }],
        "Du bist ein präziser Zusammenfasser. Antworte nur mit der Zusammenfassung, kein Vorwort.",
        300,
      );
      chatMessages = [
        { role: "user" as const, content: `[Zusammenfassung früherer Verlauf]: ${summaryResult.text}` },
        { role: "assistant" as const, content: "Verstanden, ich berücksichtige den früheren Kontext." },
        ...recent,
      ];
    }

    const system =
      "Du bist der KI-Analyst der Smart-Customer-Feedback-Plattform von Nordzucker AG. " +
      "Antworte prägnant und geschäftlich auf Deutsch. Interpretiere alles strikt aus Sicht von Nordzucker und seiner Produkte. " +
      "Behandle public_sentiment und Nordzucker-Impact getrennt; fuer Managementaussagen ist Nordzucker-Impact vorrangig. Stütze dich auf die folgenden Belege " +
      `aus den aggregierten Daten:\n\n${context}`;
    const chatResult = await callClaude(chatMessages, system, 800);
    await db.from("ai_runs").insert({
      kind: "chat",
      prompt: normalizedMessages[normalizedMessages.length - 1]?.content,
      response: { answer: chatResult.text },
      input_tokens: chatResult.inputTokens,
      output_tokens: chatResult.outputTokens,
    });
    return json({ answer: chatResult.text }, 200, req);
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500, req);
  }
});
