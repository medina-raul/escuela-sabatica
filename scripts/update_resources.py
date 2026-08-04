#!/usr/bin/env python3
"""Discover, validate, and atomically update the quarter resource catalog."""

from __future__ import annotations

import argparse
import concurrent.futures
import copy
import json
import os
import re
import shutil
import sys
import tempfile
import urllib.parse
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
    download_to,
    fetch_text,
    fetch_html_links,
    issue_dicts,
    load_catalog,
    local_path_for_url,
    metadata_to_source,
    probe_url,
    refresh_local_metadata,
    sha256_path,
    validate_source_url,
    write_manifest,
)
from teacher_readings import validate_teacher_markdown


DAY_NAMES = {
    "sabado": "Sábado",
    "domingo": "Domingo",
    "lunes": "Lunes",
    "martes": "Martes",
    "miercoles": "Miércoles",
    "jueves": "Jueves",
    "viernes": "Viernes",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", type=Path, default=DEFAULT_CATALOG)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--apply", action="store_true", help="Apply changes; otherwise run as dry-run")
    parser.add_argument("--offline", action="store_true", help="Skip all network checks")
    parser.add_argument("--timeout", type=float, default=20.0)
    parser.add_argument("--report", type=Path)
    return parser.parse_args()


def _resource_index(catalog: dict[str, Any]) -> dict[tuple[int, str], dict[str, Any]]:
    return {
        (resource["lessonNumber"], resource["dayId"]): resource
        for resource in all_resources(catalog)
        if resource.get("role") == "daily-audio"
    }


def _discover_audio(
    catalog: dict[str, Any],
    *,
    allowed_hosts: set[str],
    timeout: float,
    changes: list[str],
    warnings: list[str],
) -> None:
    config = catalog.get("resourceAutomation", {}).get("audioDiscovery")
    if not config:
        return
    lessons = {lesson["number"]: lesson for lesson in catalog.get("lessons", [])}
    by_slot = _resource_index(catalog)

    candidates: list[dict[str, Any]] = []
    for lesson_number in range(config["lessonStart"], config["lessonEnd"] + 1):
        lesson = lessons.get(lesson_number)
        if not lesson:
            warnings.append(f"No existe la lección {lesson_number} solicitada por audioDiscovery")
            continue
        days = {day["id"]: day for day in lesson.get("days", [])}
        for day_id, token in config["dayTokens"].items():
            day = days.get(day_id)
            if not day:
                warnings.append(f"No existe el día {day_id} en la lección {lesson_number}")
                continue
            url = config["urlTemplate"].format(lesson=lesson_number, day=token)
            existing = by_slot.get((lesson_number, day_id))
            candidates.append(
                {
                    "lesson": lesson,
                    "lessonNumber": lesson_number,
                    "day": day,
                    "dayId": day_id,
                    "url": url,
                    "existing": existing,
                }
            )

    def probe(candidate: dict[str, Any]) -> tuple[dict[str, Any], Any, str | None]:
        try:
            metadata = probe_url(
                candidate["url"],
                allowed_hosts=allowed_hosts,
                allowed_content_types=config.get("allowedContentTypes"),
                max_bytes=config["maxBytes"],
                timeout=timeout,
                missing_ok=candidate["existing"] is None,
            )
            return candidate, metadata, None
        except ResourceError as exc:
            message = str(exc)
            if "certificate has expired" in message.lower():
                return candidate, None, message
            raise

    results: list[tuple[dict[str, Any], Any, str | None]] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
        futures = [executor.submit(probe, candidate) for candidate in candidates]
        for future in concurrent.futures.as_completed(futures):
            results.append(future.result())

    for candidate, metadata, probe_warning in sorted(
        results,
        key=lambda result: (result[0]["lessonNumber"], result[0]["dayId"]),
    ):
        lesson = candidate["lesson"]
        lesson_number = candidate["lessonNumber"]
        day = candidate["day"]
        day_id = candidate["dayId"]
        url = candidate["url"]
        existing = candidate["existing"]
        if probe_warning:
            warnings.append(
                "Fuente de audio omitida temporalmente por certificado vencido "
                f"(lección {lesson_number}, {DAY_NAMES.get(day_id, day_id.title())}): "
                f"{url}"
            )
            continue
        if metadata is None:
            continue

        if existing is None:
            resource = {
                "id": f"audio-{lesson_number:02d}-{day_id}",
                "type": "audio",
                "role": "daily-audio",
                "lessonNumber": lesson_number,
                "dayId": day_id,
                "title": f"Lección {lesson_number} — {DAY_NAMES.get(day_id, day_id.title())}",
                "description": "Audio resumen · Audio Escuela Sabática",
                "url": url,
                "external": True,
                "storage": "external",
                "source": {
                    "kind": "url",
                    "url": url,
                    "allowedContentTypes": config.get("allowedContentTypes", []),
                    "maxBytes": config["maxBytes"],
                },
            }
            if metadata.content_length is not None:
                resource["sizeBytes"] = metadata.content_length
            metadata_to_source(resource["source"], metadata)
            lesson.setdefault("resources", []).append(resource)
            day["audio"] = {
                "title": resource["title"],
                "url": url,
                "duration": "",
                "narrator": "Audio Escuela Sabática",
            }
            by_slot[(lesson_number, day_id)] = resource
            changes.append(f"audio-discovered:{resource['id']}")
            continue

        source = existing.setdefault(
            "source",
            {
                "kind": "url",
                "url": url,
                "allowedContentTypes": config.get("allowedContentTypes", []),
                "maxBytes": config["maxBytes"],
            },
        )
        if metadata_to_source(source, metadata):
            changes.append(f"source-metadata:{existing['id']}")
        if metadata.content_length is not None and existing.get("sizeBytes") != metadata.content_length:
            existing["sizeBytes"] = metadata.content_length
            changes.append(f"source-size:{existing['id']}")


