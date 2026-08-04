#!/usr/bin/env python3
"""Extract Sabbath School content from Adventech GitHub repo into Quarter JSON."""

from __future__ import annotations

import json
import re
import sys
import urllib.request
from pathlib import Path

BASE_URL = "https://raw.githubusercontent.com/Adventech/sabbath-school-lessons/stage/src/en/2026-03"
OUTPUT = Path("src/data/quarters/2026-q3-en.json")

DAY_NAMES_ES = ["Sábado", "Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes"]
DAY_IDS = ["sabado", "domingo", "lunes", "martes", "miercoles", "jueves", "viernes"]

MONTHS_EN = {
    "January": 1, "February": 2, "March": 3, "April": 4, "May": 5, "June": 6,
    "July": 7, "August": 8, "September": 9, "October": 10, "November": 11, "December": 12,
}

MONTHS_ES = [
    "", "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
]

BIBLE_BOOKS = [
    "Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy",
    "Joshua", "Judges", "Ruth", "1 Samuel", "2 Samuel",
    "1 Kings", "2 Kings", "1 Chronicles", "2 Chronicles",
    "Ezra", "Nehemiah", "Esther", "Job", "Psalms", "Proverbs",
    "Ecclesiastes", "Song of Solomon", "Isaiah", "Jeremiah",
    "Lamentations", "Ezekiel", "Daniel", "Hosea", "Joel", "Amos",
    "Obadiah", "Jonah", "Micah", "Nahum", "Habakkuk",
    "Zephaniah", "Haggai", "Zechariah", "Malachi",
    "Matthew", "Mark", "Luke", "John",
    "Acts", "Romans", "1 Corinthians", "2 Corinthians",
    "Galatians", "Ephesians", "Philippians", "Colossians",
    "1 Thessalonians", "2 Thessalonians", "1 Timothy", "2 Timothy",
    "Titus", "Philemon", "Hebrews", "James",
    "1 Peter", "2 Peter", "1 John", "2 John", "3 John",
    "Jude", "Revelation",
]

BIBLE_BOOKS_ES = [
    "Génesis", "Éxodo", "Levítico", "Números", "Deuteronomio",
    "Josué", "Jueces", "Rut", "1 Samuel", "2 Samuel",
    "1 Reyes", "2 Reyes", "1 Crónicas", "2 Crónicas",
    "Esdras", "Nehemías", "Ester", "Job", "Salmos", "Proverbios",
    "Eclesiastés", "Cantares", "Isaías", "Jeremías",
    "Lamentaciones", "Ezequiel", "Daniel", "Oseas", "Joel", "Amós",
    "Abdías", "Jonás", "Miqueas", "Nahúm", "Habacuc",
    "Sofonías", "Hageo", "Zacarías", "Malaquías",
    "Mateo", "Marcos", "Lucas", "Juan",
    "Hechos", "Romanos", "1 Corintios", "2 Corintios",
    "Gálatas", "Efesios", "Filipenses", "Colosenses",
    "1 Tesalonicenses", "2 Tesalonicenses", "1 Timoteo", "2 Timoteo",
    "Tito", "Filemón", "Hebreos", "Santiago",
    "1 Pedro", "2 Pedro", "1 Juan", "2 Juan", "3 Juan",
    "Judas", "Apocalipsis",
]

EN_TO_ES_BOOK = dict(zip(BIBLE_BOOKS, BIBLE_BOOKS_ES))
# Add abbreviated forms
EN_TO_ES_BOOK.update({
    "Gen": "Génesis", "Exod": "Éxodo", "Lev": "Levítico", "Num": "Números", "Deut": "Deuteronomio",
    "Josh": "Josué", "Judg": "Jueces", "Ruth": "Rut", "Sam": "Samuel",
    "Kings": "Reyes", "Chron": "Crónicas", "Neh": "Nehemías", "Esth": "Ester",
    "Ps": "Salmos", "Prov": "Proverbios", "Eccl": "Eclesiastés", "Song": "Cantares",
    "Isa": "Isaías", "Jer": "Jeremías", "Lam": "Lamentaciones", "Ezek": "Ezequiel",
    "Dan": "Daniel", "Hos": "Oseas", "Joel": "Joel", "Amos": "Amós",
    "Obad": "Abdías", "Jonah": "Jonás", "Mic": "Miqueas", "Nah": "Nahúm", "Hab": "Habacuc",
    "Zeph": "Sofonías", "Hag": "Hageo", "Zech": "Zacarías", "Mal": "Malaquías",
    "Matt": "Mateo", "Mark": "Marcos", "Luke": "Lucas", "John": "Juan",
    "Acts": "Hechos", "Rom": "Romanos", "Cor": "Corintios", "Gal": "Gálatas",
    "Eph": "Efesios", "Phil": "Filipenses", "Col": "Colosenses", "Thess": "Tesalonicenses",
    "Tim": "Timoteo", "Titus": "Tito", "Philem": "Filemón", "Heb": "Hebreos",
    "Jas": "Santiago", "James": "Santiago", "Pet": "Pedro", "Rev": "Apocalipsis",
})


