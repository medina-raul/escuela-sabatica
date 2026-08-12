@echo off
setlocal EnableExtensions EnableDelayedExpansion

if /I "%~1"=="--bootstrap" goto :bootstrap_ready

set "BOOTSTRAP_REQUEST=%~1"
set "BOOTSTRAP_COPY=%TEMP%\EscuelaSabaticaCL-instalador-%RANDOM%-%RANDOM%.cmd"
copy /y "%~f0" "!BOOTSTRAP_COPY!" >nul
if errorlevel 1 (
  echo ERROR: No se pudo preparar una copia temporal segura del instalador.
  pause
  exit /b 1
)
call "!BOOTSTRAP_COPY!" --bootstrap "%~dp0." "!BOOTSTRAP_REQUEST!"
set "BOOTSTRAP_RESULT=!ERRORLEVEL!"
del /q "!BOOTSTRAP_COPY!" >nul 2>&1
exit /b !BOOTSTRAP_RESULT!

:bootstrap_ready
title Instalar y actualizar Escuela Sabatica CL

set "OFFICIAL_REPO=https://github.com/medina-raul/escuela-sabatica.git"
set "DEFAULT_DIR=%USERPROFILE%\EscuelaSabaticaCL"
set "SOURCE_DIR=%~f2"
set "PROJECT_DIR="
set "LOCAL_STASH="
set "LOCAL_LAUNCHER_BACKUP="
set "RESULT=0"

if exist "%SOURCE_DIR%\.git\" set "PROJECT_DIR=%SOURCE_DIR%"
if not defined PROJECT_DIR if exist "%DEFAULT_DIR%\.git\" set "PROJECT_DIR=%DEFAULT_DIR%"
if not defined PROJECT_DIR set "PROJECT_DIR=%DEFAULT_DIR%"
if "!PROJECT_DIR:~-1!"=="\" set "PROJECT_DIR=!PROJECT_DIR:~0,-1!"

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
for /f "delims=" %%B in ('git -C "%PROJECT_DIR%" symbolic-ref --quiet --short HEAD') do set "CURRENT_BRANCH=%%B"
if not defined CURRENT_BRANCH (
  for /f "delims=" %%B in ('git -C "%PROJECT_DIR%" branch --show-current') do set "CURRENT_BRANCH=%%B"
)
if not defined CURRENT_BRANCH (
  echo ERROR: Git no pudo identificar la rama activa en %PROJECT_DIR%.
  echo Abra CMD en esa carpeta y ejecute: git branch --show-current
  goto :failed
)
if /I "%~3"=="--self-test" (
  echo PRUEBA DEL INSTALADOR WINDOWS COMPLETADA.
  echo Rama detectada: !CURRENT_BRANCH!
  echo Ruta detectada: !PROJECT_DIR!
  exit /b 0
)
if /I "%~3"=="--self-test-stash" goto :self_test_stash
if /I not "!CURRENT_BRANCH!"=="main" (
  echo ERROR: La copia local esta en la rama !CURRENT_BRANCH! y solo puede actualizarse desde main.
  goto :failed
)

call :preserve_managed_launcher
if errorlevel 1 goto :failed

call :preserve_local_changes
if errorlevel 1 goto :failed

echo Comprobando la version mas reciente del instalador...
git -C "%PROJECT_DIR%" fetch "%OFFICIAL_REPO%" main
if errorlevel 1 (
  echo ERROR: No se pudo consultar el repositorio oficial.
  goto :restore_and_fail
)
git -C "%PROJECT_DIR%" merge --ff-only FETCH_HEAD
if errorlevel 1 (
  echo ERROR: La copia local no admite una actualizacion segura por fast-forward.
  goto :restore_and_fail
)

if not exist "%PROJECT_DIR%\ACTUALIZAR_SITIO_WINDOWS.cmd" (
  echo ERROR: La copia local no contiene el actualizador esperado.
  echo Envie esta pantalla al administrador.
  goto :restore_and_fail
)

call "%PROJECT_DIR%\ACTUALIZAR_SITIO_WINDOWS.cmd"
set "RESULT=!ERRORLEVEL!"
call :restore_local_changes
if errorlevel 1 set "RESULT=1"
exit /b !RESULT!

