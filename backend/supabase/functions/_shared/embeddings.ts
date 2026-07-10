/// <reference types="https://esm.sh/@supabase/functions-js/src/edge-runtime.d.ts" />

// ----------------------------------------------------------------------------
// Embedding-Erzeugung. Default: eingebautes gte-small (384 Dim, kostenlos).
// Hinweis: gte-small ist auf Englisch optimiert. Für bessere deutschsprachige
// Treffer den OpenAI-Block unten aktivieren UND in der Migration vector(1536).
// ----------------------------------------------------------------------------

// Wähle das Embedding-Backend per Secret:
// OPENAI_API_KEY gesetzt   →  OpenAI text-embedding-3-small (1536 Dim, mehrsprachig, empfohlen für DE)
// Kein OPENAI_API_KEY      →  eingebautes gte-small (384 Dim, EN-optimiert, kostenlos)
const session = new Supabase.ai.Session("gte-small");

export async function embed(text: string): Promise<number[]> {
  const input = text.slice(0, 4000);

  const provider = (Deno.env.get("EMBEDDING_PROVIDER") ?? "gte-small").toLowerCase();
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (provider === "openai" && openaiKey) {
    const r = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({ model: "text-embedding-3-small", input }),
    });
    if (!r.ok) throw new Error(`OpenAI embed ${r.status}: ${await r.text()}`);
    const data = await r.json();
    return data.data[0].embedding as number[];
  }

  // Fallback: gte-small (kostenlos, aber EN-optimiert — für DE-Content suboptimal)
  const out = (await session.run(input, { mean_pool: true, normalize: true })) as number[];
  return out;
}
