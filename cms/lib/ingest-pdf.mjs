import { cleanPage } from "./ingest-text.mjs";
export { cleanPage, isPdf } from "./ingest-text.mjs";
import { execFile } from "node:child_process";
import { rmSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const MAX_PAGES = 140;
const OCR_BATCH_PAGES = 8;
const PDF_HELPER = fileURLToPath(new URL("./ingest-pdf.m", import.meta.url));
let helperExecutable;

async function extractWithPoppler(file, directory) {
  const { stdout } = await exec(process.env.CMS_PDFTOTEXT || "pdftotext", [
    "-f", "1", "-l", String(MAX_PAGES + 1), "-enc", "UTF-8", "-layout", file, "-",
  ], { cwd: directory, timeout: 20_000, maxBuffer: 2 * 1024 * 1024 });
  const pages = stdout.split("\f");
  if (pages.at(-1) === "") pages.pop();
  return {
    pages: pages.slice(0, MAX_PAGES).map((text, index) => ({ page: index + 1, text, ocr: false })),
    total: pages.length,
  };
}

async function localPdfHelper() {
  if (helperExecutable) return helperExecutable;
  helperExecutable = (async () => {
    const cache = await mkdtemp(join(tmpdir(), "escuela-cms-ocr-"));
    process.once("exit", () => rmSync(cache, { recursive: true, force: true }));
    const binary = join(cache, "leer-pdf");
    await exec("/usr/bin/clang", ["-O2", "-fobjc-arc", "-framework", "Foundation", "-framework", "AppKit", "-framework", "CoreGraphics",
      "-framework", "PDFKit", "-framework", "Vision", PDF_HELPER, "-o", binary],
    { cwd: cache, timeout: 45_000, maxBuffer: 1024 * 1024 });
    return binary;
  })().catch(error => {
    helperExecutable = null;
    throw error;
  });
  return helperExecutable;
}

async function extractWithPdfKit(file, directory, first = 1, last = MAX_PAGES, ocr = false) {
  const binary = await localPdfHelper();
  const { stdout } = await exec(binary, [file, String(first), String(last), ocr ? "1" : "0"],
    { cwd: directory, timeout: ocr ? 50_000 : 25_000, maxBuffer: 4 * 1024 * 1024 });
  return JSON.parse(stdout);
}

async function readScans(file, directory, pages, warnings) {
  const byNumber = new Map(pages.map(page => [page.page, page]));
  for (let offset = 0; offset < pages.length; offset += OCR_BATCH_PAGES) {
    const batch = pages.slice(offset, offset + OCR_BATCH_PAGES);
    if (!batch.some(page => page.text.trim().length < 45)) continue;
    const first = batch[0].page;
    const last = batch.at(-1).page;
    try {
      const found = await extractWithPdfKit(file, directory, first, last, true);
      warnings.push(...found.warnings);
      for (const page of found.pages) {
        if (page.ocr && page.text.length > byNumber.get(page.page).text.length) byNumber.set(page.page, page);
      }
    } catch {
      warnings.push(`El OCR no completó las páginas ${first}–${last}. Puedes transcribirlas desde el original.`);
      if (!helperExecutable) break;
    }
  }
  return [...byNumber.values()];
}

export async function extractPdf(bytes) {
  const directory = await mkdtemp(join(tmpdir(), "escuela-cms-pdf-"));
  const warnings = [];
  try {
    const file = join(directory, "source.pdf");
    await writeFile(file, bytes, { mode: 0o600 });
    let result;
    try {
      result = await extractWithPoppler(file, directory);
    } catch (error) {
      if (process.platform !== "darwin") {
        warnings.push(error.code === "ENOENT"
          ? "Instala pdftotext (Poppler) para extraer PDF. También puedes pegar el texto de las páginas."
          : "No se pudo extraer este PDF. Comprueba que no requiera contraseña y prueba un archivo de texto.");
        return { fragments: [], warnings };
      }
    }
    if (process.platform === "darwin") {
      try {
        result ??= await extractWithPdfKit(file, directory);
      } catch {
        warnings.push("PDFKit no pudo completar la extracción local. Puedes pegar el texto de las páginas.");
      }
    }
    if (!result) return { fragments: [], warnings };
    if (result.status) {
      warnings.push(result.status === "locked"
        ? "El PDF está protegido. Carga una copia que puedas abrir sin contraseña."
        : "El archivo no se pudo leer como PDF.");
      return { fragments: [], warnings };
    }
    if (result.total > MAX_PAGES) {
      warnings.push(`Se procesaron las primeras ${MAX_PAGES} páginas. Divide el archivo para importar las restantes.`);
    }
    if (process.platform === "darwin") {
      result.pages = await readScans(file, directory, result.pages, warnings);
    }
    const unreadable = [];
    const fragments = result.pages.flatMap(({ page, text, ocr }) => {
      const content = cleanPage(text);
      if (!content) {
        unreadable.push(page);
        return [];
      }
      return [{
        location: `Página ${page}${ocr ? " (OCR)" : ""}`,
        text: content,
        rawText: text,
        ...(ocr && { warnings: ["Texto reconocido automáticamente. Coteja nombres, números y referencias con el original."] }),
      }];
    });
    if (unreadable.length) {
      const sample = unreadable.slice(0, 12).join(", ");
      warnings.push(`${unreadable.length} página(s) sin texto legible (${sample}${unreadable.length > 12 ? ", …" : ""}). Puedes transcribirlas desde el original.`);
    }
    if (!fragments.length && !warnings.length) warnings.push("El PDF no entregó texto legible. Puedes transcribir el material.");
    return { fragments, warnings };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
