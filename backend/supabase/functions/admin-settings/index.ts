import { json } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/supabase.ts";

type AppSettingEntry = {
  key: string;
  value: unknown;
};

Deno.serve(async (req) => {
  try {
    if (req.method === "OPTIONS") return json({ ok: true }, 200, req);
    if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405, req);

    const adminSecret = Deno.env.get("ADMIN_PANEL_SECRET") ?? Deno.env.get("CRON_SECRET");
    if (adminSecret && req.headers.get("x-admin-secret") !== adminSecret) {
      return json({ error: "unauthorized" }, 401, req);
    }

    const body = await req.json().catch(() => ({}));
    const entries = Array.isArray(body?.entries) ? body.entries : [];
    const normalized = entries.filter((entry): entry is AppSettingEntry => {
      return entry && typeof entry.key === "string" && entry.key.length > 0;
    });

    if (normalized.length === 0) {
      return json({ error: "no_entries" }, 400, req);
    }

    const db = serviceClient();
    const { error } = await db.from("app_settings").upsert(
      normalized.map((entry) => ({
        key: entry.key,
        value: entry.value,
        updated_at: new Date().toISOString(),
      })),
      { onConflict: "key" },
    );
    if (error) throw error;

    const { data, error: readError } = await db
      .from("app_settings")
      .select("key, value, updated_at")
      .in("key", normalized.map((entry) => entry.key))
      .order("key", { ascending: true });
    if (readError) throw readError;

    return json({ ok: true, settings: data ?? [] }, 200, req);
  } catch (e) {
    console.error("admin-settings error:", e);
    return json({ error: String((e as Error)?.message ?? e) }, 500, req);
  }
});