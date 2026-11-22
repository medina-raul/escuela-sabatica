import { posix } from "node:path";
import { parse } from "parse5";
import { downloadImportSource, validateImportUrl } from "./ingest-remote.mjs";

const INDEX_SIZE = 2_000_000;
const MAX_MEDIA_LINKS = 1000;
const FORMATS = { audio: /\.mp3$/i, ppt: /\.pptx$/i };
const WEEKLY_NAME = /^(\d{4})t([1-4])(\d{2})\.pptx$/i;
const LEGACY_WEEKLY_PATTERN = "^(?P<year>\\d{4})t(?P<quarter>[1-4])(?P<lesson>\\d{2})\\.pptx$";
const IGNORED_TAGS = new Set(["script", "style", "template", "iframe", "object", "embed"]);

function plain(value) {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function filename(url) {
  const name = posix.basename(url.pathname);
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

function mediaLinkFormat(url, type) {
  return FORMATS[type]?.test(url.pathname);
}

function resourcesInQuarter(quarter) {
  return [
    ...(quarter.resources ?? []),
    ...(quarter.lessons ?? []).flatMap(lesson => [
      ...(lesson.resources ?? []),
      ...(lesson.days ?? []).flatMap(day => day.resources ?? []),
    ]),
  ];
}

function approvedUrl(value, hosts) {
  try {
    return validateImportUrl(value, hosts).href;
  } catch {
    return undefined;
  }
}

function slotKey(lesson, day) {
  return lesson + "/" + (day ?? "");
}

function slots(quarter, type) {
  const output = new Map();
  const resources = resourcesInQuarter(quarter).filter(resource => resource.type === type);
  for (const lesson of quarter.lessons ?? []) {
    for (const day of type === "audio" ? (lesson.days ?? []) : [null]) {
      const role = type === "audio" ? "daily-audio" : "weekly-presentation";
      const resource = resources.find(item => item.role === role &&
        item.lessonNumber === lesson.number && (!day || item.dayId === day.id));
      const url = resource?.source?.url ?? resource?.url ?? day?.audio?.url;
      output.set(slotKey(lesson.number, day?.id), {
        type, role, lessonNumber: lesson.number, ...(day && { dayId: day.id }),
        title: resource?.title ?? day?.audio?.title ?? (day
          ? "Lección " + lesson.number + " · " + day.dayName
          : "Presentación PPT · Lección " + lesson.number),
        credit: resource?.source?.credit ?? resource?.source?.provider ?? day?.audio?.narrator,
        explicitManual: resource?.source?.kind === "manual" || url?.startsWith("/"),
        existing: url,
        date: day ? day.date : lesson.startDate,
      });
    }
  }
  return output;
}

function extractMediaLinks(source, base, type, allowedHosts) {
  const pending = [parse(source, { scriptingEnabled: false })];
  const found = new Map();
  let cap = false;
  while (pending.length) {
    const node = pending.pop();
    if (IGNORED_TAGS.has(node.tagName)) continue;
    const attrs = Object.fromEntries((node.attrs ?? []).map(({ name, value }) => [name, value]));
    if (Object.hasOwn(attrs, "hidden")) continue;
    const value = node.tagName === "a" ? attrs.href :
      ["audio", "source"].includes(node.tagName) ? attrs.src : undefined;
    if (value) {
      try {
        const url = new URL(value, base);
        if (mediaLinkFormat(url, type)) {
          const canonical = approvedUrl(url.href, allowedHosts);
          if (canonical) {
            // Labels can disambiguate a filename when the author included the assignment.
            const label = [attrs.title, attrs["aria-label"], node.childNodes?.map(readLabel).join(" ")].filter(Boolean).join(" ");
            if (!found.has(canonical)) found.set(canonical, []);
            if (label) found.get(canonical).push(label.slice(0, 250));
            if (found.size === MAX_MEDIA_LINKS) {
              cap = true;
              break;
            }
          }
        }
      } catch {
        // Malformed and unapproved links are skipped without connecting to them.
      }
    }
    for (let i = (node.childNodes?.length ?? 0) - 1; i >= 0; i -= 1) pending.push(node.childNodes[i]);
  }
  return {
    links: [...found].map(([url, labels]) => ({ url, label: labels.join(" ").slice(0, 500) })),
    warnings: cap ? ["El índice se limitó a los primeros 1000 enlaces de archivos. Usa un índice del trimestre."] : [],
  };
}

function readLabel(node, depth = 0) {
  if (node.nodeName === "#text") return node.value;
  if (depth > 32 || IGNORED_TAGS.has(node.tagName)) return "";
  return (node.childNodes ?? []).map(child => readLabel(child, depth + 1)).join("");
}

async function getLinks(url, type, {
  allowedHosts, downloadSource = downloadImportSource, maxIndexBytes = INDEX_SIZE, permitDirect = true,
}) {
  const target = validateImportUrl(url, allowedHosts);
  if (target.hostname === "github.com" && permitDirect) {
    return repositoryLinks(target, type, allowedHosts, downloadSource);
  }
  if (permitDirect && mediaLinkFormat(target, type)) return { links: [{ url: target.href, label: "" }], warnings: [] };
  const response = await downloadSource(target.href, {
    allowedHosts, maxBytes: Math.min(maxIndexBytes, INDEX_SIZE), allowMissing: true,
  });
  if (response.missing) return { links: [], warnings: ["El índice aún no está disponible."] };
  if (!/^(?:text\/html|application\/xhtml\+xml)(?:\s*;|$)/i.test(response.contentType)) {
    throw new Error("La fuente debe ser un índice HTML o un enlace directo a un archivo.");
  }
  const encoding = /charset\s*=\s*["']?(?:latin1|iso-8859-1|windows-1252)/i.test(response.contentType) ? "windows-1252" : "utf-8";
  return extractMediaLinks(new TextDecoder(encoding).decode(response.bytes), response.url, type, allowedHosts);
}

async function repositoryLinks(url, type, allowedHosts, download) {
  const [owner, repo, tree, branch, ...folder] = url.pathname.split("/").filter(Boolean);
  const part = /^[a-z0-9_.-]+$/i;
  if (![owner, repo, ...(branch ? [branch, ...folder] : [])].every(segment =>
    typeof segment === "string" && part.test(segment) && segment !== "." && segment !== "..") ||
    tree && (tree !== "tree" || !branch)) {
    throw new Error("Usa el enlace al repositorio público o a una carpeta en GitHub.");
  }
  const root = `https://api.github.com/repos/${owner}/${repo}`;
  const get = async (path, maxBytes) => {
    const response = await download(path, { allowedHosts, maxBytes });
    return JSON.parse(new TextDecoder().decode(response.bytes));
  };
  const ref = branch || (await get(root, 60_000)).default_branch;
  if (typeof ref !== "string" || !ref) throw new Error("El repositorio no tiene una rama pública.");
  const { tree: files, truncated } = await get(`${root}/git/trees/${encodeURIComponent(ref)}?recursive=1`, INDEX_SIZE);
  const prefix = folder.length ? folder.join("/") + "/" : "";
  const media = files.filter(file => file.type === "blob" && file.path.startsWith(prefix) && FORMATS[type].test(file.path));
  const links = media.slice(0, MAX_MEDIA_LINKS).flatMap(file => {
    const path = file.path.split("/").map(encodeURIComponent).join("/");
    const raw = approvedUrl(`https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(ref)}/${path}`, allowedHosts);
    return raw ? [{ url: raw, label: file.path }] : [];
  });
  return { links, warnings: truncated || media.length > MAX_MEDIA_LINKS ? ["El repositorio supera el límite. Selecciona una carpeta del trimestre."] : [] };
}

function inferIndexSlot(link, quarter, type, bySlot) {
  const name = filename(new URL(link.url));
  const coded = type === "ppt" && WEEKLY_NAME.exec(name);
  if (coded) {
    if (Number(coded[1]) !== quarter.year || Number(coded[2]) !== quarter.quarterNumber) return null;
    return bySlot.get(slotKey(Number(coded[3]))) ?? null;
  }
  const text = plain(name + " " + link.label);
  const lessonNumbers = new Set([...text.matchAll(/(?:^|[^a-z0-9])(?:leccion|lesson|lec)[._\s-]*(?:n[º°o.]?[._\s-]*)?(\d{1,2})(?=\D|$)/g)]
    .map(match => Number(match[1])));
  const days = new Set([...text.matchAll(/(?:^|[^a-z])(?:sabado|domingo|lunes|martes|miercoles|jueves|viernes)(?=[^a-z]|$)/g)]
    .map(match => match[0].replace(/^[^a-z]/, "")));
  if (lessonNumbers.size > 1 || days.size > 1) return null;
  const [lesson] = lessonNumbers;
  const [day] = days;
  const dates = new Set([...text.matchAll(/(?:^|\D)(\d{4})[._-](\d{2})[._-](\d{2})(?=\D|$)/g)]
    .map(match => [match[1], match[2], match[3]].join("-")));
  if (dates.size > 1) return null;
  const [date] = dates;
  const explicit = type === "audio" && day ? bySlot.get(slotKey(lesson, day))
    : type === "ppt" ? bySlot.get(slotKey(lesson)) : undefined;
  if (explicit && (!date || !explicit.date || explicit.date === date)) return explicit;
  if (!date) return null;
  const dated = [...bySlot.values()].filter(slot => slot.date === date &&
    (lesson === undefined || slot.lessonNumber === lesson) && (!day || slot.dayId === day));
  return dated.length === 1 ? dated[0] : null;
}

function makeCandidate(slot, urls, credit) {
  const { type, role, title, lessonNumber, dayId } = slot;
  return {
    type, role, title, lessonNumber, ...(dayId && { dayId }),
    credit: slot.credit || credit,
    url: urls[0],
    ...(urls.length > 1 && { alternativeUrls: urls.slice(1) }),
  };
}

function unambiguousCandidates(matches, allowedHosts, warnings, credit, {
  includeExisting = false,
} = {}) {
  const candidates = [];
  for (const [slot, links] of matches) {
    if (slot.explicitManual) continue;
    const existing = approvedUrl(slot.existing, allowedHosts);
    const urls = [...new Set(links)];
    if (urls.length > 1 && !urls.includes(existing)) {
      warnings.push("Hay varios enlaces para " + slot.title + ". Confírmalos antes de usar uno.");
      continue;
    }
    if (urls.includes(existing)) candidates.push(makeCandidate(slot, [existing], credit));
    else if (includeExisting && existing) candidates.push(makeCandidate(slot, [existing, ...urls], credit));
    else if (urls.length === 1) candidates.push(makeCandidate(slot, urls, credit));
  }
  return candidates;
}

export async function discoverResourceIndex({ url, quarter, type, credit }, options = {}) {
  if (!FORMATS[type]) throw new Error("El índice debe contener audios MP3 o presentaciones PPTX.");
  const { allowedHosts = [] } = options;
  const bySlot = slots(quarter, type);
  const { links, warnings } = await getLinks(url, type, { ...options, allowedHosts });
  const matches = new Map();
  let unknown = 0;
  for (const link of links) {
    const slot = inferIndexSlot(link, quarter, type, bySlot);
    if (!slot) {
      unknown += 1;
      continue;
    }
    const urls = matches.get(slot) ?? [];
    urls.push(link.url);
    matches.set(slot, urls);
  }
  if (!links.length && !warnings.length) warnings.push("El índice aún no ofrece archivos de este tipo en dominios autorizados.");
  if (unknown) warnings.push(unknown + " enlace(s) sin lección y día inequívocos para este trimestre. Revisa la asociación manualmente.");
  const provider = validateImportUrl(url, allowedHosts).hostname;
  return { candidates: unambiguousCandidates(matches, allowedHosts, warnings, credit || provider), warnings };
}

function legacyAudio(quarter, config, allowedHosts, warnings) {
  const templates = config.urlTemplates ?? [config.urlTemplate].filter(Boolean);
  const daily = slots(quarter, "audio");
  const candidates = [];
  let omitted = 0;
  for (const slot of daily.values()) {
    const token = config.dayTokens?.[slot.dayId];
    if (slot.explicitManual || !token || slot.lessonNumber < config.lessonStart || slot.lessonNumber > config.lessonEnd) continue;
    const urls = [slot.existing, ...templates.slice(0, 10).map(template => typeof template === "string" &&
      template.replaceAll("{lesson}", String(slot.lessonNumber)).replaceAll("{day}", token))];
    const approved = [...new Set(urls.map(url => approvedUrl(url, allowedHosts)).filter(Boolean))];
    if (approved.length) candidates.push(makeCandidate(slot, approved, "Audio Escuela Sabática"));
    else omitted += 1;
  }
  if (omitted) warnings.push(omitted + " audio(s) quedaron pendientes porque su dominio de origen no está autorizado.");
  return candidates;
}

async function legacyPpt(quarter, config, options, warnings) {
  const { allowedHosts } = options;
  const matches = new Map([...slots(quarter, "ppt").values()]
    .filter(slot => slot.lessonNumber >= config.lessonStart && slot.lessonNumber <= config.lessonEnd)
    .map(slot => [slot, []]));
  if (config.fileNamePattern !== LEGACY_WEEKLY_PATTERN) {
    warnings.push("Usa la opción de índice genérico para un patrón de presentaciones distinto al formato histórico.");
  } else {
    try {
      const { links, warnings: indexWarnings } = await getLinks(config.indexUrl, "ppt", {
        ...options, maxIndexBytes: config.indexMaxBytes ?? INDEX_SIZE, permitDirect: false,
      });
      warnings.push(...indexWarnings);
      const slotsByNumber = new Map([...matches.keys()].map(slot => [slot.lessonNumber, slot]));
      for (const link of links) {
        const parts = WEEKLY_NAME.exec(filename(new URL(link.url)));
        if (!parts || Number(parts[1]) !== quarter.year || Number(parts[2]) !== quarter.quarterNumber) continue;
        const slot = slotsByNumber.get(Number(parts[3]));
        if (slot) matches.get(slot).push(link.url);
      }
      if (![...matches.values()].some(urls => urls.length)) warnings.push("No se encontraron PPT nuevos en el índice para este trimestre.");
    } catch (error) {
      warnings.push("No se pudo revisar el índice de presentaciones: " + error.message);
    }
  }
  return unambiguousCandidates(matches, allowedHosts, warnings,
    config.credit || (config.provider === "Fustero" ? "Sergio Fustero y Eunice Laveda" : config.provider) || "Fuente de presentaciones",
    { includeExisting: true });
}

export async function discoverQuarterResources(quarter, {
  allowedHosts = [], type, ...options
} = {}) {
  if (type && !FORMATS[type]) throw new Error("La revisión de recursos admite audio o PPT.");
  const { audioDiscovery, presentationDiscovery } = quarter.resourceAutomation ?? {};
  const warnings = [];
  const candidates = [];
  if ((!type || type === "audio") && audioDiscovery) candidates.push(...legacyAudio(quarter, audioDiscovery, allowedHosts, warnings));
  if ((!type || type === "ppt") && presentationDiscovery) {
    candidates.push(...await legacyPpt(quarter, presentationDiscovery, { ...options, allowedHosts }, warnings));
  }
  if ((!type || type === "audio") && !audioDiscovery) warnings.push("El trimestre no tiene un perfil histórico de audio. Puedes registrar un índice.");
  if ((!type || type === "ppt") && !presentationDiscovery) warnings.push("El trimestre no tiene un perfil histórico de PPT. Puedes registrar un índice.");
  return { candidates, warnings };
}
