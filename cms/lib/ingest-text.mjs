import { parse, parseFragment } from "parse5";
import { findBibleReferenceMatches } from "../../src/lib/bibleReferenceParser.ts";
import { extensionOf, originalName } from "./file-names.mjs";

const utf8 = new TextDecoder();
const encoder = new TextEncoder();

export function isPdf(bytes) {
  return /^%PDF-[12]\.\d/.test(utf8.decode(bytes.subarray(0, 12)));
}

export function cleanPage(raw) {
  // PDF text extractors often wrap prose at the end of each printed line.
  // Keep paragraph breaks and the original page association.
  return raw
    .replace(/[\u0000\u00ad]/g, "")
    .replace(/\r\n?/g, "\n")
    .split(/\n(?:[\t ]*\n)+/)
    .map(paragraph => paragraph.split("\n").map(line => line.trim()).filter(Boolean).join(" "))
    .filter(Boolean)
    .join("\n\n");
}

export const MAX_IMPORT_BYTES = 24 * 1024 * 1024;
const MAX_TEXT_BYTES = 1024 * 1024;
const MAX_FRAGMENT_SIZE = 48_000;
const MAX_RESULT_SIZE = 500_000;
const MAX_FRAGMENTS = 180;
export const KINDS = new Set(["auto", "pdf", "html", "markdown", "text", "url", "adventech"]);
const ADVENTECH_HOST = "raw.githubusercontent.com";
const ADVENTECH_PREFIX = "https://" + ADVENTECH_HOST + "/Adventech/sabbath-school-lessons/stage/src/es";
const DAYS = ["sabado", "domingo", "lunes", "martes", "miercoles", "jueves", "viernes"];
const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre",
  "octubre", "noviembre", "diciembre"];
const DROP_TAGS = new Set([
  "script", "style", "head", "template", "iframe", "object", "embed", "svg", "math", "canvas",
  "noscript", "form", "button", "input", "select", "textarea", "nav", "footer", "aside", "dialog",
]);
const BLOCK_TAGS = new Set([
  "article", "section", "header", "p", "main", "div", "address", "figure", "figcaption",
  "ul", "ol", "dl", "dt", "dd", "pre", "table", "tr",
]);

