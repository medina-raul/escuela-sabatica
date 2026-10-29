import type { BibleReference } from "@app-types/bible";
import type { BeliefReference } from "@components/beliefs/types";

function displayFor(book: string, chapter: number, verseStart: number, verseEnd?: number, toEnd = false): string {
  if (verseStart === 0) return `${book} ${chapter}`;
  const start = `${book} ${chapter}:${verseStart}`;
  if (toEnd) return `${start}–final`;
  return verseEnd !== undefined && verseEnd !== verseStart ? `${start}–${verseEnd}` : start;
}

/** Keep the corpus order and every chapter, using the modal's single-chapter API. */
export function expandBeliefReferences(references: readonly BeliefReference[]): BibleReference[] {
  return references.flatMap((reference) => {
    const { book, chapterStart, chapterEnd } = reference;
    if (!Number.isInteger(chapterStart) || !Number.isInteger(chapterEnd) || chapterStart < 1 || chapterEnd < chapterStart) {
      throw new RangeError(`Intervalo de capítulos inválido: ${reference.label}`);
    }

    const passages: BibleReference[] = [];
    for (let chapter = chapterStart; chapter <= chapterEnd; chapter += 1) {
      const first = chapter === chapterStart;
      const last = chapter === chapterEnd;
      const startsAtVerse = first && reference.verseStart !== null && reference.verseStart > 0;
      let verseStart = startsAtVerse ? reference.verseStart! : 0;
      let verseEnd: number | undefined;
      let toEnd = false;

      if (chapterStart === chapterEnd) {
        if (verseStart > 0 && reference.verseEnd !== null) verseEnd = reference.verseEnd;
      } else if (first && startsAtVerse) {
        toEnd = true;
      } else if (last && reference.verseEnd !== null && reference.verseEnd > 0) {
        verseStart = 1;
        verseEnd = reference.verseEnd;
      }

      passages.push({
        book,
        chapter,
        verseStart,
        ...(verseEnd !== undefined ? { verseEnd } : {}),
        ...(toEnd ? { toEnd: true } : {}),
        display: displayFor(book, chapter, verseStart, verseEnd, toEnd),
      });
    }
    return passages;
  });
}