def fetch(url: str) -> str:
    """Fetch text from URL."""
    try:
        with urllib.request.urlopen(url) as resp:
            return resp.read().decode("utf-8")
    except Exception as e:
        print(f"  WARN: failed to fetch {url}: {e}", file=sys.stderr)
        return ""


def parse_yaml_frontmatter(text: str) -> tuple[dict, str]:
    """Parse YAML frontmatter delimited by ---. Returns (data, remaining_body)."""
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


def parse_date_en(date_str: str) -> str:
    """Parse DD/MM/YYYY to YYYY-MM-DD."""
    parts = date_str.strip().split("/")
    if len(parts) == 3:
        return f"{parts[2]}-{parts[1]}-{parts[0]}"
    return date_str


def format_date_range_es(start_str: str, end_str: str) -> str:
    """Format date range in Spanish like '27 de junio - 3 de julio'."""
    s = parse_date_en(start_str)
    e = parse_date_en(end_str)
    if not s or not e:
        return ""
    try:
        sd = s.split("-")
        ed = e.split("-")
        if sd[1] == ed[1]:
            return f"{int(sd[2])} - {int(ed[2])} de {MONTHS_ES[int(sd[1])]}"
        return f"{int(sd[2])} de {MONTHS_ES[int(sd[1])]} - {int(ed[2])} de {MONTHS_ES[int(ed[1])]}"
    except (ValueError, IndexError):
        return f"{start_str} / {end_str}"


def parse_bible_reference(ref_str: str) -> dict | None:
    """Parse English Bible reference like '1 Cor. 1:1' or 'Acts 17:16-34'."""
    ref_str = ref_str.strip().rstrip(",;.")
    if not ref_str:
        return None

    ref_str = re.sub(r",\s*(\d+)\s*$", r"-\1", ref_str)  # "9, 10" -> "9-10"
    ref_str = re.sub(r"\b(Cor|Thess|Tim|Pet|Chron|Kings|Sam|Rom|Gal|Eph|Phil|Col|Heb|Jas|Rev|Gen|Exod|Lev|Num|Deut|Josh|Judg|Neh|Esth|Ps|Prov|Eccl|Song|Isa|Jer|Lam|Ezek|Dan|Hos|Amos|Obad|Mic|Nah|Hab|Zeph|Hag|Zech|Mal|Matt|Mark|Luke|Acts|Titus|Philem)\.", r"\1", ref_str)

    pattern = r"^(\d?\s*(?:[A-Za-záéíóúñüÁÉÍÓÚÑÜ]+(?:\s+\d+)?))\s+(\d+):(\d+)(?:[\u2013\u2014\-](\d+))?$"
    match = re.match(pattern, ref_str)
    if not match:
        return None

    book_en = match.group(1).strip()
    chapter = int(match.group(2))
    verse_start = int(match.group(3))
    verse_end = int(match.group(4)) if match.group(4) else None

    book_es = EN_TO_ES_BOOK.get(book_en, book_en)

    if verse_end and verse_end != verse_start:
        display = f"{book_es} {chapter}:{verse_start}-{verse_end}"
    else:
        display = f"{book_es} {chapter}:{verse_start}"
        verse_end = None

    return {
        "book": book_es,
        "chapter": chapter,
        "verseStart": verse_start,
        "display": display,
    }


def parse_study_references(text: str) -> list[dict]:
    """Parse study references line like '1 Cor. 1:1; Gal. 1:1; Acts 17:16-34; ...'"""
    refs = []
    parts = re.split(r"[;,]\s*", text.strip().rstrip("."))
    for part in parts:
        part = part.strip().rstrip(".")
        if not part:
            continue
        ref = parse_bible_reference(part)
        if ref:
            refs.append(ref)
    return refs