function normalizedWord(value) {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function cleanText(value) {
  return value.replace(/^\ufeff/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
}

function normalizedDate(value) {
  const text = normalizedWord(value);
  const iso = /(?:^|\D)(\d{4})-(\d{2})-(\d{2})(?=\D|$)/.exec(text);
  const numeric = /(?:^|\D)(\d{1,2})\/(\d{1,2})\/(\d{4})(?=\D|$)/.exec(text);
  const words = /(?:^|\D)(\d{1,2}) de ([a-z]+) (?:de(?:l)? )?(\d{4})(?=\D|$)/.exec(text);
  let parts;
  if (iso) parts = iso.slice(1, 4);
  else if (numeric) parts = [numeric[3], numeric[2], numeric[1]];
  else if (words && MONTHS.includes(words[2])) parts = [words[3], MONTHS.indexOf(words[2]) + 1, words[1]];
  if (!parts) return undefined;
  const [year, month, day] = parts.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (year < 1900 || year > 2200 || date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined;
  return date.toISOString().slice(0, 10);
}

function marker(value) {
  if (value.length > 170) return {};
  const label = normalizedWord(value).trim();
  const lesson = /^(?:leccion|lesson)\s+(?:n(?:[o.º]|umero)*\s*)?([0-9]{1,2})(?=\D|$)/.exec(label);
  const day = /^(sabado|domingo|lunes|martes|miercoles|jueves|viernes)(?=\b)/.exec(label);
  const number = Number(lesson?.[1]);
  return {
    ...(number >= 1 && number <= 14 && { suggestedLessonNumber: number }),
    ...(day && { suggestedDayId: day[1] }),
    ...((day || lesson) && { suggestedDate: normalizedDate(value) }),
  };
}

function frontmatter(markdown) {
  const match = /^---[ \t]*\n([\s\S]{0,12000}?)^---[ \t]*(?:\n|$)/m.exec(markdown);
  if (!match || match.index !== 0) return { markdown, metadata: {} };
  const metadata = {};
  for (const line of match[1].split("\n")) {
    const field = /^(title|date|lesson|day):[ \t]*(.*?)\s*$/.exec(line);
    if (field) metadata[field[1]] = field[2].replace(/^(["'])(.*)\1$/, "$2");
  }
  return { markdown: markdown.slice(match[0].length), metadata };
}

function hidden(node) {
  return node.attrs?.some(({ name, value }) => name === "hidden" || name === "inert" ||
    (name === "aria-hidden" && value === "true") ||
    (name === "role" && ["navigation", "banner", "contentinfo", "complementary"].includes(value)));
}

function findTag(root, name) {
  const pending = [root];
  while (pending.length) {
    const node = pending.pop();
    if (hidden(node) || DROP_TAGS.has(node.tagName)) continue;
    if (node.tagName === name) return node;
    for (let i = (node.childNodes?.length ?? 0) - 1; i >= 0; i -= 1) pending.push(node.childNodes[i]);
  }
}

function htmlNodeToText(node, preserveLines, depth = 0) {
  if (depth > 180 || hidden(node) || DROP_TAGS.has(node.tagName)) return "";
  if (node.nodeName === "#text") {
    return preserveLines ? node.value : node.value.replace(/\s+/g, " ");
  }
  const tag = node.tagName ?? "";
  if (tag === "br") return "\n";
  if (tag === "hr") return "\n\n";
  if (tag === "img") return node.attrs?.find(({ name }) => name === "alt")?.value || "";
  const content = (node.childNodes ?? []).map(child => htmlNodeToText(child, preserveLines, depth + 1)).join("");
  if (/^h[1-6]$/.test(tag)) {
    return "\n\n" + "#".repeat(Number(tag[1])) + " " + content.trim().replace(/\s+/g, " ") + "\n\n";
  }
  if (tag === "li") return "\n- " + content.trim() + "\n";
  if (tag === "td" || tag === "th") return " " + content.trim() + " ";
  if (tag === "blockquote") {
    return "\n\n" + content.trim().split("\n").filter(Boolean).map(line => "> " + line).join("\n") + "\n\n";
  }
  return BLOCK_TAGS.has(tag) ? "\n\n" + content.trim() + "\n\n" : content;
}

function htmlToMarkdown(text) {
  const document = parse(text, { scriptingEnabled: false });
  const source = findTag(document, "main") ?? findTag(document, "body") ?? document;
  return htmlNodeToText(source, false).replace(/\n[ \t]+\n/g, "\n\n").replace(/\n{3,}/g, "\n\n").trim();
}

function sanitizeMarkdownText(markdown) {
  // HTML in Markdown contributes visible text only. The CMS never renders it as a page.
  if (/<\/?[a-z][^>]*>/i.test(markdown)) {
    return htmlNodeToText(parseFragment(markdown, { scriptingEnabled: false }), true).trim();
  }
  return markdown;
}

function sectionize(value, context, { location, pdf = false, plaintext = false, single = false }) {
  const parts = [];
  let lines = [];
  let title;
  let fence;
  function save() {
    const text = pdf ? cleanPage(lines.join("\n")) : lines.join("\n").trim();
    if (text) {
      const partLocation = title ? location + " · " + title : location;
      parts.push({ location: partLocation, text, ...(title && { title }), ...context });
    }
    lines = [];
  }

  for (const line of value.split("\n")) {
    const fenceMatch = /^\s*(\x60{3,}|~{3,})/.exec(line);
    if (!pdf && fenceMatch) {
      if (!fence) fence = fenceMatch[1];
      else if (fence[0] === fenceMatch[1][0] && fenceMatch[1].length >= fence.length) fence = undefined;
    }
    const heading = !fence && /^(#{1,6})[ \t]+(.+?)(?:\s+#+)?\s*$/.exec(line.trim());
    const label = heading?.[2] ?? ((pdf || plaintext) ? line.trim() : "");
    const found = label ? marker(label) : {};
    const newSection = !single && (found.suggestedLessonNumber || found.suggestedDayId);
    if (newSection) {
      save();
      if (found.suggestedLessonNumber && found.suggestedLessonNumber !== context.suggestedLessonNumber) {
        delete context.suggestedDayId;
        delete context.suggestedDate;
      }
      Object.assign(context, found);
      title = label;
    } else if (heading && !title && heading[1] === "#" && !lines.some(text => text.trim())) {
      title = label.slice(0, 170);
    } else {
      const text = !pdf && heading ? (heading[1].length <= 3 ? "### " : "#### ") + heading[2] : line;
      lines.push(text);
    }
  }
  save();
  return parts;
}

export function detectType(name, bytes, requested, contentType) {
  const extension = extensionOf(name).toLowerCase();
  const mime = contentType.split(";", 1)[0].trim().toLowerCase();
  const prefix = utf8.decode(bytes.subarray(0, 4096));
  const html = /<(?:!doctype\s+html|html|head|body|main|article|section|div|h[1-6]|p)(?:\s|>)/i.test(prefix);
  const detected = isPdf(bytes) ? "pdf"
    : /\.html?$/.test(extension) || ["text/html", "application/xhtml+xml"].includes(mime) || html ? "html"
    : [".md", ".markdown"].includes(extension) || mime === "text/markdown" || requested === "adventech" ? "markdown"
    : "text";
  if (requested === "pdf" && detected !== "pdf" || requested !== "pdf" && detected === "pdf" &&
      !["auto", "url"].includes(requested)) {
    throw new Error("El formato seleccionado no coincide con el archivo.");
  }
  if (requested === "adventech") {
    if (detected !== "markdown") throw new Error("La URL de Adventech no devolvió un texto Markdown.");
    return detected;
  }
  if (["html", "markdown", "text"].includes(requested)) return requested;
  return detected;
}

function decodeText(bytes, contentType) {
  if (bytes.length > MAX_TEXT_BYTES) throw new Error("Divide el texto en archivos de hasta 1 MB.");
  if (bytes.subarray(0, 4096).includes(0)) throw new Error("El archivo no parece texto. Selecciona PDF o un archivo HTML o Markdown UTF-8.");
  const header = /;\s*charset\s*=\s*["']?([a-z0-9_-]+)/i.exec(contentType);
  const meta = /<meta[^>]+charset\s*=\s*["']?([a-z0-9_-]+)/i.exec(utf8.decode(bytes.subarray(0, 4096)));
  const requested = (header?.[1] ?? meta?.[1] ?? "utf-8").toLowerCase();
  const charset = ["latin1", "iso-8859-1", "windows-1252"].includes(requested) ? "windows-1252" : "utf-8";
  try {
    return cleanText(new TextDecoder(charset, { fatal: true }).decode(bytes));
  } catch {
    throw new Error("No se pudo leer la codificación. Guarda una copia del texto en UTF-8.");
  }
}

export function adventechPath(url) {
  const match = /^\/Adventech\/sabbath-school-lessons\/(?:stage|master|[a-f0-9]{40})\/src\/es\/(\d{4})-0([1-4])\/(\d{2})\/(0[1-7])\.md$/.exec(url.pathname);
  if (url.hostname !== ADVENTECH_HOST || !match) return null;
  const lessonNumber = Number(match[3]);
  if (lessonNumber < 1 || lessonNumber > 14) return null;
  return { suggestedLessonNumber: lessonNumber, suggestedDayId: DAYS[Number(match[4]) - 1] };
}

export function assertAdventechUrl(url) {
  if (!adventechPath(url)) throw new Error("Usa un enlace HTTPS al Markdown diario en el repositorio oficial de Adventech en español.");
}

export function adventechLessonUrls({ year, quarterNumber, lessonNumber }) {
  const numbers = [year, quarterNumber, lessonNumber];
  if (!numbers.every(Number.isInteger) || year < 2000 || year > 2200 ||
      quarterNumber < 1 || quarterNumber > 4 || lessonNumber < 1 || lessonNumber > 14) {
    throw new Error("Elige un año, trimestre y número de lección válidos de Adventech.");
  }
  const base = ADVENTECH_PREFIX + "/" + year + "-0" + quarterNumber + "/" + String(lessonNumber).padStart(2, "0");
  return DAYS.map((_, index) => base + "/0" + (index + 1) + ".md");
}

function referenceSuggestions(text) {
  const seen = new Map();
  for (const { reference } of findBibleReferenceMatches(text)) {
    if (reference.chapter < 1 || reference.verseStart < 0 ||
        reference.verseEnd !== undefined && reference.verseEnd < reference.verseStart ||
        reference.crossChapter && reference.crossChapter.chapter <= reference.chapter) continue;
    const key = JSON.stringify([
      reference.book, reference.chapter, reference.verseStart, reference.verseEnd,
      reference.crossChapter?.chapter, reference.crossChapter?.verseEnd,
    ]);
    if (!seen.has(key)) seen.set(key, reference.display);
    if (seen.size >= 150) break;
  }
  return [...seen.values()];
}

function suggestedKeyVerse(text) {
  const match = /(?:^|\n)[ \t]*(?:#+[ \t]*)?(?:para memorizar|vers[ií]culo (?:clave|para memorizar)|texto de memoria)\b[ \t:]*([^\n]*)/i.exec(text);
  if (!match) return undefined;
  const nextParagraph = text.slice(match.index + match[0].length).trimStart().split("\n\n", 1)[0];
  const candidate = (match[1].trim() || nextParagraph).trim().replace(/^>\s*/, "").slice(0, 950);
  const references = findBibleReferenceMatches(candidate);
  if (references.length !== 1) return undefined;
  const [{ index, length, reference }] = references;
  const verseText = candidate.slice(0, index).trim().replace(/^["“«]+|["”»(\s]+$/g, "");
  const trailing = candidate.slice(index + length).replace(/[.)"”»\s]/g, "");
  if (verseText.length < 8 || trailing) return undefined;
  return { text: verseText, reference: reference.display };
}

function boundedFragments(fragments, warnings) {
  let size = 0;
  const output = [];
  for (const fragment of fragments) {
    if (size >= MAX_RESULT_SIZE || output.length >= MAX_FRAGMENTS) break;
    const text = fragment.text.slice(0, Math.min(MAX_FRAGMENT_SIZE, MAX_RESULT_SIZE - size)).trim();
    if (!text) continue;
    size += text.length;
    const clipped = text.length < fragment.text.length;
    const verse = suggestedKeyVerse(text);
    output.push({
      ...fragment, text, referenceSuggestions: referenceSuggestions(text),
      ...(verse && { suggestedKeyVerse: verse }),
      ...(clipped && { warnings: [...(fragment.warnings ?? []), "El fragmento es demasiado extenso. Divide el original para recuperar el resto."] }),
    });
  }
  if (output.length < fragments.length) warnings.push("Hay fragmentos fuera del límite del informe. Divide el original para recuperar el resto.");
  return output;
}

export async function extractContent({ kind, bytes, name, url, contentType = "" }, extractPdf) {
  let fragments;
  const warnings = [];
  const adventech = url && adventechPath(url);
  const originUrl = url?.href;
  if (kind === "pdf") {
    const extracted = await extractPdf(bytes);
    warnings.push(...extracted.warnings);
    const context = marker(name);
    fragments = extracted.fragments.flatMap(page =>
      sectionize(page.rawText, context, { location: page.location, pdf: true }).map(fragment => ({
        ...fragment, ...(page.warnings && { warnings: page.warnings }),
      })),
    );
  } else {
    const text = decodeText(bytes, contentType);
    const normalized = kind === "html" ? htmlToMarkdown(text) : sanitizeMarkdownText(text);
    const content = kind === "markdown" ? frontmatter(normalized) : { markdown: normalized, metadata: {} };
    const context = { ...marker(name), ...marker(content.metadata.title ?? ""), ...adventech };
    const date = normalizedDate(content.metadata.date ?? "");
    if (date) context.suggestedDate = date;
    const lesson = Number(content.metadata.lesson);
    if (!adventech && Number.isInteger(lesson) && lesson >= 1 && lesson <= 14) context.suggestedLessonNumber = lesson;
    const day = normalizedWord(content.metadata.day ?? "");
    if (!adventech && DAYS.includes(day)) context.suggestedDayId = day;
    fragments = sectionize(content.markdown, context, {
      location: originUrl ? "Página de origen" : "Documento",
      plaintext: kind === "text", single: Boolean(adventech),
    });
    if (fragments.length === 1 && content.metadata.title) fragments[0].title = content.metadata.title.slice(0, 170);
  }
  if (!fragments.length && !warnings.length) warnings.push("No se reconoció contenido utilizable. Conserva el original y pega el texto para asignarlo manualmente.");
  return { fragments: boundedFragments(fragments, warnings), warnings };
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

export function articleDocument(text, name = "lectura.html") {
  if (typeof text !== "string" || !text.trim() || encoder.encode(text).length > MAX_TEXT_BYTES) {
    throw new Error("La lectura debe tener contenido y pesar hasta 1 MB.");
  }
  const content = cleanText(text).split("\n").map(line => {
    const trimmed = line.trim();
    if (!trimmed) return "";
    if (/^#{1,6}\s/.test(trimmed)) return "<h2>" + escapeHtml(trimmed.replace(/^#{1,6}\s+/, "")) + "</h2>";
    if (trimmed.startsWith("> ")) return "<blockquote>" + escapeHtml(trimmed.slice(2)) + "</blockquote>";
    return "<p>" + escapeHtml(trimmed) + "</p>";
  }).join("\n");
  const bytes = encoder.encode('<!doctype html>\n<html lang="es">\n<head><meta charset="utf-8"><title>Lectura complementaria</title></head>\n<body><article>\n' +
    content + "\n</article></body>\n</html>\n");
  const safeName = originalName(name, "lectura.html").replace(/\.[^.]+$/, "") + ".html";
  return { name: safeName, sizeBytes: bytes.length, kind: "article", bytes };
}
