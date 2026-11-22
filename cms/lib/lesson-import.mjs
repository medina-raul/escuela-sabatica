import { findBibleReferenceMatches } from "../../src/lib/bibleReferenceParser.ts";
import { applyChange, CatalogError } from "./catalog-model.mjs";

function sourceMetadata(item, fragment) {
  const result = item.result;
  const page = String(fragment.location).match(/p[aá]gina\s+(\d+)/i);
  return {
    kind: result.kind === "pdf" ? "local-pdf" : result.kind, sha256: result.sha256,
    file: result.name, url: result.originUrl, location: fragment.location,
    ...(page ? { pages: [Number(page[1]), Number(page[1])] } : {}),
    language: "es", reviewStatus: "reviewed",
  };
}

export function assignImportedFragment(snapshot, job, data) {
  const item = Number.isInteger(data.item) ? job.items[data.item] : null;
  const part = Number.isInteger(data.fragment) ? item?.result?.fragments[data.fragment] : null;
  if (!part) throw new CatalogError("Elige un fragmento extraído de esta importación.");
  const title = data.title ?? part.title;
  const date = data.date ?? part.suggestedDate;
  // The editor confirms the assignment. Only the parser generates reference objects.
  return applyChange(snapshot, "day.update", {
    quarterId: data.quarterId, lessonId: data.lessonId, dayId: data.dayId,
    ...(title ? { title } : {}), ...(date ? { date } : {}),
    contentMarkdown: data.contentMarkdown ?? part.text,
    ...(data.keyVerseText !== undefined || part.suggestedKeyVerse?.text ? { keyVerseText: data.keyVerseText ?? part.suggestedKeyVerse.text } : {}),
    ...(data.keyVerseReference !== undefined || part.suggestedKeyVerse?.reference ? { keyVerseReference: data.keyVerseReference ?? part.suggestedKeyVerse.reference } : {}),
    studyReferences: data.studyReferences ?? referenceLabels(data.contentMarkdown ?? part.text),
    contentSource: sourceMetadata(item, part),
  });
}

export function referenceLabels(text) {
  return [...new Set(findBibleReferenceMatches(text).flatMap(({ reference }) => {
    if (reference.chapter < 1 || (reference.display.includes(":") && reference.verseStart < 1)) return [];
    if (reference.verseEnd !== undefined && reference.verseEnd < reference.verseStart) return [];
    if (reference.crossChapter && (reference.crossChapter.chapter <= reference.chapter || reference.crossChapter.verseEnd < 1)) return [];
    return [reference.display];
  }))].slice(0, 150);
}
