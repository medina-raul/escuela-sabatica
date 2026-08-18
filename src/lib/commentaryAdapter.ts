import type { BibleReference, CommentaryBlock, CommentaryEntry } from "@app-types/bible";

type BookMeta = { id: number; name: string; file: string; chapters: number; slug: string };

const normalize = (v: string) => v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const BASE = "https://www.santabiblia.cloud/data";

// Shared manifest (same as bibleAdapter - imported lazily to avoid circular dependency)
let manifestCache: BookMeta[] | null = null;
const chapterCache = new Map<string, Record<string, unknown>>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function getManifest(): Promise<BookMeta[]> {
  if (manifestCache) return manifestCache;
  const res = await fetch(`${BASE}/books.json`);
  if (!res.ok) throw new Error("No fue posible cargar el catálogo bíblico.");
  manifestCache = await res.json();
  return manifestCache!;
}

async function getChapterCommentary(bookId: number, chapter: number): Promise<Record<string, unknown> | null> {
  const key = `${bookId}_${chapter}`;
  if (chapterCache.has(key)) return chapterCache.get(key)!;
  try {
    const res = await fetch(`${BASE}/cba/${bookId}/${chapter}.json`);
    if (!res.ok) return null;
    const data: unknown = await res.json();
    if (!isRecord(data)) return null;
    chapterCache.set(key, data);
    return data;
  } catch {
    return null;
  }
}

function normalizeBlock(value: unknown): CommentaryBlock | null {
  if (Array.isArray(value)) {
    const [type, text] = value;
    if (typeof text !== "string" || !text.trim()) return null;
    return { type: type === "h" ? "heading" : "paragraph", text: text.trim() };
  }

  if (!value || typeof value !== "object") return null;
  const { type, text } = value as { type?: unknown; text?: unknown };
  if (typeof text !== "string" || !text.trim()) return null;
  return {
    type: type === "heading" || type === "h" ? "heading" : "paragraph",
    text: text.trim(),
  };
}

function normalizeCommentary(value: unknown): Pick<CommentaryEntry, "content" | "blocks"> | null {
  if (typeof value === "string") {
    const blocks = value
      .split(/\n{2,}/)
      .map((text) => text.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .map((text) => ({ type: "paragraph" as const, text }));
    return blocks.length > 0 ? { content: blocks.map((block) => block.text).join("\n\n"), blocks } : null;
  }

  if (!value || typeof value !== "object") return null;
  const structured = value as { blocks?: unknown; b?: unknown };
  const sourceBlocks = Array.isArray(structured.blocks)
    ? structured.blocks
    : structured.b;
  if (!Array.isArray(sourceBlocks)) return null;

  const blocks = sourceBlocks
    .map(normalizeBlock)
    .filter((block): block is CommentaryBlock => block !== null);
  return blocks.length > 0 ? { content: blocks.map((block) => block.text).join("\n\n"), blocks } : null;
}

function toEntry(
  value: unknown,
  reference: BibleReference,
  source: string,
  verse: number,
): CommentaryEntry | null {
  const normalized = normalizeCommentary(value);
  return normalized ? { reference, source, verse, ...normalized } : null;
}

export async function getCommentary(reference: BibleReference): Promise<CommentaryEntry[]> {
  const manifest = await getManifest();
  const bookMeta = manifest.find(b => normalize(b.name) === normalize(reference.book));
  if (!bookMeta) return [];

  const chapterData = await getChapterCommentary(bookMeta.id, reference.chapter);
  if (!chapterData) return [];

  const entries: CommentaryEntry[] = [];

  // Chapter-only reference: load all verses
  if (!reference.verseStart || reference.verseStart === 0) {
    const verseKeys = Object.keys(chapterData)
      .map(Number)
      .filter(n => !isNaN(n))
      .sort((a, b) => a - b);
    for (const v of verseKeys) {
      const entry = toEntry(chapterData[String(v)], reference, `CBA ${bookMeta.name} ${reference.chapter}:${v}`, v);
      if (entry) entries.push(entry);
    }
    return entries;
  }

  // Get commentary for the verse range (including toEnd + crossChapter)
  const maxVerse = Object.keys(chapterData)
    .map(Number).filter(n => !isNaN(n))
    .reduce((max, n) => n > max ? n : max, 0);
  const verseEnd = reference.toEnd
    ? maxVerse
    : (reference.verseEnd ?? reference.verseStart);
  for (let v = reference.verseStart; v <= verseEnd; v++) {
    const entry = toEntry(chapterData[String(v)], reference, `CBA ${bookMeta.name} ${reference.chapter}:${v}`, v);
    if (entry) entries.push(entry);
  }

  // Append cross-chapter commentary if present
  if (reference.crossChapter) {
    const nextChapterData = await getChapterCommentary(bookMeta.id, reference.crossChapter.chapter);
    if (nextChapterData) {
      const nextKeys = Object.keys(nextChapterData)
        .map(Number).filter(n => !isNaN(n) && n <= reference.crossChapter!.verseEnd)
        .sort((a, b) => a - b);
      for (const v of nextKeys) {
        const entry = toEntry(
          nextChapterData[String(v)],
          reference,
          `CBA ${bookMeta.name} ${reference.crossChapter!.chapter}:${v}`,
          v,
        );
        if (entry) entries.push(entry);
      }
    }
  }

  return entries;
}
