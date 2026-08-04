#!/usr/bin/env python3
"""Validation, translation, and safe HTML rendering for teacher readings."""

from __future__ import annotations

import html
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from resource_lib import ResourceError, USER_AGENT


PROMPT_VERSION = "teacher-es-v1"
GLOSSARY_PATH = Path(__file__).with_name("teacher_glossary.json")
REQUIRED_ENGLISH_SECTIONS = (
    "Part I: Overview",
    "Part II: Commentary",
    "Part III: Life Application",
)
REQUIRED_SPANISH_SECTIONS = (
    "Parte I: Visión General",
    "Parte II: Comentario",
    "Parte III: Aplicación a la Vida",
)
DISALLOWED_RAW_HTML = re.compile(
    r"<\s*/?\s*(script|style|iframe|object|embed|form|input|button|svg|math|template|link|meta|base)\b",
    re.IGNORECASE,
)
FRONTMATTER_RE = re.compile(r"\A---\s*\n(?P<body>.*?)\n---\s*(?:\n|\Z)", re.DOTALL)


@dataclass(frozen=True)
class TranslatorSettings:
    api_url: str
    api_key: str
    model: str


def translator_settings_from_env() -> TranslatorSettings | None:
    api_key = os.environ.get("TEACHER_TRANSLATION_API_KEY") or os.environ.get("OPENAI_API_KEY")
    model = os.environ.get("TEACHER_TRANSLATION_MODEL")
    api_url = os.environ.get("TEACHER_TRANSLATION_API_URL") or "https://api.openai.com/v1/responses"
    if not api_key and not model:
        return None
    if not api_key or not model:
        raise ResourceError(
            "La traducción de maestros requiere TEACHER_TRANSLATION_MODEL y "
            "TEACHER_TRANSLATION_API_KEY (u OPENAI_API_KEY)"
        )
    parsed = urllib.parse.urlparse(api_url)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise ResourceError("TEACHER_TRANSLATION_API_URL debe ser una URL HTTPS sin credenciales embebidas")
    return TranslatorSettings(api_url=api_url, api_key=api_key, model=model)


def _frontmatter(markdown: str) -> tuple[dict[str, str], str]:
    match = FRONTMATTER_RE.match(markdown)
    if not match:
        raise ResourceError("El comentario para maestros no contiene frontmatter YAML")
    metadata: dict[str, str] = {}
    for raw_line in match.group("body").splitlines():
        if not raw_line.strip():
            continue
        key, separator, value = raw_line.partition(":")
        if not separator or not key.strip() or not value.strip():
            raise ResourceError(f"Frontmatter inválido: {raw_line!r}")
        metadata[key.strip()] = value.strip()
    return metadata, markdown[match.end() :].strip()


def validate_teacher_markdown(markdown: str, *, language: str) -> None:
    if len(markdown.encode("utf-8")) < 1_000:
        raise ResourceError("El comentario para maestros es sospechosamente pequeño")
    if "\x00" in markdown:
        raise ResourceError("El comentario para maestros contiene bytes nulos")
    if DISALLOWED_RAW_HTML.search(markdown):
        raise ResourceError("El comentario para maestros contiene HTML no permitido")
    metadata, _ = _frontmatter(markdown)
    if not metadata.get("title") or not metadata.get("date"):
        raise ResourceError("El comentario para maestros debe declarar title y date")
    expected = REQUIRED_ENGLISH_SECTIONS if language == "en" else REQUIRED_SPANISH_SECTIONS
    positions: list[int] = []
    for section in expected:
        match = re.search(rf"^#{{1,6}}\s+{re.escape(section)}\s*$", markdown, re.MULTILINE | re.IGNORECASE)
        if not match:
            raise ResourceError(f"Falta la sección obligatoria: {section}")
        positions.append(match.start())
    if positions != sorted(positions):
        raise ResourceError("Las secciones del comentario para maestros están fuera de orden")


