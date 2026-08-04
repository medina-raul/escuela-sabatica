#!/usr/bin/env python3
"""Audit: compare Spanish JSON vs English Adventech source."""

from __future__ import annotations

import json
import re
import sys
import urllib.request
from datetime import datetime

BASE_URL = "https://raw.githubusercontent.com/Adventech/sabbath-school-lessons/stage/src/en/2026-03"
JSON_PATH = "src/data/quarters/2026-q3.json"

DAY_IDS = ["sabado", "domingo", "lunes", "martes", "miercoles", "jueves", "viernes"]
DAY_NAMES_ES = ["Sábado", "Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes"]

issues = []

def fetch(url: str) -> str:
    try:
        with urllib.request.urlopen(url) as resp:
            return resp.read().decode("utf-8")
    except Exception as e:
        print(f"  ERROR fetching {url}: {e}", file=sys.stderr)
        return ""

def parse_frontmatter(text: str) -> tuple[dict, str]:
    if not text.startswith("---"):
        return {}, text
    parts = text.split("---", 2)
    if len(parts) < 3:
        return {}, text
    data = {}
    for line in parts[1].strip().split("\n"):
        line = line.strip()
        if ":" in line and not line.startswith("#"):
            key, _, val = line.partition(":")
            data[key.strip()] = val.strip().strip('"').strip("'")
    return data, parts[2].strip()

def en_date_to_iso(date_str: str) -> str:
    """DD/MM/YYYY -> YYYY-MM-DD."""
    parts = date_str.strip().split("/")
    if len(parts) == 3:
        return f"{parts[2]}-{parts[1]}-{parts[0]}"
    return date_str

# ── Load Spanish JSON ────────────────────────────────────────────
with open(JSON_PATH, encoding="utf-8") as f:
    quarter_es = json.load(f)

print("=" * 70)
print("AUDITORÍA DE CONTENIDO — Comparación Inglés vs Español")
print(f"Fuente: {BASE_URL}")
print("=" * 70)

# ── 1. Quarter info ──────────────────────────────────────────────
print("\n📋 1. METADATOS DEL TRIMESTRE")
info_en = {}
info_text = fetch(f"{BASE_URL}/info.yml")
if info_text:
    for line in info_text.strip().split("\n"):
        if ":" in line and not line.strip().startswith("#"):
            k, _, v = line.partition(":")
            info_en[k.strip()] = v.strip().strip('"').strip("'")

es_title = quarter_es.get("title", "")
en_title = info_en.get("title", "")
print(f"  Inglés : {en_title}")
print(f"  Español: {es_title}")
print(f"  Fechas : {info_en.get('start_date','')} – {info_en.get('end_date','')}")

# ── 2. Per-lesson audit ──────────────────────────────────────────
print("\n📋 2. LECCIONES — Títulos, fechas, días")

total_days_ok = 0
total_days_mismatch = 0
total_refs_issues = 0
total_content_empty = 0
title_issues = []

