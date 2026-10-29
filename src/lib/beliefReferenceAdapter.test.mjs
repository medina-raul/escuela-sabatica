import assert from "node:assert/strict";
import test from "node:test";
import { expandBeliefReferences } from "./beliefReferenceAdapter.ts";

const reference = (changes = {}) => ({
  id: "test", bookId: 27, book: "Daniel", chapterStart: 7, chapterEnd: 7,
  verseStart: 9, verseEnd: 12, label: "Daniel 7:9–12", sourceGroup: "Dan. 7:9–12", ...changes,
});

test("conserva un versículo y un intervalo dentro del mismo capítulo", () => {
  assert.deepEqual(expandBeliefReferences([reference({ verseEnd: 9 })]), [
    { book: "Daniel", chapter: 7, verseStart: 9, verseEnd: 9, display: "Daniel 7:9" },
  ]);
  assert.deepEqual(expandBeliefReferences([reference()]), [
    { book: "Daniel", chapter: 7, verseStart: 9, verseEnd: 12, display: "Daniel 7:9–12" },
  ]);
});

test("incluye cada capítulo intermedio sin inventar límites de versículo", () => {
  assert.deepEqual(expandBeliefReferences([reference({ chapterEnd: 10, verseEnd: 4 })]), [
    { book: "Daniel", chapter: 7, verseStart: 9, toEnd: true, display: "Daniel 7:9–final" },
    { book: "Daniel", chapter: 8, verseStart: 0, display: "Daniel 8" },
    { book: "Daniel", chapter: 9, verseStart: 0, display: "Daniel 9" },
    { book: "Daniel", chapter: 10, verseStart: 1, verseEnd: 4, display: "Daniel 10:1–4" },
  ]);
});

test("los intervalos de capítulos completos permanecen completos", () => {
  const passages = expandBeliefReferences([reference({ chapterEnd: 10, verseStart: null, verseEnd: null })]);
  assert.deepEqual(passages.map(({ chapter, verseStart }) => ({ chapter, verseStart })), [
    { chapter: 7, verseStart: 0 }, { chapter: 8, verseStart: 0 },
    { chapter: 9, verseStart: 0 }, { chapter: 10, verseStart: 0 },
  ]);
  assert.ok(passages.every((passage) => !("verseEnd" in passage) && !("toEnd" in passage) && !("crossChapter" in passage)));
});

test("no confunde un capítulo completo inicial con un intervalo parcial final", () => {
  assert.deepEqual(expandBeliefReferences([reference({ chapterEnd: 8, verseStart: null, verseEnd: 1 })]), [
    { book: "Daniel", chapter: 7, verseStart: 0, display: "Daniel 7" },
    { book: "Daniel", chapter: 8, verseStart: 1, verseEnd: 1, display: "Daniel 8:1" },
  ]);
});

test("conserva el orden y los vacíos entre referencias separadas", () => {
  const inputs = [reference({ verseStart: 4, verseEnd: 4 }), reference({ verseStart: 8, verseEnd: 8 }), reference({ book: "Juan", bookId: 43, chapterStart: 1, chapterEnd: 1, verseStart: 1, verseEnd: 3 })];
  assert.deepEqual(expandBeliefReferences(inputs).map((passage) => passage.display), ["Daniel 7:4", "Daniel 7:8", "Juan 1:1–3"]);
});

test("es puro y no altera las referencias originales", () => {
  const input = Object.freeze(reference({ chapterEnd: 9, verseEnd: null }));
  const snapshot = JSON.stringify(input);
  const passages = expandBeliefReferences(Object.freeze([input]));
  passages[0].chapter = 99;
  assert.equal(JSON.stringify(input), snapshot);
  assert.deepEqual(expandBeliefReferences([]), []);
});

test("rechaza un intervalo imposible en vez de truncarlo silenciosamente", () => {
  assert.throws(() => expandBeliefReferences([reference({ chapterEnd: 6 })]), RangeError);
  assert.throws(() => expandBeliefReferences([reference({ chapterStart: 0 })]), RangeError);
});
