# Production MVP Go-Live Checklist

## 1) Security Baseline (Must)

- [ ] Set fixed `CRON_SECRET` once (do not rotate during normal tests).
- [ ] Keep `CRON_SECRET` synchronized between:
  - Edge Function secret: `CRON_SECRET`
  - Vault secret: `cron_secret`
- [ ] Set `ALLOWED_ORIGINS` for Edge Functions (comma separated).
  - Example: `https://your-app.vercel.app,https://www.your-domain.com`
- [ ] Verify no wildcard CORS is used in production traffic.

### Commands

```powershell
# Set production secrets
supabase secrets set CRON_SECRET="<strong-secret>" --project-ref <project-ref>
supabase secrets set ALLOWED_ORIGINS="https://your-app.vercel.app,https://www.your-domain.com" --project-ref <project-ref>
```

```sql
-- SQL editor: keep vault cron secret in sync
select vault.create_secret('<strong-secret>', 'cron_secret', 'Cron auth secret', null);
```

## 2) Data Pipeline Health (Must)

- [ ] `ingest` deploy is current.
- [ ] Manual authenticated run succeeds (status 200).
- [ ] `adapterDiagnostics` present in response.
- [ ] YouTube source has `status=ok` and `count > 0` in dry-run.
- [ ] Full run returns `ingested > 0` and no critical `upsertErrors`.

### Commands

```powershell
supabase functions deploy ingest --project-ref <project-ref>
```

```powershell
# Dry run (source diagnostics only)
$secret = "<same-secret-as-CRON_SECRET>"
Invoke-RestMethod -Uri "https://<project-ref>.supabase.co/functions/v1/ingest" -Method Post -Headers @{"x-cron-secret"=$secret;"Content-Type"="application/json"} -Body "{\"dryRun\":true}" | ConvertTo-Json -Depth 10
```

```powershell
# Full run
$secret = "<same-secret-as-CRON_SECRET>"
Invoke-RestMethod -Uri "https://<project-ref>.supabase.co/functions/v1/ingest" -Method Post -Headers @{"x-cron-secret"=$secret;"Content-Type"="application/json"} -Body "{}" | ConvertTo-Json -Depth 10
```

## 3) Database & Access (Must)

- [ ] Confirm RLS mode fits your product decision (public vs internal dashboard).
- [ ] Confirm `mentions` contains expected source mix for last 30 days.
- [ ] Confirm dedupe is active via `(source, external_id)` uniqueness.

### SQL Checks

```sql
select source, count(*) as cnt
from public.mentions
where published_at >= now() - interval '30 days'
group by source
order by source;
```

```sql
select count(*) as duplicate_rows
from (
  select source, external_id, count(*)
  from public.mentions
  group by source, external_id
  having count(*) > 1
) d;
```

## 4) Frontend Readiness (Must)

- [ ] Build succeeds with no blocking errors.
- [ ] Dashboard loads from live backend.
- [ ] Sources page reflects live source health (volume + last sync).
- [ ] BI Cube interactions are smooth on desktop and mobile.

### Commands

```powershell
cd frontend
npm run build
npm run dev
```

## 5) Operability (Should)

- [ ] Add alerting for:
  - `ingest` failures
  - repeated `WORKER_RESOURCE_LIMIT`
  - source count dropping to zero unexpectedly
- [ ] Keep a short runbook for incidents (401, 546, quota errors).
- [ ] Weekly quota review for YouTube/News APIs.

### Scheduler Health Runbook (30-Second Check)

```sql
-- 1) Job exists and is active
select jobid, jobname, schedule, active
from cron.job
where jobname = 'scf-ingest-6h';
```

```sql
-- 2) Vault values are present (must return 2 rows with non-zero length)
select name, length(decrypted_secret) as len
from vault.decrypted_secrets
where name in ('project_url', 'cron_secret')
order by name;
```

```sql
-- 3) Last scheduler runs
select jobid, status, return_message, start_time, end_time
from cron.job_run_details
where jobid = (select jobid from cron.job where jobname = 'scf-ingest-6h')
order by start_time desc
limit 5;
```

```sql
-- 4) Last HTTP worker responses for cron-triggered requests
select id, status_code, timed_out, error_msg, created
from net._http_response
order by id desc
limit 5;
```

Expected healthy state:

- Job is `active = true`
- Vault returns both `project_url` and `cron_secret`
- Recent run status is `succeeded` (or at least no recurring null-url/null-secret errors)
- `net._http_response.status_code` includes `200`

### One-Command Secret Sync + Verify

```powershell
cd backend
.\sync-cron-secrets.ps1 -ProjectRef <project-ref>
```

## 6) Acceptance Criteria (Go / No-Go)

Go live only if all are true:

- [ ] CORS restricted with `ALLOWED_ORIGINS`.
- [ ] Authenticated `ingest` full run status 200.
- [ ] YouTube + News both `status=ok` in `adapterDiagnostics`.
- [ ] Last 30 days include YouTube mentions in DB.
- [ ] Frontend loads and shows source health correctly.

## Notes for this project

- Ingest currently uses quality prioritization and run insights.
- YouTube terms are rotated per run to balance coverage and resource limits.
- If source volume appears low, run dry-run first to inspect term diagnostics before changing limits.
