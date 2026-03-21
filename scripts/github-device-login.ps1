# Run in Windows PowerShell (not headless). Device login opens a browser step.
# Usage:  cd <repo>;  Set-ExecutionPolicy -Scope Process Bypass -Force;  .\scripts\github-device-login.ps1

# Do not use $ErrorActionPreference = 'Stop': git prints warnings to stderr when the old account is already gone.
$ErrorActionPreference = "Continue"

Write-Host "Clearing old GitHub credentials (safe if account already removed)..." -ForegroundColor Cyan
git credential-manager github logout Daniel777611 2>&1 | Out-Null
@"
protocol=https
host=github.com

"@ | git credential-manager erase 2>&1 | Out-Null

Write-Host ""
Write-Host "Starting device login. A window may open, or URL + code will show here." -ForegroundColor Yellow
Write-Host "Sign in as OrdashlabDaniel at https://github.com/login/device" -ForegroundColor Yellow
Write-Host ""

git credential-manager github login --device --username OrdashlabDaniel

if ($LASTEXITCODE -eq 0) {
  Write-Host ""
  Write-Host "Done. Saved GitHub accounts:" -ForegroundColor Green
  git credential-manager github list
  $repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
  Write-Host ""
  Write-Host "Next, push your repo:" -ForegroundColor Green
  Write-Host ('  cd "' + $repoRoot + '"')
  Write-Host "  git push -u origin main"
}
