import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { HttpError, readForm, requireCondition, requiredText } from "./http.mjs";
import { ingestItem, MAX_ASSET_BYTES, validateAsset, prepareArticle } from "./ingest.mjs";
import { sha256 } from "./store.mjs";

const maxImport = 40 * 1024 * 1024;
const maxAsset = MAX_ASSET_BYTES;
const maxItems = 105; // A quarterly Adventech selection contains up to 91 daily documents.
const sourceKinds = new Set(["auto", "pdf", "html", "markdown", "text", "url", "adventech"]);
const hashPattern = /^sha256:[a-f0-9]{64}$/;

function filename(value, fallback = "fuente") {
  const cleaned = String(value ?? "").split(/[\\/]/).pop().replace(/[\x00-\x1f\x7f]/g, "").trim();
  return cleaned.slice(0, 180) || fallback;
}

function blobFile(store, checksum) {
  if (!hashPattern.test(checksum ?? "")) throw new Error("Identificador de archivo inválido.");
  return join(store.dataDir, "archivos", checksum.slice(7));
}

export function writeBlob(store, bytes, checksum = sha256(bytes)) {
  requireCondition(sha256(bytes) === checksum, 422, "El original no coincide con su huella.");
  mkdirSync(join(store.dataDir, "archivos"), { recursive: true, mode: 0o700 });
  const path = blobFile(store, checksum);
  try {
    writeFileSync(path, bytes, { mode: 0o600, flag: "wx" });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  return checksum;
}

export function readBlob(store, checksum) {
  const bytes = readFileSync(blobFile(store, checksum));
  requireCondition(sha256(bytes) === checksum, 422, "El archivo guardado no coincide con su huella.");
  return bytes;
}

export function normalizeHost(value) {
  const host = String(value ?? "").trim().toLowerCase();
  requireCondition(host.length <= 253 && /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(host), 400, "Ingresa un dominio público exacto, sin rutas.");
  requireCondition(!/\.(?:local|internal|test|localhost|invalid|example)$/.test(host), 400, "Usa un dominio público.");
  return host;
}

export function approvedHosts(store) {
  return store.all("SELECT host FROM approved_hosts ORDER BY host").map(row => row.host);
}

export function sourceUrl(value) {
  const input = requiredText(value, "la dirección de origen", 2000);
  let parsed;
  try {
    parsed = new URL(input);
  } catch {
    throw new HttpError(400, "Usa una URL HTTPS válida.");
  }
  requireCondition(parsed.protocol === "https:" && !parsed.port && !parsed.username && !parsed.password, 400, "Usa una URL HTTPS sin puerto ni credenciales.");
  normalizeHost(parsed.hostname);
  parsed.hash = "";
  return parsed;
}

function requireApprovedUrl(store, url) {
  const parsed = sourceUrl(url);
  requireCondition(store.get("SELECT 1 FROM approved_hosts WHERE host = ?", parsed.hostname), 422, `Pide a un administrador que apruebe el dominio ${parsed.hostname}.`);
  return parsed.href;
}

export async function receiveImport(store, request) {
  const form = await readForm(request, maxImport);
  const kind = String(form.get("kind") || "auto");
  requireCondition(sourceKinds.has(kind), 400, "Elige un tipo de fuente válido.");
  const urls = String(form.get("urls") ?? "").split(/\r?\n/).map(value => value.trim()).filter(Boolean);
  const files = form.getAll("files").filter(item => typeof item !== "string" && item.name && item.size);
  const text = String(form.get("text") ?? "").trim();
  requireCondition(Buffer.byteLength(text) <= 256 * 1024, 413, "El texto pegado supera el tamaño permitido.");
  requireCondition(urls.length + files.length + Boolean(text) > 0, 400, "Agrega un archivo, enlace o texto.");
  requireCondition(urls.length + files.length + Boolean(text) <= maxItems && files.length <= 24, 413, "Divide la importación en lotes más pequeños.");
  const items = urls.map(value => {
    try {
      const url = requireApprovedUrl(store, value);
      return { name: new URL(url).pathname.split("/").pop() || new URL(url).hostname, url, kind, status: "queued" };
    } catch (error) {
      return { name: filename(value, "Enlace rechazado"), kind, status: "failed", error: error.message };
    }
  });
  for (const file of files) {
    const bytes = Buffer.from(await file.arrayBuffer());
    items.push({ name: filename(file.name), checksum: writeBlob(store, bytes), kind, status: "queued" });
  }
  if (text) {
    items.push({ name: kind === "html" ? "texto.html" : "texto.md", checksum: writeBlob(store, Buffer.from(text)), kind, status: "queued" });
  }
  return items;
}

export function enqueueImport(store, { draftId, userId = null, sourceId = null, items }) {
  return store.transaction(() => {
    const { count } = store.get("SELECT count(*) AS count FROM jobs WHERE draft_id = ? AND status IN ('queued', 'running')", draftId);
    requireCondition(count < 5, 409, "Hay cinco importaciones en curso para este borrador. Espera que terminen.");
    const id = store.id();
    const stamp = store.stamp();
    store.run("INSERT INTO jobs (id, draft_id, actor_id, source_id, status, created_at, updated_at, items) VALUES (?, ?, ?, ?, 'queued', ?, ?, ?)",
      id, draftId, userId, sourceId, stamp, stamp, JSON.stringify(items));
    if (sourceId) store.run("UPDATE sources SET state = 'queued' WHERE id = ?", sourceId);
    store.audit("import.queued", { draftId, userId, comment: `${items.length} fuente(s)` });
    return getJob(store, draftId, id);
  });
}

function serializeJob(row, details) {
  const job = {
    id: row.id, status: row.status, sourceId: row.source_id, createdAt: row.created_at, updatedAt: row.updated_at,
    items: JSON.parse(row.items).map(item => ({
      name: item.name, status: item.status, error: item.error, unchanged: item.unchanged, hasOriginal: Boolean(item.checksum),
      ...(details && item.result ? { result: item.result } : {}),
    })),
  };
  return job;
}

export function getJob(store, draftId, jobId) {
  const row = store.get("SELECT * FROM jobs WHERE draft_id = ? AND id = ?", draftId, jobId);
  requireCondition(row, 404, "Importación desconocida.");
  return serializeJob(row, true);
}

export function listJobs(store, draftId) {
  return store.all("SELECT * FROM jobs WHERE draft_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 100", draftId).map(row => serializeJob(row, false));
}

export function retryImport(store, draftId, jobId, userId) {
  const row = store.get("SELECT * FROM jobs WHERE id = ? AND draft_id = ?", jobId, draftId);
  requireCondition(row, 404, "Importación desconocida.");
  requireCondition(row.status === "partial" || row.status === "failed", 409, "Esta importación todavía no tiene partes que se puedan volver a procesar.");
  if (row.source_id) return runSource(store, row.source_id, userId);
  const stuck = JSON.parse(row.items).filter(item => item.status === "failed" && (item.url || item.checksum));
  requireCondition(stuck.length, 422, "Agrega de nuevo las fuentes rechazadas con un archivo o un enlace autorizado.");
  const items = stuck.map(({ name, url, checksum, kind }) => ({ name, url, checksum, kind, status: "queued" }));
  return enqueueImport(store, { draftId, userId, items });
}

function sourceInfo(row) {
  return {
    id: row.id, draftId: row.draft_id, name: row.name, url: row.url, kind: row.kind,
    purpose: row.purpose, resource: JSON.parse(row.resource),
    intervalMinutes: row.interval_minutes, enabled: Boolean(row.enabled),
    nextRunAt: new Date(row.next_run_at).toISOString(), lastRunAt: row.last_run_at, state: row.state,
  };
}

export function listSources(store) {
  return store.all("SELECT * FROM sources ORDER BY name").map(sourceInfo);
}

export function saveSource(store, id, data, userId) {
  return store.transaction(() => {
    const before = id ? store.get("SELECT * FROM sources WHERE id = ?", id) : undefined;
    if (id) requireCondition(before, 404, "Fuente desconocida.");
    const draftId = data.draftId ?? before?.draft_id;
    const name = requiredText(data.name ?? before?.name, "el nombre de la fuente", 120);
    const purpose = data.purpose ?? before?.purpose ?? "lesson";
    requireCondition(["lesson", "resource", "resource-index", "quarter-resources"].includes(purpose), 400, "La tarea de la fuente no existe.");
    const url = purpose === "quarter-resources" ? "" : requireApprovedUrl(store, data.url ?? before?.url);
    const kind = data.kind ?? before?.kind ?? "auto";
    const interval = Number(data.intervalMinutes ?? before?.interval_minutes ?? 10080);
    const enabled = data.enabled ?? (before ? Boolean(before.enabled) : false);
    requireCondition(sourceKinds.has(kind), 400, "El tipo de fuente no existe.");
    requireCondition(Number.isInteger(interval) && interval >= 15 && interval <= 43200, 400, "Usa un intervalo de 15 a 43.200 minutos.");
    requireCondition(typeof enabled === "boolean", 400, "El estado de la fuente no es válido.");
    const draft = typeof draftId === "string" && store.get("SELECT snapshot FROM drafts WHERE id = ?", draftId);
    requireCondition(draft, 400, "Elige un borrador para recibir los hallazgos.");
    const resource = {};
    if (purpose !== "lesson") {
      const settings = data.resource ?? (before && JSON.parse(before.resource));
      requireCondition(settings && /^\d{4}-q[1-4]$/.test(settings.quarterId ?? ""), 400, "Elige un trimestre para los materiales.");
      const quarter = JSON.parse(draft.snapshot).quarters[settings.quarterId];
      requireCondition(quarter, 400, "El trimestre debe existir en el borrador.");
      resource.quarterId = settings.quarterId;
      if (purpose !== "quarter-resources") {
        requireCondition(settings.type === "audio" || settings.type === "ppt", 400, "Elige audio o presentación.");
        resource.type = settings.type;
      }
      if (purpose === "resource") {
        const lesson = quarter.lessons.find(item => item.number === settings.lessonNumber);
        requireCondition(lesson, 400, "Elige una lección de destino.");
        resource.lessonNumber = lesson.number;
        resource.title = requiredText(settings.title, "el título del recurso", 180);
        resource.credit = typeof settings.credit === "string" ? settings.credit.trim().slice(0, 180) : "";
        resource.role = settings.type === "audio" ? "daily-audio" : "weekly-presentation";
        if (settings.type === "audio") {
          requireCondition(lesson.days.some(day => day.id === settings.dayId), 400, "Elige el día del audio.");
          resource.dayId = settings.dayId;
        }
      }
    }
    const key = id ?? store.id();
    const nextRun = enabled && !before ? store.now() : store.now() + interval * 60_000;
    store.run(`INSERT INTO sources (id, draft_id, name, url, kind, purpose, resource, interval_minutes, enabled, next_run_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET draft_id = excluded.draft_id, name = excluded.name,
        url = excluded.url, kind = excluded.kind, interval_minutes = excluded.interval_minutes,
        purpose = excluded.purpose, resource = excluded.resource, enabled = excluded.enabled, next_run_at = excluded.next_run_at,
        last_checksum = CASE WHEN sources.url = excluded.url AND sources.kind = excluded.kind AND sources.purpose = excluded.purpose THEN sources.last_checksum ELSE NULL END`,
    key, draftId, name, url, kind, purpose, JSON.stringify(resource), interval, Number(enabled), nextRun);
    store.audit(before ? "source.updated" : "source.created", { draftId, userId, comment: name });
    return sourceInfo(store.get("SELECT * FROM sources WHERE id = ?", key));
  });
}

export function runSource(store, sourceId, userId = null) {
  const source = store.get("SELECT * FROM sources WHERE id = ?", sourceId);
  requireCondition(source, 404, "Fuente desconocida.");
  requireCondition(!store.get("SELECT 1 FROM jobs WHERE source_id = ? AND status IN ('queued', 'running')", source.id), 409, "La fuente ya tiene una revisión en curso.");
  const url = source.purpose === "quarter-resources" ? "" : requireApprovedUrl(store, source.url);
  const item = { name: source.name, url, kind: source.kind, status: "queued", purpose: source.purpose, resource: JSON.parse(source.resource) };
  return enqueueImport(store, { draftId: source.draft_id, userId, sourceId, items: [item] });
}

export function scheduleSources(store) {
  const next = store.all("SELECT id, interval_minutes FROM sources WHERE enabled = 1 AND next_run_at <= ? ORDER BY next_run_at LIMIT 4", store.now());
  for (const source of next) {
    const now = store.now();
    if (!store.run("UPDATE sources SET next_run_at = ? WHERE id = ? AND enabled = 1 AND next_run_at <= ?",
      now + source.interval_minutes * 60_000, source.id, now).changes) continue;
    try {
      runSource(store, source.id);
    } catch (error) {
      if (error.status === 409 && store.get("SELECT 1 FROM jobs WHERE source_id = ? AND status IN ('queued', 'running')", source.id)) continue;
      store.run("UPDATE sources SET state = 'failed', last_run_at = ? WHERE id = ?", store.stamp(), source.id);
    }
  }
}

export async function processJob(store, extract = ingestItem, materialJob) {
  const row = store.transaction(() => {
    const next = store.get("SELECT * FROM jobs WHERE status = 'queued' ORDER BY created_at, rowid LIMIT 1");
    if (next) store.run("UPDATE jobs SET status = 'running', updated_at = ? WHERE id = ?", store.stamp(), next.id);
    return next;
  });
  if (!row) return false;
  const items = JSON.parse(row.items);
  const source = row.source_id ? store.get("SELECT * FROM sources WHERE id = ?", row.source_id) : null;
  const originalSource = source && items[0]?.url === source.url && items[0]?.kind === source.kind;
  if (source && items[0]?.purpose && items[0].purpose !== "lesson" && materialJob) {
    try {
      const result = await materialJob(row, items[0]);
      store.transaction(() => {
        store.run("UPDATE jobs SET status = ?, updated_at = ?, items = ? WHERE id = ?", result.status, store.stamp(), JSON.stringify(result.items), row.id);
        store.run("UPDATE sources SET state = ?, last_run_at = ? WHERE id = ?", result.state, store.stamp(), source.id);
        store.audit("resource.job." + result.state, { draftId: row.draft_id, userId: row.actor_id, comment: result.summary });
      });
    } catch (error) {
      items[0].status = "failed";
      items[0].error = String(error.message).slice(0, 500);
      store.transaction(() => {
        store.run("UPDATE jobs SET status = 'failed', updated_at = ?, items = ? WHERE id = ?", store.stamp(), JSON.stringify(items), row.id);
        store.run("UPDATE sources SET state = 'failed', last_run_at = ? WHERE id = ?", store.stamp(), source.id);
        store.audit("resource.job.failed", { draftId: row.draft_id, userId: row.actor_id });
      });
    }
    return true;
  }
  function checkpoint() {
    store.run("UPDATE jobs SET items = ?, updated_at = ? WHERE id = ?", JSON.stringify(items), store.stamp(), row.id);
  }
  for (const item of items) {
    if (item.status !== "queued") continue;
    try {
      const result = await extract({
        name: item.name, kind: item.kind,
        ...(item.url ? { url: item.url } : { bytes: readBlob(store, item.checksum) }),
      }, {
        allowedHosts: approvedHosts(store),
        onOriginal(original) {
          item.checksum = writeBlob(store, original.bytes, original.sha256);
        },
      });
      item.status = "ready";
      item.result = result;
      if (originalSource && result.sha256 === source.last_checksum) item.unchanged = true;
    } catch (error) {
      item.status = "failed";
      item.error = String(error.message ?? "No se pudo procesar esta fuente.").slice(0, 500);
    }
    checkpoint();
  }
  const ready = items.filter(item => item.status === "ready").length;
  const status = ready === items.length ? "ready" : ready ? "partial" : "failed";
  store.transaction(() => {
    store.run("UPDATE jobs SET status = ?, updated_at = ?, items = ? WHERE id = ?", status, store.stamp(), JSON.stringify(items), row.id);
    if (originalSource) {
      const first = items[0];
      const state = first?.unchanged ? "unchanged" : first?.status === "ready" ? "changed" : "failed";
      store.run("UPDATE sources SET state = ?, last_run_at = ?, last_checksum = COALESCE(?, last_checksum) WHERE id = ? AND url = ? AND kind = ?",
        state, store.stamp(), first?.result?.sha256 ?? null, source.id, source.url, source.kind);
    }
    store.audit(`import.${status}`, { draftId: row.draft_id, userId: row.actor_id, comment: `${ready}/${items.length} fuentes procesadas` });
  });
  return true;
}

export function originalForJob(store, draftId, jobId, index) {
  const row = store.get("SELECT items FROM jobs WHERE draft_id = ? AND id = ?", draftId, jobId);
  const item = row && JSON.parse(row.items)[index];
  requireCondition(item?.checksum, 404, "El original no está disponible.");
  return { name: item.result?.name ?? item.name, bytes: readBlob(store, item.checksum) };
}

export async function receiveAsset(store, request, draftId) {
  const form = await readForm(request, maxAsset + 64_000);
  const file = form.get("file");
  const article = form.get("article");
  let bytes;
  let metadata;
  if (typeof article === "string" && article.trim()) {
    requireCondition(Buffer.byteLength(article) <= 256 * 1024, 413, "La lectura supera el tamaño permitido.");
    ({ bytes, ...metadata } = prepareArticle(article, filename(form.get("name"), "lectura.html")));
  } else {
    requireCondition(file && typeof file !== "string" && file.size > 0 && file.size <= maxAsset, 400, "Selecciona un archivo de hasta 32 MB.");
    bytes = Buffer.from(await file.arrayBuffer());
    const name = filename(file.name);
    if (form.get("asArticle") === "true") {
      const result = await ingestItem({ name, bytes }).catch(error => { throw new HttpError(422, error.message); });
      requireCondition(["html", "markdown", "text"].includes(result.kind), 422, "Usa HTML, Markdown o texto para preparar un artículo.");
      const text = result.fragments.map(fragment => [fragment.title ? `## ${fragment.title}` : "", fragment.text].filter(Boolean).join("\n\n")).join("\n\n");
      requireCondition(text.trim(), 422, "El archivo no contiene texto para el artículo.");
      writeBlob(store, bytes, result.sha256);
      ({ bytes, ...metadata } = prepareArticle(text, name));
    } else if (form.get("asAttachment") === "true" || !/^(?:\.pdf|\.pptx|\.mp3|\.mp4|\.png|\.jpg|\.jpeg|\.gif|\.webp)$/i.test(extname(name))) {
      metadata = { name, kind: "attachment", sha256: sha256(bytes), sizeBytes: bytes.length };
    } else {
      try {
        metadata = validateAsset(name, bytes);
      } catch (error) {
        throw new HttpError(422, error.message);
      }
    }
  }
  writeBlob(store, bytes, metadata.sha256);
  return store.transaction(() => {
    const existing = store.get("SELECT id FROM assets WHERE draft_id = ? AND sha256 = ? AND kind = ?", draftId, metadata.sha256, metadata.kind);
    if (existing) return getAsset(store, draftId, existing.id);
    const id = store.id();
    store.run("INSERT INTO assets (id, draft_id, name, sha256, size_bytes, kind) VALUES (?, ?, ?, ?, ?, ?)",
      id, draftId, metadata.name, metadata.sha256, metadata.sizeBytes, metadata.kind);
    return { id, ...metadata };
  });
}

export function getAsset(store, draftId, id) {
  const row = store.get("SELECT * FROM assets WHERE id = ? AND draft_id = ?", id, draftId);
  requireCondition(row, 404, "Archivo desconocido en este borrador.");
  return { id: row.id, name: row.name, sha256: row.sha256, sizeBytes: row.size_bytes, kind: row.kind };
}
