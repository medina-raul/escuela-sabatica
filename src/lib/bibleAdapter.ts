import type { BiblePassage, BibleReference, BibleVerse } from "@app-types/bible";

type BookMeta = { id: number; name: string; file: string; chapters: number; slug: string };
type BibleVerseData = { verse: number; text: string };
type BibleChapterData = { verses: BibleVerseData[] };

const BASE = "https://www.santabiblia.cloud/data";
const normalize = (v: string) => v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

// Book name aliases: common abbreviations → full Spanish name
const BOOK_ALIASES: Record<string, string> = {
  "gen": "Génesis", "exo": "Éxodo", "exod": "Éxodo",
  "lev": "Levítico", "num": "Números", "deut": "Deuteronomio",
  "jos": "Josué", "josh": "Josué", "jue": "Jueces", "judg": "Jueces",
  "rut": "Rut", "ruth": "Rut",
  "1 sam": "1 Samuel", "2 sam": "2 Samuel",
  "1 rey": "1 Reyes", "2 rey": "2 Reyes", "1 reyes": "1 Reyes", "2 reyes": "2 Reyes",
  "1 kings": "1 Reyes", "2 kings": "2 Reyes",
  "1 cron": "1 Crónicas", "2 cron": "2 Crónicas", "1 cro": "1 Crónicas", "2 cro": "2 Crónicas",
  "esd": "Esdras", "ezra": "Esdras", "neh": "Nehemías", "est": "Ester",
  "job": "Job", "sal": "Salmos", "salm": "Salmos", "ps": "Salmos", "psalms": "Salmos",
  "prov": "Proverbios", "ecl": "Eclesiastés", "eccles": "Eclesiastés",
  "cant": "Cantares", "song": "Cantares",
  "isa": "Isaías", "isaias": "Isaías", "jer": "Jeremías", "jerem": "Jeremías",
  "lam": "Lamentaciones", "eze": "Ezequiel", "ezek": "Ezequiel",
  "dan": "Daniel", "os": "Oseas", "ose": "Oseas", "hos": "Oseas",
  "joel": "Joel", "amós": "Amós", "amos": "Amós",
  "abd": "Abdías", "obad": "Abdías", "jon": "Jonás", "jonas": "Jonás",
  "miq": "Miqueas", "mic": "Miqueas", "nah": "Nahúm", "hab": "Habacuc",
  "sof": "Sofonías", "zeph": "Sofonías", "hag": "Hageo", "zac": "Zacarías",
  "mal": "Malaquías", "malaquias": "Malaquías",
  "mat": "Mateo", "matt": "Mateo", "mar": "Marcos", "mark": "Marcos",
  "luc": "Lucas", "luke": "Lucas", "jua": "Juan", "john": "Juan",
  "hech": "Hechos", "hechos": "Hechos", "acts": "Hechos",
  "rom": "Romanos", "roman": "Romanos",
  "1 cor": "1 Corintios", "2 cor": "2 Corintios",
  "1co": "1 Corintios", "2co": "2 Corintios",
  "gal": "Gálatas", "galatas": "Gálatas", "ef": "Efesios", "eph": "Efesios",
  "fil": "Filipenses", "phil": "Filipenses",
  "col": "Colosenses", "colosenses": "Colosenses",
  "1 tes": "1 Tesalonicenses", "2 tes": "2 Tesalonicenses",
  "1 thes": "1 Tesalonicenses", "2 thes": "2 Tesalonicenses",
  "1 thess": "1 Tesalonicenses", "2 thess": "2 Tesalonicenses",
  "1 tim": "1 Timoteo", "2 tim": "2 Timoteo",
  "1 timoteo": "1 Timoteo", "2 timoteo": "2 Timoteo",
  "tit": "Tito", "tito": "Tito", "titus": "Tito",
  "flm": "Filemón", "filemon": "Filemón", "philem": "Filemón",
  "heb": "Hebreos", "hebreos": "Hebreos",
  "sant": "Santiago", "santiago": "Santiago", "stgo": "Santiago", "jas": "Santiago", "james": "Santiago",
  "1 pe": "1 Pedro", "2 pe": "2 Pedro", "1 pedro": "1 Pedro", "2 pedro": "2 Pedro",
  "1 pet": "1 Pedro", "2 pet": "2 Pedro",
  "1 jua": "1 Juan", "2 jua": "2 Juan", "3 jua": "3 Juan",
  "1 jn": "1 Juan", "2 jn": "2 Juan", "3 jn": "3 Juan",
  "jud": "Judas", "judas": "Judas", "jude": "Judas",
  "apoc": "Apocalipsis", "apocalipsis": "Apocalipsis", "rev": "Apocalipsis",
};

function resolveBookName(bookName: string): string {
  return BOOK_ALIASES[normalize(bookName)] || bookName;
}

// ---- Manifest cache ----
let manifestCache: BookMeta[] | null = null;

async function fetchManifest(): Promise<BookMeta[]> {
  if (manifestCache) return manifestCache;
  const res = await fetch(`${BASE}/books.json`);
  manifestCache = await res.json();
  return manifestCache!;
}

