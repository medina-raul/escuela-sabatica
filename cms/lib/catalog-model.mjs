import { findBibleReferenceMatches } from "../../src/lib/bibleReferenceParser.ts";

const registryPath = "resource-automation.json";
const sitePath = "src/data/site-config.json";
const days = [
  ["sabado", "Sábado"], ["domingo", "Domingo"], ["lunes", "Lunes"], ["martes", "Martes"],
  ["miercoles", "Miércoles"], ["jueves", "Jueves"], ["viernes", "Viernes"],
];
const dayIds = new Set(days.map(([id]) => id));
const periods = ["Enero - Marzo", "Abril - Junio", "Julio - Septiembre", "Octubre - Diciembre"];
const dateFormat = new Intl.DateTimeFormat("es-CL", { day: "numeric", month: "long", timeZone: "UTC" });
const quarterIdPattern = /^\d{4}-q[1-4]$/;
const sha256Pattern = /^sha256:[0-9a-f]{64}$/;
const statuses = ["draft", "published", "archived"];
const roleTypes = {
  "general-reading": ["article", "pdf", "commentary", "guide", "video"],
  "general-attachment": ["attachment"],
  "friday-reading": ["article"],
  "teacher-reading": ["article"],
  "complementary-book-reading": ["article", "pdf"],
  "weekly-presentation": ["ppt"],
  "weekly-attachment": ["attachment"],
  "daily-audio": ["audio"],
};
const localTemplates = {
  "general-reading": "/recursos/{quarterId}/lecturas/generales/{filename}",
  "general-attachment": "/recursos/{quarterId}/adjuntos/generales/{filename}",
  "friday-reading": "/recursos/{quarterId}/lecturas/viernes/leccion-{lesson:02d}.html",
  "teacher-reading": "/recursos/{quarterId}/lecturas/maestros/leccion-{lesson:02d}.html",
  "complementary-book-reading": "/recursos/{quarterId}/lecturas/libro-complementario/{filename}",
  "weekly-presentation": "/recursos/{quarterId}/ppt/leccion-{lesson:02d}.pptx",
  "weekly-attachment": "/recursos/{quarterId}/adjuntos/leccion-{lesson:02d}/{filename}",
  "daily-audio": "/recursos/{quarterId}/audio/leccion-{lesson:02d}/{day}.mp3",
};
const navSections = ["home", "lessons", "resources", "beliefs", "archive", "bible", "custom"];
const palettes = ["clasica", "azul", "oliva"];
const readingFonts = ["literata", "lora", "georgia"];
const widgetTypes = [
  "weekly-presentation", "teacher-reading", "complementary-book", "reavivados",
  "friday-reading", "resource-library", "notice", "link",
];

export class CatalogError extends Error {
  constructor(message) {
    super(message);
    this.name = "CatalogError";
    this.status = 400;
  }
}

function requireCondition(condition, message) {
  if (!condition) throw new CatalogError(message);
}

function asObject(value, name) {
  requireCondition(value && typeof value === "object" && !Array.isArray(value), `${name} debe ser un objeto.`);
  return value;
}

function asString(value, name, { max = 180, optional = false } = {}) {
  requireCondition(typeof value === "string", `${name} debe ser texto.`);
  const text = value.replace(/\r\n?/g, "\n").trim();
  requireCondition((optional || text) && text.length <= max && !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(text),
    `${name} debe contener ${optional ? "hasta" : "entre 1 y"} ${max} caracteres válidos.`);
  return text;
}

function asNumber(value, name, min, max) {
  requireCondition(Number.isInteger(value) && value >= min && value <= max, `${name} debe estar entre ${min} y ${max}.`);
  return value;
}

function asOption(value, options, name) {
  requireCondition(options.includes(value), `${name} no es válido.`);
  return value;
}

function asBoolean(value, name) {
  requireCondition(typeof value === "boolean", `${name} debe ser verdadero o falso.`);
  return value;
}

function asArray(value, limit, name) {
  requireCondition(Array.isArray(value) && value.length <= limit, `${name} admite hasta ${limit} elementos.`);
  return value;
}

function asDate(value, name = "La fecha") {
  const timestamp = timestampFor(value);
  requireCondition(Number.isFinite(timestamp), `${name} debe ser una fecha válida (AAAA-MM-DD).`);
  return new Date(timestamp);
}

function timestampFor(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value ? timestamp : NaN;
}