def _remote_copy_is_current(resource: dict[str, Any], source: dict[str, Any], metadata: Any) -> bool:
    target = local_path_for_url(resource["url"])
    if not target.is_file() or not resource.get("checksum"):
        return False
    if sha256_path(target) != resource["checksum"]:
        return False
    if metadata.content_length is not None and resource.get("sizeBytes") != metadata.content_length:
        return False
    if source.get("etag") and metadata.etag:
        return source["etag"] == metadata.etag
    if source.get("lastModified") and metadata.last_modified:
        return source["lastModified"] == metadata.last_modified
    return False


def _discover_presentations(
    catalog: dict[str, Any],
    *,
    allowed_hosts: set[str],
    timeout: float,
    changes: list[str],
    warnings: list[str],
) -> set[str]:
    config = catalog.get("resourceAutomation", {}).get("presentationDiscovery")
    if not config:
        return set()

    try:
        file_pattern = re.compile(config["fileNamePattern"])
    except re.error as exc:
        raise ResourceError(f"fileNamePattern inválido para presentaciones: {exc}") from exc

    links = fetch_html_links(
        config["indexUrl"],
        allowed_hosts=allowed_hosts,
        max_bytes=config["indexMaxBytes"],
        timeout=timeout,
    )
    published: dict[int, str] = {}
    for url in links:
        parsed = urllib.parse.urlparse(url)
        filename = urllib.parse.unquote(parsed.path.rsplit("/", 1)[-1])
        match = file_pattern.fullmatch(filename)
        if not match:
            continue
        try:
            year = int(match.group("year"))
            quarter_number = int(match.group("quarter"))
            lesson_number = int(match.group("lesson"))
        except (IndexError, ValueError) as exc:
            raise ResourceError("fileNamePattern debe definir year, quarter y lesson") from exc
        if year != config["year"] or quarter_number != config["quarter"]:
            continue
        if not config["lessonStart"] <= lesson_number <= config["lessonEnd"]:
            continue
        validate_source_url(url, allowed_hosts)
        if lesson_number in published and published[lesson_number] != url:
            raise ResourceError(f"Fustero publicó dos PPT distintos para la lección {lesson_number}")
        published[lesson_number] = url

    if not published:
        raise ResourceError(f"No se encontraron PPT del trimestre en {config['indexUrl']}")

    lessons = {lesson["number"]: lesson for lesson in catalog.get("lessons", [])}
    presentations: dict[int, dict[str, Any]] = {}
    for resource in all_resources(catalog):
        if resource.get("role") != "weekly-presentation":
            continue
        lesson_number = resource.get("lessonNumber")
        if lesson_number in presentations:
            raise ResourceError(f"Hay más de un PPT catalogado para la lección {lesson_number}")
        presentations[lesson_number] = resource

    def probe(item: tuple[int, str]) -> tuple[int, str, Any]:
        lesson_number, url = item
        return lesson_number, url, probe_url(
            url,
            allowed_hosts=allowed_hosts,
            allowed_content_types=config.get("allowedContentTypes"),
            max_bytes=config["maxBytes"],
            timeout=timeout,
        )

    probed: list[tuple[int, str, Any]] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        futures = [executor.submit(probe, item) for item in published.items()]
        for future in concurrent.futures.as_completed(futures):
            probed.append(future.result())

    verified_unchanged: set[str] = set()
    for lesson_number, source_url, metadata in sorted(probed):
        lesson = lessons.get(lesson_number)
        if lesson is None:
            warnings.append(f"Fustero publicó la lección {lesson_number}, pero no existe en el catálogo")
            continue
        resource = presentations.get(lesson_number)
        if resource is None:
            local_url = config["localUrlTemplate"].format(
                quarterId=catalog["id"],
                lesson=lesson_number,
            )
            resource = {
                "id": f"ppt-{lesson_number:02d}",
                "type": "ppt",
                "role": "weekly-presentation",
                "lessonNumber": lesson_number,
                "title": f"Presentación PPT — Lección {lesson_number}",
                "description": "Presentación preparada por Sergio Fustero y Eunice Laveda",
                "url": local_url,
                "storage": "local",
                "source": {},
            }
            lesson.setdefault("resources", []).append(resource)
            presentations[lesson_number] = resource
            changes.append(f"presentation-discovered:{resource['id']}")

        previous_source = resource.get("source", {})
        same_source = previous_source.get("kind") == "url" and previous_source.get("url") == source_url
        copy_is_current = same_source and _remote_copy_is_current(resource, previous_source, metadata)
        desired_source = {
            "kind": "url",
            "url": source_url,
            "allowedContentTypes": config.get("allowedContentTypes", []),
            "maxBytes": config["maxBytes"],
            "provider": config["provider"],
            "providerUrl": config["providerUrl"],
        }
        for key in ("etag", "lastModified"):
            if key in previous_source:
                desired_source[key] = previous_source[key]
        if previous_source != desired_source:
            resource["source"] = desired_source
            changes.append(f"source-config:{resource['id']}")
        source = resource["source"]
        if metadata_to_source(source, metadata):
            changes.append(f"source-metadata:{resource['id']}")
        expected_description = "Presentación preparada por Sergio Fustero y Eunice Laveda"
        if resource.get("description") != expected_description:
            resource["description"] = expected_description
            changes.append(f"source-attribution:{resource['id']}")
        if copy_is_current:
            verified_unchanged.add(resource["id"])

    return verified_unchanged


