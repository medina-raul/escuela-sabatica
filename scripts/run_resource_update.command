#!/bin/sh
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPORT_DIR="$PROJECT_DIR/artifacts"

cd "$PROJECT_DIR"
mkdir -p "$REPORT_DIR"

npm run resources:sync -- --report "$REPORT_DIR/resource-sync-report.json"

printf '\nActualización completada. Informe: %s\n' "$REPORT_DIR/resource-sync-report.json"
