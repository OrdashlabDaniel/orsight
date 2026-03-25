# Copy Supabase URL + anon + service_role from webapp/.env.local into admin-webapp/.env.local
# Run from repo root:
#   powershell -ExecutionPolicy Bypass -File admin-webapp/scripts/sync-supabase-env-from-webapp.ps1
$ErrorActionPreference = "Stop"
$repoRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$src = Join-Path $repoRoot "webapp\.env.local"
$dst = Join-Path $repoRoot "admin-webapp\.env.local"

if (-not (Test-Path $src)) {
  Write-Error "Missing webapp/.env.local"
}

$keys = Get-Content $src | Where-Object {
  $_ -match '^(NEXT_PUBLIC_SUPABASE_URL|NEXT_PUBLIC_SUPABASE_ANON_KEY|SUPABASE_SERVICE_ROLE_KEY)='
}
if ($keys.Count -lt 3) {
  Write-Error "webapp/.env.local must contain NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY"
}

$pick = @(
  "# Supabase (synced from webapp/.env.local by sync-supabase-env-from-webapp.ps1)",
  ""
) + $keys

# UTF-8 without BOM (BOM can break Next.js parsing of the first env line)
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllLines($dst, $pick, $utf8NoBom)
Write-Host "Wrote $dst"