def parse_memory_verse(text: str) -> tuple[str, str] | None:
    """Parse memory verse from blockquote. Returns (text, reference_display) or None."""
    match = re.search(r"> .+?\(([^)]+)\)", text, re.DOTALL)
    if not match:
        match2 = re.search(r">\s*\u201c(.+?)\u201d\s*\(([^)]+)\)", text)
        if match2:
            verse_text = match2.group(1).strip()
            ref_str = match2.group(2).strip().split(",")[0].strip()
            ref_str = re.sub(r",?\s*(NRSV|NIV|NKJV|KJV|ESV|NASB)\s*$", "", ref_str).strip()
            ref_str = re.sub(r",\s*(\d+)\s*$", r"-\1", ref_str)
            ref = parse_bible_reference(ref_str)
            display = ref["display"] if ref else ref_str
            return verse_text, display
        return None

    prefix = text[:match.start()]
    verse_match = re.search(r">\s*(.+?)\s*\([^)]+\)", text, re.DOTALL)
    raw = ""
    if verse_match:
        raw = verse_match.group(1).strip()
        raw = re.sub(r"<[^>]+>", "", raw)
        raw = re.sub(r"^>\s*", "", raw, flags=re.MULTILINE)
        raw = raw.strip().strip('"').strip("'").strip("\u201c").strip("\u201d").strip()

    ref_str = match.group(1).strip().split(",")[0].strip()
    ref_str = re.sub(r",?\s*(NRSV|NIV|NKJV|KJV|ESV|NASB)\s*$", "", ref_str).strip()
    ref_str = re.sub(r",\s*(\d+)\s*$", r"-\1", ref_str)
    ref = parse_bible_reference(ref_str)
    display = ref["display"] if ref else ref_str

    if raw:
        return raw, display
    return None


def extract_egw_notes(content: str) -> str | None:
    """Extract Additional Reading EGW section."""
    match = re.search(r"#### Additional Reading: Selected Quotes from Ellen G\. White\s*\n(.*?)(?:\n---|\Z)", content, re.DOTALL)
    if not match:
        return None
    egw_text = match.group(1).strip()
    # Clean up: remove backslash at end of lines (line continuation)
    egw_text = re.sub(r"\\\n", " ", egw_text)
    # Truncate for sidebar display
    if len(egw_text) > 500:
        egw_text = egw_text[:500] + "..."
    return egw_text


def parse_saturday(content: str) -> dict:
    """Parse Saturday (01.md) file."""
    day_data = {"studyReferences": [], "keyVerse": None, "contentMarkdown": content}

    # Extract study references from "Read for This Week's Study"
    ref_match = re.search(r"### Read for This Week[\u2019']s Study\n+(.+?)(?:\n>|\n\n)", content)
    if ref_match:
        refs = parse_study_references(ref_match.group(1).strip())
        day_data["studyReferences"] = refs

    # Extract memory verse
    mv = parse_memory_verse(content)
    if mv:
        verse_text, ref_display = mv
        ref = parse_bible_reference(ref_display)
        day_data["keyVerse"] = {
            "reference": ref if ref else {"book": "", "chapter": 0, "verseStart": 0, "display": ref_display},
            "text": verse_text,
        }

    return day_data


