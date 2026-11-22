import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { findBibleReferenceMatches } from "../src/lib/bibleReferenceParser.ts";
import { addUser, capabilities, checkRequestMutation, listUsers, login, requireAdmin, requireEditor, sessionForRequest, setSessionCookie, updateUser } from "./lib/auth.mjs";
import { materialJobRunner } from "./lib/auto-resources.mjs";
import { loadSnapshot } from "./lib/catalog.mjs";
import { acceptChange, applyImport, createDraft, describeDraft, draftRow, listDrafts, liveSummary, requireDraftEditor, versionCheck, workflow } from "./lib/drafts.mjs";
import { HttpError, json, originHeaders, readJson, requireCondition } from "./lib/http.mjs";
import { adventechLessonUrls } from "./lib/ingest.mjs";
import { approvedHosts, enqueueImport, getJob, listJobs, listSources, normalizeHost, originalForJob, processJob, receiveAsset, receiveImport, retryImport, runSource, saveSource, scheduleSources } from "./lib/jobs.mjs";
import { createPublisher } from "./lib/releases.mjs";
import { openStore } from "./lib/store.mjs";

const filename = fileURLToPath(import.meta.url);
const projectRoot = dirname(dirname(filename));
const uiRoot = join(dirname(filename), "ui");
const host = "127.0.0.1";
const idPattern = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/;

function requireId(id) {
  requireCondition(typeof id === "string" && idPattern.test(id), 404, "Identificador desconocido.");
  return id;
}

function redirect(response, location) {
  response.writeHead(303, { Location: location });
  response.end();
}

function listen(server, port) {
  return new Promise((resolveAddress, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.removeListener("error", reject);
      resolveAddress(`http://${host}:${server.address().port}`);
    });
  });
}

function closeServer(server) {
  return new Promise(resolveClose => {
    server.close(() => resolveClose());
    server.closeAllConnections();
  });
}

function secureUrl(request, origin) {
  requireCondition(origin && request.headers.host === new URL(origin).host,
    421, "Abre el portal en la dirección local que se indicó al iniciar.");
  requireCondition(typeof request.url === "string" && request.url.startsWith("/") &&
    !request.url.startsWith("//") && !request.url.includes("\\"), 400, "Ruta inválida.");
  return new URL(request.url, origin);
}

function errorResponse(response, error) {
  if (response.headersSent) return response.destroy();
  const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 600 ? error.status : 500;
  if (status === 413) response.setHeader("Connection", "close");
  if (status === 500) console.error("Error interno del CMS:", error);
  json(response, status, { error: status === 500 ? "No se pudo completar esta operación. Consulta el registro local." : error.message });
}

function requireOwnDraft(user, row) {
  requireEditor(user);
  requireCondition(user.role === "admin" || row.owner_id === user.id, 403, "El borrador pertenece a otra persona.");
}

async function serveUi(request, response, path) {
  requireCondition(["GET", "HEAD"].includes(request.method), 405, "Método no permitido.");
  if (path === "/admin") return redirect(response, "/admin/");
  let asset = "index.html";
  if (path !== "/admin/") {
    const match = path.match(/^\/admin\/assets\/([a-z0-9-]+\.(?:mjs|css|svg))$/);
    requireCondition(match, 404, "Página desconocida.");
    asset = match[1];
  }
  const contentTypes = { html: "text/html", css: "text/css", mjs: "text/javascript", svg: "image/svg+xml" };
  const content = await readFile(join(uiRoot, asset)).catch(error => {
    if (error.code === "ENOENT") throw new HttpError(404, "Archivo desconocido.");
    throw error;
  });
  response.writeHead(200, { "Content-Type": `${contentTypes[asset.split(".").pop()]}; charset=utf-8`, "Content-Length": content.length });
  response.end(request.method === "HEAD" ? undefined : content);
}

