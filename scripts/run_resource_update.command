#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPORT_DIR="$PROJECT_DIR/artifacts"

cd "$PROJECT_DIR"
mkdir -p "$REPORT_DIR"

npm run resources:update -- --report "$REPORT_DIR/resource-update-report.json"
npm run resources:audit
npm run build

printf '\nActualización completada. Informe: %s\n' "$REPORT_DIR/resource-update-report.json"
