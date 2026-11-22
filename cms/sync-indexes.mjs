import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { applyChange, loadSnapshot, resourceAssetUrls, snapshotFiles } from "./lib/catalog.mjs";
import { downloadImportSource } from "./lib/ingest-remote.mjs";
import { editorialResourcePath } from "./lib/publication-model.mjs";
import { discoverResourceIndex } from "./lib/resource-discovery.mjs";
import { inspectCandidate, resourceAt } from "./lib/resource-media.mjs";

export async function syncIndexes(root, { download = downloadImportSource, report = console.log } = {}) {
  const base = loadSnapshot(root);
  let snapshot = base;
  const files = new Map();
  let availableBytes = 128 * 1024 * 1024;
  for (const { id, status } of base.registry.quarters) {
    if (status !== "published") continue;
    const quarter = base.quarters[id];
    const settings = quarter.resourceAutomation ?? {};
    const allowedHosts = settings.allowedSourceHosts ?? [];
    for (const type of ["audio", "ppt"]) {
      const source = settings.sourceIndexes?.[type];
      if (!source?.url) continue;
      let candidates;
      try {
        const result = await discoverResourceIndex({ url: source.url, quarter, type }, { allowedHosts, downloadSource: download });
        candidates = result.candidates;
        for (const warning of result.warnings) report(`${id} · ${type} · ${warning}`);
      } catch (error) {
        report(`${id} · ${type} · Fuente pendiente. ${error.message}`);
        continue;
      }
      for (let offset = 0; offset < candidates.length && availableBytes > 0; offset += 6) {
        const group = await Promise.all(candidates.slice(offset, offset + 6).map(candidate =>
          inspectCandidate(candidate, allowedHosts, download, resourceAt(snapshot.quarters[id], candidate))));
        for (const result of group) {
          const { candidate, state, asset, bytes, url } = result;
          if (state !== "ready") {
            if (state !== "unchanged") report(`${id} · ${candidate.title} · ${result.message}`);
            continue;
          }
          try {
            if (bytes && bytes.length > availableBytes) {
              report(`${id} · ${candidate.title} · Pendiente para la próxima revisión.`);
              continue;
            }
            const existing = resourceAt(snapshot.quarters[id], candidate);
            const common = { ...candidate, quarterId: id, id: existing?.id };
            const next = applyChange(snapshot, "resource.upsert", bytes ? { ...common, asset, sourceUrl: url } : { ...common, url });
            if (bytes) {
              const find = resourceAt(next.quarters[id], candidate);
              if (!find || !resourceAssetUrls(next).some(item => item.url === find.url && item.sha256 === asset.sha256)) {
                throw new Error("El archivo validado no coincide con el recurso.");
              }
              files.set(editorialResourcePath(find.url), bytes);
              availableBytes -= bytes.length;
            }
            snapshot = next;
            report(`${id} · ${candidate.title} · Incorporado`);
          } catch (error) {
            report(`${id} · ${candidate.title} · Pendiente. ${error.message}`);
          }
        }
      }
    }
  }
  const previous = snapshotFiles(base);
  for (const [path, contents] of snapshotFiles(snapshot)) {
    if (previous.get(path) !== contents) files.set(path, contents);
  }
  for (const [path, data] of files) {
    const target = join(root, path);
    const temporary = target + ".cms-" + process.pid;
    await mkdir(dirname(target), { recursive: true });
    await writeFile(temporary, data);
    await rename(temporary, target);
  }
  return files.size > 0;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await syncIndexes(process.cwd());
}
