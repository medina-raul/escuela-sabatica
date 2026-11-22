import { assignImportedFragment } from "./lesson-import.mjs";
export { referenceLabels } from "./lesson-import.mjs";
import { applyChange, listQuarters, loadSnapshot, publicationIssues } from "./catalog.mjs";
import { capabilities, requireAdmin, requireEditor } from "./auth.mjs";
import { getAsset, getJob, sourceUrl } from "./jobs.mjs";
import { record, requireCondition, requiredText } from "./http.mjs";
import { checkBase, snapshotDigest } from "./releases.mjs";

export function draftRow(store, id) {
  const row = store.get(`SELECT d.*, u.username AS owner FROM drafts d
    JOIN users u ON u.id = d.owner_id WHERE d.id = ?`, id);
  requireCondition(row, 404, "Borrador desconocido.");
  return row;
}

function heading(row) {
  return { id: row.id, title: row.title, owner: row.owner, ownerId: row.owner_id, status: row.status, version: row.version, updatedAt: row.updated_at };
}

export function listDrafts(store) {
  return store.all(`SELECT d.id, d.title, d.owner_id, d.status, d.version, d.updated_at, u.username AS owner
    FROM drafts d JOIN users u ON u.id = d.owner_id ORDER BY d.updated_at DESC, d.rowid DESC`).map(heading);
}

export function liveSummary(root) {
  const live = loadSnapshot(root);
  return { activeQuarterId: live.registry.quarters.find(entry => entry.catalog === live.registry.activeCatalog)?.id, quarters: listQuarters(live) };
}

export function describeDraft(store, publisher, row, user) {
  const snapshot = JSON.parse(row.snapshot);
  const history = store.all(`SELECT a.action, a.comment, a.created_at AS createdAt, COALESCE(u.username, 'Sistema') AS actor
    FROM audit a LEFT JOIN users u ON u.id = a.user_id WHERE draft_id = ? ORDER BY a.sequence DESC LIMIT 100`, row.id);
  const release = publisher.status(row);
  if (release && !capabilities(user).prepare) delete release.downloadUrl;
  return { draft: { ...heading(row), snapshot }, issues: publicationIssues(snapshot), history, release };
}

