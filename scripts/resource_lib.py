#!/usr/bin/env python3
"""Shared helpers for the resource update, audit, and deployment pipelines."""

from __future__ import annotations

import hashlib
import json
import os
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from dataclasses import asdict, dataclass
from html.parser import HTMLParser
from pathlib import Path
from typing import Any, Iterable


PROJECT_ROOT = Path(__file__).resolve().parents[1]
PUBLIC_ROOT = PROJECT_ROOT / "public"
DEFAULT_CATALOG = PROJECT_ROOT / "src/data/quarters/2026-q3.json"
DEFAULT_MANIFEST = PUBLIC_ROOT / "resource-manifest.json"
USER_AGENT = "EscuelaSabaticaResourceBot/1.0 (+https://escuelasabatica.cl)"


@dataclass(frozen=True)
class Issue:
    level: str
    code: str
    message: str


@dataclass(frozen=True)
class RemoteMetadata:
    url: str
    content_type: str | None
    content_length: int | None
    etag: str | None
    last_modified: str | None


class ResourceError(RuntimeError):
    """Raised when a resource violates a pipeline safeguard."""


class _LinkParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.hrefs: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() != "a":
            return
        href = dict(attrs).get("href")
        if href:
            self.hrefs.append(href)


def load_catalog(path: Path = DEFAULT_CATALOG) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def atomic_write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_name, path)
    except Exception:
        try:
            os.unlink(temp_name)
        except FileNotFoundError:
            pass
        raise


def iter_resources(catalog: dict[str, Any]) -> Iterable[dict[str, Any]]:
    yield from catalog.get("resources", [])
    for lesson in catalog.get("lessons", []):
        yield from lesson.get("resources", [])


def all_resources(catalog: dict[str, Any]) -> list[dict[str, Any]]:
    return list(iter_resources(catalog))


