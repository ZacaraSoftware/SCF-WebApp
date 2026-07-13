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

export async function callClaude(
  messages: Msg[],
  system: string,
  maxTokens = 1024,
): Promise<string> {
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
      body: JSON.stringify({ model, max_tokens: maxTokens, system, messages }),
    });

    if (res.ok) {
      const data = await res.json();
      return (data.content ?? [])
        .filter((b: any) => b.type === "text")
        .map((b: any) => b.text)
        .join("\n")
        .trim();
    }

    const txt = await res.text();
    lastErr = `Anthropic ${res.status}: ${txt}`;
    // Try next model only when this model is unknown for the account.
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
    'is_b2b = true, wenn ein industrieller Großabnehmerbezug erkennbar ist (z. B. Cola-/Getränkehersteller). ' +
    "Antworte AUSSCHLIESSLICH mit einem JSON-Array, ein Objekt pro Eingabe, in Reihenfolge. " +
    'Schema je Objekt: {"public_sentiment": number (-1..1), "public_sentiment_label": "positiv"|"neutral"|"negativ", "business_impact": number (-1..1), "business_impact_label": "positiv"|"neutral"|"negativ", "impact_reason": string, "topic": string, "is_b2b": boolean}. ' +
    "Kein Markdown, keine Backticks, kein Vorwort.";
  const user =
    "Eingaben:\n" + texts.map((t, i) => `${i + 1}. ${t.replace(/\n/g, " ")}`).join("\n");

  try {
    const raw = await callClaude([{ role: "user", content: user }], system, 1500);
    const clean = raw.replace(/```json|```/g, "").trim();
    const arr = JSON.parse(clean) as Analysis[];
    return texts.map((_, i) => arr[i] ?? fallback());
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
  };
}
