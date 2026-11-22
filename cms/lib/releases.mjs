import { execFile } from "node:child_process";
import { constants, createReadStream } from "node:fs";
import { access, cp, lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { loadSnapshot, localResourceUrls, publicationIssues, resourceAssetUrls, snapshotFiles } from "./catalog.mjs";
import { publishableSnapshot } from "./publication-model.mjs";
import { HttpError, originHeaders, readCookie, requireCondition } from "./http.mjs";
import { sessionForHash } from "./auth.mjs";
import { readBlob } from "./jobs.mjs";
import { sha256 } from "./store.mjs";
import { randomBytes } from "node:crypto";

const execute = promisify(execFile);
const releaseCookie = "es_cms_preview";
const previewLifetime = 30 * 60 * 1000;
const allowedReleasePath = /^(?:resource-automation\.json|src\/data\/(?:site-config\.json|cms-years\.json|quarters\/\d{4}-q[1-4]\.json)|public\/(?:resource-manifest\.json|manifests\/\d{4}-q[1-4]\.json|recursos\/\d{4}-q[1-4]\/[A-Za-z0-9._/-]+))$/;

function inside(root, relativePath) {
  const absolute = resolve(root, relativePath);
  requireCondition(absolute.startsWith(root + sep), 422, "Una ruta de publicación no pertenece al sitio.");
  return absolute;
}

function checkReleasePath(path) {
  requireCondition(allowedReleasePath.test(path) && path.split("/").every(part => part && part !== "." && part !== ".."),
    422, `La ruta ${path} no está permitida en un paquete editorial.`);
}

function materialPath(url) {
  const path = `public${url}`;
  checkReleasePath(path);
  return path;
}

function stableFiles(snapshot) {
  return [...snapshotFiles(snapshot)].sort(([a], [b]) => a.localeCompare(b));
}

export function snapshotDigest(snapshot) {
  return sha256(JSON.stringify(stableFiles(snapshot).map(([path, bytes]) => [path, sha256(bytes)])));
}

export function checkBase(root, row) {
  const latest = loadSnapshot(root);
  requireCondition(snapshotDigest(latest) === row.base_digest, 409, "El contenido publicado cambió desde que abriste este borrador. Consérvalo y prepara los cambios sobre la nueva base antes de publicar.");
  return latest;
}

function expectedAssets(snapshot) {
  return new Map(resourceAssetUrls(snapshot).map(({ url, sha256: checksum }) => [materialPath(url), checksum]));
}

function absentAssets(base, target) {
  const remaining = new Set(localResourceUrls(target));
  return localResourceUrls(base).filter(url => !remaining.has(url)).map(materialPath);
}

async function writeTo(root, path, data) {
  checkReleasePath(path);
  const destination = inside(root, path);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, data);
}