def _translation_prompt(markdown: str) -> tuple[str, str]:
    glossary = json.loads(GLOSSARY_PATH.read_text(encoding="utf-8"))
    system = (
        "Traduce íntegramente del inglés al español latinoamericano el comentario para maestros "
        "de la Escuela Sabática. No resumas, no omitas y no agregues contenido. Conserva el "
        "frontmatter YAML, la estructura Markdown, las listas, citas bibliográficas, números y "
        "referencias bíblicas. Devuelve solamente Markdown, sin cercos de código ni explicación. "
        "Usa exactamente los encabezados canónicos indicados en el glosario. Mantén un tono "
        "formal, natural y teológicamente neutral. Glosario obligatorio:\n"
        + json.dumps(glossary, ensure_ascii=False, indent=2)
    )
    return system, markdown


def translate_teacher_markdown(markdown: str, settings: TranslatorSettings, *, timeout: float) -> str:
    system, user = _translation_prompt(markdown)
    uses_responses_api = urllib.parse.urlparse(settings.api_url).path.rstrip("/").endswith("/responses")
    request_body = (
        {
            "model": settings.model,
            "instructions": system,
            "input": user,
            "store": False,
        }
        if uses_responses_api
        else {
            "model": settings.model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        }
    )
    payload = json.dumps(
        request_body,
        ensure_ascii=False,
    ).encode("utf-8")
    request = urllib.request.Request(
        settings.api_url,
        data=payload,
        method="POST",
        headers={
            "Authorization": f"Bearer {settings.api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": USER_AGENT,
        },
    )
    try:
        response = urllib.request.urlopen(request, timeout=max(timeout, 120.0))
    except urllib.error.HTTPError as exc:
        raise ResourceError(f"El traductor respondió HTTP {exc.code}") from exc
    except urllib.error.URLError as exc:
        raise ResourceError(f"No se pudo conectar con el traductor: {exc.reason}") from exc
    with response:
        raw = response.read(2_000_001)
    if len(raw) > 2_000_000:
        raise ResourceError("La respuesta del traductor excede 2 MB")
    try:
        result = json.loads(raw)
        if uses_responses_api:
            parts = [
                part["text"]
                for item in result["output"]
                if item.get("type") == "message"
                for part in item.get("content", [])
                if part.get("type") == "output_text"
            ]
            if not parts:
                raise KeyError("output_text")
            translated = "".join(parts)
        else:
            translated = result["choices"][0]["message"]["content"]
    except (json.JSONDecodeError, KeyError, IndexError, TypeError) as exc:
        raise ResourceError("El traductor devolvió una respuesta inesperada") from exc
    if not isinstance(translated, str):
        raise ResourceError("El traductor no devolvió texto")
    translated = translated.strip()
    if translated.startswith("```"):
        translated = re.sub(r"^```(?:markdown|md)?\s*", "", translated, flags=re.IGNORECASE)
        translated = re.sub(r"\s*```$", "", translated).strip()
    validate_teacher_markdown(translated, language="es")
    source_length = len(markdown)
    if not 0.55 <= len(translated) / source_length <= 2.2:
        raise ResourceError("La longitud de la traducción está fuera del rango seguro")
    return translated


def _safe_href(raw: str) -> str | None:
    href = raw.strip()
    parsed = urllib.parse.urlparse(href)
    if parsed.scheme and parsed.scheme not in {"http", "https"}:
        return None
    if parsed.username or parsed.password:
        return None
    return href