def sha256_path(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return f"sha256:{digest.hexdigest()}"


def local_path_for_url(url: str) -> Path:
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme or parsed.netloc or parsed.query or parsed.fragment:
        raise ResourceError(f"La URL local no es una ruta pública simple: {url}")
    candidate = (PUBLIC_ROOT / urllib.parse.unquote(parsed.path).lstrip("/")).resolve()
    public_root = PUBLIC_ROOT.resolve()
    if candidate != public_root and public_root not in candidate.parents:
        raise ResourceError(f"La URL intenta salir de public/: {url}")
    return candidate


def validate_source_url(url: str, allowed_hosts: set[str]) -> None:
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "https":
        raise ResourceError(f"La fuente debe usar HTTPS: {url}")
    if parsed.hostname not in allowed_hosts:
        raise ResourceError(f"Host de fuente no autorizado: {parsed.hostname or '(vacío)'}")
    if parsed.username or parsed.password:
        raise ResourceError(f"No se permiten credenciales embebidas en la URL: {url}")


def extract_links(base_url: str, html: str) -> list[str]:
    parser = _LinkParser()
    parser.feed(html)
    return sorted({urllib.parse.urljoin(base_url, href) for href in parser.hrefs})


def fetch_html_links(
    url: str,
    *,
    allowed_hosts: set[str],
    max_bytes: int,
    timeout: float,
) -> list[str]:
    validate_source_url(url, allowed_hosts)
    request = urllib.request.Request(
        url,
        headers={"User-Agent": USER_AGENT, "Accept": "text/html,application/xhtml+xml"},
    )
    try:
        response = urllib.request.urlopen(request, timeout=timeout)
    except urllib.error.HTTPError as exc:
        raise ResourceError(f"Índice de recursos respondió HTTP {exc.code}: {url}") from exc
    except urllib.error.URLError as exc:
        raise ResourceError(f"No se pudo consultar el índice {url}: {exc.reason}") from exc

    with response:
        final_url = response.geturl()
        validate_source_url(final_url, allowed_hosts)
        content_type = response.headers.get("Content-Type", "")
        if "text/html" not in content_type.lower() and "application/xhtml+xml" not in content_type.lower():
            raise ResourceError(f"El índice no devolvió HTML ({content_type!r}): {final_url}")
        payload = response.read(max_bytes + 1)
        if len(payload) > max_bytes:
            raise ResourceError(f"El índice excede {max_bytes} bytes: {final_url}")
        encoding = response.headers.get_content_charset() or "utf-8"
    return extract_links(final_url, payload.decode(encoding, errors="replace"))


def validate_file(path: Path, resource_type: str, max_bytes: int | None = None) -> None:
    if not path.is_file():
        raise ResourceError(f"Archivo inexistente: {path}")
    size = path.stat().st_size
    if size == 0:
        raise ResourceError(f"Archivo vacío: {path}")
    if max_bytes is not None and size > max_bytes:
        raise ResourceError(f"Archivo excede el máximo de {max_bytes} bytes: {path}")

    suffix = path.suffix.lower()
    if resource_type == "article":
        if suffix != ".html":
            raise ResourceError(f"Un artículo debe terminar en .html: {path}")
        if size < 128:
            raise ResourceError(f"HTML sospechosamente pequeño: {path}")
        sample = path.read_bytes()[:8192].decode("utf-8", errors="ignore").lower()
        if "<html" not in sample and "<!doctype html" not in sample:
            raise ResourceError(f"El archivo no parece HTML: {path}")
        if "404 not found" in sample or "access denied" in sample:
            raise ResourceError(f"El HTML parece una página de error: {path}")
    elif resource_type == "ppt":
        if suffix != ".pptx":
            raise ResourceError(f"Una presentación debe terminar en .pptx: {path}")
        if size < 10_000:
            raise ResourceError(f"PPTX sospechosamente pequeño: {path}")
        try:
            with zipfile.ZipFile(path) as archive:
                names = set(archive.namelist())
                required = {"[Content_Types].xml", "ppt/presentation.xml"}
                if not required.issubset(names):
                    raise ResourceError(f"PPTX incompleto: {path}")
        except zipfile.BadZipFile as exc:
            raise ResourceError(f"El archivo no es un PPTX válido: {path}") from exc
    elif resource_type == "audio":
        if suffix != ".mp3":
            raise ResourceError(f"Un audio local debe terminar en .mp3: {path}")
        if size < 10_000:
            raise ResourceError(f"MP3 sospechosamente pequeño: {path}")
        with path.open("rb") as handle:
            header = handle.read(3)
        if header != b"ID3" and not (len(header) >= 2 and header[0] == 0xFF and header[1] & 0xE0 == 0xE0):
            raise ResourceError(f"El archivo no parece un MP3: {path}")


def _content_type_allowed(actual: str | None, allowed: list[str] | None) -> bool:
    if not allowed or not actual:
        return True
    normalized = actual.split(";", 1)[0].strip().lower()
    return normalized in {item.lower() for item in allowed}


def probe_url(
    url: str,
    *,
    allowed_hosts: set[str],
    allowed_content_types: list[str] | None,
    max_bytes: int,
    timeout: float,
    missing_ok: bool = False,
) -> RemoteMetadata | None:
    validate_source_url(url, allowed_hosts)
    headers = {"User-Agent": USER_AGENT, "Accept": "*/*"}
    request = urllib.request.Request(url, headers=headers, method="HEAD")
    response = None
    try:
        response = urllib.request.urlopen(request, timeout=timeout)
    except urllib.error.HTTPError as exc:
        if missing_ok and exc.code in {403, 404, 410}:
            return None
        if exc.code not in {405, 501}:
            raise ResourceError(f"Fuente respondió HTTP {exc.code}: {url}") from exc
        range_request = urllib.request.Request(
            url,
            headers={**headers, "Range": "bytes=0-1023"},
            method="GET",
        )
        try:
            response = urllib.request.urlopen(range_request, timeout=timeout)
        except urllib.error.HTTPError as range_exc:
            if missing_ok and range_exc.code in {403, 404, 410}:
                return None
            raise ResourceError(f"No se pudo comprobar la fuente HTTP {range_exc.code}: {url}") from range_exc
    except urllib.error.URLError as exc:
        raise ResourceError(f"No se pudo conectar con la fuente {url}: {exc.reason}") from exc

    assert response is not None
    with response:
        validate_source_url(response.geturl(), allowed_hosts)
        content_type = response.headers.get("Content-Type")
        raw_length = response.headers.get("Content-Length")
        content_length = int(raw_length) if raw_length and raw_length.isdigit() else None
        if not _content_type_allowed(content_type, allowed_content_types):
            raise ResourceError(f"Content-Type inesperado {content_type!r}: {url}")
        if content_length is not None and content_length > max_bytes:
            raise ResourceError(f"La fuente excede {max_bytes} bytes: {url}")
        return RemoteMetadata(
            url=url,
            content_type=content_type,
            content_length=content_length,
            etag=response.headers.get("ETag"),
            last_modified=response.headers.get("Last-Modified"),
        )


def download_to(
    url: str,
    destination: Path,
    *,
    resource_type: str,
    allowed_hosts: set[str],
    allowed_content_types: list[str] | None,
    max_bytes: int,
    timeout: float,
) -> tuple[str, int, RemoteMetadata]:
    validate_source_url(url, allowed_hosts)
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "*/*"})
    try:
        response = urllib.request.urlopen(request, timeout=timeout)
    except urllib.error.HTTPError as exc:
        raise ResourceError(f"Descarga respondió HTTP {exc.code}: {url}") from exc
    except urllib.error.URLError as exc:
        raise ResourceError(f"No se pudo descargar {url}: {exc.reason}") from exc

    digest = hashlib.sha256()
    total = 0
    destination.parent.mkdir(parents=True, exist_ok=True)
    with response, destination.open("wb") as handle:
        validate_source_url(response.geturl(), allowed_hosts)
        content_type = response.headers.get("Content-Type")
        if not _content_type_allowed(content_type, allowed_content_types):
            raise ResourceError(f"Content-Type inesperado {content_type!r}: {url}")
        for chunk in iter(lambda: response.read(1024 * 1024), b""):
            total += len(chunk)
            if total > max_bytes:
                raise ResourceError(f"Descarga excede {max_bytes} bytes: {url}")
            digest.update(chunk)
            handle.write(chunk)
        handle.flush()
        os.fsync(handle.fileno())
        metadata = RemoteMetadata(
            url=url,
            content_type=content_type,
            content_length=total,
            etag=response.headers.get("ETag"),
            last_modified=response.headers.get("Last-Modified"),
        )
    validate_file(destination, resource_type, max_bytes)
    return f"sha256:{digest.hexdigest()}", total, metadata


