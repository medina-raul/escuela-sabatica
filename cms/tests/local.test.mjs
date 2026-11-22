import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { test } from "node:test";
import { addUser } from "../lib/auth.mjs";
import { ingestItem } from "../lib/ingest.mjs";
import { createCmsServer } from "../server.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const execute = promisify(execFile);
const testPassword = "contraseña-sintética-de-prueba";

async function api(origin, path, { data, expected = 200, method = "GET", credential, browserOrigin = origin } = {}) {
  const headers = { origin: browserOrigin };
  if (credential) {
    headers.cookie = credential.cookie;
    headers["x-csrf-token"] = credential.csrf;
  }
  let body = data;
  if (data && !(data instanceof FormData)) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(data);
  }
  const response = await fetch(`${origin}/admin/api/${path}`, { method, headers, body, redirect: "manual" });
  const result = await response.json().catch(() => null);
  assert.equal(response.status, expected, `${method} ${path} · ${result?.error ?? response.statusText}`);
  return { body: result, response };
}

async function session(origin, username) {
  const { body, response } = await api(origin, "login", { method: "POST", data: { username, password: testPassword } });
  const setCookie = response.headers.get("set-cookie");
  assert.match(setCookie, /HttpOnly; SameSite=Strict/);
  return { cookie: setCookie.split(";", 1)[0], csrf: body.csrf };
}

function fixtureRemote(url, bytes, mime) {
  return { bytes: Buffer.from(bytes), url: new URL(url), contentType: mime, status: 200 };
}