def _render_inline(value: str) -> str:
    placeholders: list[str] = []

    def hold(rendered: str) -> str:
        placeholders.append(rendered)
        return f"\x00{len(placeholders) - 1}\x00"

    def link(match: re.Match[str]) -> str:
        href = _safe_href(match.group(2))
        label = html.escape(match.group(1), quote=False)
        if href is None:
            return label
        return hold(f'<a href="{html.escape(href, quote=True)}" rel="noopener noreferrer">{label}</a>')

    value = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", link, value)
    escaped = html.escape(value, quote=False)
    escaped = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", escaped)
    escaped = re.sub(r"__(.+?)__", r"<strong>\1</strong>", escaped)
    escaped = re.sub(r"(?<!\*)\*([^*\n]+)\*(?!\*)", r"<em>\1</em>", escaped)
    escaped = re.sub(r"(?<!\w)_([^_\n]+)_(?!\w)", r"<em>\1</em>", escaped)
    escaped = re.sub(r"`([^`\n]+)`", r"<code>\1</code>", escaped)
    for index, rendered in enumerate(placeholders):
        escaped = escaped.replace(f"\x00{index}\x00", rendered)
    return escaped


def _render_markdown_body(markdown: str) -> str:
    lines = markdown.splitlines()
    output: list[str] = []
    paragraph: list[str] = []
    list_type: str | None = None
    blockquote: list[str] = []

    def flush_paragraph() -> None:
        if paragraph:
            output.append(f"<p>{_render_inline(' '.join(paragraph))}</p>")
            paragraph.clear()

    def flush_list() -> None:
        nonlocal list_type
        if list_type:
            output.append(f"</{list_type}>")
            list_type = None

    def flush_blockquote() -> None:
        if blockquote:
            output.append(f"<blockquote><p>{_render_inline(' '.join(blockquote))}</p></blockquote>")
            blockquote.clear()

    for raw_line in lines:
        line = raw_line.strip()
        if not line:
            flush_paragraph()
            flush_list()
            flush_blockquote()
            continue
        heading = re.match(r"^(#{1,6})\s+(.+)$", line)
        unordered = re.match(r"^[-*+]\s+(.+)$", line)
        ordered = re.match(r"^\d+[.)]\s+(.+)$", line)
        quote = re.match(r"^>\s?(.*)$", line)
        if heading:
            flush_paragraph()
            flush_list()
            flush_blockquote()
            level = min(len(heading.group(1)) + 1, 6)
            output.append(f"<h{level}>{_render_inline(heading.group(2))}</h{level}>")
        elif unordered or ordered:
            flush_paragraph()
            flush_blockquote()
            desired = "ul" if unordered else "ol"
            if list_type != desired:
                flush_list()
                output.append(f"<{desired}>")
                list_type = desired
            match = unordered or ordered
            assert match is not None
            output.append(f"<li>{_render_inline(match.group(1))}</li>")
        elif quote:
            flush_paragraph()
            flush_list()
            blockquote.append(quote.group(1))
        else:
            flush_list()
            flush_blockquote()
            paragraph.append(line)
    flush_paragraph()
    flush_list()
    flush_blockquote()
    return "\n        ".join(output)


def render_teacher_html(
    markdown: str,
    *,
    lesson_number: int,
    source_url: str,
    provider_url: str,
) -> str:
    metadata, body = _frontmatter(markdown)
    body_html = _render_markdown_body(body)
    title = f"Material para Maestros — Lección {lesson_number}"
    date = metadata.get("date", "")
    safe_source = html.escape(source_url, quote=True)
    safe_provider = html.escape(provider_url, quote=True)
    generated_at = datetime.now(timezone.utc).isoformat()
    return f"""<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="generator" content="Escuela Sabática CL · {PROMPT_VERSION}">
  <title>{html.escape(title)}</title>
</head>
<body>
  <article class="teacher-reading" data-lesson="{lesson_number}" data-generated-at="{html.escape(generated_at, quote=True)}">
    <h1>El sábado enseñaré...</h1>
    <p class="meta-info">Lección {lesson_number:02d} · {html.escape(date)}</p>
    <p class="source-credit">Fuente original: <a href="{safe_source}" rel="noopener noreferrer">Adult Sabbath School Bible Study Guide</a>, distribuida por <a href="{safe_provider}" rel="noopener noreferrer">Adventech</a>. Traducción al español preparada para Escuela Sabática CL.</p>
        {body_html}
  </article>
</body>
</html>
"""
