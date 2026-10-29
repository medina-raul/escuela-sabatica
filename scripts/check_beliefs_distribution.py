#!/usr/bin/env python3
"""Verify the imported beliefs corpus without printing its protected body text.

Run from any directory. Use --source-repo to compare every distributed byte
against the recorded Santa Biblia Git revision; --self-test tests the guards.
"""

import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import subprocess
import sys
import unittest


ROOT = Path(__file__).resolve().parents[1]
MANIFEST_PATH = "src/data/beliefs/distribution.json"
INDEX_PATH = "src/data/beliefs/beliefs.es.json"
SOURCE_COMMIT = "15c24467c895b353a3397ade55c2baaabd9cfece"
ARTWORK = {
    "dios": "scriptures.webp",
    "humanidad": "creation.webp",
    "salvacion": "salvation.webp",
    "iglesia": "church-v1.webp",
    "vida-cristiana": "christian-life-v1.webp",
    "restauracion": "restoration-v1.webp",
}
CHAPTER_COUNTS = (
    50, 40, 27, 36, 34, 24, 21, 4, 31, 24, 22, 25, 29, 36, 10, 13, 10,
    42, 150, 31, 12, 8, 66, 52, 5, 48, 12, 14, 3, 9, 1, 4, 7, 3, 3, 3,
    2, 14, 4, 28, 16, 24, 21, 28, 16, 16, 13, 6, 6, 4, 4, 5, 3, 6, 4,
    3, 1, 13, 5, 5, 3, 5, 1, 1, 1, 22,
)


def safe_path(value):
    if not isinstance(value, str) or not value or "\\" in value:
        raise ValueError("Invalid distribution path")
    path = PurePosixPath(value)
    if path.is_absolute() or ".." in path.parts or str(path) != value:
        raise ValueError("Distribution path must be normalized and relative")
    return value


def require(condition, message):
    if not condition:
        raise ValueError(message)


def verify_bytes(data, entry):
    require(len(data) == entry["bytes"], f"Byte count differs: {entry['path']}")
    require(hashlib.sha256(data).hexdigest() == entry["sha256"], f"SHA-256 differs: {entry['path']}")


def check_reference(reference, catalog):
    book_id = reference["bookId"]
    require(type(book_id) is int and book_id in catalog, "Unknown canonical book ID")
    book = catalog[book_id]
    require(reference["book"] == book["name"], "Book ID and name differ")
    first, last = reference["chapterStart"], reference["chapterEnd"]
    require(type(first) is int and type(last) is int, "Chapter endpoints must be integers")
    require(1 <= first <= last <= len(book["chapterVerseCounts"]), "Chapter range outside book")
    start, end = reference["verseStart"], reference["verseEnd"]
    require((start is None) == (end is None), "Verse endpoints must both be present or absent")
    if start is not None:
        require(type(start) is int and type(end) is int, "Verse endpoints must be integers")
        require(1 <= start <= book["chapterVerseCounts"][first - 1], "Starting verse outside chapter")
        require(1 <= end <= book["chapterVerseCounts"][last - 1], "Ending verse outside chapter")
        require(first != last or start <= end, "Reversed verse range")
    expected = f"b{book_id}-{first}-{start if start is not None else 'all'}-{last}-{end if end is not None else 'all'}"
    require(reference["id"] == expected, "Reference ID differs from its canonical range")
    require(isinstance(reference["label"], str) and reference["label"].strip(), "Missing reference label")