def refresh_local_metadata(catalog: dict[str, Any]) -> list[str]:
    changes: list[str] = []
    for resource in iter_resources(catalog):
        if resource.get("storage") != "local":
            continue
        path = local_path_for_url(resource["url"])
        if not path.exists():
            continue
        checksum = sha256_path(path)
        size = path.stat().st_size
        if resource.get("checksum") != checksum:
            resource["checksum"] = checksum
            changes.append(f"checksum:{resource['id']}")
        if resource.get("sizeBytes") != size:
            resource["sizeBytes"] = size
            changes.append(f"size:{resource['id']}")
    return changes


def audit_catalog(catalog: dict[str, Any]) -> list[Issue]:
    issues: list[Issue] = []
    resources = all_resources(catalog)
    automation = catalog.get("resourceAutomation", {})
    allowed_hosts = set(automation.get("allowedSourceHosts", []))
    resource_root = PUBLIC_ROOT / "recursos" / catalog.get("id", "")

    seen_ids: set[str] = set()
    seen_urls: set[str] = set()
    catalog_local_paths: set[Path] = set()
    lessons = {lesson.get("number"): lesson for lesson in catalog.get("lessons", [])}

    for resource in resources:
        resource_id = resource.get("id", "")
        url = resource.get("url", "")
        if not resource_id:
            issues.append(Issue("error", "missing-id", "Hay un recurso sin id"))
        elif resource_id in seen_ids:
            issues.append(Issue("error", "duplicate-id", f"ID duplicado: {resource_id}"))
        seen_ids.add(resource_id)

        if not url or url == "#":
            issues.append(Issue("error", "placeholder-url", f"URL inválida en {resource_id}: {url!r}"))
        elif url in seen_urls:
            issues.append(Issue("error", "duplicate-url", f"URL duplicada: {url}"))
        seen_urls.add(url)

        role = resource.get("role")
        if not role:
            issues.append(Issue("error", "missing-role", f"Recurso sin role: {resource_id}"))
        if role in {"friday-reading", "teacher-reading", "weekly-presentation", "daily-audio"}:
            lesson_number = resource.get("lessonNumber")
            if lesson_number not in lessons:
                issues.append(Issue("error", "invalid-lesson", f"Lección inválida en {resource_id}"))
        if role == "daily-audio" and not resource.get("dayId"):
            issues.append(Issue("error", "missing-day", f"Audio sin dayId: {resource_id}"))

        storage = resource.get("storage")
        source = resource.get("source", {})
        source_kind = source.get("kind")
        if source_kind not in {"manual", "url"}:
            issues.append(Issue("error", "invalid-source-kind", f"source.kind inválido en {resource_id}"))
        if source_kind == "url":
            try:
                validate_source_url(source.get("url", ""), allowed_hosts)
            except ResourceError as exc:
                issues.append(Issue("error", "invalid-source", f"{resource_id}: {exc}"))
        if storage == "local":
            try:
                path = local_path_for_url(url)
                catalog_local_paths.add(path)
                if resource_root.resolve() not in path.parents:
                    issues.append(Issue("error", "outside-quarter", f"Archivo fuera del trimestre: {url}"))
                max_bytes = source.get("maxBytes") or automation.get("maxDownloadBytes")
                validate_file(path, resource.get("type", ""), max_bytes)
                checksum = sha256_path(path)
                size = path.stat().st_size
                if resource.get("checksum") != checksum:
                    issues.append(Issue("error", "checksum-mismatch", f"Checksum desactualizado: {resource_id}"))
                if resource.get("sizeBytes") != size:
                    issues.append(Issue("error", "size-mismatch", f"Tamaño desactualizado: {resource_id}"))
            except ResourceError as exc:
                issues.append(Issue("error", "invalid-local-file", f"{resource_id}: {exc}"))
        elif storage == "external":
            if not resource.get("external"):
                issues.append(Issue("error", "external-flag", f"Falta external=true: {resource_id}"))
            if source_kind != "url":
                issues.append(Issue("error", "external-source", f"Fuente externa sin URL en {resource_id}"))
            elif source.get("url") != url:
                issues.append(Issue("error", "external-url-drift", f"URL externa no coincide con su fuente: {resource_id}"))
        else:
            issues.append(Issue("error", "invalid-storage", f"storage inválido en {resource_id}: {storage!r}"))

    if resource_root.is_dir():
        physical_files = {
            path.resolve()
            for path in resource_root.rglob("*")
            if path.is_file() and path.name != ".DS_Store"
        }
        for orphan in sorted(physical_files - catalog_local_paths):
            issues.append(Issue("error", "orphan-file", f"Archivo no catalogado: {orphan.relative_to(PROJECT_ROOT)}"))

    audio_by_slot = {
        (resource.get("lessonNumber"), resource.get("dayId")): resource
        for resource in resources
        if resource.get("role") == "daily-audio"
    }
    for lesson in catalog.get("lessons", []):
        for day in lesson.get("days", []):
            audio = day.get("audio")
            registered = audio_by_slot.get((lesson.get("number"), day.get("id")))
            if audio and (not registered or registered.get("url") != audio.get("url")):
                issues.append(
                    Issue(
                        "error",
                        "audio-catalog-drift",
                        f"Audio diario no coincide con catálogo: lección {lesson.get('number')} {day.get('id')}",
                    )
                )
            if registered and (not audio or audio.get("url") != registered.get("url")):
                issues.append(
                    Issue(
                        "error",
                        "audio-day-drift",
                        f"Catálogo de audio no coincide con el día: {registered.get('id')}",
                    )
                )
    return issues


