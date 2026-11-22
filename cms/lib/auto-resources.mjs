import { applyChange, loadSnapshot } from "./catalog.mjs";
import { inspectCandidate, resourceAt } from "./resource-media.mjs";
import { downloadImportSource } from "./ingest-remote.mjs";
import { discoverQuarterResources, discoverResourceIndex } from "./resource-discovery.mjs";
import { approvedHosts, sourceUrl, writeBlob } from "./jobs.mjs";
import { requireCondition } from "./http.mjs";
import { snapshotDigest } from "./releases.mjs";

function slotLabel(candidate) {
  return `Lección ${candidate.lessonNumber}${candidate.dayId ? ` · ${candidate.dayId}` : ""}`;
}

function applyFound(store, snapshot, quarterId, found) {
  const candidate = found.candidate;
  const existing = resourceAt(snapshot.quarters[quarterId], candidate);
  if (existing?.source?.kind === "manual") return { snapshot, applied: false };
  const host = sourceUrl(found.url).hostname;
  const approved = store.get("SELECT 1 FROM approved_hosts WHERE host = ?", host);
  requireCondition(approved, 422, "El dominio ya no está autorizado.");
  let next = snapshot;
  if (!snapshot.quarters[quarterId].resourceAutomation?.allowedSourceHosts?.includes(host)) {
    next = applyChange(next, "resource.host.allow", { quarterId, host });
  }
  const common = { ...candidate, quarterId, id: existing?.id };
  if (found.downloaded) {
    next = applyChange(next, "resource.upsert", { ...common, asset: found.asset, sourceUrl: found.url });
  } else {
    next = applyChange(next, "resource.upsert", { ...common, url: found.url });
  }
  return { snapshot: next, applied: true };
}

function moveIfFrozen(store, root, row, quarterId) {
  const current = store.get("SELECT * FROM drafts WHERE id = ?", row.draft_id);
  const live = loadSnapshot(root);
  const base = snapshotDigest(live);
  if (current.status === "editing" && current.base_digest === base) return current;
  requireCondition(live.quarters[quarterId], 409, "El trimestre todavía pertenece a otro borrador. Abre ese borrador para incorporar recursos.");
  const id = store.id();
  store.run("INSERT INTO drafts (id, title, owner_id, snapshot, base_digest, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    id, `Material semanal · ${quarterId}`, current.owner_id, JSON.stringify(live), base, store.stamp());
  const moved = store.run("UPDATE sources SET draft_id = ? WHERE id = ? AND draft_id = ?", id, row.source_id, row.draft_id);
  requireCondition(moved.changes > 0, 409, "Cambió el destino de la fuente durante la revisión.");
  store.run("UPDATE jobs SET draft_id = ? WHERE id = ?", id, row.id);
  store.audit("draft.automatic", { draftId: id, comment: quarterId });
  return store.get("SELECT * FROM drafts WHERE id = ?", id);
}

function applyResults(store, root, row, settings, findings) {
  return store.transaction(() => {
    const source = store.get("SELECT * FROM sources WHERE id = ?", row.source_id);
    requireCondition(source?.draft_id === row.draft_id && source.purpose === settings.purpose &&
      source.url === settings.url && source.resource === JSON.stringify(settings.resource),
      409, "La configuración de esta fuente cambió durante la revisión.");
    const quarterId = settings.resource.quarterId;
    const editing = findings.some(found => found.state === "ready") ? moveIfFrozen(store, root, row, quarterId) : null;
    let snapshot = editing ? JSON.parse(editing.snapshot) : null;
    let additions = 0;
    const lines = [];
    for (const found of findings) {
      let status = found.state;
      let message = found.message;
      if (status === "ready") {
        try {
          const result = applyFound(store, snapshot, quarterId, found);
          snapshot = result.snapshot;
          if (result.applied) {
            additions += 1;
            message = "Incorporado al borrador.";
          } else {
            status = "unchanged";
            message = "Se conserva el archivo editorial.";
          }
        } catch (error) {
          status = "failed";
          message = String(error.message).slice(0, 240);
        }
      }
      const label = `${found.candidate.type === "audio" ? "Audio" : "Presentación"} · ${slotLabel(found.candidate)}`;
      lines.push({ name: label, status: status === "unchanged" ? "ready" : status, unchanged: status === "unchanged",
        error: status === "failed" || status === "pending" ? message : undefined, result: { kind: found.candidate.type, fragments: [], warnings: message ? [message] : [] } });
    }
    if (additions) {
      store.run("UPDATE drafts SET snapshot = ?, version = version + 1, updated_at = ? WHERE id = ?",
        JSON.stringify(snapshot), store.stamp(), editing.id);
      store.audit("resource.automatic", { draftId: editing.id, userId: row.actor_id, comment: `${additions} audio(s) o presentación(es)` });
    }
    return { additions, lines };
  });
}

export function materialJobRunner(store, root, { download = downloadImportSource } = {}) {
  return async (row, settings) => {
    const sourceDraft = store.get("SELECT snapshot FROM drafts WHERE id = ?", row.draft_id);
    const quarter = JSON.parse(sourceDraft.snapshot).quarters[settings.resource.quarterId];
    requireCondition(quarter, 422, "El trimestre de esta fuente no existe.");
    const allowedHosts = approvedHosts(store);
    const options = { allowedHosts, downloadSource: download };
    let result;
    if (settings.purpose === "quarter-resources") result = await discoverQuarterResources(quarter, options);
    else if (settings.purpose === "resource-index") result = await discoverResourceIndex({ ...settings.resource, quarter, url: settings.url }, options);
    else result = { candidates: [{ ...settings.resource, url: settings.url }], warnings: [] };
    // Use a small group of downloads at a time. A missing file cannot cancel its neighbors.
    const outcomes = [];
    let budget = 160 * 1024 * 1024;
    for (let offset = 0; offset < result.candidates.length; offset += 4) {
      const candidates = result.candidates.slice(offset, offset + 4);
      if (budget < 0) {
        outcomes.push(...candidates.map(candidate => ({ candidate, state: "pending", message: "La revisión alcanzó su límite. El recurso se comprobará en la próxima ejecución." })));
        continue;
      }
      const group = await Promise.all(candidates.map(candidate => inspectCandidate(candidate, allowedHosts, download, resourceAt(quarter, candidate))));
      for (const material of group) {
        if (material.asset) budget -= material.asset.sizeBytes;
        if (material.bytes) {
          writeBlob(store, material.bytes, material.asset.sha256);
          delete material.bytes;
          material.downloaded = true;
        }
        outcomes.push(material);
      }
    }
    const { additions, lines } = applyResults(store, root, row, settings, outcomes);
    const unavailable = lines.filter(item => item.status === "pending" || item.status === "failed").length;
    const summary = `${additions} incorporados · ${unavailable} pendientes o con incidencias`;
    lines.unshift({ name: settings.name, status: "ready", result: { kind: "resource-check", fragments: [], warnings: [summary, ...result.warnings] } });
    const state = additions ? (unavailable ? "partial" : "changed") : unavailable || result.warnings.length || !outcomes.length ? "pending" : "unchanged";
    return { status: state === "partial" ? "partial" : "ready", state, items: lines, summary };
  };
}