async function readOptional(root, path) {
  try {
    const file = inside(root, path);
    const metadata = await lstat(file);
    requireCondition(metadata.isFile(), 422, `La ruta ${path} no es un archivo regular.`);
    return await readFile(file);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function runNode(workspace, args, env = {}) {
  try {
    const localEnv = Object.fromEntries(["PATH", "HOME", "USERPROFILE", "SystemRoot", "ComSpec", "LANG", "LC_ALL",
      "TMPDIR", "TMP", "TEMP", "PY_PYTHON", "XDG_CACHE_HOME"].flatMap(name =>
      process.env[name] === undefined ? [] : [[name, process.env[name]]]));
    return await execute(process.execPath, args, {
      cwd: workspace, env: {
        ...localEnv, ASTRO_TELEMETRY_DISABLED: "1", INCLUDE_DRAFT_QUARTERS: "0", ...env,
      }, timeout: 150_000, maxBuffer: 6 * 1024 * 1024,
    });
  } catch (error) {
    const output = (error.stdout ?? "").split("\n").slice(-45).join("\n").trim();
    const stderr = (error.stderr ?? "").split("\n").slice(-10).join("\n").trim();
    throw new Error(`${args[0]} ${args[1] ?? ""}: ${[output, stderr].filter(Boolean).join("\n") || "se agotó el tiempo o falló el proceso."}`);
  }
}

async function makeManifest(workspace, entry, manifestPath) {
  checkReleasePath(manifestPath);
  return runNode(workspace, ["scripts/run_python.mjs", "scripts/audit_resources.py", "--catalog", entry.catalog, "--manifest", manifestPath, "--write-manifest"]);
}

async function createBundle(workspace, root, original, snapshot, draft, commit, readyBundle) {
  const publicSnapshot = publishableSnapshot(snapshot, original);
  const files = new Map();
  const base = snapshotFiles(original);
  for (const [path, data] of stableFiles(publicSnapshot)) {
    if (!base.has(path) || sha256(base.get(path)) !== sha256(data)) files.set(path, data);
  }
  const previousAssets = expectedAssets(original);
  for (const [path, checksum] of expectedAssets(publicSnapshot)) {
    if (previousAssets.get(path) !== checksum || !await readOptional(root, path)) files.set(path, await readFile(inside(workspace, path)));
  }
  const removals = absentAssets(original, publicSnapshot);
  for (const entry of publicSnapshot.registry.quarters) {
    if (entry.status === "draft" || !files.has(entry.catalog)) continue;
    const path = `public/manifests/${entry.id}.json`;
    const data = await readOptional(workspace, path);
    requireCondition(data, 422, `Falta el manifiesto de ${entry.id}.`);
    const previous = await readOptional(root, path);
    if (!previous || sha256(previous) !== sha256(data)) files.set(path, data);
  }
  const active = publicSnapshot.registry.activeCatalog;
  if (files.has(active) || active !== original.registry.activeCatalog) {
    const path = "public/resource-manifest.json";
    files.set(path, await readFile(inside(workspace, path)));
  }
  const packageDir = join(workspace, "entrega");
  await mkdir(packageDir);
  const changes = [];
  for (const [path, content] of files) {
    const previous = await readOptional(root, path);
    await writeTo(packageDir, path, content);
    changes.push({ path, sha256: sha256(content), previousSha256: previous && sha256(previous) });
  }
  const removedFiles = [];
  for (const path of removals) {
    const file = await readOptional(root, path);
    if (file) removedFiles.push({ path, previousSha256: sha256(file) });
  }
  const manifest = {
    schemaVersion: 1, name: draft.title, repository: "medina-raul/escuela-sabatica", baseBranch: "main",
    baseCommit: commit, baseSnapshotChecksum: draft.base_digest, snapshotChecksum: snapshotDigest(snapshot),
    files: changes, removedFiles,
  };
  const manifestFile = join(packageDir, "release.json");
  await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  await runNode(workspace, ["scripts/run_python.mjs", "-c", [
    "import pathlib,sys,zipfile",
    "source = pathlib.Path(sys.argv[1])",
    "with zipfile.ZipFile(sys.argv[2], 'w', zipfile.ZIP_DEFLATED) as output:",
    "    for path in sorted(source.rglob('*')):",
    "        if path.is_file(): output.write(path, path.relative_to(source).as_posix())",
  ].join("\n"), packageDir, readyBundle]);
  return [...changes.map(item => item.path), ...removedFiles.map(item => `Eliminar: ${item.path}`)];
}

export function createPublisher({ store, root, issueCheck = publicationIssues }) {
  const workspaces = new Map();
  const tickets = new Map();
  const previewSessions = new Map();
  let building = null;
  let closed = false;

  store.run("UPDATE releases SET status = 'failed', error = 'Se interrumpió la preparación. Puedes volver a generarla.' WHERE status IN ('queued', 'building')");

  function status(row) {
    const digest = snapshotDigest(JSON.parse(row.snapshot));
    const release = store.get("SELECT * FROM releases WHERE draft_id = ? AND snapshot_digest = ?", row.id, digest);
    if (!release) return null;
    const url = `/admin/api/drafts/${row.id}`;
    const preview = workspaces.has(release.id);
    const changes = JSON.parse(release.changes);
    return {
      id: release.id, status: release.status, changes, error: release.error || undefined,
      previewUrl: preview ? `${url}/preview` : undefined,
      downloadUrl: release.status === "ready" && changes.length > 0 && row.status === "approved" ? `${url}/download` : undefined,
    };
  }

  function prepare(row, userId) {
    requireCondition(!closed, 503, "El portal se está cerrando.");
    const original = checkBase(root, row);
    const snapshot = JSON.parse(row.snapshot);
    const issues = issueCheck(snapshot);
    requireCondition(issues.length === 0, 422, issues[0]);
    const existing = status(row);
    if (existing?.status === "ready" && existing.previewUrl) return existing;
    if (existing && ["queued", "building"].includes(existing.status)) return existing;
    requireCondition(!building, 409, "Ya se está construyendo otra vista previa. Vuelve a intentarlo cuando termine.");
    const id = existing?.id ?? store.id();
    const digest = snapshotDigest(snapshot);
    store.run(`INSERT INTO releases (id, draft_id, snapshot_digest, status, created_at) VALUES (?, ?, ?, 'queued', ?)
      ON CONFLICT(id) DO UPDATE SET status = 'queued', changes = '[]', error = NULL`, id, row.id, digest, store.stamp());
    store.audit("release.queued", { draftId: row.id, userId });
    building = buildRelease(id, row, original, snapshot, userId).finally(() => { building = null; });
    return status(row);
  }

  async function buildRelease(id, draft, original, snapshot, userId) {
    let dir;
    const bundle = join(store.dataDir, "entregas", `${id}.zip`);
    const nextBundle = `${bundle}.tmp`;
    try {
      const projectEntries = ["src", "public", "scripts", "content", "node_modules", "cms", "astro.config.mjs", "tsconfig.json", "package.json", "package-lock.json", "resource-automation.json"];
      store.run("UPDATE releases SET status = 'building' WHERE id = ?", id);
      dir = await mkdtemp(join(tmpdir(), "escuela-cms-preview-"));
      const workspace = join(dir, "site");
      await mkdir(workspace);
      for (const name of projectEntries) {
        const source = join(root, name);
        await access(source);
        await cp(source, join(workspace, name), {
          recursive: true, mode: constants.COPYFILE_FICLONE,
          verbatimSymlinks: true,
          filter: sourcePath => ![".DS_Store", "__pycache__", ".vite", ".vite-temp", ".astro", ".cache"].includes(sourcePath.split(sep).at(-1)),
        });
      }
      for (const [path, data] of stableFiles(snapshot)) await writeTo(workspace, path, data);
      for (const path of absentAssets(original, snapshot)) await rm(inside(workspace, path), { force: true });
      for (const [path, checksum] of expectedAssets(snapshot)) {
        const local = await readOptional(workspace, path);
        if (!local || sha256(local) !== checksum) await writeTo(workspace, path, readBlob(store, checksum));
      }
      const baseFiles = snapshotFiles(original);
      const nextFiles = snapshotFiles(snapshot);
      for (const entry of snapshot.registry.quarters) {
        if (entry.status === "draft") continue;
        const changed = !baseFiles.has(entry.catalog) || sha256(baseFiles.get(entry.catalog)) !== sha256(nextFiles.get(entry.catalog));
        if (changed) await makeManifest(workspace, entry, `public/manifests/${entry.id}.json`);
      }
      const active = snapshot.registry.quarters.find(entry => entry.catalog === snapshot.registry.activeCatalog);
      await makeManifest(workspace, active, "public/resource-manifest.json");
      async function buildAndAudit(includeDrafts) {
        await runNode(workspace, ["node_modules/astro/bin/astro.mjs", "build"], { INCLUDE_DRAFT_QUARTERS: includeDrafts ? "1" : "0", CMS_PRIVATE_PREVIEW: "1" });
        await runNode(workspace, ["scripts/run_python.mjs", "scripts/audit_site_build.py"]);
      }
      await buildAndAudit(false);
      if (snapshot.registry.quarters.some(entry => entry.status === "draft")) await buildAndAudit(true);
      await mkdir(join(store.dataDir, "entregas"), { mode: 0o700, recursive: true });
      const { stdout: commit } = await execute("git", ["rev-parse", "HEAD"], { cwd: root, timeout: 5000 });
      checkBase(root, draft);
      const changes = await createBundle(workspace, root, original, snapshot, draft, commit.trim(), nextBundle);
      await rename(nextBundle, bundle);
      workspaces.set(id, { dir, dist: await realpath(join(workspace, "dist")), draftId: draft.id, digest: snapshotDigest(snapshot) });
      store.run("UPDATE releases SET status = 'ready', changes = ? WHERE id = ?", JSON.stringify(changes), id);
      store.audit("release.ready", { draftId: draft.id, userId, comment: `${changes.length} cambio(s)` });
      await prune();
    } catch (error) {
      const message = String(error.message).replaceAll(dir ?? "~~no-dir~~", "[vista previa]").slice(0, 4400);
      store.run("UPDATE releases SET status = 'failed', error = ? WHERE id = ?", message, id);
      store.audit("release.failed", { draftId: draft.id, userId });
      if (dir) await rm(dir, { recursive: true, force: true });
      await rm(nextBundle, { force: true });
    }
  }

  async function prune() {
    while (workspaces.size > 3) {
      const id = workspaces.keys().next().value;
      const old = workspaces.get(id);
      workspaces.delete(id);
      await rm(old.dir, { recursive: true, force: true });
    }
  }

  function openPreview(row, session, previewOrigin) {
    const release = status(row);
    requireCondition(release?.previewUrl, 404, "Primero prepara la vista previa de esta versión.");
    for (const [key, value] of tickets) if (value.expires <= store.now()) tickets.delete(key);
    for (const [key, value] of previewSessions) if (value.expires <= store.now()) previewSessions.delete(key);
    const key = randomBytes(32).toString("base64url");
    tickets.set(key, { releaseId: release.id, tokenHash: session.tokenHash, expires: store.now() + 30_000 });
    return `${previewOrigin}/?acceso=${key}`;
  }

  async function servePreview(request, response, url) {
    originHeaders(response, true);
    if (request.method !== "GET" && request.method !== "HEAD") throw new HttpError(405, "Método no permitido.");
    if (url.pathname === "/" && url.searchParams.has("acceso")) {
      const ticketKey = url.searchParams.get("acceso");
      const ticket = tickets.get(ticketKey);
      tickets.delete(ticketKey);
      requireCondition(ticket && ticket.expires > store.now() && sessionForHash(store, ticket.tokenHash), 403, "El acceso a la vista previa caducó. Vuélvela a abrir en el CMS.");
      const key = randomBytes(32).toString("base64url");
      previewSessions.set(key, { ...ticket, expires: store.now() + previewLifetime });
      response.writeHead(303, {
        "Set-Cookie": `${releaseCookie}=${key}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${previewLifetime / 1000}`,
        Location: "/",
      });
      response.end();
      return;
    }
    const session = previewSessions.get(readCookie(request, releaseCookie));
    requireCondition(session && session.expires > store.now() && sessionForHash(store, session.tokenHash), 403, "Abre una vista previa desde tu sesión del CMS.");
    const preview = workspaces.get(session.releaseId);
    requireCondition(preview, 404, "Esa vista previa necesita generarse de nuevo.");
    const row = store.get("SELECT snapshot FROM drafts WHERE id = ?", preview.draftId);
    requireCondition(row && snapshotDigest(JSON.parse(row.snapshot)) === preview.digest, 409, "El borrador cambió. Prepara otra vista previa.");
    await sendPreviewFile(request, response, preview.dist, url.pathname);
  }

  async function download(row, response, userId) {
    const release = status(row);
    requireCondition(release?.downloadUrl, 409, "La entrega requiere aprobación y cambios listos para publicar.");
    checkBase(root, row);
    const file = join(store.dataDir, "entregas", `${release.id}.zip`);
    const metadata = await stat(file).catch(() => null);
    requireCondition(metadata?.isFile(), 404, "Vuelve a preparar el paquete de publicación.");
    store.audit("release.downloaded", { draftId: row.id, userId });
    response.writeHead(200, { "Content-Type": "application/zip", "Content-Length": metadata.size, "Content-Disposition": 'attachment; filename="escuela-sabatica-publicacion.zip"' });
    createReadStream(file).on("error", () => response.destroy()).pipe(response);
  }

  return { status, prepare, openPreview, servePreview, download, async close() {
    closed = true;
    if (building) await building;
    await Promise.all([...workspaces.values()].map(item => rm(item.dir, { recursive: true, force: true })));
  } };
}

const contentTypes = {
  html: "text/html; charset=utf-8", css: "text/css; charset=utf-8", js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8", json: "application/json", png: "image/png", jpg: "image/jpeg",
  jpeg: "image/jpeg", svg: "image/svg+xml", webp: "image/webp", woff2: "font/woff2",
  pdf: "application/pdf", mp3: "audio/mpeg", mp4: "video/mp4", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

async function sendPreviewFile(request, response, directory, pathname) {
  let clean;
  try {
    clean = decodeURIComponent(pathname).replace(/^\/+/, "");
  } catch {
    throw new HttpError(400, "Ruta inválida.");
  }
  requireCondition(!clean.includes("\\") && !clean.includes("\0") && !clean.split("/").some(part => part.startsWith(".")), 404, "Página desconocida.");
  const path = inside(directory, clean || "index.html");
  let chosen = path;
  let metadata = await stat(path).catch(() => null);
  if (metadata?.isDirectory()) {
    chosen = join(path, "index.html");
    metadata = await stat(chosen).catch(() => null);
  }
  requireCondition(metadata?.isFile() && (await realpath(chosen)).startsWith(directory + sep), 404, "Página desconocida.");
  const ext = chosen.split(".").pop().toLowerCase();
  const headers = { "Content-Type": contentTypes[ext] ?? "application/octet-stream", "Content-Length": metadata.size };
  if (!contentTypes[ext]) headers["Content-Disposition"] = "attachment";
  response.writeHead(200, headers);
  if (request.method === "HEAD") response.end();
  else createReadStream(chosen).on("error", () => response.destroy()).pipe(response);
}