function getBookMeta(bookName: string, manifest: BookMeta[]): BookMeta | undefined {
  const resolved = resolveBookName(bookName);
  return manifest.find(b => normalize(b.name) === normalize(resolved));
}

// ---- Bible chapter cache ----
// Santa Biblia publica capítulos independientes. Mantener el consumidor en
// este contrato evita descargar un libro entero para mostrar una referencia.
const chapterCache = new Map<string, BibleChapterData>();
const MAX_CHAPTER_CACHE = 36;

function normalizeVersion(version: string): string {
  return version.trim().toLowerCase() || "rva2015";
}

function normalizeVerses(payload: unknown): BibleVerseData[] {
  const candidate = Array.isArray(payload)
    ? payload
    : (payload as { verses?: unknown } | null)?.verses;

  if (!Array.isArray(candidate)) {
    throw new Error("Formato de capítulo bíblico no reconocido.");
  }

  const verses = candidate
    .filter((item): item is BibleVerseData => (
      Boolean(item)
      && typeof item === "object"
      && Number.isInteger((item as BibleVerseData).verse)
      && typeof (item as BibleVerseData).text === "string"
    ))
    .sort((a, b) => a.verse - b.verse);

  if (verses.length === 0) {
    throw new Error("El capítulo bíblico no contiene versículos válidos.");
  }

  return verses;
}

async function loadChapter(version: string, book: BookMeta, chapter: number): Promise<BibleChapterData> {
  const safeVersion = normalizeVersion(version);
  const key = `${safeVersion}:${book.id}:${chapter}`;
  if (chapterCache.has(key)) return chapterCache.get(key)!;

  const res = await fetch(`${BASE}/${safeVersion}/${book.file}/${chapter}.json`);
  if (!res.ok) {
    throw new Error(`No fue posible cargar ${book.name} ${chapter}.`);
  }

  const verses = normalizeVerses(await res.json());
  const data = { verses };
  chapterCache.set(key, data);
  while (chapterCache.size > MAX_CHAPTER_CACHE) {
    const oldestKey = chapterCache.keys().next().value;
    if (!oldestKey) break;
    chapterCache.delete(oldestKey);
  }
  return data;
}

// ---- Public API ----

export async function getPassage(
  reference: BibleReference,
  version = "RVA2015",
): Promise<BiblePassage> {
  const manifest = await fetchManifest();
  const bookMeta = getBookMeta(reference.book, manifest);
  if (!bookMeta) {
    return { reference, version, verses: [{ number: reference.verseStart, text: "Libro no encontrado." }] };
  }

  const safeVersion = normalizeVersion(version);
  const chapter = await loadChapter(safeVersion, bookMeta, reference.chapter);
  // Chapter-only reference: show all verses
  if (!reference.verseStart || reference.verseStart === 0) {
    const verses: BibleVerse[] = chapter.verses.map(v => ({ number: v.verse, text: v.text }));
    return { reference, version: safeVersion, verses };
  }
  // toEnd: show from verseStart to end of chapter
  // crossChapter: show from verseStart to end of first chapter + start of next chapter to crossChapter.verseEnd
  let verseEnd: number;
  if (reference.toEnd) {
    verseEnd = chapter.verses.at(-1)?.verse ?? reference.verseStart;
  } else {
    verseEnd = reference.verseEnd ?? reference.verseStart;
  }

  let verses: BibleVerse[] = chapter.verses
    .filter(v => v.verse >= reference.verseStart && v.verse <= verseEnd)
    .map(v => ({ number: v.verse, text: v.text })) ?? [];

  // Append cross-chapter verses if present
  if (reference.crossChapter) {
    const nextChapter = await loadChapter(safeVersion, bookMeta, reference.crossChapter.chapter);
    const crossVerses = nextChapter.verses
      .filter(v => v.verse <= reference.crossChapter!.verseEnd)
      .map(v => ({ number: v.verse, text: v.text }));
    verses = verses.concat(crossVerses);
  }

  return {
    reference,
    version: safeVersion,
    verses: verses.length > 0
      ? verses
      : [{ number: reference.verseStart, text: "Versículo no disponible." }],
  };
}

// ---- Deep link to Bible PWA ----

export async function getBibleUrl(bookName: string, chapter: number): Promise<string> {
  const manifest = await fetchManifest();
  const meta = getBookMeta(bookName, manifest);
  if (!meta) return "https://www.santabiblia.cloud";
  return `https://www.santabiblia.cloud/read/${meta.id}/${chapter}`;
}

export async function searchBible(query: string, version = "rva2015") {
  const value = normalize(query.trim());
  if (!value) return [];

  const manifest = await fetchManifest();
  const results: { reference: string; text: string }[] = [];
  for (const bookMeta of manifest.slice(0, 10)) {
    for (let chapter = 1; chapter <= bookMeta.chapters; chapter += 1) {
      const chapterData = await loadChapter(version, bookMeta, chapter);
      for (const verse of chapterData.verses) {
        if (normalize(verse.text).includes(value)) {
          results.push({
            reference: `${bookMeta.name} ${chapter}:${verse.verse}`,
            text: verse.text.slice(0, 200),
          });
          if (results.length >= 20) return results;
        }
      }
    }
  }
  return results;
}