def manifest_payload(catalog: dict[str, Any]) -> dict[str, Any]:
    resources = sorted(all_resources(catalog), key=lambda item: item["id"])
    canonical = json.dumps(
        {"quarterId": catalog.get("id"), "resources": resources},
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return {
        "schemaVersion": 1,
        "quarterId": catalog.get("id"),
        "catalogChecksum": f"sha256:{hashlib.sha256(canonical).hexdigest()}",
        "resourceCount": len(resources),
        "localResourceCount": sum(resource.get("storage") == "local" for resource in resources),
        "resources": [
            {
                key: resource[key]
                for key in ("id", "type", "role", "lessonNumber", "dayId", "url", "storage", "checksum", "sizeBytes")
                if key in resource
            }
            for resource in resources
        ],
    }


def write_manifest(catalog: dict[str, Any], output: Path = DEFAULT_MANIFEST) -> dict[str, Any]:
    payload = manifest_payload(catalog)
    atomic_write_json(output, payload)
    return payload


def metadata_to_source(source: dict[str, Any], metadata: RemoteMetadata) -> bool:
    changed = False
    for key, value in (("etag", metadata.etag), ("lastModified", metadata.last_modified)):
        if value and source.get(key) != value:
            source[key] = value
            changed = True
    return changed


def issue_dicts(issues: Iterable[Issue]) -> list[dict[str, str]]:
    return [asdict(issue) for issue in issues]