function shiftDate(date, count) {
  return new Date(date.valueOf() + count * 86_400_000);
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function readableRange(start, end) {
  return `${dateFormat.format(start)} al ${dateFormat.format(end)}`;
}

function asHost(value) {
  const host = asString(value, "El dominio", { max: 253 }).toLowerCase();
  const label = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
  const publicHostPattern = new RegExp(`^(?:${label}\\.)+[a-z][a-z0-9-]{1,62}$`);
  requireCondition(publicHostPattern.test(host)
    && !/\.(?:localhost|local|internal|lan|home|test)$/.test(host), "Ingresa un dominio público completo.");
  return host;
}

function asLink(value, { optional = false, local = true, image = false, name = "La URL" } = {}) {
  const link = asString(value, name, { max: 2048, optional });
  if (!link && optional) return "";
  requireCondition(!/[\s\\<>"'`]/.test(link), `${name} contiene caracteres no permitidos.`);
  if (image) requireCondition(!/[()]/.test(link), `${name} contiene caracteres no permitidos.`);
  if (local && (link.startsWith("/") || link.startsWith("#"))) {
    requireCondition(!link.startsWith("//") && !/%(?:2f|5c|2e)/i.test(link)
      && !/(?:^|\/)\.\.?(?:\/|$)/.test(link.split(/[?#]/)[0])
      && (link.startsWith("/") || !image), `${name} debe ser una ruta del sitio.`);
    return link;
  }
  let url;
  try { url = new URL(link); } catch { throw new CatalogError(`${name} debe usar HTTPS o una ruta del sitio.`); }
  requireCondition(url.protocol === "https:" && !url.username && !url.password && !url.port
    && link.startsWith("https://"), `${name} debe usar HTTPS sin credenciales ni puerto alternativo.`);
  asHost(url.hostname);
  return url.href;
}

function cloneChangedText(target, input, fields) {
  for (const [key, [label, max, optional]] of Object.entries(fields)) {
    if (Object.hasOwn(input, key)) target[key] = asString(input[key], label, { max, optional });
  }
}

function catalogPath(id) {
  requireCondition(typeof id === "string" && quarterIdPattern.test(id), "Identificador de trimestre inválido.");
  return `src/data/quarters/${id}.json`;
}

export function snapshotFromDocuments(read) {
  const registry = read(registryPath);
  const quarters = {};
  for (const entry of registry.quarters) {
    const file = catalogPath(entry.id);
    requireCondition(entry.catalog === file && !Object.hasOwn(quarters, entry.id), "Registro de catálogo inválido.");
    const quarter = read(file);
    requireCondition(quarter.id === entry.id, "El catálogo no coincide con su registro.");
    quarters[entry.id] = quarter;
  }
  const years = [...new Set([...(registry.years ?? []), ...Object.values(quarters).map(quarter => quarter.year)])]
    .sort((a, b) => a - b);
  return { registry, quarters, years, site: read(sitePath) };
}

export function listQuarters(snapshot) {
  return snapshot.registry.quarters.map(({ id, catalog, status }) => {
    const { title, year, quarterNumber, dateRange, lessons } = snapshot.quarters[id];
    return { id, title, year, quarterNumber, dateRange, status, lessonCount: lessons.length, active: catalog === snapshot.registry.activeCatalog };
  });
}

export function snapshotFiles(snapshot) {
  const registeredYears = new Set(Object.values(snapshot.quarters).map(quarter => quarter.year));
  const registry = { ...snapshot.registry };
  if (registry.years || snapshot.years.some(year => !registeredYears.has(year))) registry.years = snapshot.years;
  const encode = value => `${JSON.stringify(value, null, 2)}\n`;
  const files = new Map([[registryPath, encode(registry)], [sitePath, encode(snapshot.site)]]);
  for (const entry of registry.quarters) {
    files.set(catalogPath(entry.id), encode(snapshot.quarters[entry.id]));
  }
  return files;
}

function getQuarter(snapshot, id) {
  requireCondition(typeof id === "string" && quarterIdPattern.test(id) && Object.hasOwn(snapshot.quarters, id),
    "El trimestre seleccionado no existe.");
  return snapshot.quarters[id];
}

function getLesson(quarter, id) {
  const lesson = quarter.lessons.find(entry => entry.id === id);
  requireCondition(lesson, "La lección seleccionada no existe.");
  return lesson;
}

function getDay(lesson, id) {
  const day = lesson.days.find(entry => entry.id === id);
  requireCondition(day, "El día seleccionado no existe.");
  return day;
}

function addYear(snapshot, year) {
  if (!snapshot.years.includes(year)) {
    snapshot.years.push(year);
    snapshot.years.sort((a, b) => a - b);
  }
}

function createQuarter(snapshot, data) {
  const year = asNumber(data.year, "El año", 1900, 2199);
  const quarterNumber = asNumber(data.quarterNumber, "El trimestre", 1, 4);
  const id = `${year}-q${quarterNumber}`;
  const startDate = asDate(data.startDate, "La fecha de inicio");
  requireCondition(startDate.getUTCDay() === 6, "El primer día del trimestre debe ser sábado.");
  requireCondition(!Object.hasOwn(snapshot.quarters, id), "Ya existe ese trimestre.");
  const lessonCount = data.templateId ? getQuarter(snapshot, data.templateId).lessons.length
    : (data.lessonCount === undefined ? 13 : asNumber(data.lessonCount, "La cantidad de lecciones", 13, 14));
  requireCondition(lessonCount >= 13 && lessonCount <= 14, "La plantilla debe tener 13 o 14 lecciones.");
  const title = asString(data.title, "El título");
  const lessons = Array.from({ length: lessonCount }, (_, index) => {
    const first = shiftDate(startDate, index * 7);
    const last = shiftDate(first, 6);
    const number = index + 1;
    const label = String(number).padStart(2, "0");
    return {
      id: `leccion-${label}`, number, title: `Lección ${label}`,
      dateRange: readableRange(first, last), startDate: isoDate(first), endDate: isoDate(last),
      days: days.map(([dayId, name], offset) => ({
        id: dayId, dayName: name, date: isoDate(shiftDate(first, offset)), title: name, contentMarkdown: "",
      })),
      resources: [],
    };
  });
  const allowedSourceHosts = [...new Set(Object.values(snapshot.quarters)
    .flatMap(quarter => quarter.resourceAutomation?.allowedSourceHosts ?? []))];
  snapshot.quarters[id] = {
    id, year, quarterNumber, title, dateRange: `${periods[quarterNumber - 1]} ${year}`,
    description: "", lessons, resources: [], reavivados: [],
    resourceAutomation: {
      schemaVersion: 1, manifestPath: `/manifests/${id}.json`, maxDownloadBytes: 50_000_000,
      allowedSourceHosts, canonicalLayout: { roleTemplates: { ...localTemplates }, legacySearchRoots: [`public/recursos/${id}`] },
    },
  };
  addYear(snapshot, year);
  snapshot.registry.quarters.push({ id, catalog: catalogPath(id), status: "draft" });
  snapshot.registry.quarters.sort((a, b) => a.id.localeCompare(b.id));
}

function updateQuarter(quarter, data) {
  cloneChangedText(quarter, data, {
    title: ["El título", 180], subtitle: ["El subtítulo", 500, true],
    description: ["La introducción", 50000, true], dateRange: ["El período", 120],
  });
  if (Object.hasOwn(data, "coverImage")) {
    const cover = asLink(data.coverImage, { optional: true, image: true, name: "La portada" });
    if (cover) quarter.coverImage = cover;
    else delete quarter.coverImage;
  }
  if (Object.hasOwn(data, "introduction")) {
    const input = asObject(data.introduction, "La ficha de introducción");
    const intro = { ...quarter.introduction };
    cloneChangedText(intro, input, {
      subtitle: ["El subtítulo", 500, true], author: ["El autor", 120, true],
      videoCaption: ["El texto del video", 300, true],
    });
    if (Object.hasOwn(input, "videoUrl")) {
      intro.videoUrl = asLink(input.videoUrl, { optional: true, name: "El enlace de video" });
    }
    quarter.introduction = intro;
  }
}

function updateQuarterStatus(snapshot, quarter, data) {
  const entry = snapshot.registry.quarters.find(item => item.id === quarter.id);
  const status = Object.hasOwn(data, "status") ? asOption(data.status, statuses, "El estado") : entry.status;
  const isActive = entry.catalog === snapshot.registry.activeCatalog;
  const makeActive = data.active === undefined ? false : asBoolean(data.active, "Trimestre activo");
  requireCondition((!makeActive && !isActive) || status === "published", "El trimestre activo debe quedar publicado.");
  requireCondition(status !== "draft" || entry.status === "draft", "Archiva el trimestre para conservar sus enlaces públicos.");
  if (status !== "draft" && entry.status === "draft") {
    const [issue] = quarterIssues(quarter, status);
    if (issue) throw new CatalogError(issue);
  }
  entry.status = status;
  if (makeActive) snapshot.registry.activeCatalog = entry.catalog;
}

function validatedReference(value, name) {
  const text = asString(value, name, { max: 100 });
  const matches = findBibleReferenceMatches(text);
  const [{ reference, index, length } = {}] = matches;
  requireCondition(matches.length === 1 && reference && index === 0 && length === text.length && reference.chapter > 0
    && (reference.verseStart > 0 || !text.includes(":"))
    && (reference.verseEnd === undefined || reference.verseEnd >= reference.verseStart)
    && (!reference.crossChapter || (reference.crossChapter.chapter > reference.chapter && reference.crossChapter.verseEnd > 0)),
  `${name} debe indicar un capítulo, versículo o rango válido.`);
  return reference;
}

function setKeyVerse(day, data) {
  const hasReference = Object.hasOwn(data, "keyVerseReference");
  const hasText = Object.hasOwn(data, "keyVerseText");
  if (!hasReference && !hasText) return;
  const referenceText = hasReference ? asString(data.keyVerseReference, "La referencia clave", { max: 100, optional: true })
    : (day.keyVerse?.reference?.display ?? "");
  const verseText = hasText ? asString(data.keyVerseText, "El versículo clave", { max: 3000, optional: true })
    : (day.keyVerse?.text ?? "");
  if (!referenceText) {
    requireCondition(!verseText, "Indica la referencia bíblica del versículo clave.");
    if (day.keyVerse) delete day.keyVerse;
    return;
  }
  const reference = hasReference && referenceText !== day.keyVerse?.reference?.display
    ? validatedReference(referenceText, "La referencia clave") : (day.keyVerse?.reference ?? validatedReference(referenceText, "La referencia clave"));
  day.keyVerse = { ...day.keyVerse, reference, text: verseText };
}

function publicSource(value) {
  const input = asObject(value, "La procedencia");
  const kind = asString(input.kind ?? "import", "El tipo de procedencia", { max: 40 });
  const source = {
    kind,
    reviewStatus: input.reviewStatus === "reviewed" ? "reviewed" : "pending-editorial-review",
  };
  const hash = input.sha256 ?? input.checksum;
  if (hash !== undefined) {
    requireCondition(typeof hash === "string", "El checksum de procedencia no es válido.");
    source.sha256 = hash.startsWith("sha256:") ? hash : `sha256:${hash}`;
    requireCondition(sha256Pattern.test(source.sha256), "El checksum de procedencia no es válido.");
  }
  if (input.language !== undefined) source.language = asString(input.language, "El idioma", { max: 25 });
  if (input.location !== undefined) source.location = asString(input.location, "La ubicación de origen", { max: 500 });
  if (input.file || input.filename) {
    const filename = asString(input.file ?? input.filename, "El nombre del archivo", { max: 220 });
    source.file = filename.split(/[\\/]/).at(-1);
  }
  if (input.page !== undefined) source.pages = [asNumber(input.page, "La página", 1, 9999)];
  if (input.pages !== undefined) {
    source.pages = asArray(input.pages, 9999, "Las páginas").map(page => asNumber(page, "La página", 1, 9999));
  }
  const originUrl = input.url ?? input.originUrl;
  if (originUrl) {
    const url = new URL(asLink(originUrl, { local: false, name: "La URL de procedencia" }));
    source.url = `${url.origin}${url.pathname}`;
  }
  return source;
}

function updateDay(lesson, day, data) {
  cloneChangedText(day, data, {
    title: ["El título del día", 180], subtitle: ["El subtítulo", 500, true],
    contentMarkdown: ["El texto de lectura", 100000, true],
    fridayReadingAnchor: ["La invitación a leer", 2000, true],
  });
  if (Object.hasOwn(data, "date")) {
    const date = asDate(data.date);
    requireCondition(date.getUTCDay() === (days.findIndex(([id]) => id === day.id) + 6) % 7,
      `La fecha elegida debe corresponder a ${day.dayName}.`);
    day.date = isoDate(date);
    if (lesson.days[0] === day) lesson.startDate = day.date;
    if (lesson.days.at(-1) === day) lesson.endDate = day.date;
  }
  if (Object.hasOwn(data, "studyReferences")) {
    const references = asArray(data.studyReferences, 150, "Las referencias")
      .map(text => validatedReference(text, "La referencia bíblica"));
    day.studyReferences = [...new Map(references.map(reference => [
      JSON.stringify([reference.book, reference.chapter, reference.verseStart, reference.verseEnd, reference.crossChapter]), reference,
    ])).values()];
  }
  setKeyVerse(day, data);
  if (Object.hasOwn(data, "contentSource")) day.contentSource = publicSource(data.contentSource);
}

function upsertReading(quarter, data) {
  const date = isoDate(asDate(data.date));
  const reading = asString(data.reading, "La lectura");
  const readings = quarter.reavivados ??= [];
  const existing = readings.find(entry => entry.date === date);
  const updated = { ...existing, date, reading };
  if (Object.hasOwn(data, "bookId") || Object.hasOwn(data, "chapter")) {
    const removeLink = data.bookId == null && data.chapter == null;
    if (removeLink) {
      delete updated.bookId;
      delete updated.chapter;
    } else {
      updated.bookId = asNumber(data.bookId ?? existing?.bookId, "El identificador del libro", 1, 66);
      updated.chapter = asNumber(data.chapter ?? existing?.chapter, "El capítulo", 1, 150);
    }
  }
  if (existing) readings[readings.indexOf(existing)] = updated;
  else readings.push(updated);
  readings.sort((a, b) => a.date.localeCompare(b.date));
}

function resourceCollections(quarter) {
  return [quarter.resources ?? [], ...quarter.lessons.map(lesson => lesson.resources ?? [])];
}

function resourceList(quarter) {
  return resourceCollections(quarter).flat();
}

function getResource(quarter, id) {
  const collection = resourceCollections(quarter).find(list => list.some(resource => resource.id === id));
  if (!collection) return {};
  return { collection, resource: collection.find(resource => resource.id === id) };
}

function asSlug(text) {
  return text.normalize("NFD").replace(/\p{Mark}/gu, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 54) || "material";
}

function resourceId(quarter, role, title, lesson, day) {
  const base = ["general-reading", "general-attachment", "weekly-attachment"].includes(role) ? asSlug(title)
    : [role, lesson ? String(lesson).padStart(2, "0") : "introduccion", day].filter(Boolean).join("-");
  const ids = new Set(resourceList(quarter).map(resource => resource.id));
  let candidate = base;
  let suffix = 2;
  while (ids.has(candidate)) candidate = `${base}-${suffix++}`;
  return candidate;
}

function resourceTarget(quarter, next, asset) {
  const { type, role, lessonNumber, dayId } = next;
  const kinds = {
    audio: ["audio", "mp3"], ppt: ["ppt", "pptx"], article: ["article", "html"],
    pdf: ["pdf"], commentary: ["pdf", "commentary"], guide: ["pdf", "guide"], video: ["video"], attachment: ["attachment"],
  };
  const extension = {
    audio: "mp3", ppt: "pptx", article: "html", pdf: "pdf", commentary: "pdf", guide: "pdf", video: "mp4", attachment: "download",
  }[type];
  requireCondition(kinds[type].includes(asset.kind), "El formato del archivo no corresponde al tipo de recurso.");
  requireCondition(sha256Pattern.test(asset.sha256), "Falta un checksum válido para el recurso.");
  const name = asString(asset.name, "El nombre del archivo", { max: 220 });
  requireCondition(type === "attachment" || name.toLowerCase().endsWith(`.${extension}`), `El recurso requiere un archivo .${extension}.`);
  asNumber(asset.sizeBytes, "El tamaño del recurso", 1, quarter.resourceAutomation?.maxDownloadBytes ?? 50_000_000);
  requireCondition(!(role === "complementary-book-reading" && type === "pdf"),
    "Registra el PDF del libro como enlace oficial de Google Drive o sube un artículo HTML.");
  const automation = quarter.resourceAutomation;
  const template = automation?.canonicalLayout?.roleTemplates?.[role] ?? localTemplates[role];
  if (automation?.canonicalLayout && !automation.canonicalLayout.roleTemplates[role]) {
    automation.canonicalLayout.roleTemplates[role] = template;
  }
  const nameWithoutExtension = type === "attachment" ? name : name.slice(0, -(extension.length + 1));
  const filename = `${asSlug(nameWithoutExtension)}-${asset.sha256.slice(7, 19)}.${extension}`;
  const values = {
    quarterId: quarter.id, "lesson:02d": String(lessonNumber).padStart(2, "0"), lesson: lessonNumber,
    day: dayId, filename, id: next.id,
  };
  const url = template.replace(/\{([^{}]+)\}/g, (_, label) => values[label] ?? "");
  requireCondition(url.startsWith(`/recursos/${quarter.id}/`) && /^\/[a-z0-9_/.-]+$/.test(url)
    && !url.split("/").some(segment => segment === ".." || segment === "."), "La ruta del archivo no cumple el formato del catálogo.");
  return url;
}

function refreshAudioSlot(quarter, resource) {
  if (resource?.role !== "daily-audio") return;
  const lesson = quarter.lessons.find(item => item.number === resource.lessonNumber);
  const day = lesson?.days.find(item => item.id === resource.dayId);
  if (!day) return;
  const audio = resourceList(quarter).find(item => item.role === "daily-audio"
    && item.lessonNumber === resource.lessonNumber && item.dayId === resource.dayId);
  if (audio) {
    const original = day.audio?.url === audio.url ? day.audio : {};
    day.audio = {
      ...original, title: audio.title, url: audio.url,
      duration: audio.duration ?? original.duration,
      narrator: audio.source?.provider ?? original.narrator,
    };
    for (const key of ["duration", "narrator"]) if (day.audio[key] === undefined) delete day.audio[key];
  } else {
    day.audio = null;
  }
}

function allowResourceHost(quarter, hostInput) {
  const host = asHost(hostInput);
  const automation = quarter.resourceAutomation ??= { schemaVersion: 1, maxDownloadBytes: 50_000_000, manifestPath: `/manifests/${quarter.id}.json` };
  const hosts = automation.allowedSourceHosts ??= [];
  if (!hosts.includes(host)) hosts.push(host);
}

function approvedSource(quarter, value) {
  const url = asLink(value, { local: false, name: "El enlace del recurso" });
  const hostname = new URL(url).hostname;
  requireCondition(quarter.resourceAutomation?.allowedSourceHosts?.includes(hostname),
    `Solicita autorizar el dominio ${hostname} para este trimestre o carga el archivo.`);
  return { kind: "url", url, provider: hostname, providerUrl: `https://${hostname}/` };
}

function upsertResource(quarter, data) {
  const { collection, resource: existing } = getResource(quarter, data.id);
  requireCondition(data.id == null || existing, "El recurso seleccionado no existe.");
  const role = data.role ?? existing?.role;
  requireCondition(Object.hasOwn(roleTypes, role), "El rol del recurso no es válido.");
  const type = asOption(data.type ?? existing?.type, roleTypes[role], "El tipo de recurso");
  const title = asString(data.title ?? existing?.title, "El título del recurso");
  const next = { ...existing, role, type, title };
  cloneChangedText(next, data, {
    description: ["La descripción", 2000, true],
    duration: ["La duración", 40, true],
  });
  const lessonNumber = Object.hasOwn(data, "lessonNumber") ? data.lessonNumber : existing?.lessonNumber;
  const dayId = Object.hasOwn(data, "dayId") ? data.dayId : existing?.dayId;
  const lesson = lessonNumber == null || lessonNumber === "" ? undefined : quarter.lessons.find(item => item.number === lessonNumber);
  requireCondition(lesson || lessonNumber == null || lessonNumber === "", "La lección del recurso no existe.");
  requireCondition(lesson || !["friday-reading", "teacher-reading", "weekly-presentation", "weekly-attachment", "daily-audio"].includes(role),
    "Selecciona la lección del recurso.");
  if (lesson) next.lessonNumber = lesson.number;
  else delete next.lessonNumber;
  if (dayId) {
    requireCondition(lesson && dayIds.has(dayId), "Selecciona primero la lección y un día válido.");
    getDay(lesson, dayId);
    next.dayId = dayId;
  } else delete next.dayId;
  requireCondition(role !== "daily-audio" || next.dayId, "Selecciona el día del audio.");
  next.id = existing?.id ?? resourceId(quarter, role, title, next.lessonNumber, next.dayId);
  const credit = data.credit === undefined ? undefined : asString(data.credit, "El crédito", { max: 400, optional: true });
  if (data.asset) {
    const asset = asObject(data.asset, "El archivo");
    next.url = resourceTarget(quarter, next, asset);
    next.storage = "local";
    next.source = data.sourceUrl
      ? { ...approvedSource(quarter, data.sourceUrl), currentChecksum: asset.sha256 }
      : { kind: "manual", lastImportedChecksum: asset.sha256 };
    const attribution = credit ?? existing?.source?.credit;
    if (attribution) next.source.credit = attribution;
    if (type === "attachment") next.originalName = asString(asset.originalName ?? asset.name, "El nombre del adjunto", { max: 220 }).split(/[\\/]/).at(-1);
    else delete next.originalName;
    next.checksum = asset.sha256;
    next.sizeBytes = asset.sizeBytes;
    next.cmsManaged = true;
    delete next.external;
    delete next.translation;
  } else if (data.url === undefined || data.url === existing?.url) {
    requireCondition(existing, "Agrega un archivo o un enlace HTTPS para publicar el recurso.");
    requireCondition(existing.storage !== "local" || (
      type === existing.type && role === existing.role && next.lessonNumber === existing.lessonNumber && next.dayId === existing.dayId
    ), "Para cambiar el formato o la ubicación de un recurso local, elige su archivo.");
    if (credit !== undefined) next.source = { ...existing.source, credit };
  } else {
    const source = approvedSource(quarter, data.url);
    next.url = source.url;
    if (role === "complementary-book-reading") {
      requireCondition(/^https:\/\/drive\.google\.com\/file\/d\/[a-zA-Z0-9_-]+\/view$/.test(next.url),
        "Usa el enlace del PDF publicado en Google Drive.");
    }
    next.storage = "external";
    next.external = true;
    next.source = { ...source, ...(credit ? { credit } : {}) };
    delete next.cmsManaged;
    delete next.checksum;
    delete next.sizeBytes;
    delete next.translation;
    delete next.originalName;
  }
  requireCondition(next.storage !== "external" || type !== "article", "Carga el artículo como HTML para mostrarlo en el lector.");
  requireCondition(next.storage !== "external" || type !== "attachment", "Carga el adjunto para ofrecer una descarga segura.");
  const others = resourceList(quarter).filter(item => item.id !== next.id);
  requireCondition(!others.some(item => item.url === next.url), "Este enlace o archivo ya está registrado.");
  requireCondition(["general-reading", "general-attachment", "weekly-attachment"].includes(role) || !others.some(item => item.role === role
    && item.lessonNumber === next.lessonNumber && (role !== "daily-audio" || item.dayId === next.dayId)),
  "Ya existe un recurso con esa función en la lección o día.");
  if (collection) collection[collection.indexOf(existing)] = next;
  else (quarter.resources ??= []).push(next);
  refreshAudioSlot(quarter, existing);
  refreshAudioSlot(quarter, next);
}

function removeResource(quarter, id) {
  const { collection, resource } = getResource(quarter, id);
  requireCondition(resource, "El recurso seleccionado no existe.");
  collection.splice(collection.indexOf(resource), 1);
  refreshAudioSlot(quarter, resource);
}

export function resourceAssetUrls(snapshot) {
  return Object.values(snapshot.quarters).flatMap(resourceList)
    .filter(resource => resource.cmsManaged && resource.storage === "local")
    .map(resource => ({ url: resource.url, sha256: resource.checksum }));
}

export function localResourceUrls(snapshot) {
  return Object.values(snapshot.quarters).flatMap(resourceList)
    .filter(resource => resource.storage === "local")
    .map(resource => resource.url);
}

function updateNavigation(site, input) {
  const seenSections = new Set();
  const seenLinks = new Set();
  const navigation = asArray(input, 24, "La navegación").map(value => {
    const item = asObject(value, "La opción de navegación");
    const section = asOption(item.section, navSections, "La sección");
    const href = asLink(item.href, { name: "El destino" });
    requireCondition(!/^\/admin(?:[/?#]|$)/.test(href), "El menú público no puede apuntar a la administración.");
    requireCondition(!seenLinks.has(href) && (section === "custom" || !seenSections.has(section)),
      "Las opciones del menú deben tener destinos únicos.");
    seenLinks.add(href);
    seenSections.add(section);
    return {
      section, label: asString(item.label, "El nombre del enlace", { max: 45 }), href,
      ...(href.startsWith("https://") ? { external: true } : {}),
      ...(item.visible !== undefined ? { visible: asBoolean(item.visible, "Visibilidad") } : {}),
      ...(item.mobile !== undefined ? { mobile: asBoolean(item.mobile, "Visibilidad móvil") } : {}),
    };
  });
  requireCondition(navigation.some(item => item.section === "home" && item.visible !== false && item.href === "/"),
    "El menú necesita un enlace visible a Inicio (/).");
  site.navigation = navigation;
}

function updateWidgets(site, snapshot, input) {
  const ids = new Set();
  site.widgets = asArray(input, 24, "Los widgets").map(value => {
    const item = asObject(value, "El widget");
    const id = asString(item.id, "El identificador del widget", { max: 64 });
    requireCondition(/^[a-z0-9][a-z0-9-]*$/.test(id) && !ids.has(id), "Usa un identificador único para cada widget.");
    ids.add(id);
    const type = asOption(item.type, widgetTypes, "El tipo de widget");
    const result = {
      id, type, title: asString(item.title, "El título del widget"),
      enabled: item.enabled === undefined ? true : asBoolean(item.enabled, "Visibilidad"),
    };
    if (item.placement) result.placement = asOption(item.placement, ["sidebar"], "La ubicación");
    if (item.quarterId) result.quarterId = getQuarter(snapshot, item.quarterId).id;
    if (item.dayId) result.dayId = asOption(item.dayId, [...dayIds], "El día");
    if (type === "notice" || type === "link") {
      result.text = asString(item.text ?? "", "El texto del widget", { max: 1000, optional: type === "link" });
      if (type === "link") {
        result.href = asLink(item.href, { name: "El enlace del widget" });
        requireCondition(!/^\/admin(?:[/?#]|$)/.test(result.href), "El widget público no puede apuntar a la administración.");
      }
    }
    return result;
  });
}

function updateSite(snapshot, data) {
  const { site } = snapshot;
  if (Object.hasOwn(data, "navigation")) updateNavigation(site, data.navigation);
  if (Object.hasOwn(data, "theme")) {
    const theme = asObject(data.theme, "La apariencia");
    if (Object.hasOwn(theme, "palette")) site.theme.palette = asOption(theme.palette, palettes, "La paleta");
    if (Object.hasOwn(theme, "readingFont")) site.theme.readingFont = asOption(theme.readingFont, readingFonts, "La tipografía");
    if (Object.hasOwn(theme, "accent")) {
      requireCondition(typeof theme.accent === "string" && /^(?:#[\da-f]{6})?$/i.test(theme.accent), "Usa un color hexadecimal válido.");
      if (theme.accent) site.theme.accent = theme.accent.toLowerCase();
      else delete site.theme.accent;
    }
  }
  if (Object.hasOwn(data, "widgets")) updateWidgets(site, snapshot, data.widgets);
  if (Object.hasOwn(data, "seo")) {
    const seo = asObject(data.seo, "Los metadatos");
    cloneChangedText(site.seo, seo, { title: ["El nombre del sitio", 96], description: ["La descripción", 255, true] });
    if (Object.hasOwn(seo, "image")) site.seo.image = asLink(seo.image, { image: true, optional: true, name: "La imagen de portada social" });
  }
  if (Object.hasOwn(data, "footer")) {
    const footer = asObject(data.footer, "El pie de página");
    cloneChangedText(site.footer, footer, { brand: ["La marca", 100], credits: ["Los créditos", 180, true] });
    if (Object.hasOwn(footer, "links")) {
      site.footer.links = asArray(footer.links, 16, "Los enlaces destacados").map(value => {
        const link = asObject(value, "El enlace destacado");
        const href = asLink(link.href);
        requireCondition(!/^\/admin(?:[/?#]|$)/.test(href), "El enlace público no puede apuntar a la administración.");
        return {
          label: asString(link.label, "La etiqueta", { max: 60 }),
          description: asString(link.description ?? "", "La descripción", { max: 120, optional: true }),
          href,
          ...(link.iconUrl ? { iconUrl: asLink(link.iconUrl, { image: true }) } : {}),
        };
      });
    }
  }
}

export function applyChange(snapshot, action, input) {
  const data = asObject(input, "La edición");
  const next = structuredClone(snapshot);
  if (action === "year.create") {
    const year = asNumber(data.year, "El año", 1900, 2199);
    requireCondition(!next.years.includes(year), "Ya existe ese año.");
    addYear(next, year);
    return next;
  }
  if (action === "quarter.create") {
    createQuarter(next, data);
    return next;
  }
  if (action === "site.update") {
    updateSite(next, data);
    return next;
  }
  const quarter = getQuarter(next, data.quarterId);
  switch (action) {
    case "quarter.update": updateQuarter(quarter, data); break;
    case "quarter.status": updateQuarterStatus(next, quarter, data); break;
    case "lesson.update": {
      const lesson = getLesson(quarter, data.lessonId);
      cloneChangedText(lesson, data, {
        title: ["El título de la lección", 180], summary: ["El resumen", 8000, true], dateRange: ["El período", 120],
      });
      if (Object.hasOwn(data, "image")) {
        const image = asLink(data.image, { optional: true, image: true, name: "La imagen de la lección" });
        if (image) lesson.image = image;
        else delete lesson.image;
      }
      break;
    }
    case "day.update": {
      const lesson = getLesson(quarter, data.lessonId);
      updateDay(lesson, getDay(lesson, data.dayId), data);
      break;
    }
    case "reading.upsert": upsertReading(quarter, data); break;
    case "resource.upsert": upsertResource(quarter, data); break;
    case "resource.remove": removeResource(quarter, data.id); break;
    case "resource.host.allow": allowResourceHost(quarter, data.host); break;
    case "resource.index": {
      const type = asOption(data.type, ["audio", "ppt"], "El tipo de fuente");
      const url = asLink(data.url, { local: false, optional: true });
      const settings = quarter.resourceAutomation ??= { schemaVersion: 1, maxDownloadBytes: 50_000_000 };
      const sources = settings.sourceIndexes ??= {};
      if (url) {
        const host = new URL(url).hostname;
        allowResourceHost(quarter, host);
        if (host === "github.com") {
          allowResourceHost(quarter, "api.github.com");
          allowResourceHost(quarter, "raw.githubusercontent.com");
        }
        sources[type] = { url };
      } else {
        delete sources[type];
      }
      break;
    }
    default: throw new CatalogError("La acción solicitada no está disponible.");
  }
  return next;
}

function quarterIssues(quarter, status) {
  if (status === "draft") return [];
  const issues = [];
  if (!quarter.title?.trim() || !quarter.description?.trim() || !quarter.dateRange?.trim()) {
    issues.push(`${quarter.id}: completa el título, el período y la introducción del trimestre.`);
  }
  if (quarter.lessons.length < 13 || quarter.lessons.length > 14) {
    issues.push(`${quarter.id}: el trimestre debe tener 13 o 14 lecciones.`);
  }
  let previousDate;
  for (const lesson of quarter.lessons) {
    const label = `${quarter.id} · Lección ${lesson.number}`;
    if (!lesson.title?.trim() || /^Lección \d+$/i.test(lesson.title)) issues.push(`${label}: agrega un título.`);
    if (lesson.days.length !== 7 || lesson.days.some((day, index) => day.id !== days[index][0])) {
      issues.push(`${label}: deben existir los siete días de sábado a viernes.`);
    }
    const missing = lesson.days.filter(day => !day.title?.trim() || !day.contentMarkdown?.trim()).map(day => day.dayName);
    if (missing.length) issues.push(`${label}: falta contenido en ${missing.join(", ")}.`);
    for (const day of lesson.days) {
      const date = timestampFor(day.date);
      if (!Number.isFinite(date) || (previousDate !== undefined && date !== previousDate + 86_400_000)) {
        issues.push(`${label}: revisa la continuidad de la fecha de ${day.dayName}.`);
      }
      previousDate = Number.isFinite(date) ? date : undefined;
    }
    const friday = lesson.days.find(day => day.id === "viernes");
    if (friday?.fridayReadingAnchor && !friday.contentMarkdown?.split("\n").includes(friday.fridayReadingAnchor)) {
      issues.push(`${label}: la invitación a la lectura del viernes debe coincidir con una línea del texto.`);
    }
  }
  return issues;
}

export function publicationIssues(snapshot) {
  const { registry, quarters } = snapshot;
  const issues = [];
  const active = registry.quarters.find(entry => entry.catalog === registry.activeCatalog);
  if (!active || active.status !== "published") issues.push("Debe haber un trimestre activo publicado.");
  const legacy = registry.quarters.find(entry => entry.id === registry.legacyQuarterId);
  if (!legacy || legacy.status === "draft") issues.push("El trimestre histórico debe seguir disponible para los enlaces existentes.");
  for (const entry of registry.quarters) {
    if (!quarters[entry.id]) issues.push(`${entry.id}: falta su catálogo.`);
    else issues.push(...quarterIssues(quarters[entry.id], entry.status));
  }
  return issues;
}
