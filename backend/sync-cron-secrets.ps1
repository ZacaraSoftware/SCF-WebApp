param(
  [Parameter(Mandatory = $true)]
  [string]$ProjectRef,

  [Parameter(Mandatory = $false)]
  [string]$CronSecret,

  [Parameter(Mandatory = $false)]
  [string]$AllowedOrigins = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function New-StrongSecret {
  $chars = (65..90) + (97..122) + (48..57) + 33,35,36,37,38,42,43,45,46,58,61,63
  return -join ($chars | Get-Random -Count 48 | ForEach-Object { [char]$_ })
}

function Write-Step([string]$msg) {
  Write-Host ("[sync] " + $msg)
}

function Invoke-SupabaseCli([string[]]$CliArgs) {
  & supabase @CliArgs
  if ($LASTEXITCODE -ne 0) {
    throw "Supabase CLI command failed: supabase $($CliArgs -join ' ')"
  }
}

if (-not $CronSecret -or $CronSecret.Trim().Length -lt 24) {
  $CronSecret = New-StrongSecret
  Write-Step "Generated strong random CRON secret."
} else {
  Write-Step "Using provided CRON secret."
}

Write-Step "Setting Edge Function secret CRON_SECRET..."
Invoke-SupabaseCli @("secrets", "set", "CRON_SECRET=$CronSecret", "--project-ref", $ProjectRef) | Out-Null

if ($AllowedOrigins.Trim().Length -gt 0) {
  Write-Step "Setting ALLOWED_ORIGINS..."
  Invoke-SupabaseCli @("secrets", "set", "ALLOWED_ORIGINS=$AllowedOrigins", "--project-ref", $ProjectRef) | Out-Null
}

Write-Step "Upserting vault secret project_url and cron_secret..."
$projectUrl = "https://$ProjectRef.supabase.co"
$escapedSecret = $CronSecret.Replace("'", "''")
$sqlProjectUpdate = "select vault.update_secret((select id from vault.secrets where name = 'project_url' order by created_at desc limit 1), '$projectUrl', 'project_url', 'Supabase project URL', null) where exists (select 1 from vault.secrets where name = 'project_url');"
$sqlProjectCreate = "select vault.create_secret('$projectUrl', 'project_url', 'Supabase project URL', null) where not exists (select 1 from vault.secrets where name = 'project_url');"
$sqlCronUpdate = "select vault.update_secret((select id from vault.secrets where name = 'cron_secret' order by created_at desc limit 1), '$escapedSecret', 'cron_secret', 'Cron auth secret', null) where exists (select 1 from vault.secrets where name = 'cron_secret');"
$sqlCronCreate = "select vault.create_secret('$escapedSecret', 'cron_secret', 'Cron auth secret', null) where not exists (select 1 from vault.secrets where name = 'cron_secret');"
Invoke-SupabaseCli @("db", "query", $sqlProjectUpdate, "--linked") | Out-Null
Invoke-SupabaseCli @("db", "query", $sqlProjectCreate, "--linked") | Out-Null
Invoke-SupabaseCli @("db", "query", $sqlCronUpdate, "--linked") | Out-Null
Invoke-SupabaseCli @("db", "query", $sqlCronCreate, "--linked") | Out-Null

Write-Step "Executing cron-equivalent SQL net.http_post..."
$sqlHttp = "select net.http_post(url := (select decrypted_secret from vault.decrypted_secrets where name='project_url') || '/functions/v1/ingest', headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='cron_secret')), body := '{}'::jsonb, timeout_milliseconds := 120000) as request_id;"
Invoke-SupabaseCli @("db", "query", $sqlHttp, "--linked")

Write-Step "Verifying direct authenticated dry-run..."
$nodeScript = @"
const secret = process.argv[1];
const url = 'https://$ProjectRef.supabase.co/functions/v1/ingest';
fetch(url, {
  method: 'POST',
  headers: {
    'x-cron-secret': secret,
    'content-type': 'application/json',
    'origin': 'http://localhost:4173'
  },
  body: JSON.stringify({ dryRun: true })
}).then(async (r) => {
  const txt = await r.text();
  console.log('ingest_status', r.status);
  console.log(txt.slice(0, 350));
  if (r.status !== 200) process.exit(2);
}).catch((e) => {
  console.error(e);
  process.exit(1);
});
"@

& node -e $nodeScript "$CronSecret"
if ($LASTEXITCODE -ne 0) {
  throw "Node verification failed with exit code $LASTEXITCODE"
}

$fingerprint = $CronSecret.Substring(0, 6) + "..." + $CronSecret.Substring($CronSecret.Length - 4)
Write-Step ("Done. Active CRON secret fingerprint: " + $fingerprint)
