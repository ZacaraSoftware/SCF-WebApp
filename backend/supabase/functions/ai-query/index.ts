/// <reference types="https://esm.sh/@supabase/functions-js/src/edge-runtime.d.ts" />
import { json } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { embed } from "../_shared/embeddings.ts";
import { callClaude } from "../_shared/llm.ts";

type ChatRole = "user" | "assistant";
type ChatMessage = { role: ChatRole; content: string };
type MentionHit = {
  content: string;
  source: string;
  source_context: string | null;
  author: string | null;
  url: string | null;
  like_count: number | null;
  reply_count: number | null;
  topic: string;
  public_sentiment: number;
  public_sentiment_label: string;
  business_impact: number;
  business_impact_label: string;
  impact_reason: string;
  published_at: string;
  similarity: number;
  rrf_score: number;
};
type MemoryEnvelope = {
  summary: string;
  facts: string[];
  decisions: string[];
};

type ConversationRow = {
  id: string;
  session_id: string;
  title: string | null;
  last_question: string | null;
  memory_summary: string | null;
  memory_facts: string[] | null;
  memory_decisions: string[] | null;
  message_count: number | null;
};

const CHAT_WINDOW = 8;
const MEMORY_FACT_LIMIT = 8;
const MEMORY_DECISION_LIMIT = 6;
const DEFAULT_CHAT_DAYS = 3650;
const DEFAULT_HISTORY_LIMIT = 20;
const DEFAULT_MESSAGE_LIMIT = 120;

function sanitizeMessage(message: unknown): ChatMessage | null {
  const role = (message as ChatMessage | undefined)?.role;
  const content = String((message as ChatMessage | undefined)?.content ?? "").trim();
  if (!content) return null;
  if (role !== "user" && role !== "assistant") return null;
  return { role, content };
}

function asMessageArray(input: unknown): ChatMessage[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((item) => sanitizeMessage(item))
    .filter((item): item is ChatMessage => Boolean(item));
}

function parseDays(input: unknown, fallback: number): number {
  const value = Number(input);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.max(1, Math.min(3650, Math.floor(value)));
}

function deriveTitle(text: string): string {
  const plain = text.replace(/\s+/g, " ").trim();
  if (!plain) return "Neue Unterhaltung";
  return plain.slice(0, 72);
}

function uniqueStringList(values: unknown[], limit: number): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(text);
    if (result.length >= limit) break;
  }
  return result;
}

function isTopCommentQuestion(text: string): boolean {
  return /(top\s*3|drei\s+komment|3\s+komment|meisten\s+interaktionen|likes|antwort(en)?|originalkomment|zitiere|quote)/i.test(text)
    && /(komment|beleg|impact|interaktion|engagement)/i.test(text);
}

function interactionScore(hit: Pick<MentionHit, "like_count" | "reply_count">): number {
  return Number(hit.like_count ?? 0) + (Number(hit.reply_count ?? 0) * 2);
}

function compactText(text: string, maxLen = 360): string {
  const plain = String(text ?? "").replace(/\s+/g, " ").trim();
  return plain.length > maxLen ? `${plain.slice(0, maxLen - 1)}…` : plain;
}

