#!/usr/bin/env python3
"""Audit the resource catalog, local files, checksums, and generated manifest."""

from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path

from resource_lib import (
    DEFAULT_CATALOG,
    DEFAULT_MANIFEST,
    all_resources,
    audit_catalog,
    issue_dicts,
    load_catalog,
    write_manifest,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", type=Path, default=DEFAULT_CATALOG)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--write-manifest", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    catalog = load_catalog(args.catalog.resolve())
    resources = all_resources(catalog)
    issues = audit_catalog(catalog)
    manifest = write_manifest(catalog, args.manifest.resolve()) if args.write_manifest else None
    counts = Counter(resource.get("type", "unknown") for resource in resources)
    report = {
        "quarterId": catalog.get("id"),
        "resourceCount": len(resources),
        "countsByType": dict(sorted(counts.items())),
        "localResourceCount": sum(resource.get("storage") == "local" for resource in resources),
        "externalResourceCount": sum(resource.get("storage") == "external" for resource in resources),
        "manifestChecksum": manifest.get("catalogChecksum") if manifest else None,
        "issues": issue_dicts(issues),
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 1 if any(issue.level == "error" for issue in issues) else 0


if __name__ == "__main__":
    raise SystemExit(main())