def _discover_teacher_readings(
    catalog: dict[str, Any],
    *,
    allowed_hosts: set[str],
    timeout: float,
    changes: list[str],
    warnings: list[str],
    tasks: list[dict[str, Any]],
) -> set[str]:
    config = catalog.get("resourceAutomation", {}).get("teacherReadingDiscovery")
    if not config:
        return set()

    resources_by_lesson: dict[int, dict[str, Any]] = {}
    for resource in all_resources(catalog):
        if resource.get("role") != "teacher-reading":
            continue
        lesson_number = resource.get("lessonNumber")
        if lesson_number in resources_by_lesson:
            raise ResourceError(f"Hay más de una lectura de maestros para la lección {lesson_number}")
        resources_by_lesson[lesson_number] = resource

    handled_ids: set[str] = set()
    for lesson_number in range(config["lessonStart"], config["lessonEnd"] + 1):
        source_url = config["sourceUrlTemplate"].format(
            sourceQuarter=config["sourceQuarter"],
            lesson=lesson_number,
        )
        source_markdown, source_checksum, _source_size, metadata = fetch_text(
            source_url,
            allowed_hosts=allowed_hosts,
            allowed_content_types=config.get("allowedContentTypes"),
            max_bytes=config["maxBytes"],
            timeout=timeout,
        )
        validate_teacher_markdown(source_markdown, language="en")

        resource = resources_by_lesson.get(lesson_number)
        local_url = config["localUrlTemplate"].format(
            quarterId=catalog["id"],
            lesson=lesson_number,
        )
        target = local_path_for_url(local_url)
        if resource is None:
            warnings.append(
                f"teacher-reading-{lesson_number:02d}: fuente validada; requiere traducción asistida"
            )
            tasks.append(
                {
                    "kind": "teacher-translation",
                    "lessonNumber": lesson_number,
                    "resourceId": f"reading-teacher-{lesson_number:02d}",
                    "reason": "missing-translation",
                    "sourceUrl": source_url,
                    "sourceChecksum": source_checksum,
                    "targetUrl": local_url,
                    "reviewRequired": config.get("reviewRequired", True),
                }
            )
            continue

        handled_ids.add(resource["id"])
        if resource.get("url") != local_url:
            resource["url"] = local_url
            changes.append(f"teacher-local-url:{resource['id']}")

        desired_source = {
            "kind": "url",
            "url": source_url,
            "allowedContentTypes": config.get("allowedContentTypes", []),
            "maxBytes": config["maxBytes"],
            "provider": config["provider"],
            "providerUrl": config["providerUrl"],
            "credit": config["credit"],
            "currentChecksum": source_checksum,
        }
        metadata_to_source(desired_source, metadata)
        previous_source = resource.get("source", {})
        translation = resource.get("translation")

        # The current quarter was translated manually. Adopt it as the reviewed
        # baseline without regenerating or touching the published HTML.
        if not translation and previous_source.get("kind") == "manual" and target.is_file():
            resource["source"] = desired_source
            resource["translation"] = {
                "sourceLanguage": "en",
                "targetLanguage": "es",
                "method": "manual",
                "sourceChecksum": source_checksum,
                "reviewStatus": "reviewed-existing",
            }
            changes.append(f"teacher-source-adopted:{resource['id']}")
            continue

        if previous_source != desired_source:
            resource["source"] = desired_source
            changes.append(f"teacher-source-metadata:{resource['id']}")
        translation = dict(translation or {})
        translated_source_checksum = translation.get("sourceChecksum")
        if translated_source_checksum == source_checksum and target.is_file():
            if translation.pop("detectedSourceChecksum", None) is not None:
                resource["translation"] = translation
                changes.append(f"teacher-pending-cleared:{resource['id']}")
            continue

        if translation.get("detectedSourceChecksum") != source_checksum:
            translation["detectedSourceChecksum"] = source_checksum
            translation["reviewStatus"] = "source-changed"
            resource["translation"] = translation
            changes.append(f"teacher-source-pending:{resource['id']}")
        reason = "source-changed" if target.is_file() else "missing-output"
        tasks.append(
            {
                "kind": "teacher-translation",
                "lessonNumber": lesson_number,
                "resourceId": resource["id"],
                "reason": reason,
                "sourceUrl": source_url,
                "sourceChecksum": source_checksum,
                "translatedSourceChecksum": translated_source_checksum,
                "targetUrl": local_url,
                "reviewRequired": config.get("reviewRequired", True),
            }
        )
        warnings.append(f"{resource['id']}: fuente validada; traducción asistida pendiente")

    return handled_ids


