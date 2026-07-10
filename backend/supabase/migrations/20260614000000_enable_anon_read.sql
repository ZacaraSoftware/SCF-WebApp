-- Enable read access for anon role so the dashboard can load data without auth.
-- This keeps write access restricted to service_role via Edge Functions.

drop policy if exists "read_mentions_anon" on public.mentions;
create policy "read_mentions_anon"
  on public.mentions for select to anon using (true);

drop policy if exists "read_competitors_anon" on public.competitor_metrics;
create policy "read_competitors_anon"
  on public.competitor_metrics for select to anon using (true);

drop policy if exists "read_sources_anon" on public.sources;
create policy "read_sources_anon"
  on public.sources for select to anon using (true);
