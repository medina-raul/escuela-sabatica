#!/usr/bin/env python3
"""Generate a machine-readable inventory of every cataloged resource and its origin."""

from __future__ import annotations

import argparse
import json
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from resource_lib import (
    DEFAULT_CATALOG,
    PROJECT_ROOT,
    all_resources,
    atomic_write_json,
    first_friday_invitation,
    load_catalog,
    local_path_for_url,
    sha256_path,
)


DEFAULT_OUTPUT = PROJECT_ROOT / "artifacts/resource-status.json"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", type=Path, default=DEFAULT_CATALOG)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--stdout", action="store_true", help="Imprime el inventario JSON completo")
    return parser.parse_args()


def _origin(resource: dict[str, Any]) -> tuple[str, str | None]:
    source = resource.get("source", {})
    if source.get("kind") == "manual":
        provider = source.get("provider") or "Carga manual"
        detail = source.get("providerUrl") or source.get("credit")
        return provider, detail
    source_url = source.get("url") or resource.get("url")
    host = urllib.parse.urlparse(source_url or "").hostname or "Fuente remota"
    provider = source.get("provider")
    if not provider:
        provider = {
            "www.audioescuelasabatica.com": "Audio Escuela Sabática",
            "www.fustero.es": "Fustero",
            "raw.githubusercontent.com": "Adventech (GitHub)",
        }.get(host, host)
    return provider, source_url


def build_status(catalog: dict[str, Any]) -> dict[str, Any]:
    lessons = {lesson.get("number"): lesson for lesson in catalog.get("lessons", [])}
    records: list[dict[str, Any]] = []
    for resource in sorted(
        all_resources(catalog),
        key=lambda item: (
            item.get("type", ""),
            item.get("role", ""),
            item.get("lessonNumber") or 0,
            item.get("dayId") or "",
            item.get("id", ""),
        ),
    ):
        origin, origin_detail = _origin(resource)
        status = "Catalogado"
        checksum_ok: bool | None = None
        if resource.get("storage") == "local":
            path = local_path_for_url(resource["url"])
            if path.is_file():
                checksum_ok = not resource.get("checksum") or sha256_path(path) == resource.get("checksum")
                status = "Disponible · local validado" if checksum_ok else "Requiere atención · checksum"
            else:
                checksum_ok = False
                status = "Requiere atención · archivo ausente"
        elif resource.get("storage") == "external":
            status = "Disponible · enlace externo catalogado"

        friday_linked: bool | None = None
        if resource.get("role") == "friday-reading":
            lesson = lessons.get(resource.get("lessonNumber"), {})
            friday = next((day for day in lesson.get("days", []) if day.get("id") == "viernes"), None)
            invitation = first_friday_invitation((friday or {}).get("contentMarkdown", ""))
            friday_linked = bool(invitation and invitation.lower().startswith("lee"))

        records.append(
            {
                "id": resource.get("id"),
                "title": resource.get("title"),
                "type": resource.get("type"),
                "role": resource.get("role"),
                "lessonNumber": resource.get("lessonNumber"),
                "dayId": resource.get("dayId"),
                "storage": resource.get("storage"),
                "url": resource.get("url"),
                "origin": origin,
                "originDetail": origin_detail,
                "sourceKind": resource.get("source", {}).get("kind"),
                "status": status,
                "checksumOk": checksum_ok,
                "fridayInvitationLinked": friday_linked,
            }
        )

    return {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "quarterId": catalog.get("id"),
        "resourceCount": len(records),
        "summary": {
            "local": sum(record["storage"] == "local" for record in records),
            "external": sum(record["storage"] == "external" for record in records),
            "manualOrigin": sum(record["sourceKind"] == "manual" for record in records),
            "remoteOrigin": sum(record["sourceKind"] == "url" for record in records),
            "requiresAttention": sum(record["status"].startswith("Requiere atención") for record in records),
            "fridayLinked": sum(record["fridayInvitationLinked"] is True for record in records),
        },
        "resources": records,
    }


def main() -> int:
    args = parse_args()
    report = build_status(load_catalog(args.catalog.resolve()))
    output_path = args.output.resolve()
    atomic_write_json(output_path, report)
    if args.stdout:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print(json.dumps(report["summary"], ensure_ascii=False, indent=2))
        print(f"Inventario: {output_path}")
    return 1 if report["summary"]["requiresAttention"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