for n in range(1, 14):
    padded = f"{n:02d}"
    lesson_es = quarter_es["lessons"][n - 1]

    # Fetch English info.yml
    info_url = f"{BASE_URL}/{padded}/info.yml"
    info_text = fetch(info_url)
    info = {}
    if info_text:
        for line in info_text.strip().split("\n"):
            if ":" in line:
                k, _, v = line.partition(":")
                info[k.strip()] = v.strip().strip('"').strip("'")

    en_lesson_title = info.get("title", f"Lesson {n}")
    es_lesson_title = lesson_es.get("title", "")
    en_start = info.get("start_date", "")
    en_end = info.get("end_date", "")

    print(f"\n── Lección {n} ──")
    if en_lesson_title.lower().replace(" ","") != es_lesson_title.lower().replace(" ",""):
        print(f"  ⚠️  TÍTULO diferente:")
        print(f"     EN: {en_lesson_title}")
        print(f"     ES: {es_lesson_title}")
        title_issues.append((n, en_lesson_title, es_lesson_title))

    # Check dates
    es_start = lesson_es.get("startDate", "")
    if en_start and es_start != en_date_to_iso(en_start):
        print(f"  ⚠️  startDate: EN={en_start} → ES={es_start}")

    # ── 3. Day-by-day ──────────────────────────────────────────
    lesson_days_es = lesson_es.get("days", [])
    if len(lesson_days_es) != 7:
        print(f"  ⚠️  SOLO {len(lesson_days_es)} días (deberían ser 7)")

    for day_idx in range(1, 8):
        day_es = lesson_days_es[day_idx - 1] if day_idx <= len(lesson_days_es) else None
        if not day_es:
            print(f"     ❌ Día {day_idx} FALTANTE en ES")
            total_days_mismatch += 1
            continue

        day_id = day_es.get("id", "?")
        day_name = day_es.get("dayName", "?")

        # Fetch English .md
        day_url = f"{BASE_URL}/{padded}/{day_idx:02d}.md"
        day_text = fetch(day_url)
        if not day_text:
            print(f"     ❌ No se pudo obtener {padded}/{day_idx:02d}.md")
            continue

        fm, body = parse_frontmatter(day_text)

        # a) Day title
        en_day_title = fm.get("title", "")
        es_day_title = day_es.get("title", "")

        if en_day_title and en_day_title != es_day_title:
            # Check if the English title contains only basic Latin chars
            has_spanish = any(c in es_day_title for c in "áéíóúñüÁÉÍÓÚÑÜ")
            if not has_spanish and es_day_title.lower().replace(" ","") == en_day_title.lower().replace(" ",""):
                pass  # Same text, just casing
            elif en_day_title != es_day_title:
                print(f"     ⚠️  Día {day_idx} ({day_name}) título:")
                print(f"        EN: {en_day_title}")
                print(f"        ES: {es_day_title}")
                title_issues.append((n, day_idx, en_day_title, es_day_title))

        # b) Day date
        en_day_date = fm.get("date", "")
        es_day_date = day_es.get("date", "")
        if en_day_date:
            expected = en_date_to_iso(en_day_date)
            if es_day_date != expected:
                print(f"     ⚠️  Día {day_idx} ({day_name}) fecha:")
                print(f"        EN: {en_day_date} → esperado: {expected}")
                print(f"        ES: {es_day_date}")
                total_days_mismatch += 1
            else:
                total_days_ok += 1

        # c) contentMarkdown integrity
        content = day_es.get("contentMarkdown", "")
        if not content or len(content) < 50:
            total_content_empty += 1
            print(f"     ❌ Día {day_idx} ({day_name}) contentMarkdown vacío o muy corto ({len(content)} chars)")

        # d) Study references (Saturday only)
        if day_idx == 1:
            refs_es = day_es.get("studyReferences", [])
            ref_text_en = re.search(r"### Read for This Week.+?Study\n+(.+?)(?:\n>|\n\n)", day_text)
            if ref_text_en:
                ref_line = ref_text_en.group(1).strip()
                ref_count_en = len(re.split(r"[;,]", ref_line))
                ref_count_es = len(refs_es)
                if ref_count_es == 0:
                    print(f"     ⚠️  studyReferences VACÍO (EN tiene ~{ref_count_en} refs)")
                    total_refs_issues += 1
                elif ref_count_es < ref_count_en - 2:
                    print(f"     ⚠️  studyReferences sospechosos: EN ~{ref_count_en} refs, ES {ref_count_es} refs")
                    total_refs_issues += 1

        # e) Key verse (Saturday only)
        if day_idx == 1:
            kv_es = day_es.get("keyVerse")
            if kv_es and kv_es.get("text"):
                pass  # OK
            else:
                print(f"     ⚠️  keyVerse faltante o sin texto")

# ── 4. Summary ────────────────────────────────────────────────────
print("\n" + "=" * 70)
print("📊 RESUMEN")
print("=" * 70)

lessons_count = len(quarter_es["lessons"])
total_days = sum(len(l.get("days", [])) for l in quarter_es["lessons"])

print(f"  Lecciones: {lessons_count}/13")
print(f"  Total días: {total_days}/91")
print(f"  Fechas OK: {total_days_ok}")
print(f"  Fechas con error: {total_days_mismatch}")
print(f"  Títulos con diferencias: {len(title_issues)}")
print(f"  Referencias de estudio sospechosas: {total_refs_issues}")
print(f"  Días sin contenido (vacío/corto): {total_content_empty}")

if title_issues:
    print(f"\n  📝 Títulos que difieren (EN → ES):")
    for issue in title_issues:
        if len(issue) == 3:
            print(f"     Lec {issue[0]}: {issue[1]} → {issue[2]}")
        else:
            print(f"     Lec {issue[0]} día {issue[1]}: {issue[2]} → {issue[3]}")

print("\n✅ Auditoría completada.")