def fetch_lesson(lesson_num: str) -> dict | None:
    """Fetch and parse a complete lesson from Adventech."""
    padded = f"{int(lesson_num):02d}"

    # Fetch lesson info.yml
    info_url = f"{BASE_URL}/{padded}/info.yml"
    info_text = fetch(info_url)
    if not info_text:
        print(f"  Skipping lesson {padded}: no info.yml")
        return None

    info = {}
    for line in info_text.strip().split("\n"):
        if ":" in line:
            k, _, v = line.partition(":")
            info[k.strip()] = v.strip().strip('"').strip("'")

    title = info.get("title", f"Lesson {lesson_num}")
    start_date = info.get("start_date", "")
    end_date = info.get("end_date", "")

    lesson = {
        "number": int(lesson_num),
        "title": title,
        "dateRange": format_date_range_es(start_date, end_date),
        "startDate": parse_date_en(start_date),
        "endDate": parse_date_en(end_date),
        "summary": "",
        "image": f"/images/lecciones/lecc{lesson_num}.jpg",
        "days": [],
        "resources": [],
    }

    all_egw_parts = []

    for day_idx in range(1, 8):
        day_url = f"{BASE_URL}/{padded}/{day_idx:02d}.md"
        day_text = fetch(day_url)
        if not day_text:
            print(f"  WARN: missing {padded}/{day_idx:02d}.md")
            continue

        frontmatter, body = parse_yaml_frontmatter(day_text)
        day_title = frontmatter.get("title", DAY_NAMES_ES[day_idx - 1])
        day_date = frontmatter.get("date", "")

        day_entry = {
            "id": DAY_IDS[day_idx - 1],
            "dayName": DAY_NAMES_ES[day_idx - 1],
            "date": parse_date_en(day_date),
            "title": day_title,
            "contentMarkdown": body,
            "studyReferences": [],
            "keyVerse": None,
        }

        if day_idx == 1:
            # Saturday: extract special sections
            sat_data = parse_saturday(body)
            day_entry["studyReferences"] = sat_data["studyReferences"]
            day_entry["keyVerse"] = sat_data["keyVerse"]
            if day_entry["keyVerse"]:
                lesson["keyVerse"] = day_entry["keyVerse"]

        # Extract EGW notes from Additional Reading
        egw = extract_egw_notes(day_text)
        if egw:
            all_egw_parts.append(egw)

        lesson["days"].append(day_entry)

    # Combine EGW notes for the sidebar
    if all_egw_parts:
        combined = " ".join(all_egw_parts)
        lesson["egwNotes"] = combined[:600] + "..." if len(combined) > 600 else combined

    # Summary from first day's first paragraph
    if lesson["days"]:
        first_body = lesson["days"][0]["contentMarkdown"]
        # Skip headings and study refs section
        body_start = 0
        for line in first_body.split("\n"):
            if line.strip() and not line.startswith("#") and not line.startswith(">") and not line.startswith("_") and not line.startswith("*"):
                body_start = first_body.index(line)
                break
        summary = first_body[body_start:body_start+300].strip()
        lesson["summary"] = summary

    return lesson


def fetch_quarter_info() -> dict:
    """Fetch quarter-level info.yml."""
    info_url = f"{BASE_URL}/info.yml"
    info_text = fetch(info_url)
    data = {}
    if info_text:
        for line in info_text.strip().split("\n"):
            if ":" in line and not line.strip().startswith("#"):
                key, _, val = line.partition(":")
                val = val.strip().strip('"').strip("'")
                if val:
                    data[key.strip()] = val
    return data


def slugify(text: str) -> str:
    """Generate a URL-friendly slug from text."""
    text = text.lower().strip()
    text = re.sub(r"[áàäâ]", "a", text)
    text = re.sub(r"[éèëê]", "e", text)
    text = re.sub(r"[íìïî]", "i", text)
    text = re.sub(r"[óòöô]", "o", text)
    text = re.sub(r"[úùüû]", "u", text)
    text = re.sub(r"[ñ]", "n", text)
    text = re.sub(r"[^a-z0-9]+", "-", text)
    text = text.strip("-")
    return text


def main() -> int:
    print("Fetching quarter info...")
    info = fetch_quarter_info()

    quarter = {
        "id": "2026-q3",
        "title": info.get("title", "1 and 2 Corinthians"),
        "subtitle": "Estudiemos juntos la Palabra de Dios y crezcamos en gracia y conocimiento.",
        "dateRange": "Julio - Septiembre 2026",
        "year": 2026,
        "quarterNumber": 3,
        "description": info.get("description", ""),
        "coverImage": "/images/cover-2026-q3.png",
        "lessons": [],
        "resources": [],
    }

    # Este importador solo genera contenido. Los recursos se administran
    # exclusivamente en el catálogo activo mediante update_resources.py.

    memory_verse = None

    for n in range(1, 14):
        lesson_num = f"{n:02d}"
        print(f"Fetching lesson {n}/13...")
        lesson = fetch_lesson(str(n))

        if lesson:
            # Generate ID
            title_slug = slugify(lesson["title"])
            lesson["id"] = f"leccion-{n:02d}-{title_slug}"

            if not memory_verse and lesson.get("keyVerse"):
                memory_verse = lesson["keyVerse"]

            quarter["lessons"].append(lesson)

    if memory_verse:
        quarter["keyVerse"] = memory_verse

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(quarter, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"\nGenerated {OUTPUT}")
    print(f"  Lessons: {len(quarter['lessons'])}")
    print(f"  Total days: {sum(len(l['days']) for l in quarter['lessons'])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
