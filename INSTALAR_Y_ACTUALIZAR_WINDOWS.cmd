@echo off
setlocal EnableExtensions EnableDelayedExpansion
title Instalar y actualizar Escuela Sabatica CL

set "OFFICIAL_REPO=https://github.com/medina-raul/escuela-sabatica.git"
set "DEFAULT_DIR=%USERPROFILE%\EscuelaSabaticaCL"
set "PROJECT_DIR="

if exist "%~dp0.git\" set "PROJECT_DIR=%~dp0"
if not defined PROJECT_DIR if exist "%DEFAULT_DIR%\.git\" set "PROJECT_DIR=%DEFAULT_DIR%"
if not defined PROJECT_DIR set "PROJECT_DIR=%DEFAULT_DIR%"

echo ================================================================
echo   ESCUELA SABATICA CL - INSTALACION Y ACTUALIZACION
echo ================================================================
echo.
echo Carpeta administrada: %PROJECT_DIR%
echo No cierre esta ventana hasta leer el resultado final.
echo.

where git >nul 2>&1
if errorlevel 1 (
  where winget >nul 2>&1
  if errorlevel 1 (
    echo ERROR: Este equipo no tiene Git ni el instalador winget.
    echo Solicite al administrador instalar Git.Git y vuelva a intentarlo.
    goto :failed
  )
  echo Instalando Git por unica vez...
  winget install --id Git.Git --exact --accept-package-agreements --accept-source-agreements
  if errorlevel 1 (
    echo ERROR: Windows no pudo instalar Git.
    goto :failed
  )
  call :refresh_path
)

where git >nul 2>&1
if errorlevel 1 (
  echo ERROR: Git fue instalado, pero Windows requiere cerrar esta ventana.
  echo Cierrela, vuelva a abrir este mismo archivo y continue.
  goto :failed
)

if not exist "%PROJECT_DIR%\.git\" (
  echo Descargando el repositorio oficial por primera vez...
  git clone "%OFFICIAL_REPO%" "%PROJECT_DIR%"
  if errorlevel 1 (
    echo ERROR: No se pudo crear la copia oficial en %PROJECT_DIR%
    echo Si esa carpeta contiene otros archivos, no se modificaron.
    goto :failed
  )
)

set "CURRENT_BRANCH="
for /f "usebackq delims=" %%B in (`git -C "%PROJECT_DIR%" branch --show-current`) do set "CURRENT_BRANCH=%%B"
if /I not "!CURRENT_BRANCH!"=="main" (
  echo ERROR: La copia local esta en la rama !CURRENT_BRANCH! y solo puede actualizarse desde main.
  goto :failed
)

git -C "%PROJECT_DIR%" diff --quiet
if errorlevel 1 (
  echo ERROR: Hay cambios locales en archivos versionados. No se modifico nada.
  goto :failed
)
git -C "%PROJECT_DIR%" diff --cached --quiet
if errorlevel 1 (
  echo ERROR: Hay cambios preparados en Git. No se modifico nada.
  goto :failed
)

echo Comprobando la version mas reciente del instalador...
git -C "%PROJECT_DIR%" fetch "%OFFICIAL_REPO%" main
if errorlevel 1 (
  echo ERROR: No se pudo consultar el repositorio oficial.
  goto :failed
)
git -C "%PROJECT_DIR%" merge --ff-only FETCH_HEAD
if errorlevel 1 (
  echo ERROR: La copia local no admite una actualizacion segura por fast-forward.
  goto :failed
)

if not exist "%PROJECT_DIR%\ACTUALIZAR_SITIO_WINDOWS.cmd" (
  echo ERROR: La copia local no contiene el actualizador esperado.
  echo Envie esta pantalla al administrador.
  goto :failed
)

call "%PROJECT_DIR%\ACTUALIZAR_SITIO_WINDOWS.cmd"
exit /b %ERRORLEVEL%

:refresh_path
for /f "usebackq delims=" %%P in (`powershell.exe -NoProfile -Command "[Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')"`) do set "PATH=%%P"
exit /b 0

:failed
echo.
echo LA INSTALACION SE DETUVO DE FORMA SEGURA.
echo No se sobrescribieron archivos del proyecto.
echo.
pause
exit /b 1
