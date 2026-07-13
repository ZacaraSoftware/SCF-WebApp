// ----------------------------------------------------------------------------
// Anbindung an das Sprachmodell (Anthropic). Der API-Key liegt ausschließlich
// serverseitig (Edge-Function-Secret ANTHROPIC_API_KEY) — niemals im Frontend.
// ----------------------------------------------------------------------------

const MODEL_CANDIDATES = [
  Deno.env.get("ANTHROPIC_MODEL") ?? "claude-sonnet-4-6",
].filter(Boolean);
const TOPICS = [
  "zuckersteuer", "zuckerfrei", "softdrinks", "suesswaren",
  "backen", "gesundheit", "saisonal", "preise", "nachhaltig",
];

type Msg = { role: "user" | "assistant"; content: string };

export type ClaudeResult = {
  text: string;
  inputTokens: number;
  outputTokens: number;
};

export async function callClaude(
  messages: Msg[],
  system: string,
  maxTokens = 1024,
): Promise<ClaudeResult> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY missing");

  let lastErr = "";
  for (const model of MODEL_CANDIDATES) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ model, max_tokens: maxTokens, temperature: 0, system, messages }),
    });

    if (res.ok) {
      const data = await res.json();
      const text = (data.content ?? [])
        .filter((b: any) => b.type === "text")
        .map((b: any) => b.text)
        .join("\n")
        .trim();
      return {
        text,
        inputTokens:  data.usage?.input_tokens  ?? 0,
        outputTokens: data.usage?.output_tokens ?? 0,
      };
    }

    const txt = await res.text();
    lastErr = `Anthropic ${res.status}: ${txt}`;
    if (!(res.status === 404 && txt.includes("not_found_error"))) {
      throw new Error(lastErr);
    }
  }
  throw new Error(lastErr || "No Anthropic model available for this account");
}

export type Analysis = {
  public_sentiment: number;         // -1 .. 1
  public_sentiment_label: string;   // positiv | neutral | negativ
  business_impact: number;          // -1 .. 1 (gut/schlecht fuer Nordzucker)
  business_impact_label: string;    // positiv | neutral | negativ
  impact_reason: string;
  topic: string;
  is_b2b: boolean;
  confidence: number;               // 0 .. 1 — wie sicher ist Claude bei dieser Analyse?
  primary_flavor: string;
  flavor_tags: string[];
  flavor_confidence: number;
};

// Klassifiziert mehrere Texte in EINEM Aufruf (kostengünstig).
export async function analyzeBatch(texts: string[]): Promise<Analysis[]> {
  const system =
    "Du bist ein Sentiment-, Themen- und Business-Impact-Klassifikator für Nordzucker AG. " +
    "Bewerte deutschsprachige öffentliche Aussagen zu Zucker, Süßgetränken und süßen Speisen immer aus Sicht von Nordzucker und seiner Produkte. " +
    `Erlaubte Themen: ${TOPICS.join(", ")}. ` +
    "Unterscheide strikt zwischen oeffentlicher Tonalitaet und geschaeftlicher Wirkung fuer Nordzucker. " +
    "public_sentiment beschreibt nur die sprachliche/oeffentliche Haltung des Autors. " +
    "business_impact beschreibt, ob die Aussage voraussichtlich positiv, neutral oder negativ fuer Nordzucker ist. " +
    "Wenn jemand Zucker reduziert, Zucker meidet oder zuckerfreie Alternativen positiv bewertet, ist public_sentiment oft positiv, business_impact fuer Nordzucker aber eher negativ. " +
    "Wenn Nachfrage nach Backen, saisonalen Suesswaren oder industriellen Anwendungen steigt, kann business_impact positiv sein. " +
    "impact_reason muss eine kurze Kategorie sein, bevorzugt eine dieser Werte: substitution_risk, health_tailwind, seasonal_demand, pricing_support, regulatory_risk, b2b_opportunity, brand_tailwind, neutral_context, unknown. " +
    "Extrahiere zusätzlich Geschmacksrichtungen aus dem Text fuer Produktentwicklung (z. B. limette, zitrone, orange, cola, vanille, erdbeere). " +
    "Wenn keine Geschmacksrichtung erkennbar ist, nutze primary_flavor='none' und flavor_tags=[]. " +
    'is_b2b = true, wenn ein industrieller Großabnehmerbezug erkennbar ist (z. B. Cola-/Getränkehersteller). ' +
    'confidence beschreibt deine Sicherheit bei der Klassifikation: 1.0 = eindeutig, 0.5 = ambivalent/mehrdeutig, 0.0 = kaum Kontext vorhanden. ' +
    "Antworte AUSSCHLIESSLICH mit einem JSON-Array, ein Objekt pro Eingabe, in Reihenfolge. " +
    'Schema je Objekt: {"public_sentiment": number (-1..1), "public_sentiment_label": "positiv"|"neutral"|"negativ", "business_impact": number (-1..1), "business_impact_label": "positiv"|"neutral"|"negativ", "impact_reason": string, "topic": string, "is_b2b": boolean, "confidence": number (0..1), "primary_flavor": string, "flavor_tags": string[], "flavor_confidence": number (0..1)}. ' +
    "Kein Markdown, keine Backticks, kein Vorwort.";
  const user =
    "Eingaben:\n" + texts.map((t, i) => `${i + 1}. ${t.replace(/\n/g, " ")}`).join("\n");

  try {
    const result = await callClaude([{ role: "user", content: user }], system, 1500);
    const clean = result.text.replace(/```json|```/g, "").trim();
    const arr = JSON.parse(clean) as Analysis[];
    return texts.map((_, i) => ({
      ...fallback(),
      ...arr[i],
      confidence: Math.max(0, Math.min(1, arr[i]?.confidence ?? 0.5)),
      flavor_confidence: Math.max(0, Math.min(1, arr[i]?.flavor_confidence ?? 0.5)),
      primary_flavor: String(arr[i]?.primary_flavor ?? "none").trim().toLowerCase() || "none",
      flavor_tags: Array.isArray(arr[i]?.flavor_tags)
        ? arr[i].flavor_tags.map((tag: unknown) => String(tag ?? "").trim().toLowerCase()).filter(Boolean).slice(0, 8)
        : [],
    }));
  } catch (e) {
    console.error("analyzeBatch fallback:", e);
    return texts.map(fallback);
  }
}

function fallback(): Analysis {
  return {
    public_sentiment: 0,
    public_sentiment_label: "neutral",
    business_impact: 0,
    business_impact_label: "neutral",
    impact_reason: "unknown",
    topic: "unknown",
    is_b2b: false,
    confidence: 0,
    primary_flavor: "none",
    flavor_tags: [],
    flavor_confidence: 0,
  };
}