function escapeMarkdown(text: string): string {
  return String(text ?? "").replace(/([\\`*_{}\[\]()#+\-.!|>])/g, "\\$1");
}

function formatTopComments(rows: MentionHit[]): string {
  if (rows.length === 0) {
    return "Ich habe keine passenden Originalkommentare gefunden.";
  }

  const intro = "Hier sind die 3 relevantesten Originalkommentare nach Interaktions-Score (Likes + 2×Antworten), gefiltert auf den angefragten Themenkontext.";
  const items = rows.map((row, index) => {
    const interaction = interactionScore(row);
    const context = row.source_context ? `\n\n**Kontext:** ${escapeMarkdown(compactText(row.source_context, 180))}` : "";
    const url = row.url ? `[Original öffnen](${row.url})` : "Kein Original-Link verfügbar";
    return [
      `${index + 1}. **${escapeMarkdown(row.author ?? row.source)}** · ${escapeMarkdown(row.source)} · Interaktions-Score ${interaction}`,
      `> ${escapeMarkdown(compactText(row.content))}`,
      context,
      `- Likes: ${Number(row.like_count ?? 0)} · Antworten: ${Number(row.reply_count ?? 0)}`,
      `- Nordzucker-Impact: ${escapeMarkdown(String(row.business_impact_label ?? "neutral"))} (${Number(row.business_impact ?? 0).toFixed(2)}) · Grund: ${escapeMarkdown(row.impact_reason ?? "unknown")}`,
      `- ${url}`,
    ].filter(Boolean).join("\n");
  });

  return [intro, "", ...items].join("\n\n");
}

function defaultMemory(row?: Partial<ConversationRow>): MemoryEnvelope {
  return {
    summary: String(row?.memory_summary ?? "").trim(),
    facts: Array.isArray(row?.memory_facts) ? uniqueStringList(row.memory_facts, MEMORY_FACT_LIMIT) : [],
    decisions: Array.isArray(row?.memory_decisions)
      ? uniqueStringList(row.memory_decisions, MEMORY_DECISION_LIMIT)
      : [],
  };
}

async function ensureConversation(
  db: ReturnType<typeof serviceClient>,
  sessionId: string,
  conversationId: string | null,
  firstQuestion: string,
): Promise<ConversationRow> {
  if (conversationId) {
    const { data: found, error } = await db
      .from("ai_conversations")
      .select("id, session_id, title, last_question, memory_summary, memory_facts, memory_decisions, message_count")
      .eq("id", conversationId)
      .single();

    if (error) throw error;
    if (!found) throw new Error("conversation not found");
    if (found.session_id !== sessionId) throw new Error("conversation session mismatch");
    return found as ConversationRow;
  }

  const { data: created, error } = await db
    .from("ai_conversations")
    .insert({
      session_id: sessionId,
      title: deriveTitle(firstQuestion),
      last_question: firstQuestion.slice(0, 500),
      message_count: 0,
      memory_summary: "",
      memory_facts: [],
      memory_decisions: [],
    })
    .select("id, session_id, title, last_question, memory_summary, memory_facts, memory_decisions, message_count")
    .single();

  if (error) throw error;
  return created as ConversationRow;
}

async function listConversationHistory(
  db: ReturnType<typeof serviceClient>,
  sessionId: string,
  limitInput: unknown,
) {
  const limit = Math.max(1, Math.min(100, Number(limitInput) || DEFAULT_HISTORY_LIMIT));
  const { data, error } = await db
    .from("ai_conversations")
    .select("id, title, last_question, updated_at, created_at, message_count")
    .eq("session_id", sessionId)
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    id: row.id,
    title: row.title ?? "Neue Unterhaltung",
    last_question: row.last_question ?? "",
    updated_at: row.updated_at,
    created_at: row.created_at,
    message_count: Number(row.message_count ?? 0),
  }));
}

async function getConversationMessages(
  db: ReturnType<typeof serviceClient>,
  sessionId: string,
  conversationId: string,
  limitInput: unknown,
) {
  const { data: conversation, error: convErr } = await db
    .from("ai_conversations")
    .select("id, session_id, title, memory_summary, memory_facts, memory_decisions")
    .eq("id", conversationId)
    .single();

  if (convErr) throw convErr;
  if (!conversation) throw new Error("conversation not found");
  if (conversation.session_id !== sessionId) throw new Error("conversation session mismatch");

  const limit = Math.max(1, Math.min(300, Number(limitInput) || DEFAULT_MESSAGE_LIMIT));
  const { data: messages, error: msgErr } = await db
    .from("ai_messages")
    .select("role, content, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (msgErr) throw msgErr;

  return {
    conversation: {
      id: conversation.id,
      title: conversation.title ?? "Neue Unterhaltung",
      memory: defaultMemory(conversation as Partial<ConversationRow>),
    },
    messages: (messages ?? [])
      .filter((m: any) => m.role === "user" || m.role === "assistant")
      .map((m: any) => ({ role: m.role, content: m.content, created_at: m.created_at })),
  };
}

async function updateConversationMemory(
  currentMemory: MemoryEnvelope,
  question: string,
  answer: string,
): Promise<MemoryEnvelope> {
  const system =
    "Du verwaltest das Gespraechsgedaechtnis fuer einen B2B-KI-Assistenten bei Nordzucker. " +
    "Gib NUR ein JSON-Objekt zurueck ohne Markdown. " +
    "Schema: {\"summary\": string, \"facts\": string[], \"decisions\": string[]}. " +
    `Max ${MEMORY_FACT_LIMIT} facts, max ${MEMORY_DECISION_LIMIT} decisions. ` +
    "Nur belastbare, langfristig relevante Punkte aufnehmen.";

  const user =
    `Bisheriges Gedaechtnis:\n${JSON.stringify(currentMemory)}\n\n` +
    `Neue Nutzerfrage:\n${question}\n\n` +
    `Neue Antwort:\n${answer}\n\n` +
    "Aktualisiere das Gedaechtnis. Summary auf 2-3 Saetze begrenzen.";

  try {
    const raw = await callClaude([{ role: "user", content: user }], system, 350);
    const cleaned = raw.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleaned);
    return {
      summary: String(parsed?.summary ?? "").trim(),
      facts: uniqueStringList(Array.isArray(parsed?.facts) ? parsed.facts : [], MEMORY_FACT_LIMIT),
      decisions: uniqueStringList(
        Array.isArray(parsed?.decisions) ? parsed.decisions : [],
        MEMORY_DECISION_LIMIT,
      ),
    };
  } catch {
    return currentMemory;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({ ok: true }, 200, req);

  try {
    const body = await req.json();
    const mode = body?.mode;
    const db = serviceClient();

    const safeMode = mode === "recommendations"
      ? "recommendations"
      : mode === "history_list"
        ? "history_list"
        : mode === "history_get"
          ? "history_get"
          : "chat";

    const sessionId = String(body?.session_id ?? "").trim();

    if ((safeMode === "chat" || safeMode === "history_list" || safeMode === "history_get") && !sessionId) {
      return json({ error: "session_id is required" }, 400, req);
    }

    if (safeMode === "history_list") {
      const items = await listConversationHistory(db, sessionId, body?.limit);
      return json({ conversations: items }, 200, req);
    }

    if (safeMode === "history_get") {
      const conversationId = String(body?.conversation_id ?? "").trim();
      if (!conversationId) return json({ error: "conversation_id is required" }, 400, req);
      const payload = await getConversationMessages(db, sessionId, conversationId, body?.limit);
      return json(payload, 200, req);
    }

    const { messages, question, summary } = body ?? {};
    const normalizedMessages = asMessageArray(messages);
    if (safeMode === "chat" && normalizedMessages.length === 0 && String(question ?? "").trim().length === 0) {
      return json({ error: "chat mode requires messages or question" }, 400, req);
    }

    const days = parseDays(body?.days, DEFAULT_CHAT_DAYS);
    const since = new Date(Date.now() - days * 86400000).toISOString();

    // Retrieval-Query bestimmen
    const query =
      safeMode === "chat"
        ? String(
          normalizedMessages[normalizedMessages.length - 1]?.content
          ?? question
          ?? "",
        ).trim()
        : "Risiken, Chancen und Stimmungstrends rund um Zucker, Softdrinks und süße Speisen";

    const topCommentMode = safeMode === "chat" && isTopCommentQuestion(query);

    // Top-k relevante Mentions per Vektor-Ähnlichkeit holen
    const qvec = await embed(query);
    const { data: hits } = await db.rpc("match_mentions", {
      query_embedding: qvec,
      query_text: query,
      match_count: topCommentMode ? 120 : safeMode === "recommendations" ? 24 : 40,
      since,
    });

    const { count: corpusCount } = await db
      .from("mentions")
      .select("id", { count: "exact", head: true })
      .eq("enrichment_status", "done");

    const hitRows = (hits ?? []) as MentionHit[];

    const context = hitRows
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
    const conversationId = String(body?.conversation_id ?? "").trim() || null;
    const latestQuestion = query;
    const conversation = await ensureConversation(db, sessionId, conversationId, latestQuestion);
    const memory = defaultMemory(conversation);

    const { data: recentRows } = await db
      .from("ai_messages")
      .select("role, content")
      .eq("conversation_id", conversation.id)
      .in("role", ["user", "assistant"])
      .order("created_at", { ascending: false })
      .limit(CHAT_WINDOW);

    const persistedRecent = (recentRows ?? [])
      .slice()
      .reverse()
      .map((row: any) => sanitizeMessage(row))
      .filter((row: ChatMessage | null): row is ChatMessage => Boolean(row));

    let chatMessages = persistedRecent.length > 0
      ? persistedRecent
      : normalizedMessages.slice(-CHAT_WINDOW);

    const hasLatestQuestion = chatMessages.length > 0
      && chatMessages[chatMessages.length - 1].role === "user"
      && chatMessages[chatMessages.length - 1].content === latestQuestion;

    if (!hasLatestQuestion) {
      chatMessages = [...chatMessages, { role: "user", content: latestQuestion }].slice(-CHAT_WINDOW);
    }

    const memoryBlock = [
      memory.summary ? `Zusammenfassung:\n${memory.summary}` : "Zusammenfassung:\n(noch keine)",
      `Wichtige Fakten:\n${memory.facts.length ? memory.facts.map((f, idx) => `${idx + 1}. ${f}`).join("\n") : "(keine)"}`,
      `Bisherige Entscheidungen:\n${memory.decisions.length ? memory.decisions.map((d, idx) => `${idx + 1}. ${d}`).join("\n") : "(keine)"}`,
    ].join("\n\n");

    if (topCommentMode) {
      const ranked = hitRows
        .slice()
        .sort((a, b) =>
          interactionScore(b) - interactionScore(a)
          || Math.abs(Number(b.business_impact ?? 0)) - Math.abs(Number(a.business_impact ?? 0))
          || Number(b.rrf_score ?? 0) - Number(a.rrf_score ?? 0)
        )
        .slice(0, 3);
      const answer = formatTopComments(ranked);

      await db.from("ai_messages").insert([
        {
          conversation_id: conversation.id,
          role: "user",
          content: latestQuestion,
          retrieval_hits: hitRows.length,
        },
        {
          conversation_id: conversation.id,
          role: "assistant",
          content: answer,
          retrieval_hits: ranked.length,
        },
      ]);

      const updatedMemory = await updateConversationMemory(memory, latestQuestion, answer);

      await db
        .from("ai_conversations")
        .update({
          title: conversation.title || deriveTitle(latestQuestion),
          last_question: latestQuestion.slice(0, 500),
          message_count: Number(conversation.message_count ?? 0) + 2,
          memory_summary: updatedMemory.summary,
          memory_facts: updatedMemory.facts,
          memory_decisions: updatedMemory.decisions,
        })
        .eq("id", conversation.id);

      await db.from("ai_runs").insert({
        kind: "chat",
        prompt: latestQuestion,
        response: {
          answer,
          conversation_id: conversation.id,
          corpus_count: Number(corpusCount ?? 0),
          mode: "top_comments",
          citations: ranked,
        },
      });

      return json({
        answer,
        conversation_id: conversation.id,
        memory: updatedMemory,
        corpus_count: Number(corpusCount ?? 0),
        mode: "top_comments",
        citations: ranked,
      }, 200, req);
    }

    const system =
      "Du bist der KI-Analyst der Smart-Customer-Feedback-Plattform von Nordzucker AG. " +
      "Antworte prägnant und geschäftlich auf Deutsch. Interpretiere alles strikt aus Sicht von Nordzucker und seiner Produkte. " +
      "Behandle public_sentiment und Nordzucker-Impact getrennt; fuer Managementaussagen ist Nordzucker-Impact vorrangig. " +
      `Du hast Zugriff auf den Vollkorpus aller aggregierten Kommentare (aktuell ${Number(corpusCount ?? 0)} Eintraege). ` +
      "Nutze den Gespraechsverlauf und das Gedaechtnis konsequent fuer Rueckschluesse, Empfehlungen und Entscheidungen.\n\n" +
      `Gedaechtnis:\n${memoryBlock}\n\n` +
      `Relevante Belege aus den Daten:\n${context}`;
    const answer = await callClaude(chatMessages, system, 800);

    await db.from("ai_messages").insert([
      {
        conversation_id: conversation.id,
        role: "user",
        content: latestQuestion,
        retrieval_hits: (hits ?? []).length,
      },
      {
        conversation_id: conversation.id,
        role: "assistant",
        content: answer,
        retrieval_hits: (hits ?? []).length,
      },
    ]);

    const updatedMemory = await updateConversationMemory(memory, latestQuestion, answer);

    await db
      .from("ai_conversations")
      .update({
        title: conversation.title || deriveTitle(latestQuestion),
        last_question: latestQuestion.slice(0, 500),
        message_count: Number(conversation.message_count ?? 0) + 2,
        memory_summary: updatedMemory.summary,
        memory_facts: updatedMemory.facts,
        memory_decisions: updatedMemory.decisions,
      })
      .eq("id", conversation.id);

    await db.from("ai_runs").insert({
      kind: "chat",
      prompt: latestQuestion,
      response: { answer, conversation_id: conversation.id, corpus_count: Number(corpusCount ?? 0) },
    });
    return json({
      answer,
      conversation_id: conversation.id,
      memory: updatedMemory,
      corpus_count: Number(corpusCount ?? 0),
    }, 200, req);
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500, req);
  }
});