:self_test_stash
call :preserve_managed_launcher
if errorlevel 1 goto :failed
call :preserve_local_changes
if errorlevel 1 goto :failed
call :restore_local_changes
if errorlevel 1 goto :failed
if not defined LOCAL_LAUNCHER_BACKUP (
  echo ERROR: La prueba no detecto la modificacion local del instalador.
  goto :failed
)
if not exist "!LOCAL_LAUNCHER_BACKUP!" (
  echo ERROR: La prueba no encontro el respaldo temporal del instalador.
  goto :failed
)
findstr /C:"WINDOWS_SELF_TEST_LAUNCHER_MARKER" "!LOCAL_LAUNCHER_BACKUP!" >nul
if errorlevel 1 (
  echo ERROR: El respaldo del instalador no conserva el contenido local.
  goto :failed
)
findstr /C:"WINDOWS_SELF_TEST_TRACKED_MARKER" "%PROJECT_DIR%\README.md" >nul
if errorlevel 1 (
  echo ERROR: La prueba no restauro el segundo archivo versionado.
  goto :failed
)
echo PRUEBA COMPLETA DE RESPALDO WINDOWS SUPERADA.
echo Respaldo del instalador: !LOCAL_LAUNCHER_BACKUP!
exit /b 0

:preserve_managed_launcher
set "LAUNCHER_CHANGED=0"
git -C "%PROJECT_DIR%" diff --quiet -- INSTALAR_Y_ACTUALIZAR_WINDOWS.cmd
if errorlevel 1 set "LAUNCHER_CHANGED=1"
git -C "%PROJECT_DIR%" diff --cached --quiet -- INSTALAR_Y_ACTUALIZAR_WINDOWS.cmd
if errorlevel 1 set "LAUNCHER_CHANGED=1"
if "!LAUNCHER_CHANGED!"=="0" exit /b 0

if not exist "%PROJECT_DIR%\artifacts" mkdir "%PROJECT_DIR%\artifacts"
set "LOCAL_LAUNCHER_BACKUP=%PROJECT_DIR%\artifacts\INSTALAR_Y_ACTUALIZAR_WINDOWS.local-!RANDOM!-!RANDOM!.cmd"
copy /y "%PROJECT_DIR%\INSTALAR_Y_ACTUALIZAR_WINDOWS.cmd" "!LOCAL_LAUNCHER_BACKUP!" >nul
if errorlevel 1 (
  echo ERROR: No se pudo respaldar el instalador local.
  exit /b 1
)
git -C "%PROJECT_DIR%" restore --source=HEAD --staged --worktree -- INSTALAR_Y_ACTUALIZAR_WINDOWS.cmd
if errorlevel 1 (
  echo ERROR: No se pudo preparar el instalador versionado.
  exit /b 1
)
echo Copia local del instalador preservada en !LOCAL_LAUNCHER_BACKUP!
exit /b 0

:preserve_local_changes
set "HAS_LOCAL_CHANGES=0"
git -C "%PROJECT_DIR%" diff --quiet
if errorlevel 1 set "HAS_LOCAL_CHANGES=1"
git -C "%PROJECT_DIR%" diff --cached --quiet
if errorlevel 1 set "HAS_LOCAL_CHANGES=1"
if "!HAS_LOCAL_CHANGES!"=="0" exit /b 0

echo Se detectaron ediciones locales. Se respaldaran y restauraran al terminar.
git -C "%PROJECT_DIR%" stash push --message "escuela-sabatica-respaldo-automatico"
if errorlevel 1 (
  echo ERROR: No se pudo crear el respaldo local.
  exit /b 1
)
set "LOCAL_STASH="
for /f "usebackq delims=" %%S in (`git -C "%PROJECT_DIR%" stash list -1 --format^=%%gd`) do set "LOCAL_STASH=%%S"
if not defined LOCAL_STASH (
  echo ERROR: Git no informo el respaldo local creado.
  exit /b 1
)
echo Respaldo local creado: !LOCAL_STASH!
exit /b 0

:restore_local_changes
if not defined LOCAL_STASH exit /b 0
echo Restaurando las ediciones locales...
git -C "%PROJECT_DIR%" stash apply --index "!LOCAL_STASH!"
if errorlevel 1 (
  echo AVISO: Git no pudo combinar automaticamente las ediciones locales.
  echo El sitio ya fue actualizado; el respaldo se conserva en !LOCAL_STASH!.
  git -C "%PROJECT_DIR%" reset --merge >nul 2>&1
  exit /b 1
)
git -C "%PROJECT_DIR%" stash drop "!LOCAL_STASH!" >nul
set "LOCAL_STASH="
echo Ediciones locales restauradas.
exit /b 0

:restore_and_fail
call :restore_local_changes
goto :failed

:refresh_path
for /f "usebackq delims=" %%P in (`powershell.exe -NoProfile -Command "[Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')"`) do set "PATH=%%P"
exit /b 0

:failed
if defined LOCAL_LAUNCHER_BACKUP copy /y "!LOCAL_LAUNCHER_BACKUP!" "%PROJECT_DIR%\INSTALAR_Y_ACTUALIZAR_WINDOWS.cmd" >nul
echo.
echo LA INSTALACION SE DETUVO DE FORMA SEGURA.
echo No se sobrescribieron archivos del proyecto.
echo.
pause
exit /b 1
