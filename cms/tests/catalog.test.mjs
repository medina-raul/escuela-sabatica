import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { applyChange, loadSnapshot, publicationIssues, snapshotFiles } from "../lib/catalog.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const load = () => loadSnapshot(root);

test("los catálogos oficiales de Q3 y Q4 se representan sin perder campos ni cambiar rutas", () => {
  const snapshot = load();
  const files = snapshotFiles(snapshot);
  assert.deepEqual(publicationIssues(snapshot), []);
  for (const id of ["2026-q3", "2026-q4"]) {
    const name = `src/data/quarters/${id}.json`;
    assert.deepEqual(JSON.parse(files.get(name)), JSON.parse(readFileSync(new URL("../../" + name, import.meta.url), "utf8")));
  }
  const previous = snapshot.quarters["2026-q3"];
  const current = snapshot.quarters["2026-q4"];
  assert.equal(previous.lessons.at(-1).days[0].audio, null);
  assert.equal(previous.resources.some(item => item.role === "friday-reading" && item.source.kind === "manual"), true);
  assert.equal(current.lessons[0].days[0].contentSource.kind, "local-pdf");
  assert.ok(current.lessons[0].days[0].contentImportBaseline.contentMarkdown);
  assert.ok(current.resources.some(item => item.role === "complementary-book-reading" && item.storage === "external"));
  assert.ok(current.resources.some(item => item.role === "complementary-book-reading" && item.type === "article"));
  assert.ok(previous.resources.some(item => item.translation?.reviewStatus === "reviewed-existing"));
});

test("un trimestre nuevo mantiene su fecha inicial y la estructura sin requerir audios o presentaciones", () => {
  let snapshot = applyChange(load(), "year.create", { year: 2027 });
  snapshot = applyChange(snapshot, "quarter.create", { year: 2027, quarterNumber: 1, startDate: "2027-01-02", title: "Trimestre de prueba" });
  const quarter = snapshot.quarters["2027-q1"];
  assert.equal(quarter.lessons.length, 13);
  assert.equal(quarter.lessons.at(-1).days.at(-1).date, "2027-04-02");
  assert.equal(quarter.resources.length, 0);
  assert.deepEqual(publicationIssues(snapshot), []);
  assert.throws(() => applyChange(snapshot, "quarter.status", { quarterId: quarter.id, status: "published", active: true }), /completa|contenido|título/i);
  assert.throws(() => applyChange(snapshot, "quarter.create", { year: 2027, quarterNumber: 2, startDate: "2027-04-02", title: "Fecha incorrecta" }), /sábado/i);
});

test("editar un día del PDF conserva aptitud para auditar el contenido y los datos históricos", () => {
  const snapshot = load();
  const original = snapshot.quarters["2026-q4"].lessons[0].days[0];
  const updated = applyChange(snapshot, "day.update", {
    quarterId: "2026-q4", lessonId: "leccion-01", dayId: "sabado",
    contentMarkdown: "Lee Mateo 6:19-7:9.", studyReferences: ["Mateo 6:19-7:9"],
  }).quarters["2026-q4"].lessons[0].days[0];
  assert.deepEqual(updated.contentImportBaseline, original.contentImportBaseline);
  assert.deepEqual(updated.contentSource, original.contentSource);
  assert.deepEqual(updated.studyReferences[0].crossChapter, { chapter: 7, verseEnd: 9 });
});