def utf16_text_slice(text, start, end):
    encoded = text.encode("utf-16-le")
    require(type(start) is int and type(end) is int, "Citation offsets must be integers")
    require(0 <= start < end <= len(encoded) // 2, "Citation offsets outside text")
    try:
        return encoded[start * 2:end * 2].decode("utf-16-le")
    except UnicodeDecodeError as error:
        raise ValueError("Citation splits a Unicode character") from error


def check_block(block, reference_ids, pdf_pages):
    require(block["kind"] in {"heading", "paragraph"}, "Unexpected content block kind")
    text = block["text"]
    require(isinstance(text, str) and text.strip(), "Empty content block")
    require(pdf_pages[0] <= block["pdfPage"] <= block.get("pdfPageEnd", block["pdfPage"]) <= pdf_pages[1], "Block outside recorded PDF pages")
    previous_end = 0
    used_ids = set()
    for citation in block.get("citations", []):
        start, end = citation["start"], citation["end"]
        require(start >= previous_end, "Overlapping or unsorted citation offsets")
        require(utf16_text_slice(text, start, end).strip(), "Empty citation text")
        ids = citation["referenceIds"]
        require(isinstance(ids, list) and ids, "Citation has no reference IDs")
        require(len(ids) == len(set(ids)), "Citation repeats a reference ID")
        require(set(ids) <= reference_ids, "Citation contains an unknown reference ID")
        used_ids.update(ids)
        previous_end = end
    for issue in block.get("citationIssues", []):
        require(utf16_text_slice(text, issue["start"], issue["end"]) == issue["text"], "Unresolved citation offsets do not match source text")
    return used_ids


def source_bytes(repo, commit, path):
    return subprocess.check_output(["git", "-C", str(repo), "show", f"{commit}:{path}"], stderr=subprocess.DEVNULL)


def check_distribution(root, source_repo=None):
    manifest = json.loads((root / MANIFEST_PATH).read_text(encoding="utf-8"))
    require(manifest["schemaVersion"] == 1, "Unsupported distribution schema")
    require(manifest["source"]["commit"] == SOURCE_COMMIT, "Unexpected canonical source revision")
    expected_paths = {INDEX_PATH}
    expected_paths.update(f"public/data/beliefs/chapters/{number:02}.json" for number in range(1, 29))
    expected_paths.update(f"public/images/beliefs/{name}" for name in ARTWORK.values())
    entries = manifest["files"]
    paths = [safe_path(entry["path"]) for entry in entries]
    require(len(paths) == len(set(paths)) == 35 and set(paths) == expected_paths, "Distribution must contain exactly the 35 expected files")
    for entry in entries:
        path = root / entry["path"]
        require(path.is_file() and not path.is_symlink(), f"Missing regular file: {entry['path']}")
        data = path.read_bytes()
        verify_bytes(data, entry)
        if entry["path"].endswith(".webp"):
            require(data[:4] == b"RIFF" and data[8:12] == b"WEBP", f"Invalid WebP: {entry['path']}")
        if source_repo:
            original = source_bytes(source_repo, SOURCE_COMMIT, safe_path(entry["sourcePath"]))
            require(data == original, f"Canonical source byte mismatch: {entry['path']}")

    catalog_books = manifest["referenceCatalog"]["books"]
    catalog = {book["id"]: book for book in catalog_books}
    require(len(catalog_books) == len(catalog) == 66 and set(catalog) == set(range(1, 67)), "Reference catalog must cover 66 canonical books")
    for book_id, book in catalog.items():
        counts = book["chapterVerseCounts"]
        require(len(counts) == CHAPTER_COUNTS[book_id - 1] and all(type(count) is int and count > 0 for count in counts), "Invalid reference validation catalog")

    index = json.loads((root / INDEX_PATH).read_text(encoding="utf-8"))
    beliefs = index["beliefs"]
    require(len(beliefs) == 28 and [belief["number"] for belief in beliefs] == list(range(1, 29)), "Belief numbers must be exactly 1 through 28")
    require(len({belief["slug"] for belief in beliefs}) == 28 and all(belief["slug"] for belief in beliefs), "Belief slugs must be unique and nonempty")
    require(len({belief["id"] for belief in beliefs}) == 28, "Belief IDs must be unique")
    require(index["contentVersion"] == manifest["source"]["contentVersion"], "Source version metadata differs")
    categories = {category["id"]: category for category in index["categories"]}
    require(len(categories) == len(index["categories"]) == 6 and set(categories) == set(ARTWORK), "Unexpected category set")
    require(manifest["categoryArtwork"] == {category: f"/images/beliefs/{name}" for category, name in ARTWORK.items()}, "Category artwork paths differ")
    category_numbers = [number for category in categories.values() for number in category["beliefNumbers"]]
    require(sorted(category_numbers) == list(range(1, 29)), "Category membership must partition all 28 beliefs")
    chapter_files = {path.name for path in (root / "public/data/beliefs/chapters").glob("*.json")}
    require(chapter_files == {f"{number:02}.json" for number in range(1, 29)}, "Chapter directory must contain exactly 28 JSON files")

    counts = {"beliefs": 28, "chapters": 28, "officialReferences": 0, "expandedReferences": 0, "blocks": 0, "citations": 0}
    unresolved = 0
    for belief in beliefs:
        number = belief["number"]
        require(belief["id"] == f"belief-{number:02}", f"Belief {number}: ID differs from number")
        require(number in categories[belief["categoryId"]]["beliefNumbers"], f"Belief {number}: category differs")
        for reference in belief["references"]:
            check_reference(reference, catalog)
        counts["officialReferences"] += len(belief["references"])
        chapter = json.loads((root / f"public/data/beliefs/chapters/{number:02}.json").read_text(encoding="utf-8"))
        require(chapter["beliefNumber"] == number, f"Chapter {number}: belief number differs")
        book_pages = belief["source"]["book2007"]
        require(chapter["printedPages"] == [book_pages["printedStartPage"], book_pages["printedEndPage"]], f"Chapter {number}: printed page range differs")
        require(chapter["pdfPages"] == [book_pages["pdfStartPage"], book_pages["pdfEndPage"]], f"Chapter {number}: PDF page range differs")
        reference_ids = set()
        for reference in chapter["references"]:
            check_reference(reference, catalog)
            require(reference["id"] not in reference_ids, f"Chapter {number}: duplicate reference ID")
            reference_ids.add(reference["id"])
        used_ids = set()
        for block in chapter["blocks"]:
            used_ids.update(check_block(block, reference_ids, chapter["pdfPages"]))
            counts["citations"] += len(block.get("citations", []))
            unresolved += len(block.get("citationIssues", []))
        require(used_ids == reference_ids, f"Chapter {number}: references missing from citation spans")
        counts["blocks"] += len(chapter["blocks"])
        counts["expandedReferences"] += len(chapter["references"])
    require(counts == manifest["counts"], "Corpus totals differ from distribution manifest")
    require(counts["officialReferences"] == 383 and counts["expandedReferences"] == 3147, "Reference totals differ from reviewed release")
    return {"status": "ok", "sourceCommit": SOURCE_COMMIT, "files": len(entries), "bytes": sum(entry["bytes"] for entry in entries), **counts, "unresolvedCitationSpansPreserved": unresolved, "canonicalBytesCompared": bool(source_repo)}


class IntegrityGuardsTest(unittest.TestCase):
    def setUp(self):
        self.catalog = {19: {"name": "Salmos", "chapterVerseCounts": [6, 12]}}
        self.reference = {"bookId": 19, "book": "Salmos", "chapterStart": 1, "chapterEnd": 1, "verseStart": 1, "verseEnd": 6, "id": "b19-1-1-1-6", "label": "Salmos 1:1-6"}

    def test_reference_accepts_full_chapter_and_cross_chapter_ranges(self):
        check_reference(self.reference, self.catalog)
        check_reference({**self.reference, "verseStart": None, "verseEnd": None, "id": "b19-1-all-1-all"}, self.catalog)
        check_reference({**self.reference, "chapterEnd": 2, "verseEnd": 12, "id": "b19-1-1-2-12"}, self.catalog)

    def test_reference_rejects_out_of_range_and_mismatched_ids(self):
        for changed in ({"bookId": 67}, {"chapterEnd": 3}, {"verseEnd": 7}, {"verseStart": 6, "verseEnd": 1}, {"id": "wrong"}):
            with self.subTest(changed=changed), self.assertRaises(ValueError):
                check_reference({**self.reference, **changed}, self.catalog)

    def test_offsets_use_browser_utf16_units(self):
        self.assertEqual(utf16_text_slice("a😀bc", 3, 5), "bc")
        with self.assertRaises(ValueError):
            utf16_text_slice("a😀bc", 2, 3)

    def test_citations_reject_unknown_ids_and_overlapping_offsets(self):
        block = {"kind": "paragraph", "text": "Sal. 1:1", "pdfPage": 1, "citations": [{"start": 0, "end": 8, "referenceIds": ["known"]}]}
        self.assertEqual(check_block(block, {"known"}, [1, 1]), {"known"})
        with self.assertRaises(ValueError):
            check_block(block, {"other"}, [1, 1])
        with self.assertRaises(ValueError):
            check_block({**block, "citations": block["citations"] * 2}, {"known"}, [1, 1])

    def test_paths_and_hashes_reject_damaged_distribution(self):
        for path in ("../outside.json", "/absolute.json", "a/../b.json", "a\\b.json"):
            with self.subTest(path=path), self.assertRaises(ValueError):
                safe_path(path)
        data = b"reviewed"
        entry = {"path": "file.json", "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
        verify_bytes(data, entry)
        with self.assertRaises(ValueError):
            verify_bytes(b"modified", entry)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT, help="Escuela Sabática checkout root")
    parser.add_argument("--source-repo", type=Path, help="Optional local Santa Biblia Git checkout")
    parser.add_argument("--self-test", action="store_true", help="Run integrity guard regression tests")
    args = parser.parse_args()
    if args.self_test:
        result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(IntegrityGuardsTest))
        return 0 if result.wasSuccessful() else 1
    try:
        print(json.dumps(check_distribution(args.root.resolve(), args.source_repo), ensure_ascii=False, indent=2))
        return 0
    except (ValueError, KeyError, TypeError, OSError, subprocess.CalledProcessError) as error:
        print(f"Beliefs distribution check failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
