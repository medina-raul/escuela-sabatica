import { basename } from "node:path";
import { MAX_ASSET_BYTES, validateAsset } from "./ingest-assets.mjs";

export function resourceAt(quarter, slot) {
  return [...(quarter.resources ?? []), ...quarter.lessons.flatMap(lesson => [...lesson.resources ?? [], ...lesson.days.flatMap(day => day.resources ?? [])])].find(
    item => item.role === slot.role && item.lessonNumber === slot.lessonNumber && item.dayId === slot.dayId,
  );
}

export async function inspectCandidate(candidate, allowedHosts, download, known) {
  if (known?.source?.kind === "manual") return { candidate, state: "unchanged", message: "Se conserva el archivo editorial." };
  const links = [...new Set([candidate.url, ...(candidate.alternativeUrls ?? [])])].slice(0, 5);
  let failure;
  for (const link of links) {
    try {
      const response = await download(link, { allowedHosts, maxBytes: MAX_ASSET_BYTES, allowMissing: true });
      if (response.missing) continue;
      const extension = candidate.type === "audio" ? "mp3" : "pptx";
      const name = decodeURIComponent(basename(response.url.pathname));
      const asset = validateAsset(name.toLowerCase().endsWith(`.${extension}`) ? name : `material.${extension}`, response.bytes);
      if (asset.kind !== candidate.type) throw new Error("El archivo no coincide con el material esperado.");
      const url = new URL(link).href;
      const unchanged = candidate.type === "audio"
        ? known?.storage === "external" && known.url === url
        : known?.source?.url === url && known.checksum === asset.sha256;
      if (unchanged) return { candidate, state: "unchanged", message: "El recurso ya estaba incorporado." };
      return { candidate, state: "ready", url, asset, bytes: candidate.type === "ppt" ? response.bytes : undefined };
    } catch (error) {
      failure = String(error.message ?? "No se pudo verificar la fuente.").slice(0, 240);
    }
  }
  return failure
    ? { candidate, state: "failed", message: failure }
    : { candidate, state: "pending", message: "El proveedor todavía no ofrece el recurso." };
}