export function createDraft(store, root, user, data, restoredId = null) {
  requireEditor(user);
  const title = requiredText(data.title, "el nombre del borrador", 100);
  const base = loadSnapshot(root);
  return store.transaction(() => {
    const id = store.id();
    let snapshot = base;
    if (restoredId) {
      requireAdmin(user);
      const previous = draftRow(store, restoredId);
      requireCondition(previous.status === "approved", 409, "Elige una versión aprobada para restaurar.");
      snapshot = JSON.parse(previous.snapshot);
    }
    store.run("INSERT INTO drafts (id, title, owner_id, snapshot, base_digest, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      id, title, user.id, JSON.stringify(snapshot), snapshotDigest(base), store.stamp());
    store.audit(restoredId ? "draft.restored" : "draft.created", { draftId: id, userId: user.id, comment: restoredId });
    return draftRow(store, id);
  });
}

export function requireDraftEditor(user, row) {
  requireEditor(user);
  requireCondition(user.role === "admin" || row.owner_id === user.id, 403, "El borrador pertenece a otra persona.");
  requireCondition(row.status === "editing", 409, "Vuelve a abrir el borrador antes de editarlo.");
}

export function versionCheck(row, expected) {
  requireCondition(Number.isInteger(expected) && row.version === expected, 409, "El borrador cambió. Recárgalo antes de guardar.");
}

function applyResource(store, row, snapshot, data) {
  // Users may choose an uploaded asset or a public URL. Provenance of automatic downloads is set on the server.
  const { asset: _asset, sourceUrl: _sourceUrl, ...fields } = data;
  if (fields.assetId) fields.asset = getAsset(store, row.id, fields.assetId);
  let next = snapshot;
  if (!fields.asset && typeof fields.url === "string" && fields.url.trim().startsWith("https://")) {
    const host = sourceUrl(fields.url).hostname;
    const allowed = snapshot.quarters[fields.quarterId]?.resourceAutomation?.allowedSourceHosts ?? [];
    if (!allowed.includes(host) && store.get("SELECT 1 FROM approved_hosts WHERE host = ?", host)) {
      next = applyChange(snapshot, "resource.host.allow", { quarterId: fields.quarterId, host });
    }
  }
  return applyChange(next, "resource.upsert", fields);
}

function persistEdit(store, row, snapshot, userId, action, comment = null) {
  store.run("UPDATE drafts SET snapshot = ?, version = version + 1, updated_at = ? WHERE id = ?",
    JSON.stringify(snapshot), store.stamp(), row.id);
  store.audit(action, { draftId: row.id, userId, comment });
  return draftRow(store, row.id);
}

export function acceptChange(store, user, id, body) {
  return store.transaction(() => {
    const row = draftRow(store, id);
    requireDraftEditor(user, row);
    versionCheck(row, body.version);
    const action = requiredText(body.action, "la acción", 80);
    const data = record(body.data);
    let snapshot = JSON.parse(row.snapshot);
    if (["site.update", "resource.host.allow", "resource.index"].includes(action)) requireAdmin(user);
    if (action === "day.update") {
      if (data.importJobId) snapshot = assignImportedFragment(snapshot, getJob(store, row.id, data.importJobId), {
        ...data, item: data.importItem, fragment: data.importFragment,
      });
      else {
        const { contentSource: _source, ...manual } = data;
        snapshot = applyChange(snapshot, action, manual);
      }
    } else if (action === "resource.upsert") {
      snapshot = applyResource(store, row, snapshot, data);
    } else {
      snapshot = applyChange(snapshot, action, data);
    }
    const scope = [data.quarterId, data.lessonId, data.dayId].filter(Boolean).join(" / ") || null;
    return persistEdit(store, row, snapshot, user.id, action, scope);
  });
}

export function applyImport(store, user, id, jobId, body) {
  return store.transaction(() => {
    const row = draftRow(store, id);
    requireDraftEditor(user, row);
    versionCheck(row, body.version);
    const { assignments } = body;
    requireCondition(Array.isArray(assignments) && assignments.length >= 1 && assignments.length <= 105, 400, "Elige uno o más fragmentos para guardar.");
    const job = getJob(store, id, jobId);
    let snapshot = JSON.parse(row.snapshot);
    const targets = new Set();
    for (const item of assignments) {
      const data = record(item);
      const target = `${data.quarterId}/${data.lessonId}/${data.dayId}`;
      requireCondition(!targets.has(target), 422, "Asigna un solo fragmento a cada día o combina su texto al revisar.");
      targets.add(target);
      snapshot = assignImportedFragment(snapshot, job, data);
    }
    return persistEdit(store, row, snapshot, user.id, "import.applied", `${assignments.length} día(s) · ${jobId}`);
  });
}

export function workflow(store, root, publisher, user, id, action, body) {
  return store.transaction(() => {
    const row = draftRow(store, id);
    versionCheck(row, body.version);
    const comment = body.comment ? requiredText(body.comment, "el comentario", 600) : null;
    let status;
    if (action === "submit") {
      requireDraftEditor(user, row);
      checkBase(root, row);
      const issues = publicationIssues(JSON.parse(row.snapshot));
      requireCondition(!issues.length, 422, issues[0]);
      status = "submitted";
    } else if (action === "approve") {
      const changed = store.get(`SELECT 1 FROM audit WHERE draft_id = ? AND user_id = ?
        AND (action LIKE 'year.%' OR action LIKE 'quarter.%' OR action LIKE 'lesson.%' OR action LIKE 'day.%'
        OR action LIKE 'resource.%' OR action LIKE 'reading.%' OR action LIKE 'site.%' OR action = 'import.applied')`, id, user.id);
      requireCondition(capabilities(user).review && row.owner_id !== user.id && !changed, 403, "La aprobación corresponde a una persona revisora distinta de quien editó.");
      requireCondition(row.status === "submitted", 409, "Primero envía el borrador a revisión.");
      requireCondition(publisher.status(row)?.status === "ready", 409, "Prepara y revisa la vista previa de esta versión.");
      checkBase(root, row);
      status = "approved";
    } else {
      requireCondition(row.status !== "editing", 409, "El borrador ya admite cambios.");
      requireCondition(capabilities(user).review || (user.id === row.owner_id && row.status === "submitted"), 403, "Tu perfil no puede devolver este borrador.");
      status = "editing";
    }
    store.run("UPDATE drafts SET status = ?, version = version + 1, updated_at = ? WHERE id = ?", status, store.stamp(), id);
    store.audit(`draft.${status}`, { draftId: id, userId: user.id, comment });
    return draftRow(store, id);
  });
}
