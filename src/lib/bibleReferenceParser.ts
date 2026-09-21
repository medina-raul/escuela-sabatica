import type { BibleReference } from "@app-types/bible";

export type BibleReferenceMatch = {
  index: number;
  length: number;
  reference: BibleReference;
};

type BookDefinition = {
  canonical: string;
  forms: string[];
};

type NumericReferenceGroups = {
  chapter?: string;
  verseStart?: string;
  verseEnd?: string;
  crossChapter?: string;
  crossVerseEnd?: string;
};

// Incluye nombres completos y las abreviaturas que aparecen en los folletos
// de Escuela Sabática. Los puntos de las abreviaturas se aceptan en el regex.
const BOOK_DEFINITIONS: BookDefinition[] = [
  { canonical: "Génesis", forms: ["Génesis", "Gen", "Gén"] },
  { canonical: "Éxodo", forms: ["Éxodo", "Exodo", "Éxo", "Exo", "Exod"] },
  { canonical: "Levítico", forms: ["Levítico", "Levitico", "Lev"] },
  { canonical: "Números", forms: ["Números", "Numeros", "Núm", "Num"] },
  { canonical: "Deuteronomio", forms: ["Deuteronomio", "Deut"] },
  { canonical: "Josué", forms: ["Josué", "Josue", "Jos", "Josh"] },
  { canonical: "Jueces", forms: ["Jueces", "Jue", "Judg"] },
  { canonical: "Rut", forms: ["Rut", "Ruth"] },
  { canonical: "1 Samuel", forms: ["1 Samuel", "1 Sam", "1Sam"] },
  { canonical: "2 Samuel", forms: ["2 Samuel", "2 Sam", "2Sam"] },
  { canonical: "1 Reyes", forms: ["1 Reyes", "1 Rey", "1 Kings"] },
  { canonical: "2 Reyes", forms: ["2 Reyes", "2 Rey", "2 Kings"] },
  { canonical: "1 Crónicas", forms: ["1 Crónicas", "1 Cronicas", "1 Crón", "1 Cron", "1 Cro"] },
  { canonical: "2 Crónicas", forms: ["2 Crónicas", "2 Cronicas", "2 Crón", "2 Cron", "2 Cro"] },
  { canonical: "Esdras", forms: ["Esdras", "Esd", "Ezra"] },
  { canonical: "Nehemías", forms: ["Nehemías", "Nehemias", "Neh"] },
  { canonical: "Ester", forms: ["Ester", "Est"] },
  { canonical: "Job", forms: ["Job"] },
  { canonical: "Salmos", forms: ["Salmos", "Salmo", "Sal", "Salm", "Ps", "Psa", "Psalm"] },
  { canonical: "Proverbios", forms: ["Proverbios", "Prov"] },
  { canonical: "Eclesiastés", forms: ["Eclesiastés", "Eclesiastes", "Ecl", "Eccles"] },
  { canonical: "Cantares", forms: ["Cantares", "Cant", "Song"] },
  { canonical: "Isaías", forms: ["Isaías", "Isaias", "Isa"] },
  { canonical: "Jeremías", forms: ["Jeremías", "Jeremias", "Jer", "Jerem"] },
  { canonical: "Lamentaciones", forms: ["Lamentaciones", "Lam"] },
  { canonical: "Ezequiel", forms: ["Ezequiel", "Eze", "Ezek"] },
  { canonical: "Daniel", forms: ["Daniel", "Dan"] },
  { canonical: "Oseas", forms: ["Oseas", "Ose", "Hos"] },
  { canonical: "Joel", forms: ["Joel"] },
  { canonical: "Amós", forms: ["Amós", "Amos"] },
  { canonical: "Abdías", forms: ["Abdías", "Abdias", "Abd", "Obad"] },
  { canonical: "Jonás", forms: ["Jonás", "Jonas", "Jon"] },
  { canonical: "Miqueas", forms: ["Miqueas", "Miq", "Mic"] },
  { canonical: "Nahúm", forms: ["Nahúm", "Nahum", "Nah"] },
  { canonical: "Habacuc", forms: ["Habacuc", "Hab"] },
  { canonical: "Sofonías", forms: ["Sofonías", "Sofonias", "Sof", "Zeph"] },
  { canonical: "Hageo", forms: ["Hageo", "Hag"] },
  { canonical: "Zacarías", forms: ["Zacarías", "Zacarias", "Zac"] },
  { canonical: "Malaquías", forms: ["Malaquías", "Malaquias", "Mal"] },
  { canonical: "Mateo", forms: ["Mateo", "Mat", "Matt"] },
  { canonical: "Marcos", forms: ["Marcos", "Mar", "Mc", "Mark"] },
  { canonical: "Lucas", forms: ["Lucas", "Luc", "Luke"] },
  { canonical: "Juan", forms: ["Juan", "Jua", "Jn", "John"] },
  { canonical: "Hechos", forms: ["Hechos", "Hech", "Hch", "Acts"] },
  { canonical: "Romanos", forms: ["Romanos", "Rom", "Roman"] },
  { canonical: "1 Corintios", forms: ["1 Corintios", "1 Cor", "1 Co", "1Co"] },
  { canonical: "2 Corintios", forms: ["2 Corintios", "2 Cor", "2 Co", "2Co"] },
  { canonical: "Gálatas", forms: ["Gálatas", "Galatas", "Gal"] },
  { canonical: "Efesios", forms: ["Efesios", "Efe", "Ef", "Eph"] },
  { canonical: "Filipenses", forms: ["Filipenses", "Fil", "Phil"] },
  { canonical: "Colosenses", forms: ["Colosenses", "Col"] },
  { canonical: "1 Tesalonicenses", forms: ["1 Tesalonicenses", "1 Tes", "1 Thes", "1 Thess"] },
  { canonical: "2 Tesalonicenses", forms: ["2 Tesalonicenses", "2 Tes", "2 Thes", "2 Thess"] },
  { canonical: "1 Timoteo", forms: ["1 Timoteo", "1 Tim"] },
  { canonical: "2 Timoteo", forms: ["2 Timoteo", "2 Tim"] },
  { canonical: "Tito", forms: ["Tito", "Tit", "Titus"] },
  { canonical: "Filemón", forms: ["Filemón", "Filemon", "Flm", "Philem"] },
  { canonical: "Hebreos", forms: ["Hebreos", "Heb"] },
  { canonical: "Santiago", forms: ["Santiago", "Sant", "Stgo", "Jas", "James"] },
  { canonical: "1 Pedro", forms: ["1 Pedro", "1 Ped", "1 Pe", "1 Pet"] },
  { canonical: "2 Pedro", forms: ["2 Pedro", "2 Ped", "2 Pe", "2 Pet"] },
  { canonical: "1 Juan", forms: ["1 Juan", "1 Jua", "1 Jn", "1 John"] },
  { canonical: "2 Juan", forms: ["2 Juan", "2 Jua", "2 Jn", "2 John"] },
  { canonical: "3 Juan", forms: ["3 Juan", "3 Jua", "3 Jn", "3 John"] },
  { canonical: "Judas", forms: ["Judas", "Jud", "Jude"] },
  { canonical: "Apocalipsis", forms: ["Apocalipsis", "Apoc", "Rev"] },
];

