#!/usr/bin/env python3
"""Move local resources into the catalog-defined canonical layout safely."""

from __future__ import annotations

import argparse
import json
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from resource_lib import (
    DEFAULT_CATALOG,
    DEFAULT_MANIFEST,
    PROJECT_ROOT,
    ResourceError,
    all_resources,
    atomic_write_json,
    audit_catalog,
    canonical_url_for_resource,
    load_catalog,
    local_path_for_url,
    project_path,
    sha256_path,
    validate_file,
    write_manifest,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", type=Path, default=DEFAULT_CATALOG)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--report", type=Path)
    return parser.parse_args()


def _relative_project(path: Path) -> str:
    return str(path.resolve().relative_to(PROJECT_ROOT.resolve()))


def _candidate_files(catalog: dict[str, Any], resource: dict[str, Any], target: Path) -> list[Path]:
    layout = catalog.get("resourceAutomation", {}).get("canonicalLayout", {})
    filename = target.name
    expected_checksum = resource.get("checksum")
    candidates: set[Path] = set()
    for configured_root in layout.get("legacySearchRoots", []):
        root = project_path(configured_root)
        if not root.is_dir():
            continue
        for candidate in root.rglob(filename):
            resolved = candidate.resolve()
            if resolved == target.resolve() or not resolved.is_file():
                continue
            if any(part in {".git", "node_modules", "dist", "artifacts", "resource-inbox"} for part in resolved.parts):
                continue
            try:
                validate_file(resolved, resource["type"])
            except ResourceError:
                continue
            if expected_checksum and sha256_path(resolved) != expected_checksum:
                continue
            candidates.add(resolved)
    return sorted(candidates)


def build_plan(catalog: dict[str, Any]) -> tuple[list[dict[str, Any]], list[str]]:
    operations: list[dict[str, Any]] = []
    errors: list[str] = []
    default_max = catalog.get("resourceAutomation", {}).get("maxDownloadBytes")
    for resource in all_resources(catalog):
        if resource.get("storage") != "local":
            continue
        try:
            canonical_url = canonical_url_for_resource(catalog, resource)
            current = local_path_for_url(resource.get("url", ""))
            target = local_path_for_url(canonical_url)
            if resource.get("url") == canonical_url and target.is_file():
                continue
            max_bytes = resource.get("source", {}).get("maxBytes") or default_max
            source: Path | None = current if current.is_file() else None
            if source is None and not target.is_file():
                candidates = _candidate_files(catalog, resource, target)
                if len(candidates) == 1:
                    source = candidates[0]
                elif not candidates:
                    raise ResourceError(f"No se encontró el archivo de {resource['id']}")
                else:
                    names = ", ".join(_relative_project(path) for path in candidates)
                    raise ResourceError(f"Ubicación ambigua para {resource['id']}: {names}")

            if source is not None:
                validate_file(source, resource["type"], max_bytes)
            if target.is_file():
                validate_file(target, resource["type"], max_bytes)
                if resource.get("checksum") and sha256_path(target) != resource["checksum"]:
                    raise ResourceError(f"El destino canónico tiene otro contenido: {canonical_url}")
                if source is not None and sha256_path(source) != sha256_path(target):
                    raise ResourceError(f"Origen y destino difieren para {resource['id']}")
            elif source is None:
                raise ResourceError(f"No hay contenido para crear {canonical_url}")
            elif resource.get("checksum") and sha256_path(source) != resource["checksum"]:
                raise ResourceError(f"El archivo legado no coincide con el checksum de {resource['id']}")

            operations.append(
                {
                    "resource": resource,
                    "resourceId": resource["id"],
                    "from": source,
                    "to": target,
                    "oldUrl": resource.get("url"),
                    "newUrl": canonical_url,
                }
            )
        except (ResourceError, KeyError) as exc:
            errors.append(str(exc))
    return operations, errors


def _restore_file(path: Path, payload: bytes | None) -> None:
    if payload is None:
        path.unlink(missing_ok=True)
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".restore", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_name, path)
    except Exception:
        Path(temp_name).unlink(missing_ok=True)
        raise


def apply_plan(
    catalog: dict[str, Any],
    catalog_path: Path,
    manifest_path: Path,
    operations: list[dict[str, Any]],
) -> None:
    original_catalog = catalog_path.read_bytes()
    original_manifest = manifest_path.read_bytes() if manifest_path.exists() else None
    original_files: dict[Path, bytes | None] = {}
    try:
        for operation in operations:
            source: Path | None = operation["from"]
            target: Path = operation["to"]
            for path in {path for path in (source, target) if path is not None}:
                if path not in original_files:
                    original_files[path] = path.read_bytes() if path.exists() else None
            target.parent.mkdir(parents=True, exist_ok=True)
            if not target.exists():
                assert source is not None
                os.replace(source, target)
            elif source is not None and source != target:
                source.unlink()
            resource = operation["resource"]
            resource["url"] = operation["newUrl"]
            resource["checksum"] = sha256_path(target)
            resource["sizeBytes"] = target.stat().st_size

        atomic_write_json(catalog_path, catalog)
        write_manifest(catalog, manifest_path)
        errors = [issue.message for issue in audit_catalog(catalog) if issue.level == "error"]
        if errors:
            raise ResourceError("La auditoría posterior falló: " + "; ".join(errors))
    except Exception:
        for path, payload in original_files.items():
            _restore_file(path, payload)
        _restore_file(catalog_path, original_catalog)
        _restore_file(manifest_path, original_manifest)
        raise


def main() -> int:
    args = parse_args()
    catalog_path = args.catalog.resolve()
    manifest_path = args.manifest.resolve()
    catalog = load_catalog(catalog_path)
    operations, errors = build_plan(catalog)
    if args.apply and operations and not errors:
        try:
            apply_plan(catalog, catalog_path, manifest_path, operations)
        except (OSError, ResourceError) as exc:
            errors.append(str(exc))
    report = {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "mode": "apply" if args.apply else "plan",
        "changed": bool(operations),
        "operations": [
            {
                "resourceId": operation["resourceId"],
                "from": _relative_project(operation["from"]) if operation["from"] else None,
                "to": _relative_project(operation["to"]),
                "oldUrl": operation["oldUrl"],
                "newUrl": operation["newUrl"],
            }
            for operation in operations
        ],
        "errors": errors,
    }
    if args.report:
        atomic_write_json(args.report.resolve(), report)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