def _stage_local_url_sources(
    catalog: dict[str, Any],
    staging_root: Path,
    *,
    allowed_hosts: set[str],
    default_max_bytes: int,
    timeout: float,
    changes: list[str],
    skip_resource_ids: set[str] | None = None,
) -> list[dict[str, Any]]:
    planned: list[dict[str, Any]] = []
    skip_resource_ids = skip_resource_ids or set()
    for resource in all_resources(catalog):
        source = resource.get("source", {})
        if resource.get("storage") != "local" or source.get("kind") != "url":
            continue
        if resource["id"] in skip_resource_ids:
            continue
        target = local_path_for_url(resource["url"])
        staged = staging_root / "downloads" / resource["id"] / target.name
        checksum, size, metadata = download_to(
            source["url"],
            staged,
            resource_type=resource["type"],
            allowed_hosts=allowed_hosts,
            allowed_content_types=source.get("allowedContentTypes"),
            max_bytes=source.get("maxBytes") or default_max_bytes,
            timeout=timeout,
        )
        if target.exists() and checksum == sha256_path(target):
            if metadata_to_source(source, metadata):
                changes.append(f"source-metadata:{resource['id']}")
            continue
        planned.append(
            {
                "resource": resource,
                "target": target,
                "staged": staged,
                "checksum": checksum,
                "size": size,
                "metadata": metadata,
            }
        )
        changes.append(f"content-update:{resource['id']}")
    return planned


def _atomic_replace_bytes(path: Path, payload: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".restore", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_name, path)
    except Exception:
        try:
            os.unlink(temp_name)
        except FileNotFoundError:
            pass
        raise


