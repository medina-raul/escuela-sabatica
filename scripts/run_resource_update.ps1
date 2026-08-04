$ErrorActionPreference = "Stop"

$ProjectDir = Split-Path -Parent $PSScriptRoot
$ReportDir = Join-Path $ProjectDir "artifacts"
$ReportPath = Join-Path $ReportDir "resource-update-report.json"

Set-Location $ProjectDir
New-Item -ItemType Directory -Force -Path $ReportDir | Out-Null

npm run resources:update -- --report $ReportPath
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

npm run resources:audit
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

npm run build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$Report = Get-Content -Raw -Path $ReportPath | ConvertFrom-Json
$Pending = @($Report.teacherTranslationTasks).Count

Write-Host ""
Write-Host "Validación completada. Informe: $ReportPath"
if ($Pending -gt 0) {
    Write-Host "$Pending traducción(es) pendientes. Ejecute el workflow /actualizar-recursos-semanales en Antigravity."
} else {
    Write-Host "No hay traducciones pendientes."
}
