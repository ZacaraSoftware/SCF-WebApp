// Gemeinsame CORS-Header für alle Edge Functions.
// Produktiv: ALLOWED_ORIGINS als kommaseparierte Liste setzen.
const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ?? "")
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean);

function resolveOrigin(req?: Request): string {
  const requestOrigin = req?.headers.get("origin") ?? "";
  if (!requestOrigin) return "*";
  if (ALLOWED_ORIGINS.length === 0) return "*";
  return ALLOWED_ORIGINS.includes(requestOrigin) ? requestOrigin : "null";
}

export function buildCorsHeaders(req?: Request): Record<string, string> {
  const origin = resolveOrigin(req);
  const headers: Record<string, string> = {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-cron-secret, x-admin-secret",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
  if (origin !== "*") headers.Vary = "Origin";
  return headers;
}

export function json(body: unknown, status = 200, req?: Request) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...buildCorsHeaders(req), "Content-Type": "application/json" },
  });
}