def _apply_transaction(
    catalog: dict[str, Any],
    catalog_path: Path,
    manifest_path: Path,
    planned: list[dict[str, Any]],
    transaction_root: Path,
) -> None:
    original_catalog = catalog_path.read_bytes()
    original_manifest = manifest_path.read_bytes() if manifest_path.exists() else None
    backups: list[tuple[Path, Path | None]] = []
    committed: list[Path] = []
    try:
        for index, item in enumerate(planned):
            target: Path = item["target"]
            backup = transaction_root / "backups" / f"{index:04d}-{target.name}"
            if target.exists():
                backup.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(target, backup)
                backups.append((target, backup))
            else:
                backups.append((target, None))
            target.parent.mkdir(parents=True, exist_ok=True)
            os.replace(item["staged"], target)
            committed.append(target)
            resource = item["resource"]
            resource["checksum"] = item["checksum"]
            resource["sizeBytes"] = item["size"]
            metadata_to_source(resource["source"], item["metadata"])

        atomic_write_json(catalog_path, catalog)
        write_manifest(catalog, manifest_path)
        errors = [issue for issue in audit_catalog(catalog) if issue.level == "error"]
        if errors:
            raise ResourceError("La auditoría posterior falló: " + "; ".join(issue.message for issue in errors))
    except Exception:
        for target, backup in reversed(backups):
            if backup is None:
                target.unlink(missing_ok=True)
            elif backup.exists():
                os.replace(backup, target)
        _atomic_replace_bytes(catalog_path, original_catalog)
        if original_manifest is None:
            manifest_path.unlink(missing_ok=True)
        else:
            _atomic_replace_bytes(manifest_path, original_manifest)
        raise


def main() -> int:
    args = parse_args()
    catalog_path = args.catalog.resolve()
    manifest_path = args.manifest.resolve()
    catalog = load_catalog(catalog_path)
    original = copy.deepcopy(catalog)
    automation = catalog.get("resourceAutomation", {})
    allowed_hosts = set(automation.get("allowedSourceHosts", []))
    default_max_bytes = int(automation.get("maxDownloadBytes", 50_000_000))
    changes: list[str] = []
    warnings: list[str] = []
    errors: list[str] = []
    teacher_tasks: list[dict[str, Any]] = []

    with tempfile.TemporaryDirectory(prefix=".resource-update-", dir=PROJECT_ROOT) as temp_dir:
        transaction_root = Path(temp_dir)
        planned: list[dict[str, Any]] = []
        try:
            if not args.offline:
                _discover_audio(
                    catalog,
                    allowed_hosts=allowed_hosts,
                    timeout=args.timeout,
                    changes=changes,
                    warnings=warnings,
                )
                unchanged_presentations = _discover_presentations(
                    catalog,
                    allowed_hosts=allowed_hosts,
                    timeout=args.timeout,
                    changes=changes,
                    warnings=warnings,
                )
                teacher_ids = _discover_teacher_readings(
                    catalog,
                    allowed_hosts=allowed_hosts,
                    timeout=args.timeout,
                    changes=changes,
                    warnings=warnings,
                    tasks=teacher_tasks,
                )
                planned = _stage_local_url_sources(
                    catalog,
                    transaction_root,
                    allowed_hosts=allowed_hosts,
                    default_max_bytes=default_max_bytes,
                    timeout=args.timeout,
                    changes=changes,
                    skip_resource_ids=unchanged_presentations | teacher_ids,
                )
            changes.extend(refresh_local_metadata(catalog))
            pre_apply_issues = audit_catalog(catalog)
            errors.extend(issue.message for issue in pre_apply_issues if issue.level == "error")
            if planned:
                planned_ids = {item["resource"]["id"] for item in planned}
                errors = [
                    error
                    for error in errors
                    if not any(resource_id in error for resource_id in planned_ids)
                ]
            if errors:
                raise ResourceError("; ".join(errors))

            changed = catalog != original or bool(planned)
            if args.apply and changed:
                _apply_transaction(catalog, catalog_path, manifest_path, planned, transaction_root)
            elif args.apply:
                write_manifest(catalog, manifest_path)
        except ResourceError as exc:
            if str(exc) not in errors:
                errors.append(str(exc))
        except Exception as exc:  # safeguard: report unexpected failures without partial success
            errors.append(f"Error inesperado: {exc}")

    report = {
        "schemaVersion": 1,
        "mode": "apply" if args.apply else "dry-run",
        "offline": args.offline,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "changed": bool(changes),
        "requiresReview": bool(teacher_tasks),
        "tasks": teacher_tasks,
        "teacherTranslationTasks": teacher_tasks,
        "changes": sorted(set(changes)),
        "warnings": warnings,
        "errors": errors,
    }
    if args.report:
        atomic_write_json(args.report.resolve(), report)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
