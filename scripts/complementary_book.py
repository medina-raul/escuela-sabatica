"""Discover the book PDFs listed for the quarter's lessons."""

from __future__ import annotations

import html
import re
from http.client import HTTPException
from html.parser import HTMLParser
from pathlib import Path

from resource_lib import (
    PROJECT_ROOT, ResourceError, all_resources, canonical_url_for_resource, download_to,
    fetch_text, local_path_for_url, sha256_bytes, sha256_path, validate_file, validate_source_url,
)
from teacher_readings import render_markdown_body


BOOK_ROLE = "complementary-book-reading"
DRIVE_LINK = re.compile(r"https://drive\.google\.com/file/d/([A-Za-z0-9_-]+)/view/?")


class BookIndex(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.rows: list[tuple[str, list[str]]] = []
        self.label: list[str] | None = None
        self.links: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag == "li":
            self.label = []
            self.links = []
        if tag == "a" and self.label is not None:
            self.links.append(dict(attrs).get("href") or "")

    def handle_data(self, data):
        if self.label is not None:
            self.label.append(data)

    def handle_endtag(self, tag):
        if tag == "li" and self.label is not None:
            self.rows.append((" ".join("".join(self.label).split()), self.links))
            self.label = None


def parse_index(html: str, lessons: set[int]) -> dict[int, tuple[str, str | None]]:
    index = re.search(r"<h3\b[^>]*>\s*Contenido\s*</h3>\s*(<ul\b[^>]*>.*?</ul>)", html, re.I | re.S)
    if index is None:
        raise ResourceError("No se encontró el índice del libro complementario")
    parser = BookIndex()
    parser.feed(index[1])
    entries = {}
    seen_ids = set()
    for label, links in parser.rows:
        chapter = re.fullmatch(r"Capítulo\s+(\d+)\.\s*(.+)", label, re.I)
        if chapter:
            number = int(chapter[1])
            if number not in lessons:
                raise ResourceError(f"Capítulo fuera del trimestre: {number}")
            title = re.sub(r"\s*\(\d{1,2} de [^)]+\)$", "", chapter[2].rstrip(" |"))
        elif re.fullmatch(r"Introducción\s*\|?", label, re.I):
            number, title = 0, "Introducción"
        else:
            continue
        if number in entries:
            raise ResourceError(f"Número repetido en el libro: {number}")
        if len(links) > 1:
            raise ResourceError(f"Más de un enlace para la entrada {number}")
        file_id = None
        if links:
            match = DRIVE_LINK.fullmatch(links[0].split("?", 1)[0])
            if match is None:
                raise ResourceError(f"Enlace de Drive inesperado para la entrada {number}")
            file_id = match[1]
            if file_id in seen_ids:
                raise ResourceError("Un PDF está asignado a más de una entrada del libro")
            seen_ids.add(file_id)
        entries[number] = (title, file_id)
    if entries.keys() != (lessons | {0}):
        raise ResourceError("El índice no coincide con las lecciones y la introducción del trimestre")
    return entries


def discover_book(catalog, staging: Path, *, allowed_hosts: set[str], timeout: float, changes, warnings) -> None:
    config = catalog.get("resourceAutomation", {}).get("complementaryBookDiscovery")
    if not config:
        return
    try:
        html, _, _, _ = fetch_text(
            config["indexUrl"], allowed_hosts=allowed_hosts,
            allowed_content_types=["text/html"], max_bytes=2_000_000, timeout=timeout,
        )
    except (OSError, HTTPException) as exc:
        raise ResourceError(f"No se pudo leer el índice del libro: {exc}") from exc
    entries = parse_index(html, {lesson["number"] for lesson in catalog["lessons"]})
    registered = {
        resource.get("lessonNumber", 0): resource
        for resource in all_resources(catalog) if resource.get("role") == BOOK_ROLE
    }
    for number, (title, file_id) in sorted(entries.items()):
        if not file_id:
            continue
        url = f"https://drive.google.com/file/d/{file_id}/view"
        if number in registered:
            if registered[number].get("source", {}).get("url") != url:
                warnings.append(f"Libro complementario: cambió el enlace de la entrada {number}. Revisar la fuente.")
            continue
        resource_id = f"complementary-book-{number:02d}"
        pdf_path = staging / f"{resource_id}.pdf"
        try:
            checksum, size, metadata = download_to(
                f"https://drive.google.com/uc?export=download&id={file_id}",
                pdf_path, resource_type="pdf",
                allowed_hosts={"drive.google.com", "drive.usercontent.google.com"},
                allowed_content_types=["application/pdf", "application/octet-stream"],
                max_bytes=20_000_000, timeout=timeout,
            )
            expected_name = f"Libro Complementario {catalog['year']}-{catalog['quarterNumber']}T_L{number:02d}.pdf"
            if (metadata.filename or "").casefold() != expected_name.casefold():
                raise ResourceError(f"Se esperaba {expected_name}; Drive devolvió {metadata.filename!r}")
            with pdf_path.open("rb") as pdf:
                signature = pdf.read(5)
                pdf.seek(max(0, size - 2048))
                if signature != b"%PDF-" or not pdf.read().rstrip().endswith(b"%%EOF"):
                    raise ResourceError("El archivo no es un PDF completo")
        except (ResourceError, OSError, HTTPException) as exc:
            warnings.append(f"Libro complementario, entrada {number}: {exc}")
            continue
        resource = {
            "id": resource_id,
            "type": "pdf",
            "role": BOOK_ROLE,
            "title": f"Capítulo {number}. {title}" if number else title,
            "description": config["title"],
            "url": url,
            "storage": "external",
            "external": True,
            "sizeBytes": size,
            "source": {
                "kind": "url", "url": url, "currentChecksum": checksum,
                "provider": "Recursos de Esperanza", "providerUrl": config["indexUrl"],
                "credit": config["credit"],
            },
        }
        if number:
            resource["lessonNumber"] = number
        catalog.setdefault("resources", []).append(resource)
        changes.append(f"complementary-book-added:{resource_id}")


def render_book_article(markdown: str, resource: dict, index_url: str) -> str:
    document = re.fullmatch(r"---\nsourceChecksum: (sha256:[0-9a-f]{64})\n---\n\s*(.+)", markdown, re.S)
    source = resource["source"]
    if document is None or document[1] != source.get("currentChecksum"):
        raise ResourceError(f"El Markdown no corresponde al PDF registrado: {resource['id']}")
    body = document[2].strip()
    if len(body) < 200 or "\x00" in body:
        raise ResourceError(f"Texto incompleto o inválido: {resource['id']}")
    source_url = source["url"]
    if not DRIVE_LINK.fullmatch(source_url):
        raise ResourceError(f"Enlace de origen inválido: {resource['id']}")
    validate_source_url(index_url, {"recursosdesperanza.blogspot.com"})
    title = html.escape(resource["title"])
    credit = html.escape(source.get("credit", ""))
    return f"""<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{title}</title>
</head>
<body>
  <article class="complementary-book-reading">
    <p class="source-credit">{credit} · <a href="{html.escape(source_url, quote=True)}">PDF original</a> · <a href="{html.escape(index_url, quote=True)}">Recursos de Esperanza</a></p>
    {render_markdown_body(body)}
  </article>
</body>
</html>
"""


def stage_book_articles(catalog: dict, staging: Path, changes: list[str]) -> list[dict]:
    config = catalog.get("resourceAutomation", {}).get("complementaryBookDiscovery")
    if not config:
        return []
    content_dir = PROJECT_ROOT / "content" / "books" / catalog["id"]
    planned = []
    for resource in all_resources(catalog):
        if resource.get("role") != BOOK_ROLE:
            continue
        number = resource.get("lessonNumber")
        stem = f"capitulo-{number:02d}" if number is not None else "introduccion"
        markdown = content_dir / f"{stem}.md"
        if not markdown.is_file():
            continue
        rendered = render_book_article(markdown.read_text(encoding="utf-8"), resource, config["indexUrl"]).encode("utf-8")
        url = canonical_url_for_resource(catalog, {**resource, "url": f"/{stem}.html"})
        target = local_path_for_url(url)
        checksum = sha256_bytes(rendered)
        if resource["url"] == url and target.is_file() and sha256_path(target) == checksum:
            continue
        staged = staging / f"{stem}.html"
        staged.write_bytes(rendered)
        validate_file(staged, "article")
        resource.update(type="article", storage="local", url=url)
        resource.pop("external", None)
        planned.append({
            "resource": resource, "target": target, "staged": staged,
            "checksum": checksum, "size": len(rendered),
        })
        changes.append(f"complementary-book-article:{resource['id']}")
    return planned
