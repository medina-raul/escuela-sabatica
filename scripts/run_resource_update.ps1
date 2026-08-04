$ErrorActionPreference = "Stop"

$ProjectDir = Split-Path -Parent $PSScriptRoot
$ReportDir = Join-Path $ProjectDir "artifacts"
$ReportPath = Join-Path $ReportDir "resource-sync-report.json"

Set-Location $ProjectDir
New-Item -ItemType Directory -Force -Path $ReportDir | Out-Null

npm run resources:sync -- --report $ReportPath
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$Report = Get-Content -Raw -Path $ReportPath | ConvertFrom-Json
$Pending = @($Report.tasks).Count

Write-Host ""
Write-Host "Validación completada. Informe: $ReportPath"
if ($Pending -gt 0) {
    Write-Host "$Pending tarea(s) asistida(s) pendientes. Pueden ser completadas por una persona o cualquier agente compatible."
} else {
    Write-Host "No hay traducciones pendientes."
}
