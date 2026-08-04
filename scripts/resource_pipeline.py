#!/usr/bin/env python3
"""Run the complete, agent-neutral resource maintenance pipeline."""

from __future__ import annotations

import argparse
import json
import platform
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from resource_lib import (
    DEFAULT_CATALOG,
    DEFAULT_MANIFEST,
    PROJECT_ROOT,
    ResourceError,
    atomic_write_json,
    load_catalog,
)


DEFAULT_REPORT = PROJECT_ROOT / "artifacts/resource-sync-report.json"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--apply", action="store_true", help="Apply safe changes (default)")
    mode.add_argument("--plan", action="store_true", help="Only calculate changes")
    parser.add_argument("--offline", action="store_true", help="Skip remote sources")
    parser.add_argument("--skip-build", action="store_true")
    parser.add_argument("--no-install", action="store_true", help="Do not run npm ci when dependencies are missing")
    parser.add_argument("--catalog", type=Path, default=DEFAULT_CATALOG)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT)
    return parser.parse_args()


def _doctor(catalog_path: Path) -> dict[str, Any]:
    errors: list[str] = []
    if sys.version_info < (3, 10):
        errors.append("Se requiere Python 3.10 o superior")
    npm = shutil.which("npm")
    if npm is None:
        errors.append("No se encontró npm en PATH")
    if not (PROJECT_ROOT / "package.json").is_file():
        errors.append("Falta package.json en la raíz del proyecto")
    if not catalog_path.is_file():
        errors.append(f"No existe el catálogo activo: {catalog_path}")
    else:
        try:
            catalog = load_catalog(catalog_path)
            if not catalog.get("resourceAutomation", {}).get("canonicalLayout"):
                errors.append("El catálogo activo no define resourceAutomation.canonicalLayout")
        except (OSError, json.JSONDecodeError, ResourceError) as exc:
            errors.append(f"No se pudo leer el catálogo activo: {exc}")
    project_root = PROJECT_ROOT.resolve()
    return {
        "platform": platform.platform(),
        "python": platform.python_version(),
        "npm": npm,
        "catalog": str(catalog_path.relative_to(project_root)) if project_root in catalog_path.parents else str(catalog_path),
        "errors": errors,
    }


def _run(command: list[str]) -> tuple[int, str]:
    print("\n> " + " ".join(command), flush=True)
    completed = subprocess.run(
        command,
        cwd=PROJECT_ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        check=False,
    )
    output = completed.stdout or ""
    if output:
        print(output, end="" if output.endswith("\n") else "\n", flush=True)
    return completed.returncode, output


def _read_report(path: Path) -> dict[str, Any]:
    if not path.is_file():
        return {"errors": [f"El paso no generó su informe: {path}"]}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        return {"errors": [f"Informe JSON inválido {path}: {exc}"]}


def main() -> int:
    args = parse_args()
    apply = not args.plan
    catalog_path = args.catalog.resolve()
    manifest_path = args.manifest.resolve()
    report_path = args.report.resolve()
    report_path.parent.mkdir(parents=True, exist_ok=True)
    doctor = _doctor(catalog_path)
    steps: list[dict[str, Any]] = []
    errors = list(doctor["errors"])
    changed = False
    tasks: list[dict[str, Any]] = []

    step_specs = [
        ("restructure", PROJECT_ROOT / "scripts/restructure_resources.py"),
        ("manual-import", PROJECT_ROOT / "scripts/import_manual_resources.py"),
        ("remote-update", PROJECT_ROOT / "scripts/update_resources.py"),
    ]
    if not errors:
        for name, script in step_specs:
            step_report_path = report_path.parent / f"{name}-report.json"
            command = [
                sys.executable,
                str(script),
                "--catalog",
                str(catalog_path),
                "--manifest",
                str(manifest_path),
                "--report",
                str(step_report_path),
            ]
            if apply:
                command.append("--apply")
            if name == "remote-update" and args.offline:
                command.append("--offline")
            returncode, _output = _run(command)
            step_report = _read_report(step_report_path)
            step_errors = list(step_report.get("errors", []))
            if returncode and not step_errors:
                step_errors.append(f"{name} terminó con código {returncode}")
            steps.append({"name": name, "returnCode": returncode, "report": step_report})
            changed = changed or bool(step_report.get("changed"))
            if name == "remote-update":
                tasks.extend(step_report.get("tasks", step_report.get("teacherTranslationTasks", [])))
            if step_errors:
                errors.extend(f"{name}: {error}" for error in step_errors)
                break

    npm = doctor.get("npm")
    if apply and not errors:
        if not args.skip_build and not (PROJECT_ROOT / "node_modules").is_dir() and not args.no_install:
            returncode, _output = _run([str(npm), "ci"])
            steps.append({"name": "dependencies", "returnCode": returncode})
            if returncode:
                errors.append(f"dependencies terminó con código {returncode}")
        if not errors:
            audit_command = [
                sys.executable,
                str(PROJECT_ROOT / "scripts/audit_resources.py"),
                "--catalog",
                str(catalog_path),
                "--manifest",
                str(manifest_path),
                "--write-manifest",
            ]
            returncode, _output = _run(audit_command)
            steps.append({"name": "audit", "returnCode": returncode})
            if returncode:
                errors.append(f"audit terminó con código {returncode}")
        if not errors:
            status_path = report_path.parent / "resource-status.json"
            status_command = [
                sys.executable,
                str(PROJECT_ROOT / "scripts/resource_status.py"),
                "--catalog",
                str(catalog_path),
                "--output",
                str(status_path),
            ]
            returncode, _output = _run(status_command)
            steps.append({"name": "status", "returnCode": returncode, "output": str(status_path)})
            if returncode:
                errors.append(f"status terminó con código {returncode}")
        if not errors and not args.skip_build:
            returncode, _output = _run([str(npm), "run", "build"])
            steps.append({"name": "build", "returnCode": returncode})
            if returncode:
                errors.append(f"build terminó con código {returncode}")

    report = {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "mode": "apply" if apply else "plan",
        "offline": args.offline,
        "doctor": doctor,
        "changed": changed,
        "requiresReview": bool(tasks),
        "tasks": tasks,
        "steps": steps,
        "errors": errors,
    }
    atomic_write_json(report_path, report)
    print("\n" + json.dumps(report, ensure_ascii=False, indent=2))
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