test("panel local de extremo a extremo con los dos catálogos y recuperación de recursos semanales", { timeout: 190_000 }, async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "escuela-cms-e2e-"));
  const start = "2026-11-22T12:00:00.000Z";
  const nextUrl = "https://www.audioescuelasabatica.com/material/";
  const pdfSample = "Lectura de prueba Juan 3:16.";
  const unavailable = new Set(["viernes", "ppt"]);
  let time = Date.parse(start);
  const mp3 = Buffer.alloc(11_000);
  mp3.writeUInt32BE(0xfffb9064, 0);
  const ppt = await readFile(join(root, "public", "recursos", "2026-q4", "ppt", "leccion-09.pptx"));
  async function remote(url) {
    if (url === nextUrl) {
      return fixtureRemote(url, `<main>
        <a href="leccion-10-jueves.mp3">Lección 10 Jueves</a>
        <a href="leccion-10-viernes.mp3">Lección 10 Viernes</a>
        <a href="leccion-10.mp3">Archivo sin día</a>
        <a href="https://www.fustero.es/material/2026t411.pptx">Lección 11</a>
      </main>`, "text/html");
    }
    if (url.endsWith("2026t411.pptx")) {
      return unavailable.has("ppt") ? { missing: true, status: 404, url: new URL(url) }
        : fixtureRemote(url, ppt, "application/vnd.openxmlformats-officedocument.presentationml.presentation");
    }
    if (url.endsWith("-viernes.mp3") && unavailable.has("viernes")) return { missing: true, status: 404, url: new URL(url) };
    if (url.endsWith(".mp3")) return fixtureRemote(url, mp3, "audio/mpeg");
    if (url.endsWith("domingo.html")) return fixtureRemote(url, `<main><h1>Domingo</h1><p>${pdfSample}</p></main>`, "text/html");
    throw new Error("El fixture no define esta URL.");
  }
  const cms = await createCmsServer({
    root, dataDir, runWorker: false, now: () => time, download: remote,
    extract: (input, options) => ingestItem(input, { ...options, downloadSource: remote }),
  });
  try {
    const adminUser = await addUser(cms.store, { username: "admin-test", role: "admin", password: testPassword });
    await addUser(cms.store, { username: "editor-test", role: "editor", password: testPassword });
    await addUser(cms.store, { username: "revision-test", role: "reviewer", password: testPassword });
    await addUser(cms.store, { username: "consulta-test", role: "viewer", password: testPassword });
    const { origin, previewOrigin, url } = await cms.listen(0);
    const html = await fetch(url);
    assert.equal(html.status, 200);
    assert.match(await html.text(), /\/admin\/assets\/app.mjs/);
    assert.equal((await fetch(previewOrigin)).status, 403);
    await api(origin, "dashboard", { expected: 401 });
    let editor = await session(origin, "editor-test");
    const viewer = await session(origin, "consulta-test");
    await api(origin, "drafts", { method: "POST", credential: viewer, data: { title: "No permitido" }, expected: 403 });
    await api(origin, "drafts", { method: "POST", credential: editor, browserOrigin: "http://127.0.0.1:9", data: { title: "Otro origen" }, expected: 403 });
    const post = (path, credential, data, expected = 200) => api(origin, path, { credential, method: "POST", data, expected });
    let { body: { draft } } = await post("drafts", editor, { title: "Edición local verificada" }, 201);
    const base = `drafts/${draft.id}`;
    const get = path => api(origin, path, { credential: editor });
    const change = async (action, data) => {
      ({ body: { draft } } = await post(`${base}/change`, editor, { version: draft.version, action, data }));
    };
    await change("year.create", { year: 2027 });
    await post(`${base}/change`, editor, { version: 1, action: "year.create", data: { year: 2029 } }, 409);
    await change("quarter.create", { year: 2027, quarterNumber: 1, title: "Trimestre futuro privado", startDate: "2027-01-02" });
    await post(`${base}/change`, editor, { version: draft.version, action: "site.update", data: { theme: {} } }, 403);

    const mixed = new FormData();
    mixed.append("files", new File(["# Lunes\n\nLee Mateo 6:19-7:9."], "lectura.md"));
    mixed.append("files", new File(["<main><h1>Martes</h1><p>Lee Salmos 23:1-3.</p></main>"], "lectura.html"));
    mixed.set("urls", "https://raw.githubusercontent.com/editorial/domingo.html\nhttps://otro-dominio.invalid/dia.html");
    const { body: { job } } = await post(`${base}/import`, editor, mixed, 202);
    await cms.step();
    const { body: { job: parsed } } = await get(`${base}/import/${job.id}`);
    assert.equal(parsed.status, "partial");
    assert.equal(parsed.items.filter(item => item.status === "ready").length, 3);
    const sunday = parsed.items.findIndex(item => item.result?.originUrl);
    assert.ok(sunday >= 0);
    const original = await fetch(`${origin}/admin/api/${base}/import/${job.id}/original/${sunday}`, { headers: { cookie: editor.cookie } });
    assert.match(original.headers.get("content-disposition"), /^attachment/);
    assert.match(await original.text(), /Juan 3:16/);
    const assignments = parsed.items.flatMap((item, index) => item.status === "ready" ? [{
      item: index, fragment: 0, quarterId: "2026-q4", lessonId: "leccion-01", dayId: item.result.fragments[0].suggestedDayId,
    }] : []);
    ({ body: { draft } } = await post(`${base}/import/${job.id}/apply`, editor, { version: draft.version, assignments }));
    const day = draft.snapshot.quarters["2026-q4"].lessons[0].days.find(day => day.id === "lunes");
    assert.equal(day.studyReferences[0].crossChapter.chapter, 7);
    assert.match(day.contentSource.sha256, /^sha256:/);
    assert.ok(day.contentImportBaseline);

    const upload = new FormData();
    upload.append("file", new File(["Contenido de muestra para el editor"], "guía-formato-libre.odt"));
    const { body: { asset } } = await post(`${base}/assets`, editor, upload, 201);
    assert.equal(asset.kind, "attachment");
    await change("resource.upsert", {
      quarterId: "2026-q4", type: "attachment", role: "weekly-attachment", lessonNumber: 1, title: "Guía de muestra", assetId: asset.id,
    });
    const article = new FormData();
    article.set("article", "## Capítulo\n\nEstudia Mateo 5:7.");
    const { body: { asset: articleFile } } = await post(`${base}/assets`, editor, article, 201);
    assert.equal(articleFile.kind, "article");
    await change("resource.upsert", {
      quarterId: "2026-q4", type: "article", role: "general-reading", title: "Artículo de muestra", assetId: articleFile.id,
    });

    const { body: { source } } = await post("sources", editor, {
      name: "Audios semanales", url: nextUrl, draftId: draft.id, purpose: "resource-index",
      resource: { type: "audio", quarterId: "2026-q4" }, enabled: true,
    }, 201);
    const { body: { source: slides } } = await post("sources", editor, {
      name: "PPT semanales", url: nextUrl, draftId: draft.id, purpose: "resource-index",
      resource: { type: "ppt", quarterId: "2026-q4" }, enabled: true,
    }, 201);
    assert.equal(source.intervalMinutes, 10080);
    await cms.step();
    await cms.step();
    ({ body: { draft } } = await get(base));
    const getQuarter = () => draft.snapshot.quarters["2026-q4"];
    const audio = id => getQuarter().lessons[9].days.find(day => day.id === id).audio;
    assert.match(audio("jueves").url, /leccion-10-jueves/);
    assert.ok(!audio("viernes"));
    assert.equal((await get("sources")).body.sources.find(item => item.id === slides.id).state, "pending");
    unavailable.clear();
    time += 7 * 24 * 60 * 60 * 1000;
    editor = await session(origin, "editor-test");
    await cms.step();
    await cms.step();
    ({ body: { draft } } = await get(base));
    assert.match(audio("viernes").url, /leccion-10-viernes/);
    const presentation = getQuarter().resources.find(item => item.role === "weekly-presentation" && item.lessonNumber === 11);
    assert.match(presentation.url, /\.pptx$/);
    assert.equal(presentation.source.url, "https://www.fustero.es/material/2026t411.pptx");
    assert.equal(presentation.storage, "local");
    const attachment = getQuarter().resources.find(item => item.role === "weekly-attachment");
    assert.ok(attachment.url.endsWith(".download"));
    assert.equal(attachment.originalName, "guía-formato-libre.odt");

    await post(`${base}/prepare`, editor, { version: draft.version }, 202);
    let state;
    for (let attempt = 0; attempt < 130; attempt += 1) {
      ({ body: state } = await get(base));
      if (["ready", "failed"].includes(state.release?.status)) break;
      await delay(500);
    }
    assert.equal(state.release?.status, "ready", state.release?.error);
    assert.ok(state.release.changes.includes(`public${presentation.url}`));
    assert.ok(state.release.changes.includes(`public${attachment.url}`));
    assert.ok(!state.release.changes.some(path => path.includes("2027-q1")));
    const previewRedirect = await fetch(new URL(state.release.previewUrl, origin), { headers: { cookie: editor.cookie }, redirect: "manual" });
    assert.equal(previewRedirect.status, 303);
    const ticket = await fetch(previewRedirect.headers.get("location"), { redirect: "manual" });
    assert.equal(ticket.status, 303);
    const previewCookie = ticket.headers.get("set-cookie").split(";", 1)[0];
    const getPreview = path => fetch(previewOrigin + path, { headers: { cookie: previewCookie } });
    const reading = await getPreview("/trimestres/2026-q4/lecciones/leccion-01/domingo");
    assert.equal(reading.status, 200);
    assert.match(await reading.text(), /Juan 3:16/);
    const historical = await getPreview("/trimestres/2026-q3/");
    assert.equal(historical.status, 200);
    assert.match(await historical.text(), /a los Corintios/);
    const pendingWeek = await getPreview("/trimestres/2026-q4/lecciones/leccion-13/martes");
    assert.equal(pendingWeek.status, 200);
    assert.match(await pendingWeek.text(), /Próximamente/);
    assert.equal((await getPreview("/trimestres/2027-q1/")).status, 200);
    const attached = await getPreview(attachment.url);
    assert.equal(attached.headers.get("content-type"), "application/octet-stream");
    assert.equal(attached.headers.get("content-disposition"), "attachment");
    await post(`${base}/approve`, editor, { version: draft.version }, 403);
    ({ body: { draft } } = await post(`${base}/submit`, editor, { version: draft.version }));
    const reviewer = await session(origin, "revision-test");
    const { body: approved } = await post(`${base}/approve`, reviewer, { version: draft.version });
    assert.ok(approved.release.downloadUrl);
    assert.ok(approved.history.some(event => event.action === "draft.approved" && event.actor === "revision-test"));
    const download = await fetch(new URL(approved.release.downloadUrl, origin), { headers: { cookie: reviewer.cookie } });
    assert.equal(download.status, 200);
    const zip = join(dataDir, "test-release.zip");
    await writeFile(zip, Buffer.from(await download.arrayBuffer()));
    const { stdout } = await execute(process.execPath, ["scripts/run_python.mjs", "-c",
      "import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); print(*z.namelist(), sep=chr(10))", zip], { cwd: root });
    assert.match(stdout, /release\.json/);
    assert.match(stdout, /2026-q4\.json/);
    assert.doesNotMatch(stdout, /2027-q1|acceso-demo|originales|\.sqlite/);
    const admin = await session(origin, "admin-test");
    const { body: { draft: restored } } = await post(`${base}/restore`, admin, { title: "Restauración local" }, 201);
    assert.notEqual(restored.id, draft.id);
    assert.equal(restored.status, "editing");
    await api(origin, `users/${adminUser.id}`, { credential: admin, method: "PATCH", data: { active: false }, expected: 409 });
    await post("logout", editor, {});
    assert.equal((await getPreview("/")).status, 403);
  } finally {
    await cms.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
