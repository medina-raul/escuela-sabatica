$ErrorActionPreference = "Stop"

$ProjectDir = Split-Path -Parent $PSScriptRoot
$ReportDir = Join-Path $ProjectDir "artifacts"
$ReportPath = Join-Path $ReportDir "site-maintenance-report.json"

function Refresh-Path {
    $machine = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $user = [Environment]::GetEnvironmentVariable("Path", "User")
    $env:Path = "$machine;$user"
}

function Install-ToolIfMissing {
    param(
        [Parameter(Mandatory = $true)][string]$Command,
        [Parameter(Mandatory = $true)][string]$WingetId
    )
    $available = $false
    if (Get-Command $Command -ErrorAction SilentlyContinue) {
        & $Command --version *> $null
        $available = ($LASTEXITCODE -eq 0)
    }
    if ($available) { return }
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        throw "Falta $Command y este Windows no dispone de winget. El administrador debe instalar $WingetId una sola vez."
    }
    Write-Host "Instalando requisito $Command..."
    winget install --id $WingetId --exact --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) { throw "No se pudo instalar $WingetId" }
    Refresh-Path
}

Set-Location $ProjectDir
New-Item -ItemType Directory -Force -Path $ReportDir | Out-Null

Install-ToolIfMissing -Command git -WingetId "Git.Git"
Install-ToolIfMissing -Command node -WingetId "OpenJS.NodeJS.LTS"
Install-ToolIfMissing -Command npm -WingetId "OpenJS.NodeJS.LTS"
Install-ToolIfMissing -Command python -WingetId "Python.Python.3.12"
Install-ToolIfMissing -Command gh -WingetId "GitHub.cli"

gh auth status -h github.com *> $null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Se abrirá GitHub para autorizar esta computadora. Esto sólo ocurre la primera vez."
    gh auth login -h github.com -p https --web
    if ($LASTEXITCODE -ne 0) { throw "No se completó la autorización de GitHub" }
}

node scripts/run_python.mjs scripts/site_maintenance.py --report $ReportPath
$ExitCode = $LASTEXITCODE

if (Test-Path $ReportPath) {
    $Report = Get-Content -Raw -Path $ReportPath | ConvertFrom-Json
    Write-Host ""
    Write-Host $Report.message
    if ($Report.prUrl) { Write-Host "PR: $($Report.prUrl)" }
    Write-Host "Informe: $ReportPath"
}

exit $ExitCode
