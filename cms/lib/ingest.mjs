import { checksum } from "./ingest-assets.mjs";
import { originalName } from "./file-names.mjs";
import { extractPdf } from "./ingest-pdf.mjs";
import { downloadImportSource, validateImportUrl } from "./ingest-remote.mjs";
import { adventechPath, articleDocument, assertAdventechUrl, detectType, extractContent, KINDS, MAX_IMPORT_BYTES } from "./ingest-text.mjs";

export { MAX_ASSET_BYTES, validateAsset } from "./ingest-assets.mjs";
export { isPublicAddress, validateImportUrl } from "./ingest-remote.mjs";
export { adventechLessonUrls, MAX_IMPORT_BYTES } from "./ingest-text.mjs";

async function prepareInput(input, options) {
  const { bytes, text, url, kind = "auto" } = input;
  if (!KINDS.has(kind)) throw new Error("Formato de importación desconocido.");
  if ([bytes, text, url].filter(value => value !== undefined).length !== 1) {
    throw new Error("Entrega un archivo, un enlace o texto por cada elemento de la importación.");
  }
  if (url !== undefined) {
    const validation = validateImportUrl(url, options.allowedHosts);
    const checkUrl = kind === "adventech" || adventechPath(validation) ? assertAdventechUrl : undefined;
    checkUrl?.(validation);
    const download = options.downloadSource ?? downloadImportSource;
    const downloaded = await download(validation.href, {
      allowedHosts: options.allowedHosts, maxBytes: MAX_IMPORT_BYTES, checkUrl,
    });
    const pathname = downloaded.url.pathname;
    let nameFromUrl = pathname;
    try {
      nameFromUrl = decodeURIComponent(pathname);
    } catch {
      // Preserve the path when the origin supplies an invalid encoded filename.
    }
    const fallback = originalName(nameFromUrl, downloaded.url.hostname);
    return { ...downloaded, kind, name: originalName(input.name, fallback) };
  }
  const body = bytes instanceof Uint8Array ? Buffer.from(bytes)
    : typeof text === "string" ? Buffer.from(text, "utf8") : null;
  if (!body) throw new Error("Selecciona un archivo o pega su texto.");
  return {
    bytes: body, kind, contentType: "", name: originalName(input.name, typeof text === "string" ? "Texto pegado" : "Archivo"),
  };
}

export async function ingestItem(input, options = {}) {
  const prepared = await prepareInput(input, options);
  const { name, bytes, url, contentType } = prepared;
  if (!bytes.length || bytes.length > MAX_IMPORT_BYTES) throw new Error("El original debe tener contenido y pesar hasta 24 MB.");
  const adventech = url && adventechPath(url);
  const originUrl = url?.href;
  const kind = detectType(url?.pathname ?? name, bytes, adventech ? "adventech" : prepared.kind, contentType);
  const result = { name, kind, sha256: checksum(bytes), ...(originUrl && { originUrl }) };
  await options.onOriginal?.({ ...result, bytes });

  const extracted = await extractContent({ kind, bytes, name, url, contentType }, extractPdf);
  return { ...result, ...extracted };
}

export function prepareArticle(text, name) {
  const article = articleDocument(text, name);
  return { ...article, bytes: Buffer.from(article.bytes), sha256: checksum(article.bytes) };
}
