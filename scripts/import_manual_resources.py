#!/usr/bin/env python3
"""Import validated manual files from a portable, project-local inbox."""

from __future__ import annotations

import argparse
import copy
import json
import os
import re
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


ID_RE = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")
DESCRIPTOR_FIELDS = {
    "id",
    "type",
    "role",
    "title",
    "description",
    "lessonNumber",
    "dayId",
    "provider",
    "providerUrl",
    "credit",
}


def _relative_project(path: Path) -> str:
    return str(path.resolve().relative_to(PROJECT_ROOT.resolve()))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", type=Path, default=DEFAULT_CATALOG)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--report", type=Path)
    return parser.parse_args()


def _load_descriptor(path: Path) -> dict[str, Any]:
    try:
        descriptor = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ResourceError(f"Descriptor JSON inválido: {path}") from exc
    if not isinstance(descriptor, dict):
        raise ResourceError(f"El descriptor debe ser un objeto JSON: {path}")
    unknown = set(descriptor) - DESCRIPTOR_FIELDS
    if unknown:
        raise ResourceError(f"Campos no admitidos en {path.name}: {', '.join(sorted(unknown))}")
    required = {"id", "type", "role", "title"}
    missing = required - set(descriptor)
    if missing:
        raise ResourceError(f"Faltan campos en {path.name}: {', '.join(sorted(missing))}")
    if not ID_RE.fullmatch(str(descriptor["id"])):
        raise ResourceError(f"ID manual inválido en {path.name}: {descriptor['id']!r}")
    return descriptor


def _new_resource(catalog: dict[str, Any], descriptor: dict[str, Any], target_url: str, inbox_path: str) -> dict[str, Any]:
    source: dict[str, Any] = {"kind": "manual", "inboxPath": inbox_path}
    for field in ("provider", "providerUrl", "credit"):
        if descriptor.get(field):
            source[field] = descriptor[field]
    resource = {
        key: copy.deepcopy(value)
        for key, value in descriptor.items()
        if key not in {"provider", "providerUrl", "credit"}
    }
    resource.update({"url": target_url, "storage": "local", "source": source})
    if canonical_url_for_resource(catalog, resource) != target_url:
        raise ResourceError(f"El archivo manual no sigue la ruta canónica de su rol: {target_url}")
    return resource


def build_plan(catalog: dict[str, Any]) -> tuple[list[dict[str, Any]], list[str], Path]:
    config = catalog.get("resourceAutomation", {}).get("manualInbox")
    if not config:
        return [], [], PROJECT_ROOT / "resource-inbox" / str(catalog.get("id", "unknown"))
    inbox_root = project_path(config["path"])
    quarter_inbox = (inbox_root / str(catalog["id"])).resolve()
    if inbox_root.resolve() not in quarter_inbox.parents:
        raise ResourceError("El trimestre de la bandeja manual intenta salir de la ruta configurada")
    if not quarter_inbox.exists():
        return [], [], quarter_inbox

    suffix = config.get("descriptorSuffix", ".resource.json")
    resources = all_resources(catalog)
    by_url = {resource.get("url"): resource for resource in resources}
    by_id = {resource.get("id"): resource for resource in resources}
    audio_by_slot = {
        (resource.get("lessonNumber"), resource.get("dayId")): resource
        for resource in resources
        if resource.get("role") == "daily-audio"
    }
    default_max = catalog.get("resourceAutomation", {}).get("maxDownloadBytes")
    operations: list[dict[str, Any]] = []
    errors: list[str] = []

    for payload in sorted(path for path in quarter_inbox.rglob("*") if path.is_file()):
        if payload.name.endswith(suffix) or payload.name in {"README.md", ".DS_Store"}:
            continue
        try:
            resolved_payload = payload.resolve()
            if quarter_inbox not in resolved_payload.parents or payload.is_symlink():
                raise ResourceError(f"No se permiten enlaces ni rutas externas en la bandeja: {payload}")
            relative = payload.relative_to(quarter_inbox)
            target_url = f"/recursos/{catalog['id']}/{relative.as_posix()}"
            target = local_path_for_url(target_url)
            existing = by_url.get(target_url)
            descriptor_path = Path(str(payload) + suffix)
            descriptor = _load_descriptor(descriptor_path) if descriptor_path.is_file() else None

            if existing is None:
                if config.get("requireDescriptorForNew", True) and descriptor is None:
                    raise ResourceError(f"Recurso nuevo sin descriptor {descriptor_path.name}")
                assert descriptor is not None
                if descriptor["id"] in by_id:
                    raise ResourceError(f"ID manual duplicado: {descriptor['id']}")
                resource = _new_resource(
                    catalog,
                    descriptor,
                    target_url,
                    _relative_project(payload),
                )
                if resource.get("role") == "daily-audio":
                    slot = (resource.get("lessonNumber"), resource.get("dayId"))
                    if slot in audio_by_slot:
                        raise ResourceError(
                            f"Ya existe un audio para la lección {slot[0]} y el día {slot[1]}: "
                            f"{audio_by_slot[slot]['id']}"
                        )
                    audio_by_slot[slot] = resource
                by_id[resource["id"]] = resource
                by_url[target_url] = resource
                is_new = True
            else:
                if existing.get("storage") != "local" or existing.get("source", {}).get("kind") != "manual":
                    raise ResourceError(f"La bandeja no puede reemplazar la fuente remota de {existing['id']}")
                if descriptor and descriptor.get("id") != existing.get("id"):
                    raise ResourceError(f"El descriptor no corresponde a {existing['id']}: {descriptor_path.name}")
                resource = existing
                is_new = False

            max_bytes = resource.get("source", {}).get("maxBytes") or default_max
            validate_file(payload, resource["type"], max_bytes)
            payload_checksum = sha256_path(payload)
            inbox_path = _relative_project(payload)
            target_current = sha256_path(target) if target.is_file() else None
            metadata_changed = resource.get("source", {}).get("inboxPath") != inbox_path
            if not is_new and payload_checksum == target_current and not metadata_changed:
                continue
            operations.append(
                {
                    "resource": resource,
                    "resourceId": resource["id"],
                    "payload": payload,
                    "target": target,
                    "targetUrl": target_url,
                    "checksum": payload_checksum,
                    "size": payload.stat().st_size,
                    "inboxPath": inbox_path,
                    "isNew": is_new,
                    "contentChanged": payload_checksum != target_current,
                }
            )
        except (KeyError, OSError, ResourceError) as exc:
            errors.append(str(exc))
    return operations, errors, quarter_inbox


