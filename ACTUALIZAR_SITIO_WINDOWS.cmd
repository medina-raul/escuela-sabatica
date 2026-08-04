@echo off
setlocal
title Actualizador de Escuela Sabatica CL
cd /d "%~dp0"

echo ================================================================
echo   ESCUELA SABATICA CL - ACTUALIZACION INTEGRAL
echo ================================================================
echo.
echo Esta ventana revisara, actualizara, publicara y comprobara el sitio.
echo No la cierre hasta leer el resultado final.
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\run_resource_update.ps1"
set "RESULT=%ERRORLEVEL%"

echo.
if "%RESULT%"=="0" (
  echo PROCESO COMPLETADO CORRECTAMENTE.
) else (
  echo EL PROCESO SE DETUVO DE FORMA SEGURA.
  echo Envie al administrador el archivo artifacts\site-maintenance-report.json
)
echo.
pause
exit /b %RESULT%
