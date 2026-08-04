#!/bin/sh
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPORT_PATH="$PROJECT_DIR/artifacts/site-maintenance-report.json"

cd "$PROJECT_DIR"
mkdir -p "$PROJECT_DIR/artifacts"

missing=""
for tool in git node npm python3 gh; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    missing="$missing $tool"
  fi
done

if [ -n "$missing" ]; then
  if command -v brew >/dev/null 2>&1; then
    printf 'Instalando requisitos faltantes:%s\n' "$missing"
    for tool in $missing; do
      case "$tool" in
        node|npm) package="node" ;;
        python3) package="python" ;;
        gh) package="gh" ;;
        *) package="$tool" ;;
      esac
      brew list "$package" >/dev/null 2>&1 || brew install "$package"
    done
  else
    printf 'Faltan herramientas:%s. Instala Homebrew o solicita ayuda al administrador.\n' "$missing"
    exit 1
  fi
fi

if ! gh auth status -h github.com >/dev/null 2>&1; then
  printf 'Se abrirá GitHub para autorizar esta computadora. Esto sólo ocurre la primera vez.\n'
  gh auth login -h github.com -p https --web
fi

node scripts/run_python.mjs scripts/site_maintenance.py --report "$REPORT_PATH"

printf '\nProceso finalizado. Informe: %s\n' "$REPORT_PATH"
