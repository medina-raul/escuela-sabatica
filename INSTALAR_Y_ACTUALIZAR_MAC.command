#!/bin/sh
set -u

OFFICIAL_REPO="https://github.com/medina-raul/escuela-sabatica.git"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEFAULT_DIR="$HOME/EscuelaSabaticaCL"
LOCAL_STASH=""

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

preserve_local_changes() {
  if git -C "$PROJECT_DIR" diff --quiet && git -C "$PROJECT_DIR" diff --cached --quiet; then
    return 0
  fi
  printf '%s\n' 'Se detectaron ediciones locales. Se respaldarán y restaurarán al terminar.'
  if ! git -C "$PROJECT_DIR" stash push --message "escuela-sabatica-respaldo-automatico"; then
    printf '%s\n' 'No se pudo crear el respaldo local.'
    return 1
  fi
  LOCAL_STASH="$(git -C "$PROJECT_DIR" stash list -1 --format=%gd)"
  if [ -z "$LOCAL_STASH" ]; then
    printf '%s\n' 'Git no informó el respaldo local creado.'
    return 1
  fi
  printf 'Respaldo local creado: %s\n' "$LOCAL_STASH"
}

restore_local_changes() {
  if [ -z "$LOCAL_STASH" ]; then
    return 0
  fi
  printf '%s\n' 'Restaurando las ediciones locales...'
  if git -C "$PROJECT_DIR" stash apply --index "$LOCAL_STASH"; then
    git -C "$PROJECT_DIR" stash drop "$LOCAL_STASH" >/dev/null
    LOCAL_STASH=""
    printf '%s\n' 'Ediciones locales restauradas.'
    return 0
  fi
  printf '%s\n' 'AVISO: Git no pudo combinar automáticamente las ediciones locales.'
  printf 'El sitio ya fue actualizado; el respaldo se conserva en %s.\n' "$LOCAL_STASH"
  git -C "$PROJECT_DIR" reset --merge >/dev/null 2>&1 || true
  return 1
}

if ! preserve_local_changes; then
  printf '\nPresiona Enter para cerrar...'
  read -r _answer
  exit 1
fi

printf '%s\n' 'Comprobando la versión más reciente del instalador...'
if ! git -C "$PROJECT_DIR" fetch "$OFFICIAL_REPO" main || \
   ! git -C "$PROJECT_DIR" merge --ff-only FETCH_HEAD; then
  restore_local_changes || true
  printf '%s\n' 'La copia local no admite una actualización segura por fast-forward.'
  printf '\nPresiona Enter para cerrar...'
  read -r _answer
  exit 1
fi

if [ ! -f "$PROJECT_DIR/ACTUALIZAR_SITIO_MAC.command" ]; then
  restore_local_changes || true
  printf '%s\n' 'La copia local no contiene el actualizador esperado. Contacta al administrador.'
  printf '\nPresiona Enter para cerrar...'
  read -r _answer
  exit 1
fi

chmod +x "$PROJECT_DIR/ACTUALIZAR_SITIO_MAC.command" "$PROJECT_DIR/scripts/run_resource_update.command"
"$PROJECT_DIR/ACTUALIZAR_SITIO_MAC.command"
RESULT=$?
if ! restore_local_changes; then
  RESULT=1
fi
exit "$RESULT"
