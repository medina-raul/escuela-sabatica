#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPORT_DIR="$PROJECT_DIR/artifacts"

cd "$PROJECT_DIR"
mkdir -p "$REPORT_DIR"

python3 scripts/update_resources.py --apply --report "$REPORT_DIR/resource-update-report.json"
python3 scripts/audit_resources.py --write-manifest
npm run build

printf '\nActualización completada. Informe: %s\n' "$REPORT_DIR/resource-update-report.json"
