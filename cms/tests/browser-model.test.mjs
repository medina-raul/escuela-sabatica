import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { applyChange, loadSnapshot, snapshotFiles } from "../lib/catalog.mjs";
import { publicCatalog } from "../lib/public-catalog.mjs";
import { mergeEditorialSnapshot, publishableSnapshot } from "../lib/publication-model.mjs";
import { syncIndexes } from "../sync-indexes.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));

test("la edición y los audios que llegaron después se combinan sin publicar un trimestre privado", () => {
  const live = loadSnapshot(root);
  const id = "2026-q4";
  const original = live.quarters[id].lessons[0];
  const args = { quarterId: id, lessonId: original.id, dayId: original.days[0].id };
  const changed = applyChange(live, "day.update", { ...args, title: "Lectura revisada" });
  const future = applyChange(changed, "quarter.create", {
    year: 2027, quarterNumber: 1, title: "Preparación privada", startDate: "2027-01-02",
  });
  const withAudio = structuredClone(live);
  withAudio.quarters[id].lessons[0].days[0].audio = { title: "Audio recién encontrado", url: "https://example.com/audio.mp3" };
  const merged = mergeEditorialSnapshot(live, publishableSnapshot(future, live), withAudio);
  const day = merged.quarters[id].lessons[0].days[0];
  assert.equal(day.title, "Lectura revisada");
  assert.equal(day.audio.title, "Audio recién encontrado");
  assert.equal(Object.hasOwn(merged.quarters, "2027-q1"), false);
  assert.equal(Object.hasOwn(publicCatalog(future).quarters, "2027-q1"), false);
  withAudio.quarters[id].lessons[0].days[0].title = "Edición simultánea";
  assert.throws(() => mergeEditorialSnapshot(live, changed, withAudio), error => {
    assert.match(error.message, /siguen guardados/);
    return error.details.some(path => path.endsWith("sabado · title"));
  });
});

test("la revisión de un repositorio incorpora el audio disponible y vuelve a comprobar el que faltaba", async () => {
  const work = await mkdtemp(join(tmpdir(), "escuela-indice-cms-"));
  const original = loadSnapshot(root);
  const id = "2026-q4";
  const quarter = original.quarters[id];
  const occupied = new Set(quarter.lessons.flatMap(lesson => [
    ...lesson.days.filter(day => day.audio).map(day => lesson.number + "/" + day.id),
    ...lesson.resources?.filter(item => item.role === "daily-audio").map(item => item.lessonNumber + "/" + item.dayId) ?? [],
  ]));
  const missing = quarter.lessons.flatMap(lesson => lesson.days.map(day => ({ lesson, day })))
    .filter(({ lesson, day }) => !occupied.has(lesson.number + "/" + day.id));
  assert.ok(missing.length >= 2);
  const [availableName, lateName] = missing.slice(0, 2).map(({ lesson, day }) => `leccion-${lesson.number}-${day.id}.mp3`);
  const website = "https://github.com/editorial/material";
  const current = applyChange(original, "resource.index", { quarterId: id, type: "audio", url: website });
  const available = new Set([availableName]);
  const mp3 = Buffer.alloc(11_000);
  mp3.writeUInt32BE(0xfffb9064);
  const downloaded = [];
  const logs = [];
  const download = async value => {
    const url = new URL(value);
    downloaded.push(value);
    if (url.hostname === "api.github.com") {
      const payload = url.pathname.endsWith("/material") ? { default_branch: "main" }
        : { tree: [availableName, lateName].map(name => ({ path: name, type: "blob" })) };
      return { url, bytes: Buffer.from(JSON.stringify(payload)), contentType: "application/json" };
    }
    if (!available.has(url.pathname.split("/").at(-1))) return { url, status: 404, missing: true };
    return { url, bytes: mp3, contentType: "audio/mpeg" };
  };
  try {
    for (const [path, content] of snapshotFiles(current)) {
      const file = join(work, path);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, content);
    }
    const options = { download, report: text => logs.push(text) };
    assert.equal(await syncIndexes(work, options), true);
    const afterFirst = loadSnapshot(work).quarters[id];
    assert.ok(afterFirst.lessons[missing[0].lesson.number - 1].days.find(day => day.id === missing[0].day.id).audio);
    assert.equal(afterFirst.lessons[missing[1].lesson.number - 1].days.find(day => day.id === missing[1].day.id).audio, missing[1].day.audio);
    assert.ok(logs.some(line => /todavía no ofrece/.test(line)));
    available.add(lateName);
    assert.equal(await syncIndexes(work, options), true);
    assert.equal(await syncIndexes(work, options), false);
    assert.ok(downloaded.some(url => url.startsWith("https://raw.githubusercontent.com/editorial/material/main/")));
    assert.match(await readFile(join(work, "src/data/quarters", id + ".json"), "utf8"), new RegExp(lateName));
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});
