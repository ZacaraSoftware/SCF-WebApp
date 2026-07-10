import { createClient } from "jsr:@supabase/supabase-js@2";

// Service-Role-Client: umgeht RLS, nur serverseitig in Edge Functions nutzen.
// SUPABASE_URL und SUPABASE_SERVICE_ROLE_KEY werden vom Edge Runtime automatisch
// als Umgebungsvariablen bereitgestellt.
export function serviceClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}