const normalizeBookKey = (value: string) => value
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[.'’]/g, "")
  .replace(/\s+/g, " ")
  .trim();

const BOOK_BY_FORM = new Map<string, string>();
for (const definition of BOOK_DEFINITIONS) {
  for (const form of definition.forms) BOOK_BY_FORM.set(normalizeBookKey(form), definition.canonical);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formToPattern(form: string): string {
  return form.trim().split(/\s+/).map(escapeRegex).join("\\s+") + "\\.?";
}

const BOOK_FORMS = Array.from(new Set(BOOK_DEFINITIONS.flatMap((definition) => definition.forms)))
  .sort((a, b) => b.length - a.length);

const BOOK_PATTERN = BOOK_FORMS
  .map((form) => formToPattern(form))
  .join("|");

const NUMERIC_REFERENCE_BODY = "(\\d{1,3})(?:\\s*:\\s*(\\d{1,3})(?:\\s*[-–]\\s*(\\d{1,3})(?:\\s*:\\s*(\\d{1,3}))?)?)?";
const BOOK_REFERENCE_REGEX = new RegExp(
  `(?<![A-Za-zÁÉÍÓÚáéíóúÑñÜü])(${BOOK_PATTERN})\\s+${NUMERIC_REFERENCE_BODY}`,
  "gi",
);
const BOOK_REFERENCE_AT_START_REGEX = new RegExp(`^(${BOOK_PATTERN})\\s+${NUMERIC_REFERENCE_BODY}`, "i");
const NUMERIC_REFERENCE_REGEX = new RegExp(`^${NUMERIC_REFERENCE_BODY}`, "i");
const CONTINUATION_PREFIX_REGEX = /^(?:\s*;\s*|\s+\by\b\s+|\s*,\s*)/iu;
const WORD_CHARACTER_REGEX = /[A-Za-zÁÉÍÓÚáéíóúÑñÜü]/;

function resolveBibleBook(book: string): string | null {
  return BOOK_BY_FORM.get(normalizeBookKey(book)) ?? null;
}

function makeReference(
  bookText: string,
  groups: NumericReferenceGroups,
  display: string,
): BibleReference | null {
  const book = resolveBibleBook(bookText);
  const chapter = Number(groups.chapter);
  if (!book || !Number.isInteger(chapter)) return null;

  const verseStart = groups.verseStart ? Number(groups.verseStart) : 0;
  const verseEnd = groups.verseEnd ? Number(groups.verseEnd) : undefined;
  const crossChapter = groups.crossChapter ? Number(groups.crossChapter) : undefined;
  const crossVerseEnd = groups.crossVerseEnd ? Number(groups.crossVerseEnd) : undefined;
  const reference: BibleReference = {
    book,
    chapter,
    verseStart,
    display: display.trim(),
  };

  if (verseEnd !== undefined && crossChapter !== undefined && crossVerseEnd !== undefined) {
    reference.toEnd = true;
    reference.crossChapter = { chapter: crossChapter, verseEnd: crossVerseEnd };
  } else if (verseEnd !== undefined) {
    reference.verseEnd = verseEnd;
  }

  return reference;
}

function referenceFromFullMatch(match: RegExpExecArray): BibleReference | null {
  return makeReference(match[1], {
    chapter: match[2],
    verseStart: match[3],
    verseEnd: match[4],
    crossChapter: match[5],
    crossVerseEnd: match[6],
  }, match[0]);
}

function referenceFromNumericMatch(book: string, match: RegExpMatchArray): BibleReference | null {
  const numericText = match[0].trim();
  return makeReference(book, {
    chapter: match[1],
    verseStart: match[2],
    verseEnd: match[3],
    crossChapter: match[4],
    crossVerseEnd: match[5],
  }, `${book} ${numericText}`);
}

function addKnownMatches(text: string, knownRefs: BibleReference[], matches: BibleReferenceMatch[]): void {
  for (const reference of knownRefs) {
    const display = reference.display.trim();
    if (!display) continue;
    let fromIndex = 0;
    while (fromIndex < text.length) {
      const index = text.indexOf(display, fromIndex);
      if (index < 0) break;
      const before = text[index - 1];
      const after = text[index + display.length];
      const hasWordBoundary = (!before || !WORD_CHARACTER_REGEX.test(before))
        && (!after || !WORD_CHARACTER_REGEX.test(after));
      if (hasWordBoundary) matches.push({ index, length: display.length, reference });
      fromIndex = index + display.length;
    }
  }
}

function addContinuationMatches(
  text: string,
  base: BibleReferenceMatch,
  matches: BibleReferenceMatch[],
): void {
  let cursor = base.index + base.length;
  let currentBook = base.reference.book;

  while (cursor < text.length) {
    const remainder = text.slice(cursor);
    const prefix = remainder.match(CONTINUATION_PREFIX_REGEX);
    if (!prefix) break;

    const numericStart = cursor + prefix[0].length;
    const numericRemainder = text.slice(numericStart);
    // Evita interpretar el "1" inicial de una referencia con libro como un
    // capítulo del libro anterior: "Romanos 12, 1 Corintios 12".
    if (BOOK_REFERENCE_AT_START_REGEX.test(numericRemainder)) break;

    const numericMatch = numericRemainder.match(NUMERIC_REFERENCE_REGEX);
    if (!numericMatch) break;
    const reference = referenceFromNumericMatch(currentBook, numericMatch);
    if (!reference) break;

    matches.push({ index: numericStart, length: numericMatch[0].length, reference });
    cursor = numericStart + numericMatch[0].length;
    currentBook = reference.book;
  }
}

function deduplicateMatches(matches: BibleReferenceMatch[]): BibleReferenceMatch[] {
  const sorted = [...matches].sort((a, b) => a.index - b.index || b.length - a.length);
  const filtered: BibleReferenceMatch[] = [];
  for (const match of sorted) {
    const previous = filtered[filtered.length - 1];
    if (!previous || match.index >= previous.index + previous.length) filtered.push(match);
  }
  return filtered;
}

/** Detecta referencias bíblicas completas, abreviadas, por capítulo y encadenadas. */
export function findBibleReferenceMatches(
  text: string,
  knownRefs: BibleReference[] = [],
): BibleReferenceMatch[] {
  const matches: BibleReferenceMatch[] = [];
  addKnownMatches(text, knownRefs, matches);

  BOOK_REFERENCE_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = BOOK_REFERENCE_REGEX.exec(text)) !== null) {
    const reference = referenceFromFullMatch(match);
    if (reference) matches.push({ index: match.index, length: match[0].length, reference });
  }

  const baseMatches = [...matches].sort((a, b) => a.index - b.index || b.length - a.length);
  for (const base of baseMatches) addContinuationMatches(text, base, matches);

  return deduplicateMatches(matches);
}
