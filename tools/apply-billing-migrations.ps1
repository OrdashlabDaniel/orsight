param(
  [string]$PasswordFile,
  [string]$PsqlPath = "C:\Program Files\PostgreSQL\17\bin\psql.exe"
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
if (-not $PasswordFile) {
  $PasswordFile = Join-Path $repoRoot "Price\SupabaseDbPassword\Password.txt"
}

if (-not (Test-Path -LiteralPath $PasswordFile)) {
  throw "Supabase DB password file not found: $PasswordFile"
}

if (-not (Test-Path -LiteralPath $PsqlPath)) {
  $psqlCommand = Get-Command psql -ErrorAction SilentlyContinue
  if (-not $psqlCommand) {
    throw "psql was not found. Install PostgreSQL client tools or pass -PsqlPath."
  }
  $PsqlPath = $psqlCommand.Source
}

$poolerUrlPath = Join-Path $repoRoot "webapp\supabase\.temp\pooler-url"
if (-not (Test-Path -LiteralPath $poolerUrlPath)) {
  throw "Supabase pooler URL file not found: $poolerUrlPath"
}

$poolerUrl = (Get-Content -LiteralPath $poolerUrlPath -Raw).Trim()
if (-not $poolerUrl) {
  throw "Supabase pooler URL is empty."
}

$migrations = @(
  "webapp\supabase\migrations\20260423_stripe_billing.sql",
  "webapp\supabase\migrations\20260424_billing_catalog_and_invoices.sql",
  "webapp\supabase\migrations\20260424_billing_stripe_assets.sql",
  "webapp\supabase\migrations\20260502_usage_logs_conservative_attribution.sql",
  "webapp\supabase\migrations\20260503_billing_webhook_events.sql",
  "webapp\supabase\migrations\20260504_billing_normal_test_plan.sql",
  "webapp\supabase\migrations\20260505_billing_token_packs.sql",
  "webapp\supabase\migrations\20260505_free_trial_budget_and_seat_cap.sql",
  "webapp\supabase\migrations\20260505_prepaid_usage_credit_pack.sql",
  "webapp\supabase\migrations\20260506_billing_lifetime_free_entitlements.sql"
)

foreach ($migration in $migrations) {
  $fullPath = Join-Path $repoRoot $migration
  if (-not (Test-Path -LiteralPath $fullPath)) {
    throw "Migration file not found: $migration"
  }
}

$passwordRaw = Get-Content -LiteralPath $PasswordFile -Raw
if ($null -eq $passwordRaw) {
  $passwordRaw = ""
}
$password = $passwordRaw.ToString().Trim()
if (-not $password) {
  throw "Supabase DB password file is empty."
}

try {
  $env:PGPASSWORD = $password

  foreach ($migration in $migrations) {
    $fullPath = Join-Path $repoRoot $migration
    Write-Host "Applying $migration"
    & $PsqlPath $poolerUrl -v ON_ERROR_STOP=1 -f $fullPath
    if ($LASTEXITCODE -ne 0) {
      throw "Migration failed: $migration"
    }
  }

  Write-Host "Reloading Supabase PostgREST schema cache"
  & $PsqlPath $poolerUrl -v ON_ERROR_STOP=1 -c "notify pgrst, 'reload schema';"
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to reload PostgREST schema cache."
  }

  Write-Host "Verifying required billing tables"
  $verifySql = @"
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'usage_logs',
    'app_billing_customers',
    'app_subscriptions',
    'app_billing_plan_configs',
    'app_billing_webhook_events',
    'app_billing_token_ledger',
    'app_free_plan_seats',
    'app_billing_user_entitlements'
  )
order by table_name;
"@
  & $PsqlPath $poolerUrl -v ON_ERROR_STOP=1 -c $verifySql
  if ($LASTEXITCODE -ne 0) {
    throw "Billing table verification failed."
  }
} finally {
  Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
}
