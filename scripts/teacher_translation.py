#!/usr/bin/env python3
"""Prepare and atomically apply teacher translations produced by an IDE agent."""

from __future__ import annotations

import argparse
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
    fetch_text,
    load_catalog,
    local_path_for_url,
    sha256_bytes,
    sha256_path,
    validate_file,
    write_manifest,
)
from teacher_readings import RENDERER_VERSION, render_teacher_html, validate_teacher_markdown, validate_translation_pair


WORKFLOW_VERSION = "antigravity-teacher-v1"
CHECKSUM_RE = re.compile(r"sha256:[0-9a-f]{64}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", type=Path, default=DEFAULT_CATALOG)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    subparsers = parser.add_subparsers(dest="command", required=True)

    fetch_parser = subparsers.add_parser("fetch", help="Download and validate one English source")
    fetch_parser.add_argument("--lesson", type=int, required=True)
    fetch_parser.add_argument("--output", type=Path, required=True)
    fetch_parser.add_argument("--expected-checksum", required=True)
    fetch_parser.add_argument("--timeout", type=float, default=30.0)

    apply_parser = subparsers.add_parser("apply", help="Validate and publish an agent translation")
    apply_parser.add_argument("--lesson", type=int, required=True)
    apply_parser.add_argument("--source", type=Path, required=True)
    apply_parser.add_argument("--input", type=Path, required=True)
    apply_parser.add_argument("--source-checksum", required=True)
    apply_parser.add_argument("--model", default="gemini-pro-latest")
    apply_parser.add_argument("--agent", default="Google Antigravity")
    return parser.parse_args()


def _workspace_path(path: Path, *, must_exist: bool = False) -> Path:
    resolved = path.resolve()
    root = PROJECT_ROOT.resolve()
    if resolved != root and root not in resolved.parents:
        raise ResourceError(f"La ruta debe permanecer dentro del proyecto: {path}")
    if must_exist and not resolved.is_file():
        raise ResourceError(f"Archivo inexistente: {path}")
    return resolved


def _teacher_config(catalog: dict[str, Any]) -> dict[str, Any]:
    config = catalog.get("resourceAutomation", {}).get("teacherReadingDiscovery")
    if not config:
        raise ResourceError("El catálogo no define teacherReadingDiscovery")
    return config


def _source_url(config: dict[str, Any], lesson_number: int) -> str:
    if not config["lessonStart"] <= lesson_number <= config["lessonEnd"]:
        raise ResourceError(f"Lección fuera del rango configurado: {lesson_number}")
    return config["sourceUrlTemplate"].format(
        sourceQuarter=config["sourceQuarter"],
        lesson=lesson_number,
    )


def _resource(catalog: dict[str, Any], lesson_number: int) -> dict[str, Any] | None:
    matches = [
        resource
        for resource in all_resources(catalog)
        if resource.get("role") == "teacher-reading" and resource.get("lessonNumber") == lesson_number
    ]
    if len(matches) > 1:
        raise ResourceError(f"Hay más de una lectura de maestros para la lección {lesson_number}")
    return matches[0] if matches else None


def _atomic_write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_name, path)
    except Exception:
        try:
            os.unlink(temp_name)
        except FileNotFoundError:
            pass
        raise


def _atomic_write_bytes(path: Path, payload: bytes) -> None:
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


def fetch_source(args: argparse.Namespace) -> dict[str, Any]:
    if not CHECKSUM_RE.fullmatch(args.expected_checksum):
        raise ResourceError("--expected-checksum no es un SHA-256 válido")
    catalog = load_catalog(args.catalog.resolve())
    config = _teacher_config(catalog)
    source_url = _source_url(config, args.lesson)
    source, checksum, size, _metadata = fetch_text(
        source_url,
        allowed_hosts=set(catalog["resourceAutomation"]["allowedSourceHosts"]),
        allowed_content_types=config.get("allowedContentTypes"),
        max_bytes=config["maxBytes"],
        timeout=args.timeout,
    )
    validate_teacher_markdown(source, language="en")
    if checksum != args.expected_checksum:
        raise ResourceError(
            "La fuente cambió después de la validación; ejecute nuevamente resources:update antes de traducir"
        )
    output = _workspace_path(args.output)
    _atomic_write_text(output, source)
    return {
        "status": "validated",
        "lessonNumber": args.lesson,
        "sourceUrl": source_url,
        "sourceChecksum": checksum,
        "sizeBytes": size,
        "output": str(output.relative_to(PROJECT_ROOT.resolve())),
    }


