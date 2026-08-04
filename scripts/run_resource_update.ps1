$ErrorActionPreference = "Stop"

$ProjectDir = Split-Path -Parent $PSScriptRoot
$ReportDir = Join-Path $ProjectDir "artifacts"
$ReportPath = Join-Path $ReportDir "site-maintenance-report.json"

function Refresh-Path {
    $machine = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $user = [Environment]::GetEnvironmentVariable("Path", "User")
    $env:Path = "$machine;$user"
}

function Test-PythonCommand {
    param(
        [Parameter(Mandatory = $true)][string]$Command,
        [Parameter(Mandatory = $true)][string[]]$Arguments
    )
    if (-not (Get-Command $Command -ErrorAction SilentlyContinue)) { return $false }
    try {
        & $Command @Arguments *> $null
        return ($LASTEXITCODE -eq 0)
    }
    catch {
        # Windows puede exponer aliases python/python3 de Microsoft Store que
        # existen como comandos, pero fallan al ejecutarse. No son Python real.
        return $false
    }
}

function Test-Python3 {
    if (Test-PythonCommand -Command "py" -Arguments @("-3", "--version")) { return $true }
    if (Test-PythonCommand -Command "python" -Arguments @("--version")) { return $true }
    if (Test-PythonCommand -Command "python3" -Arguments @("--version")) { return $true }
    return $false
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
if (-not (Test-Python3)) {
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        throw "Falta Python 3 y este Windows no dispone de winget. El administrador debe instalar Python.Python.3.12 una sola vez."
    }
    Write-Host "Instalando requisito Python 3..."
    winget install --id "Python.Python.3.12" --exact --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) { throw "No se pudo instalar Python.Python.3.12" }
    Refresh-Path
    if (-not (Test-Python3)) {
        throw "Python 3 fue instalado, pero Windows aun no lo reconoce. Cierre esta ventana y ejecute nuevamente el instalador."
    }
}
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