def _atomic_restore(path: Path, payload: bytes | None) -> None:
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
    original_targets: dict[Path, bytes | None] = {}
    try:
        for operation in operations:
            target: Path = operation["target"]
            if target not in original_targets:
                original_targets[target] = target.read_bytes() if target.exists() else None
            if operation["contentChanged"]:
                target.parent.mkdir(parents=True, exist_ok=True)
                fd, staged_name = tempfile.mkstemp(prefix=f".{target.name}.", suffix=".manual", dir=target.parent)
                try:
                    with os.fdopen(fd, "wb") as handle:
                        with operation["payload"].open("rb") as source:
                            for chunk in iter(lambda: source.read(1024 * 1024), b""):
                                handle.write(chunk)
                        handle.flush()
                        os.fsync(handle.fileno())
                    os.replace(staged_name, target)
                except Exception:
                    Path(staged_name).unlink(missing_ok=True)
                    raise

            resource = operation["resource"]
            if operation["isNew"]:
                catalog.setdefault("resources", []).append(resource)
            resource["url"] = operation["targetUrl"]
            resource["checksum"] = operation["checksum"]
            resource["sizeBytes"] = operation["size"]
            resource.setdefault("source", {})["inboxPath"] = operation["inboxPath"]
            resource["source"]["lastImportedChecksum"] = operation["checksum"]
            if resource.get("role") == "daily-audio":
                lesson = next(
                    (item for item in catalog.get("lessons", []) if item.get("number") == resource.get("lessonNumber")),
                    None,
                )
                day = next(
                    (item for item in (lesson or {}).get("days", []) if item.get("id") == resource.get("dayId")),
                    None,
                )
                if day is None:
                    raise ResourceError(f"No existe el día de destino para {resource['id']}")
                day["audio"] = {
                    "title": resource["title"],
                    "url": resource["url"],
                    "duration": "",
                    "narrator": resource.get("source", {}).get("provider", "Recurso local"),
                }

        atomic_write_json(catalog_path, catalog)
        write_manifest(catalog, manifest_path)
        errors = [issue.message for issue in audit_catalog(catalog) if issue.level == "error"]
        if errors:
            raise ResourceError("La auditoría posterior falló: " + "; ".join(errors))
    except Exception:
        for target, payload in original_targets.items():
            _atomic_restore(target, payload)
        _atomic_restore(catalog_path, original_catalog)
        _atomic_restore(manifest_path, original_manifest)
        raise


def main() -> int:
    args = parse_args()
    catalog_path = args.catalog.resolve()
    manifest_path = args.manifest.resolve()
    catalog = load_catalog(catalog_path)
    try:
        operations, errors, inbox = build_plan(catalog)
    except ResourceError as exc:
        operations, errors = [], [str(exc)]
        inbox = PROJECT_ROOT / "resource-inbox"
    if args.apply and operations and not errors:
        try:
            apply_plan(catalog, catalog_path, manifest_path, operations)
        except (OSError, ResourceError) as exc:
            errors.append(str(exc))
    report = {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "mode": "apply" if args.apply else "plan",
        "inbox": _relative_project(inbox),
        "changed": bool(operations),
        "operations": [
            {
                "resourceId": operation["resourceId"],
                "source": operation["inboxPath"],
                "target": operation["targetUrl"],
                "newResource": operation["isNew"],
                "contentChanged": operation["contentChanged"],
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