async function handleDraft({ request, response, store, root, publisher, user, session, previewOrigin, path }) {
  const [, idValue, action, id2, subAction, index] = path;
  const id = requireId(idValue);
  let row = draftRow(store, id);
  const method = request.method;
  if (method === "GET") {
    if (!action) return json(response, 200, describeDraft(store, publisher, row, user));
    if (action === "preview" && !id2) return redirect(response, publisher.openPreview(row, session, previewOrigin));
    if (action === "download" && !id2) {
      requireCondition(capabilities(user).prepare, 403, "Tu perfil no puede preparar una entrega.");
      return publisher.download(row, response, user.id);
    }
    if (action === "import") {
      if (!id2) return json(response, 200, { jobs: listJobs(store, id) });
      if (!subAction) return json(response, 200, { job: getJob(store, id, requireId(id2)) });
      if (subAction === "original" && /^\d{1,3}$/.test(index ?? "")) {
        const original = originalForJob(store, id, requireId(id2), Number(index));
        const name = encodeURIComponent(original.name).replace(/['()]/g, unescaped => `%${unescaped.charCodeAt(0).toString(16)}`);
        response.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": original.bytes.length, "Content-Disposition": `attachment; filename="original"; filename*=UTF-8''${name}` });
        return response.end(original.bytes);
      }
    }
    throw new HttpError(404, "Ruta editorial desconocida.");
  }
  requireCondition(method === "POST", 405, "Método no permitido.");
  if (action === "change" && !id2) {
    row = acceptChange(store, user, id, await readJson(request));
    return json(response, 200, describeDraft(store, publisher, row, user));
  }
  if (action === "import" && !id2) {
    requireDraftEditor(user, row);
    const items = await receiveImport(store, request);
    requireDraftEditor(user, draftRow(store, id));
    return json(response, 202, { job: enqueueImport(store, { draftId: id, userId: user.id, items }) });
  }
  if (action === "import" && id2 === "adventech" && !subAction) {
    requireDraftEditor(user, row);
    const body = await readJson(request);
    requireCondition(approvedHosts(store).includes("raw.githubusercontent.com"), 422, "Autoriza primero el dominio oficial de Adventech.");
    let urls;
    try { urls = adventechLessonUrls(body); }
    catch (error) { throw new HttpError(422, error.message); }
    const items = urls.map(url => ({ url, name: new URL(url).pathname.split("/").pop(), kind: "adventech", status: "queued" }));
    return json(response, 202, { job: enqueueImport(store, { draftId: id, userId: user.id, items }) });
  }
  if (action === "import" && subAction === "apply") {
    row = applyImport(store, user, id, requireId(id2), await readJson(request));
    return json(response, 200, describeDraft(store, publisher, row, user));
  }
  if (action === "import" && subAction === "retry") {
    requireDraftEditor(user, row);
    return json(response, 202, { job: retryImport(store, id, requireId(id2), user.id) });
  }
  if (action === "assets" && !id2) {
    requireDraftEditor(user, row);
    return json(response, 201, { asset: await receiveAsset(store, request, id) });
  }
  if (["submit", "approve", "reopen"].includes(action) && !id2) {
    row = workflow(store, root, publisher, user, id, action, await readJson(request));
    return json(response, 200, describeDraft(store, publisher, row, user));
  }
  if (action === "restore" && !id2) {
    return json(response, 201, describeDraft(store, publisher, createDraft(store, root, user, await readJson(request), id), user));
  }
  if (action === "prepare" && !id2) {
    requireCondition(capabilities(user).prepare, 403, "Tu perfil no puede preparar una vista previa.");
    const body = await readJson(request);
    row = draftRow(store, id);
    if (row.status === "editing" && user.role !== "reviewer") requireOwnDraft(user, row);
    versionCheck(row, body.version);
    publisher.prepare(row, user.id);
    return json(response, 202, describeDraft(store, publisher, row, user));
  }
  throw new HttpError(404, "Ruta editorial desconocida.");
}

async function handleApi({ request, response, store, root, publisher, origin, previewOrigin, pathname }) {
  const path = pathname.slice("/admin/api/".length).split("/").filter(Boolean);
  const [resource, id, action] = path;
  const method = request.method;
  const session = sessionForRequest(store, request);
  if (resource === "session" && !id && method === "GET") {
    return json(response, 200, session ? { user: session.user, csrf: session.csrf } : { user: null });
  }
  if (resource === "login" && !id && method === "POST") {
    checkRequestMutation(request, origin, null);
    const account = await login(store, await readJson(request, 4096));
    if (session) store.run("DELETE FROM sessions WHERE token_hash = ?", session.tokenHash);
    setSessionCookie(response, account.token);
    return json(response, 200, { user: account.user, csrf: account.csrf });
  }
  requireCondition(session, 401, "Inicia sesión para acceder al CMS.");
  const { user } = session;
  if (method !== "GET") checkRequestMutation(request, origin, session);
  if (resource === "logout" && !id && method === "POST") {
    store.run("DELETE FROM sessions WHERE token_hash = ?", session.tokenHash);
    setSessionCookie(response);
    return json(response, 200, { user: null });
  }
  if (resource === "dashboard" && !id && method === "GET") {
    return json(response, 200, { user, capabilities: capabilities(user), live: liveSummary(root), drafts: listDrafts(store) });
  }
  if (resource === "references" && !id && method === "POST") {
    const { text } = await readJson(request);
    requireCondition(typeof text === "string" && text.length <= 200_000, 400, "El texto a analizar debe tener hasta 200.000 caracteres.");
    return json(response, 200, { references: findBibleReferenceMatches(text).slice(0, 300).map(match => match.reference) });
  }
  if (resource === "drafts") {
    if (!id && method === "POST") return json(response, 201, describeDraft(store, publisher, createDraft(store, root, user, await readJson(request)), user));
    if (id) return handleDraft({ request, response, store, root, publisher, user, session, previewOrigin, path });
  }
  if (resource === "users") {
    requireAdmin(user);
    if (!id && method === "GET") return json(response, 200, { users: listUsers(store) });
    if (!id && method === "POST") return json(response, 201, { user: await addUser(store, await readJson(request, 4096), user.id) });
    if (id && !action && method === "PATCH") return json(response, 200, { user: updateUser(store, requireId(id), await readJson(request, 4096), user.id) });
  }
  if (resource === "sources") {
    if (!id && method === "GET") return json(response, 200, { sources: listSources(store), allowedHosts: approvedHosts(store) });
    requireEditor(user);
    if (!id && method === "POST") {
      const data = await readJson(request);
      requireOwnDraft(user, draftRow(store, requireId(data.draftId)));
      return json(response, 201, { source: saveSource(store, null, data, user.id) });
    }
    if (id) {
      const source = store.get("SELECT draft_id FROM sources WHERE id = ?", requireId(id));
      requireCondition(source, 404, "Fuente desconocida.");
      requireOwnDraft(user, draftRow(store, source.draft_id));
      if (action === "run" && method === "POST") return json(response, 202, { job: runSource(store, id, user.id) });
      if (!action && method === "PATCH") {
        const data = await readJson(request);
        if (data.draftId) requireOwnDraft(user, draftRow(store, requireId(data.draftId)));
        return json(response, 200, { source: saveSource(store, id, data, user.id) });
      }
    }
  }
  if (resource === "hosts" && !id && method === "POST") {
    requireAdmin(user);
    const { host: requested } = await readJson(request, 4096);
    const approved = normalizeHost(requested);
    store.transaction(() => {
      if (store.run("INSERT OR IGNORE INTO approved_hosts (host) VALUES (?)", approved).changes) {
        store.audit("source.host.approved", { userId: user.id, comment: approved });
      }
    });
    return json(response, 201, { allowedHosts: approvedHosts(store) });
  }
  throw new HttpError(404, "La operación no existe.");
}

async function setupDemo(store) {
  const demo = [
    ["admin-local", "admin"], ["editor-local", "editor"], ["revisor-local", "reviewer"], ["consulta-local", "viewer"],
  ];
  if (store.get("SELECT 1 FROM users LIMIT 1")) return false;
  const credentials = demo.map(([username, role]) => ({ username, role, password: randomBytes(12).toString("base64url") }));
  for (const entry of credentials) await addUser(store, entry);
  const output = join(store.dataDir, "acceso-demo.txt");
  await writeFile(output, `Cuentas para la prueba local\n\n${credentials.map(entry => `${entry.username} (${entry.role})\t${entry.password}`).join("\n")}\n`, { mode: 0o600, flag: "wx" });
  console.log(`Cuentas demo: ${output}`);
  return true;
}

export async function createCmsServer({
  root = projectRoot, dataDir = join(root, "artifacts", "cms-local"), demo = false, now, extract, download, runWorker = true,
} = {}) {
  root = await realpath(root);
  dataDir = resolve(dataDir);
  for (const section of [".git", "public", "src", "dist", "cms", "docs"]) {
    const protectedDir = join(root, section);
    requireCondition(dataDir !== root && dataDir !== protectedDir && !dataDir.startsWith(protectedDir + sep), 400, "Guarda los datos del CMS en una carpeta privada.");
  }
  requireCondition(!root.startsWith(dataDir + sep), 400, "La carpeta de datos no puede contener el proyecto.");
  const store = openStore(dataDir, now);
  try {
    const baseline = loadSnapshot(root);
    store.transaction(() => {
      for (const quarter of Object.values(baseline.quarters)) {
        for (const domain of quarter.resourceAutomation?.allowedSourceHosts ?? []) {
          store.run("INSERT OR IGNORE INTO approved_hosts (host) VALUES (?)", normalizeHost(domain));
        }
      }
      store.run("UPDATE jobs SET status = 'queued' WHERE status = 'running'");
    });
    if (demo) await setupDemo(store);
  } catch (error) {
    store.close();
    throw error;
  }
  const publisher = createPublisher({ store, root });
  const checkMaterials = materialJobRunner(store, root, { download });
  let origin, previewOrigin, interval, work;
  const options = { requestTimeout: 30_000, headersTimeout: 10_000, keepAliveTimeout: 2500 };
  async function step() {
    if (work) return work;
    work = Promise.resolve().then(async () => {
      scheduleSources(store);
      await processJob(store, extract, checkMaterials);
    }).catch(error => console.error("Error de la cola del CMS:", error)).finally(() => { work = null; });
    return work;
  }
  const adminServer = createServer(options, (request, response) => {
    originHeaders(response);
    Promise.resolve().then(() => {
      const { pathname } = secureUrl(request, origin);
      if (pathname === "/") return redirect(response, "/admin/");
      if (pathname.startsWith("/admin/api/")) return handleApi({ request, response, store, root, publisher, origin, previewOrigin, pathname });
      return serveUi(request, response, pathname);
    }).catch(error => errorResponse(response, error));
  });
  const previewServer = createServer(options, (request, response) => {
    originHeaders(response, true);
    Promise.resolve().then(() => publisher.servePreview(request, response, secureUrl(request, previewOrigin)))
      .catch(error => errorResponse(response, error));
  });
  return {
    store, step,
    async listen(port = 4371) {
      previewOrigin = await listen(previewServer, 0);
      origin = await listen(adminServer, port);
      if (runWorker) {
        interval = setInterval(step, 1000);
        interval.unref();
        void step();
      }
      return { origin, previewOrigin, url: `${origin}/admin/` };
    },
    async close() {
      clearInterval(interval);
      await Promise.all([closeServer(adminServer), closeServer(previewServer)]);
      if (work) await work;
      await publisher.close();
      store.close();
    },
  };
}

if (process.argv[1] && await realpath(process.argv[1]) === filename) {
  const dataDir = process.env.CMS_DATA_DIR
    ? resolve(process.env.CMS_DATA_DIR) : join(projectRoot, "artifacts", "cms-local");
  const port = Number(process.env.CMS_PORT ?? 4371);
  requireCondition(Number.isInteger(port) && port > 0 && port <= 65535, 400, "CMS_PORT no es un puerto válido.");
  const server = await createCmsServer({ dataDir, demo: process.argv.includes("--demo") });
  try {
    const { url } = await server.listen(port);
    console.log(`Panel editorial local: ${url}`);
  } catch (error) {
    await server.close();
    throw error;
  }
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, async () => {
    await server.close();
    process.exit(0);
  });
}