def _new_resource(
    catalog: dict[str, Any],
    config: dict[str, Any],
    lesson_number: int,
    source_url: str,
    source_checksum: str,
) -> dict[str, Any]:
    local_url = config["localUrlTemplate"].format(quarterId=catalog["id"], lesson=lesson_number)
    resource = {
        "id": f"reading-teacher-{lesson_number:02d}",
        "type": "article",
        "role": "teacher-reading",
        "lessonNumber": lesson_number,
        "title": f"Material para Maestros — Lección {lesson_number}",
        "description": f"Guía de estudio para maestros de la lección {lesson_number}",
        "url": local_url,
        "storage": "local",
        "source": {
            "kind": "url",
            "url": source_url,
            "allowedContentTypes": config.get("allowedContentTypes", []),
            "maxBytes": config["maxBytes"],
            "provider": config["provider"],
            "providerUrl": config["providerUrl"],
            "credit": config["credit"],
            "currentChecksum": source_checksum,
        },
    }
    catalog.setdefault("resources", []).append(resource)
    return resource


def apply_translation(args: argparse.Namespace) -> dict[str, Any]:
    if not CHECKSUM_RE.fullmatch(args.source_checksum):
        raise ResourceError("--source-checksum no es un SHA-256 válido")
    catalog_path = args.catalog.resolve()
    manifest_path = args.manifest.resolve()
    catalog = load_catalog(catalog_path)
    config = _teacher_config(catalog)
    source_url = _source_url(config, args.lesson)
    source_path = _workspace_path(args.source, must_exist=True)
    translation_path = _workspace_path(args.input, must_exist=True)
    source = source_path.read_text(encoding="utf-8-sig")
    translated = translation_path.read_text(encoding="utf-8-sig")
    validate_translation_pair(source, translated)
    normalized_source_checksum = sha256_bytes(source.encode("utf-8"))
    if normalized_source_checksum != args.source_checksum:
        raise ResourceError("El archivo inglés no corresponde al checksum validado")

    resource = _resource(catalog, args.lesson)
    if resource is None:
        resource = _new_resource(catalog, config, args.lesson, source_url, args.source_checksum)
    current_checksum = resource.get("source", {}).get("currentChecksum")
    if current_checksum != args.source_checksum:
        raise ResourceError("El catálogo cambió después de preparar la traducción; vuelva a validar la fuente")

    expected_local_url = config["localUrlTemplate"].format(quarterId=catalog["id"], lesson=args.lesson)
    resource["url"] = expected_local_url
    target = local_path_for_url(expected_local_url)
    review_status = "pending-review" if config.get("reviewRequired", True) else "reviewed"
    rendered = render_teacher_html(
        translated,
        lesson_number=args.lesson,
        source_url=source_url,
        provider_url=config["providerUrl"],
    )
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, staged_name = tempfile.mkstemp(prefix=f".{target.stem}.", suffix=".html", dir=target.parent)
    staged = Path(staged_name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(rendered)
            handle.flush()
            os.fsync(handle.fileno())
        validate_file(staged, "article", config["maxOutputBytes"])
        resource["checksum"] = sha256_path(staged)
        resource["sizeBytes"] = staged.stat().st_size
        resource["translation"] = {
            "sourceLanguage": "en",
            "targetLanguage": "es",
            "method": "antigravity-agent",
            "agent": args.agent,
            "model": args.model,
            "workflowVersion": WORKFLOW_VERSION,
            "rendererVersion": RENDERER_VERSION,
            "sourceChecksum": args.source_checksum,
            "reviewStatus": review_status,
            "generatedAt": datetime.now(timezone.utc).isoformat(),
        }

        original_catalog = catalog_path.read_bytes()
        original_manifest = manifest_path.read_bytes() if manifest_path.exists() else None
        original_target = target.read_bytes() if target.exists() else None
        try:
            os.replace(staged, target)
            atomic_write_json(catalog_path, catalog)
            write_manifest(catalog, manifest_path)
            errors = [issue.message for issue in audit_catalog(catalog) if issue.level == "error"]
            if errors:
                raise ResourceError("La auditoría posterior falló: " + "; ".join(errors))
        except Exception:
            if original_target is None:
                target.unlink(missing_ok=True)
            else:
                _atomic_write_bytes(target, original_target)
            _atomic_write_bytes(catalog_path, original_catalog)
            if original_manifest is None:
                manifest_path.unlink(missing_ok=True)
            else:
                _atomic_write_bytes(manifest_path, original_manifest)
            raise
    finally:
        staged.unlink(missing_ok=True)

    return {
        "status": f"applied-{review_status}",
        "lessonNumber": args.lesson,
        "resourceId": resource["id"],
        "sourceChecksum": args.source_checksum,
        "htmlChecksum": resource["checksum"],
        "model": args.model,
        "target": expected_local_url,
    }


def main() -> int:
    args = parse_args()
    try:
        result = fetch_source(args) if args.command == "fetch" else apply_translation(args)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except ResourceError as exc:
        print(json.dumps({"status": "error", "error": str(exc)}, ensure_ascii=False, indent=2))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
