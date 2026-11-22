import { inflateSync } from "fflate";
import { assetFormat, MAX_ASSET_BYTES } from "../lib/asset-format.mjs";
import {
  adventechPath, articleDocument, assertAdventechUrl, detectType, extractContent, MAX_IMPORT_BYTES,
} from "../lib/ingest-text.mjs";
import { extensionOf, originalName } from "../lib/file-names.mjs";
import { digest } from "./vault.mjs";

export function publicSource(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error("Ingresa un enlace HTTPS válido."); }
  const publicDomain = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z][a-z0-9-]+$/i;
  if (url.protocol !== "https:" || url.username || url.password || url.port || !publicDomain.test(url.hostname) ||
      /\.(?:local|localhost|internal|lan|home|test)$/i.test(url.hostname)) {
    throw new Error("Usa un enlace HTTPS a un sitio público.");
  }
  url.hash = "";
  return url;
}

export async function downloadSource(value) {
  const target = publicSource(value);
  let response;
  try {
    response = await fetch(target, { credentials: "omit", referrerPolicy: "no-referrer", signal: AbortSignal.timeout(25_000) });
  } catch {
    throw new Error("No se pudo abrir el enlace desde el navegador. Guarda la página o el archivo y súbelo al panel.");
  }
  if (!response.ok) {
    throw new Error(`La fuente respondió con el código ${response.status}. Revisa el enlace o sube el archivo.`);
  }
  const url = publicSource(response.url);
  if (adventechPath(target)) assertAdventechUrl(url);
  if (!response.body || Number(response.headers.get("Content-Length")) > MAX_IMPORT_BYTES) {
    throw new Error("La fuente debe tener contenido y pesar hasta 24 MB.");
  }
  const chunks = [];
  let size = 0;
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      size += chunk.length;
      if (size > MAX_IMPORT_BYTES) throw new Error("La fuente excede los 24 MB. Divide el documento.");
      chunks.push(chunk);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const bytes = new Uint8Array(await new Blob(chunks).arrayBuffer());
  return { bytes, url, contentType: response.headers.get("Content-Type") ?? "" };
}

export async function analyzeSource(source, persistOriginal) {
  const { bytes, url, contentType = "", name = originalName(url?.pathname, "Documento") } = source;
  if (!bytes.length || bytes.length > MAX_IMPORT_BYTES) throw new Error("El original debe tener contenido y pesar hasta 24 MB.");
  const { extractPdf } = await import("./pdf.mjs");
  const kind = detectType(url?.pathname ?? name, bytes, adventechPath(url ?? {}) ? "adventech" : "auto", contentType);
  const result = { kind, name, sha256: await digest(bytes), ...(url && { originUrl: url.href }) };
  await persistOriginal?.(bytes, result.sha256);
  return { ...result, ...await extractContent({ kind, bytes, name, url, contentType }, extractPdf) };
}

export async function prepareAsset(form) {
  const file = form.get("file");
  const article = form.get("article");
  if (typeof article === "string" && article.trim()) {
    return articleDocument(article, String(form.get("name") || "lectura.html"));
  }
  if (!(file instanceof File) || !file.size || file.size > MAX_ASSET_BYTES) {
    throw new Error("Selecciona un archivo de hasta 32 MB.");
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const name = originalName(file.name, "material");
  if (form.get("asArticle") === "true") {
    const result = await analyzeSource({ name, bytes });
    if (!["html", "markdown", "text"].includes(result.kind)) throw new Error("Usa HTML, Markdown o texto para el artículo.");
    const text = result.fragments.map(part => [part.title && "## " + part.title, part.text].filter(Boolean).join("\n\n")).join("\n\n");
    return articleDocument(text, name);
  }
  if (form.get("asAttachment") === "true" || !/^\.(?:pdf|pptx|mp3|mp4|png|jpe?g|gif|webp)$/i.test(extensionOf(name))) {
    return { name, kind: "attachment", sizeBytes: bytes.length, bytes };
  }
  const format = assetFormat(name, bytes, (data, max) => inflateSync(data, { out: new Uint8Array(max) }));
  return { ...format, bytes };
}
