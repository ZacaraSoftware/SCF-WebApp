-- ============================================================================
-- Security Hardening: Lock down ai_runs (contains prompts/responses/tokens)
-- ----------------------------------------------------------------------------
-- ai_runs is an internal audit table and must not be readable via anon/auth.
-- Edge Functions use service_role and continue to work.
-- ============================================================================

alter table public.ai_runs enable row level security;

-- Remove broad table grants for API roles.
revoke all on table public.ai_runs from anon;
revoke all on table public.ai_runs from authenticated;

-- Explicit deny policies for clarity and future-proofing.
drop policy if exists "deny_ai_runs_anon" on public.ai_runs;
create policy "deny_ai_runs_anon"
  on public.ai_runs for all to anon using (false) with check (false);

drop policy if exists "deny_ai_runs_authenticated" on public.ai_runs;
create policy "deny_ai_runs_authenticated"
  on public.ai_runs for all to authenticated using (false) with check (false);
