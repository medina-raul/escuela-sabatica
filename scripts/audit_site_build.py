#!/usr/bin/env python3
"""Audit every local reference emitted by the static Astro build."""

from __future__ import annotations

import argparse
import json
import urllib.parse
from html.parser import HTMLParser
from pathlib import Path
from typing import Any

from resource_lib import PROJECT_ROOT, atomic_write_json


DEFAULT_DIST = PROJECT_ROOT / "dist"
DEFAULT_OUTPUT = PROJECT_ROOT / "artifacts/site-audit-report.json"
REFERENCE_ATTRIBUTES = {"href", "src", "poster"}


class ReferenceParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.references: list[tuple[str, str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        for name, value in attrs:
            if not value:
                continue
            if name in REFERENCE_ATTRIBUTES:
                self.references.append((name, value.strip()))
            elif name == "srcset":
                for candidate in value.split(","):
                    reference = candidate.strip().split(maxsplit=1)[0]
                    if reference:
                        self.references.append((name, reference))


def _candidate_paths(dist_root: Path, source_html: Path, reference: str) -> list[Path] | None:
    parsed = urllib.parse.urlsplit(reference)
    if parsed.scheme or parsed.netloc or reference.startswith("//"):
        return None
    if parsed.scheme in {"data", "blob", "mailto", "tel", "javascript"}:
        return None

    raw_path = urllib.parse.unquote(parsed.path)
    if not raw_path:
        return [source_html]
    if raw_path.startswith("/"):
        target = dist_root / raw_path.lstrip("/")
    else:
        target = source_html.parent / raw_path
    target = target.resolve()
    try:
        target.relative_to(dist_root)
    except ValueError:
        return []

    if raw_path.endswith("/"):
        return [target / "index.html"]
    if target.suffix:
        return [target]
    return [target / "index.html", target.with_suffix(".html")]


def audit_dist(dist_root: Path) -> dict[str, Any]:
    dist_root = dist_root.resolve()
    html_files = sorted(dist_root.rglob("*.html")) if dist_root.is_dir() else []
    issues: list[dict[str, str]] = []
    local_reference_count = 0

    if not html_files:
        issues.append({"code": "missing-build", "source": str(dist_root), "reference": ""})

    for html_path in html_files:
        parser = ReferenceParser()
        try:
            parser.feed(html_path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError) as exc:
            issues.append(
                {
                    "code": "invalid-html",
                    "source": str(html_path.relative_to(dist_root)),
                    "reference": str(exc),
                }
            )
            continue

        for attribute, reference in parser.references:
            candidates = _candidate_paths(dist_root, html_path, reference)
            if candidates is None:
                continue
            local_reference_count += 1
            if candidates and any(candidate.is_file() for candidate in candidates):
                continue
            issues.append(
                {
                    "code": "broken-local-reference" if candidates else "outside-build",
                    "source": str(html_path.relative_to(dist_root)),
                    "attribute": attribute,
                    "reference": reference,
                }
            )

    return {
        "schemaVersion": 1,
        "dist": str(dist_root),
        "pagesScanned": len(html_files),
        "localReferencesChecked": local_reference_count,
        "issues": issues,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dist", type=Path, default=DEFAULT_DIST)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    report = audit_dist(args.dist.resolve())
    atomic_write_json(args.output.resolve(), report)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 1 if report["issues"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
