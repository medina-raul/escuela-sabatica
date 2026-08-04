#!/bin/sh
set -u

OFFICIAL_REPO="https://github.com/medina-raul/escuela-sabatica.git"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEFAULT_DIR="$HOME/EscuelaSabaticaCL"

if [ -d "$SCRIPT_DIR/.git" ]; then
  PROJECT_DIR="$SCRIPT_DIR"
elif [ -d "$DEFAULT_DIR/.git" ]; then
  PROJECT_DIR="$DEFAULT_DIR"
else
  PROJECT_DIR="$DEFAULT_DIR"
fi

printf '%s\n' '================================================================'
printf '%s\n' '  ESCUELA SABÁTICA CL - INSTALACIÓN Y ACTUALIZACIÓN'
printf '%s\n' '================================================================'
printf 'Carpeta administrada: %s\n\n' "$PROJECT_DIR"

if ! command -v git >/dev/null 2>&1; then
  if command -v brew >/dev/null 2>&1; then
    printf '%s\n' 'Instalando Git por única vez...'
    brew install git || exit 1
  else
    printf '%s\n' 'Falta Git. Instala las herramientas de desarrollo de Apple o solicita ayuda al administrador.'
    printf '\nPresiona Enter para cerrar...'
    read -r _answer
    exit 1
  fi
fi

if [ ! -d "$PROJECT_DIR/.git" ]; then
  printf '%s\n' 'Descargando el repositorio oficial por primera vez...'
  if ! git clone "$OFFICIAL_REPO" "$PROJECT_DIR"; then
    printf '%s\n' 'La instalación se detuvo de forma segura. No se sobrescribieron archivos.'
    printf '\nPresiona Enter para cerrar...'
    read -r _answer
    exit 1
  fi
fi

CURRENT_BRANCH="$(git -C "$PROJECT_DIR" branch --show-current)"
if [ "$CURRENT_BRANCH" != "main" ]; then
  printf 'La copia local está en la rama %s; el instalador sólo actualiza main.\n' "$CURRENT_BRANCH"
  printf '\nPresiona Enter para cerrar...'
  read -r _answer
  exit 1
fi

if ! git -C "$PROJECT_DIR" diff --quiet || ! git -C "$PROJECT_DIR" diff --cached --quiet; then
  printf '%s\n' 'Hay cambios locales versionados. No se modificó nada.'
  printf '\nPresiona Enter para cerrar...'
  read -r _answer
  exit 1
fi

printf '%s\n' 'Comprobando la versión más reciente del instalador...'
if ! git -C "$PROJECT_DIR" fetch "$OFFICIAL_REPO" main || \
   ! git -C "$PROJECT_DIR" merge --ff-only FETCH_HEAD; then
  printf '%s\n' 'La copia local no admite una actualización segura por fast-forward.'
  printf '\nPresiona Enter para cerrar...'
  read -r _answer
  exit 1
fi

if [ ! -f "$PROJECT_DIR/ACTUALIZAR_SITIO_MAC.command" ]; then
  printf '%s\n' 'La copia local no contiene el actualizador esperado. Contacta al administrador.'
  printf '\nPresiona Enter para cerrar...'
  read -r _answer
  exit 1
fi

chmod +x "$PROJECT_DIR/ACTUALIZAR_SITIO_MAC.command" "$PROJECT_DIR/scripts/run_resource_update.command"
exec "$PROJECT_DIR/ACTUALIZAR_SITIO_MAC.command"
