-- Split pipeline: fast ingest + async enrichment
-- Goal: store high-volume source data reliably, enrich in smaller background batches.

alter table public.mentions
  add column if not exists enrichment_status text not null default 'done',
  add column if not exists enriched_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'mentions_enrichment_status_check'
      and conrelid = 'public.mentions'::regclass
  ) then
    alter table public.mentions
      add constraint mentions_enrichment_status_check
      check (enrichment_status in ('pending', 'in_progress', 'done', 'failed'));
  end if;
end $$;

update public.mentions
set
  enrichment_status = 'done',
  enriched_at = coalesce(enriched_at, created_at, now())
where enrichment_status is distinct from 'done'
   or enriched_at is null;

create index if not exists mentions_enrichment_status_idx
  on public.mentions (enrichment_status, published_at desc);

-- Ensure only one enrichment scheduler exists
DO $$
DECLARE
  existing_job_id int;
BEGIN
  select jobid into existing_job_id
  from cron.job
  where jobname = 'scf-enrich-15m';

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  perform cron.schedule(
    'scf-enrich-15m',
    '*/15 * * * *',
    $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
             || '/functions/v1/enrich-mentions',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000
    );
    $job$
  );
END $$;
