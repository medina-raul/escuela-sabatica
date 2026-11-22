import { isPdf } from "../lib/ingest-text.mjs";

const maxPages = 140;

function pageText({ items }) {
  let line = "";
  let previous;
  const lines = [];
  for (const item of items) {
    if (!("str" in item)) continue;
    const y = item.transform[5];
    if (line && previous !== undefined && Math.abs(y - previous) > 3) {
      lines.push(line.trim());
      line = "";
    }
    if (line && !line.endsWith(" ") && !item.str.startsWith(" ")) line += " ";
    line += item.str;
    previous = y;
    if (item.hasEOL) {
      lines.push(line.trim());
      line = "";
    }
  }
  if (line.trim()) lines.push(line.trim());
  return lines.join("\n");
}

async function startOcr() {
  const [{ createWorker }, { default: workerPath }, { default: corePath }] = await Promise.all([
    import("tesseract.js"),
    import("tesseract.js/dist/worker.min.js?url"),
    import("tesseract.js-core/tesseract-core-lstm.wasm.js?url"),
  ]);
  return createWorker("spa", 1, {
    workerPath, corePath, workerBlobURL: false, cacheMethod: "none",
    langPath: new URL("/admin/pdf/ocr", location.origin).href,
  });
}

export async function extractPdf(bytes) {
  if (!isPdf(bytes)) throw new Error("El archivo no contiene un PDF compatible.");
  const [pdf, { default: workerSrc }] = await Promise.all([
    import("pdfjs-dist/build/pdf.min.mjs"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ]);
  pdf.GlobalWorkerOptions.workerSrc = workerSrc;
  const assets = new URL("/admin/pdf/", location.origin).href;
  const task = pdf.getDocument({
    data: bytes.slice(), enableXfa: false, isEvalSupported: false,
    cMapUrl: assets + "cmaps/", cMapPacked: true, standardFontDataUrl: assets + "standard_fonts/",
    wasmUrl: assets + "wasm/", iccUrl: assets + "iccs/", maxImageSize: 24_000_000,
  });
  let ocr;
  const fragments = [];
  const warnings = [];
  try {
    const document = await task.promise;
    for (let number = 1; number <= Math.min(document.numPages, maxPages); number++) {
      const page = await document.getPage(number);
      let rawText = pageText(await page.getTextContent());
      let viaOcr = false;
      if (rawText.replace(/\s/g, "").length < 65) {
        const original = rawText;
        const canvas = window.document.createElement("canvas");
        try {
          ocr ??= startOcr();
          const worker = await ocr;
          const natural = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: Math.min(2.4, 2400 / Math.max(natural.width, natural.height)) });
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          await page.render({ canvas, viewport }).promise;
          const { data } = await worker.recognize(canvas);
          if (data.text.trim().length > original.trim().length) {
            rawText = data.text;
            viaOcr = true;
          }
        } catch {
          warnings.push(`Página ${number}: no se pudo reconocer la imagen. Revisa el original.`);
        } finally {
          canvas.width = 0;
          canvas.height = 0;
        }
      }
      if (rawText.trim()) {
        fragments.push({
          location: `Página ${number}`, rawText,
          ...(viaOcr && { warnings: ["Texto recuperado por OCR. Revisa acentos, fechas y citas antes de guardar."] }),
        });
      } else {
        warnings.push(`Página ${number}: no se reconoció texto.`);
      }
      page.cleanup();
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    if (document.numPages > maxPages) warnings.push(`Se analizaron ${maxPages} páginas. Divide el PDF para continuar.`);
  } catch (error) {
    if (error.name === "PasswordException") throw new Error("Abre el PDF con su contraseña y guarda una copia desbloqueada para importarla.");
    throw new Error("No se pudo extraer el texto del PDF. Comprueba que abra y vuelve a intentarlo.", { cause: error });
  } finally {
    await task.destroy();
    if (ocr) await ocr.then(worker => worker.terminate()).catch(() => {});
  }
  return { fragments, warnings };
}
