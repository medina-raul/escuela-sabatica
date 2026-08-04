#!/usr/bin/env python3
"""Verify that production serves the exact local resource manifest and every local file."""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

from resource_lib import DEFAULT_MANIFEST, USER_AGENT


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--base-url", default="https://escuelasabatica.cl")
    parser.add_argument("--attempts", type=int, default=30)
    parser.add_argument("--interval", type=float, default=20.0)
    parser.add_argument("--timeout", type=float, default=20.0)
    parser.add_argument("--workers", type=int, default=8)
    return parser.parse_args()


def fetch_json(url: str, timeout: float) -> dict[str, Any]:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Cache-Control": "no-cache"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        content_type = response.headers.get("Content-Type", "")
        if "json" not in content_type.lower():
            raise RuntimeError(f"Content-Type inesperado para el manifiesto: {content_type}")
        return json.load(response)


def check_url(url: str, timeout: float) -> tuple[str, str | None]:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT}, method="HEAD")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            if 200 <= response.status < 400:
                return url, None
            return url, f"HTTP {response.status}"
    except urllib.error.HTTPError as exc:
        if exc.code not in {405, 501}:
            return url, f"HTTP {exc.code}"
        fallback = urllib.request.Request(
            url,
            headers={"User-Agent": USER_AGENT, "Range": "bytes=0-0"},
            method="GET",
        )
        try:
            with urllib.request.urlopen(fallback, timeout=timeout) as response:
                return (url, None) if 200 <= response.status < 400 else (url, f"HTTP {response.status}")
        except Exception as fallback_exc:
            return url, str(fallback_exc)
    except Exception as exc:
        return url, str(exc)


def main() -> int:
    args = parse_args()
    parsed_base = urllib.parse.urlparse(args.base_url)
    if parsed_base.scheme != "https" or not parsed_base.netloc:
        raise SystemExit("--base-url debe ser una URL HTTPS absoluta")

    expected = json.loads(args.manifest.resolve().read_text(encoding="utf-8"))
    manifest_url = urllib.parse.urljoin(args.base_url.rstrip("/") + "/", "resource-manifest.json")
    deployed: dict[str, Any] | None = None
    last_error = ""
    for attempt in range(1, args.attempts + 1):
        try:
            candidate = fetch_json(f"{manifest_url}?check={attempt}", args.timeout)
            if candidate.get("catalogChecksum") == expected.get("catalogChecksum"):
                deployed = candidate
                break
            last_error = (
                "checksum desplegado "
                f"{candidate.get('catalogChecksum')} != esperado {expected.get('catalogChecksum')}"
            )
        except Exception as exc:
            last_error = str(exc)
        if attempt < args.attempts:
            time.sleep(args.interval)

    if deployed is None:
        print(json.dumps({"status": "error", "manifest": manifest_url, "error": last_error}, ensure_ascii=False, indent=2))
        return 1

    local_urls = [
        urllib.parse.urljoin(args.base_url.rstrip("/") + "/", resource["url"].lstrip("/"))
        for resource in expected.get("resources", [])
        if resource.get("storage") == "local"
    ]
    failures: list[dict[str, str]] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as executor:
        for url, error in executor.map(lambda value: check_url(value, args.timeout), local_urls):
            if error:
                failures.append({"url": url, "error": error})

    report = {
        "status": "ok" if not failures else "error",
        "catalogChecksum": expected.get("catalogChecksum"),
        "resourceCount": expected.get("resourceCount"),
        "checkedLocalUrls": len(local_urls),
        "failures": failures,
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
