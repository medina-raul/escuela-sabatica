import {
  actionLink, area, bindForm, button, card, checkbox, el, empty, field, input,
  readingPreview, referencesList, select, setFeedback, status, table, confirmDialog,
} from "./dom.mjs";

export function catalogQuarters(ctx) {
  const registry = ctx.draft.snapshot.registry;
  return Object.values(ctx.draft.snapshot.quarters ?? {}).map(quarter => ({
    quarter, entry: registry.quarters?.find(item => item.id === quarter.id),
  })).sort((a, b) => b.quarter.year - a.quarter.year || b.quarter.quarterNumber - a.quarter.quarterNumber);
}

export function quarterLabel(quarter) {
  return String(quarter.year) + " Q" + quarter.quarterNumber + " · " + (quarter.title || "Sin título");
}

export function lessonLabel(lesson) {
  return "Lección " + lesson.number + (lesson.title ? " · " + lesson.title : "");
}

function selectedQuarter(ctx, quarters = catalogQuarters(ctx)) {
  const active = ctx.draft.snapshot.registry.activeCatalog;
  return quarters.find(({ quarter }) => quarter.id === ctx.selection.quarterId)
    ?? quarters.find(({ entry }) => entry && entry.catalog === active)
    ?? quarters[0];
}

export function catalogTarget(ctx, { lessons = true, days = false } = {}) {
  const quarters = catalogQuarters(ctx);
  const active = selectedQuarter(ctx, quarters);
  const qChoice = select("quarterId", quarters.map(({ quarter }) => [quarter.id, quarterLabel(quarter)]), active?.quarter.id);
  const lChoice = select("lessonId", [], "");
  const dChoice = select("dayId", [], "");
  function setOptions(control, rows, selected) {
    control.replaceChildren(...rows.map(([id, label]) => el("option", { value: id }, label)));
    control.value = rows.some(([id]) => id === selected) ? selected : rows[0]?.[0] ?? "";
  }
  function updateDays() {
    const quarter = ctx.draft.snapshot.quarters[qChoice.value];
    const lesson = quarter?.lessons?.find(item => item.id === lChoice.value);
    setOptions(dChoice, (lesson?.days ?? []).map(day => [day.id, day.dayName ?? day.id]), ctx.selection.dayId);
  }
  function updateLessons() {
    const quarter = ctx.draft.snapshot.quarters[qChoice.value];
    setOptions(lChoice, (quarter?.lessons ?? []).map(lesson => [lesson.id, lessonLabel(lesson)]), ctx.selection.lessonId);
    updateDays();
  }
  qChoice.addEventListener("change", updateLessons);
  lChoice.addEventListener("change", updateDays);
  updateLessons();
  const node = el("div", { class: lessons && days ? "selector" : "selector-2" },
    field("Trimestre", qChoice), lessons ? field("Lección", lChoice) : null,
    days ? field("Día", dChoice) : null);
  return { node, quarter: qChoice, lesson: lChoice, day: dChoice, updateLessons, updateDays };
}

export function calendarView(ctx) {
  const { snapshot } = ctx.draft;
  const quarters = catalogQuarters(ctx);
  const allYears = [...new Set([...snapshot.years ?? [], ...quarters.map(({ quarter }) => quarter.year)])].sort((a, b) => b - a);
  const active = selectedQuarter(ctx, quarters);
  const quarter = active?.quarter;
  const name = quarter ? quarterLabel(quarter) : null;
  const yearRows = allYears.map(year => {
    const within = quarters.filter(({ quarter }) => quarter.year === year);
    const chips = within.length
      ? within.map(({ quarter: q, entry }) => el("li", { class: "row row-between" },
        el("span", {}, "Trimestre " + q.quarterNumber + " · " + (q.title || "Sin título")),
        el("div", { class: "row" },
          status(entry?.status, entry?.catalog === snapshot.registry.activeCatalog ? "Trimestre activo" : undefined),
          button("Abrir", { appearance: "secondary small", onClick: () => {
            ctx.selection.quarterId = q.id;
            ctx.render();
          } }))))
      : [el("li", { class: "muted" }, "Sin trimestres")];
    return el("details", { class: "disclosure", open: year === quarter?.year || year === ctx.selection.year },
      el("summary", {}, year + " · " + within.length + (within.length === 1 ? " trimestre" : " trimestres")),
      el("ul", { class: "list" }, chips));
  });
  const list = card("Calendario", yearRows.length ? yearRows : empty("Crea un año para comenzar."));
  const right = quarter ? quarterDetails(ctx, quarter, active.entry, name) : null;
  const body = el("div", { class: "stack" },
    el("div", { class: "grid-2" }, el("div", { class: "stack" }, list, ctx.canEdit ? yearForm(ctx) : null), right),
    ctx.canEdit && allYears.length ? quarterForm(ctx, allYears, quarters, quarter?.year) : null);
  return ctx.page("Años y trimestres", "Prepara el calendario, completa el contenido y elige el trimestre activo.", body);
}

function yearForm(ctx) {
  const form = bindForm(el("form", { class: "stack-compact" },
    field("Año", input("year", "", { type: "number", min: 1900, max: 2200, required: true, placeholder: "2027" })),
    button("Agregar año", { type: "submit", lead: "plus" })),
  data => ctx.change("year.create", { year: Number(data.get("year")) }, "Año agregado al calendario.",
    { selection: { year: Number(data.get("year")) } }));
  return card("Nuevo año", form);
}

function quarterForm(ctx, years, quarters, defaultYear) {
  const yearChoice = select("year", years, ctx.selection.year ?? defaultYear ?? years[0], { required: true });
  const periodChoice = select("quarterNumber", [[1, "1 · Enero a marzo"], [2, "2 · Abril a junio"], [3, "3 · Julio a septiembre"], [4, "4 · Octubre a diciembre"]], 1);
  const template = select("templateId", [["", "En blanco"], ...quarters.map(({ quarter }) => [quarter.id, quarterLabel(quarter)])]);
  const lessonCount = select("lessonCount", [[13, "13 lecciones"], [14, "14 lecciones"]], 13);
  const countField = field("Estructura", lessonCount);
  const start = input("startDate", "", { type: "date", required: true });
  const suggestStart = () => {
    const first = new Date(Date.UTC(Number(yearChoice.value), (Number(periodChoice.value) - 1) * 3, 1));
    first.setUTCDate(1 - ((first.getUTCDay() + 1) % 7));
    start.value = first.toISOString().slice(0, 10);
  };
  yearChoice.addEventListener("change", suggestStart);
  periodChoice.addEventListener("change", suggestStart);
  template.addEventListener("change", () => { countField.hidden = Boolean(template.value); });
  suggestStart();
  const form = bindForm(el("form", { class: "stack-compact" },
    el("div", { class: "form-grid" },
      field("Año", yearChoice), field("Trimestre", periodChoice),
      field("Título", input("title", "", { required: true, maxlength: 160 })),
      field("Sábado de inicio", start,
        { help: "Fecha de la primera lectura. Puede caer en el mes anterior." }),
      field("Estructura de otro trimestre", template, { help: "Reutiliza la cantidad de lecciones." }), countField),
    button("Crear trimestre", { type: "submit", lead: "plus" })),
  data => {
    const year = Number(data.get("year"));
    const quarterNumber = Number(data.get("quarterNumber"));
    return ctx.change("quarter.create", {
      year, quarterNumber, title: data.get("title"), startDate: data.get("startDate"),
      templateId: data.get("templateId") || undefined, lessonCount: Number(data.get("lessonCount")),
    }, "Trimestre creado en el borrador.", { selection: { year, quarterId: year + "-q" + quarterNumber } });
  });
  return card("Nuevo trimestre", form);
}

function quarterDetails(ctx, quarter, entry, name) {
  const { introduction: intro = {} } = quarter;
  const disabled = !ctx.canEdit;
  const details = el("div", { class: "form-grid" },
    field("Título", input("title", quarter.title, { disabled, required: true, maxlength: 160 })),
    field("Subtítulo", input("subtitle", quarter.subtitle, { disabled })),
    field("Rango visible", input("dateRange", quarter.dateRange, { disabled, placeholder: "Octubre a diciembre 2026" })),
    field("Portada", input("coverImage", quarter.coverImage, { disabled, placeholder: "/images/portada.jpg" })),
    field("Descripción", area("description", quarter.description, { disabled, rows: "3" }), { wide: true }),
    field("Autor de la introducción", input("author", intro.author, { disabled })),
    field("Subtítulo de la introducción", input("introSubtitle", intro.subtitle, { disabled })),
    field("Video de introducción", input("videoUrl", intro.videoUrl, { disabled })),
    field("Pie del video", input("videoCaption", intro.videoCaption, { disabled })));
  const form = el("form", { class: "stack-compact" }, details);
  if (ctx.canEdit) {
    form.append(button("Guardar trimestre", { type: "submit" }));
    bindForm(form, data => ctx.change("quarter.update", {
      quarterId: quarter.id, title: data.get("title"), subtitle: data.get("subtitle"),
      description: data.get("description"), dateRange: data.get("dateRange"), coverImage: data.get("coverImage"),
      introduction: {
        author: data.get("author"), subtitle: data.get("introSubtitle"),
        videoUrl: data.get("videoUrl"), videoCaption: data.get("videoCaption"),
      },
    }, "Trimestre guardado."));
  }
  const isActive = entry?.catalog === ctx.draft.snapshot.registry.activeCatalog;
  const states = [["draft", "Borrador"], ["published", "Publicado"], ["archived", "Archivado"]];
  const legalStates = isActive ? states.slice(1, 2) : entry?.status === "draft" ? states : states.slice(1);
  const visibility = select("status", legalStates, entry?.status ?? "draft");
  const activate = checkbox("active", "Usar como trimestre activo", isActive, { disabled: isActive });
  const activeInput = activate.querySelector("input");
  activeInput.addEventListener("change", () => { if (activeInput.checked) visibility.value = "published"; });
  visibility.addEventListener("change", () => { if (visibility.value !== "published") activeInput.checked = false; });
  const statusForm = ctx.canEdit ? bindForm(el("form", { class: "stack-compact" },
    field("Estado en el sitio", visibility), activate,
    button("Guardar estado", { appearance: "secondary", type: "submit" })),
  data => ctx.change("quarter.status", {
    quarterId: quarter.id, status: data.get("status"), active: isActive || data.has("active"),
  }, "Estado actualizado en el borrador.")) : null;
  return card(name, el("div", { class: "stack" }, form, statusForm),
    { caption: String(quarter.lessons?.length ?? 0) + " lecciones", action: actionLink("Lecciones", "#lecciones", "small secondary") });
}

function dayText(day) {
  if (typeof day.contentMarkdown === "string") return day.contentMarkdown;
  return (day.contentBlocks ?? []).map(block => {
    if (block.type === "heading") return "### " + block.text;
    if (block.type === "quote") return "> " + block.text;
    if (block.type === "bible-reference") return block.reference?.display ?? "";
    if (block.type === "image") return block.alt ?? "";
    return block.text ?? "";
  }).filter(Boolean).join("\n\n");
}

export function lessonView(ctx) {
  const target = catalogTarget(ctx, { lessons: true });
  const quarter = ctx.draft.snapshot.quarters[target.quarter.value];
  const lesson = quarter?.lessons?.find(item => item.id === target.lesson.value);
  const days = lesson?.days ?? [];
  const activeDay = days.find(item => item.id === ctx.selection.dayId) ?? days[0];
  target.quarter.addEventListener("change", () => {
    ctx.selection.quarterId = target.quarter.value;
    ctx.selection.lessonId = target.lesson.value;
    ctx.render();
  });
  target.lesson.addEventListener("change", () => {
    ctx.selection.quarterId = target.quarter.value;
    ctx.selection.lessonId = target.lesson.value;
    ctx.render();
  });
  const tabs = el("div", { class: "day-tabs", role: "group", "aria-label": "Día de la lección" }, days.map(day =>
    el("button", { class: "day-tab", type: "button", "aria-pressed": day.id === activeDay?.id,
      onclick: () => {
        ctx.selection.dayId = day.id;
        ctx.render();
        document.querySelector(".day-tab[aria-pressed=true]")?.focus();
      },
    }, day.dayName ?? day.id)));
  const sections = el("div", { class: "stack" }, card("Seleccionar lección", [target.node, lesson ? el("div", { class: "stack-compact" }, tabs,
    lessonDetails(ctx, quarter, lesson)) : empty("Todavía no hay lecciones en este trimestre.")]),
    activeDay ? editDay(ctx, quarter, lesson, activeDay) : null);
  return ctx.page("Lecciones", "Edita el texto y revisa cómo se leerá cada día.", sections,
    ctx.canEdit ? actionLink("Importar contenido", "#importar") : null);
}

function lessonDetails(ctx, quarter, lesson) {
  const form = el("form", { class: "stack-compact" },
    el("div", { class: "form-grid" },
      field("Título de la lección", input("title", lesson.title, { disabled: !ctx.canEdit, required: true })),
      field("Rango de fechas", input("dateRange", lesson.dateRange, { disabled: !ctx.canEdit })),
      field("Resumen", area("summary", lesson.summary, { rows: "2", disabled: !ctx.canEdit }), { wide: true })),
    ctx.canEdit ? button("Guardar ficha", { type: "submit", appearance: "secondary small" }) : null);
  if (ctx.canEdit) bindForm(form, data => ctx.change("lesson.update", {
    quarterId: quarter.id, lessonId: lesson.id, title: data.get("title"),
    dateRange: data.get("dateRange"), summary: data.get("summary"),
  }, "Ficha de lección guardada."));
  return el("details", { class: "disclosure" }, el("summary", {}, "Ficha de la lección"), form);
}

function editDay(ctx, quarter, lesson, day) {
  const editable = ctx.canEdit;
  const content = area("contentMarkdown", dayText(day), { class: "editor-body", readonly: !editable, rows: "12" });
  const previewTitle = el("h3", {}, day.title || "Sin título");
  const preview = el("div", { class: "preview" }, previewTitle, readingPreview(content.value));
  const versePreview = el("div", { class: "preview", hidden: !day.keyVerse?.text },
    el("blockquote", {}, day.keyVerse?.text, day.keyVerse?.reference?.display ? " (" + day.keyVerse.reference.display + ")" : ""));
  const refs = el("div", { class: "stack-compact", "aria-live": "polite" },
    referencesList(day.studyReferences ?? []));
  const refsButton = button("Detectar referencias", { appearance: "secondary small", lead: "eye" });
  refsButton.addEventListener("click", async () => {
    refsButton.disabled = true;
    try {
      const response = await ctx.request("references", { method: "POST", data: { text: content.value } });
      if (refs.isConnected) refs.replaceChildren(referencesList(response.references));
    } catch (error) {
      if (refs.isConnected) setFeedback(refs, error);
    } finally {
      refsButton.disabled = false;
    }
  });
  const title = input("title", day.title, { readonly: !editable, required: true });
  const verseRef = input("keyVerseReference", day.keyVerse?.reference?.display, { readonly: !editable, placeholder: "Juan 3:16" });
  const verseText = area("keyVerseText", day.keyVerse?.text, { readonly: !editable, rows: "3" });
  const updateReading = () => {
    previewTitle.textContent = title.value.trim() || "Sin título";
    preview.replaceChildren(previewTitle, ...readingPreview(content.value));
    versePreview.hidden = !verseText.value.trim();
    versePreview.replaceChildren(el("blockquote", {}, verseText.value, verseRef.value ? " (" + verseRef.value + ")" : ""));
  };
  let timer;
  for (const control of [title, content, verseText, verseRef]) {
    control.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(updateReading, 180);
    });
  }
  const form = el("form", { class: "stack-compact" },
    el("div", { class: "form-grid" },
      field("Título del día", title), field("Fecha", input("date", day.date, { type: "date", readonly: !editable })),
      field("Referencia del versículo clave", verseRef),
      field("Texto del versículo clave", verseText, { wide: true })),
    field("Lectura", content, { help: "Acepta títulos, énfasis, citas y listas en Markdown." }),
    editable ? button("Guardar lectura", { type: "submit" }) : null);
  if (editable) bindForm(form, data => ctx.change("day.update", {
    quarterId: quarter.id, lessonId: lesson.id, dayId: day.id,
    title: data.get("title"), date: data.get("date"),
    keyVerseText: data.get("keyVerseText"), keyVerseReference: data.get("keyVerseReference"),
    contentMarkdown: data.get("contentMarkdown"),
  }, "Lectura guardada.", { selection: { quarterId: quarter.id, lessonId: lesson.id, dayId: day.id } }));
  const origin = day.contentSource;
  const provenance = origin ? el("div", { class: "notice wrap small" },
    "Origen: ", origin.name ?? origin.file ?? origin.originUrl ?? origin.url ?? origin.kind ?? "archivo importado",
    origin.location ? " · " + origin.location : "") : null;
  return el("div", { class: "editor-grid" },
    card(day.dayName ?? day.id, form, { caption: lessonLabel(lesson) }),
    el("div", { class: "stack" },
      card("Vista de lectura", el("div", { class: "stack-compact" }, versePreview, preview, provenance)),
      card("Referencias bíblicas", refs, { action: refsButton })));
}

const resourceTypes = [["audio", "Audio"], ["ppt", "Presentación"], ["pdf", "PDF"], ["article", "Artículo HTML"],
  ["video", "Video"], ["guide", "Guía"], ["commentary", "Comentario"], ["attachment", "Adjunto · descarga"]];
const resourceRoles = [["general-reading", "Material general"], ["daily-audio", "Audio del día"],
  ["weekly-presentation", "Presentación semanal"], ["friday-reading", "Lectura del viernes"],
  ["teacher-reading", "Material para maestros"], ["complementary-book-reading", "Libro complementario"],
  ["general-attachment", "Adjunto en la biblioteca"],
  ["weekly-attachment", "Adjunto de la semana"]];
const dayNames = [["sabado", "Sábado"], ["domingo", "Domingo"], ["lunes", "Lunes"], ["martes", "Martes"],
  ["miercoles", "Miércoles"], ["jueves", "Jueves"], ["viernes", "Viernes"]];
const bookNames = [
  "Génesis", "Éxodo", "Levítico", "Números", "Deuteronomio", "Josué", "Jueces", "Rut", "1 Samuel", "2 Samuel",
  "1 Reyes", "2 Reyes", "1 Crónicas", "2 Crónicas", "Esdras", "Nehemías", "Ester", "Job", "Salmos", "Proverbios",
  "Eclesiastés", "Cantares", "Isaías", "Jeremías", "Lamentaciones", "Ezequiel", "Daniel", "Oseas", "Joel", "Amós",
  "Abdías", "Jonás", "Miqueas", "Nahúm", "Habacuc", "Sofonías", "Hageo", "Zacarías", "Malaquías", "Mateo",
  "Marcos", "Lucas", "Juan", "Hechos", "Romanos", "1 Corintios", "2 Corintios", "Gálatas", "Efesios", "Filipenses",
  "Colosenses", "1 Tesalonicenses", "2 Tesalonicenses", "1 Timoteo", "2 Timoteo", "Tito", "Filemón", "Hebreos",
  "Santiago", "1 Pedro", "2 Pedro", "1 Juan", "2 Juan", "3 Juan", "Judas", "Apocalipsis",
];
const labelFrom = (items, value) => items.find(([id]) => id === value)?.[1] ?? value;

function quarterResources(quarter) {
  const resources = new Map();
  function collect(items, fallbackLesson, fallbackDay) {
    for (const item of items ?? []) {
      resources.set(item.id, { ...item, lessonNumber: item.lessonNumber ?? fallbackLesson, dayId: item.dayId ?? fallbackDay });
    }
  }
  collect(quarter.resources);
  for (const lesson of quarter.lessons ?? []) {
    collect(lesson.resources, lesson.number);
    for (const day of lesson.days ?? []) collect(day.resources, lesson.number, day.id);
  }
  return [...resources.values()];
}

export function resourcesView(ctx) {
  const target = catalogTarget(ctx, { lessons: false });
  const quarter = ctx.draft.snapshot.quarters[target.quarter.value];
  target.quarter.addEventListener("change", () => {
    ctx.selection.quarterId = target.quarter.value;
    ctx.selection.resourceId = "";
    ctx.selection.resourceNew = null;
    ctx.selection.readingDate = "";
    ctx.render();
  });
  const working = quarter ? [
    resourcesTable(ctx, quarter),
    pendingMaterials(ctx, quarter),
    ctx.canEdit ? resourceForm(ctx, quarter) : null,
    readings(ctx, quarter),
  ] : empty("Crea un trimestre para organizar los recursos.");
  return ctx.page("Biblioteca y lecturas", "Organiza recursos por trimestre, lección y día.", el("div", { class: "stack" },
    card("Trimestre", target.node), working));
}

function resourcesTable(ctx, quarter) {
  const list = quarterResources(quarter);
  const filter = select("filter", [["", "Todos los tipos"], ...resourceTypes], ctx.selection.resourceFilter ?? "");
  filter.addEventListener("change", () => {
    ctx.selection.quarterId = quarter.id;
    ctx.selection.resourceFilter = filter.value;
    ctx.render();
    document.querySelector("select[name=filter]")?.focus();
  });
  const rows = list.filter(item => !filter.value || item.type === filter.value)
    .map(item => [
      item.title,
      labelFrom(resourceTypes, item.type),
      labelFrom(resourceRoles, item.role),
      item.lessonNumber ? [item.lessonNumber, item.dayId ? " · " + labelFrom(dayNames, item.dayId) : ""] : "Trimestre",
      !item.url || item.url === "#" ? status("pending") : status("ready", "Disponible"),
      ctx.canEdit ? button("Editar", { appearance: "small secondary", onClick: () => {
        ctx.selection.resourceId = item.id;
        ctx.selection.quarterId = quarter.id;
        ctx.render();
        document.getElementById("resource-editor")?.scrollIntoView({ block: "start" });
      } }) : "—",
    ]);
  return card("Recursos", el("div", { class: "stack-compact" },
    el("div", { class: "row row-between" },
      field("Filtro", filter),
      ctx.canEdit ? button("Nuevo recurso", { appearance: "secondary", lead: "plus", onClick: () => {
        ctx.selection.resourceId = "";
        ctx.selection.resourceNew = null;
        ctx.render();
        document.getElementById("resource-editor")?.scrollIntoView({ block: "start" });
      } }) : null),
    rows.length ? table(["Título", "Tipo", "Función", "Asignación", "Estado", ""], rows, { label: "Recursos del trimestre" }) : empty("No hay recursos para este filtro.")),
  { caption: "Los audios y las presentaciones pueden quedar pendientes." });
}

function pendingMaterials(ctx, quarter) {
  const available = quarterResources(quarter).filter(resource => resource.url && resource.url !== "#");
  const linked = new Set(available.map(resource => [resource.role, resource.lessonNumber, resource.dayId ?? ""].join("/")));
  const groups = [];
  const viewSlot = (item, title) => el("li", { class: "row row-between" },
    el("span", {}, title), el("div", { class: "row" }, status("pending"),
      ctx.canEdit ? button("Completar", { appearance: "secondary small", onClick: () => {
        ctx.selection.resourceId = "";
        ctx.selection.resourceNew = { ...item, title };
        ctx.render();
        document.getElementById("resource-editor")?.scrollIntoView({ block: "start" });
      } }) : null));
  for (const lesson of quarter.lessons ?? []) {
    const rows = [];
    if (!linked.has("weekly-presentation/" + lesson.number + "/")) {
      rows.push(viewSlot({ lessonNumber: lesson.number, role: "weekly-presentation", type: "ppt" }, "Presentación · Lección " + lesson.number));
    }
    for (const day of lesson.days ?? []) {
      if ((!day.audio?.url || day.audio.url === "#") && !linked.has("daily-audio/" + lesson.number + "/" + day.id)) {
        rows.push(viewSlot({ lessonNumber: lesson.number, dayId: day.id, role: "daily-audio", type: "audio" },
          "Audio · " + (day.dayName ?? day.id) + " · Lección " + lesson.number));
      }
    }
    if (rows.length) groups.push(el("details", { class: "disclosure" },
      el("summary", {}, "Lección " + lesson.number + " · " + rows.length + (rows.length === 1 ? " pendiente" : " pendientes")),
      el("ul", { class: "list" }, rows)));
  }
  return card("Materiales pendientes", groups.length ? el("div", {}, groups) : empty("Todos los espacios de audio y PPT tienen material."),
    { caption: "Las lecciones pueden publicarse con estos espacios pendientes." });
}

function resourceForm(ctx, quarter) {
  const selected = quarterResources(quarter).find(resource => resource.id === ctx.selection.resourceId);
  const resource = selected ?? ctx.selection.resourceNew ?? {};
  const title = selected ? "Editar recurso" : "Nuevo recurso";
  const roleSelect = select("role", resourceRoles, resource.role ?? resourceRoles[0][0]);
  const typeSelect = select("type", resourceTypes, resource.type ?? "pdf");
  const lSelect = select("lessonNumber", [["", "Trimestre completo"], ...(quarter.lessons ?? []).map(item => [item.number, lessonLabel(item)])],
    resource.lessonNumber ?? "");
  const dSelect = select("dayId", [["", "Sin día asignado"], ...dayNames], resource.dayId ?? "");
  const upload = input("file", "", { type: "file" });
  const url = input("url", resource.url === "#" ? "" : resource.url, { placeholder: "https://…" });
  const articleText = area("article", "", { rows: "3" });
  const articleField = field("O redactar el artículo", articleText, { wide: true, help: "Se acepta texto o Markdown." });
  const sync = () => {
    lSelect.required = !["general-reading", "general-attachment", "complementary-book-reading"].includes(roleSelect.value);
    dSelect.required = roleSelect.value === "daily-audio";
    articleField.hidden = typeSelect.value !== "article";
    articleText.disabled = articleField.hidden;
    const accept = { audio: ".mp3", ppt: ".pptx", pdf: ".pdf", article: ".html,.htm,.md,.markdown,.txt" }[typeSelect.value];
    if (accept) upload.setAttribute("accept", accept);
    else upload.removeAttribute("accept");
  };
  roleSelect.addEventListener("change", () => {
    if (roleSelect.value === "daily-audio") typeSelect.value = "audio";
    if (roleSelect.value === "weekly-presentation") typeSelect.value = "ppt";
    if (["general-attachment", "weekly-attachment"].includes(roleSelect.value)) typeSelect.value = "attachment";
    if (["friday-reading", "teacher-reading", "complementary-book-reading"].includes(roleSelect.value)) typeSelect.value = "article";
    sync();
  });
  typeSelect.addEventListener("change", () => {
    if (typeSelect.value === "attachment" && !["weekly-attachment", "general-attachment"].includes(roleSelect.value)) roleSelect.value = "general-attachment";
    if (typeSelect.value === "audio") roleSelect.value = "daily-audio";
    if (typeSelect.value === "ppt") roleSelect.value = "weekly-presentation";
    if (!["attachment", "audio", "ppt"].includes(typeSelect.value) && ["weekly-attachment", "general-attachment", "weekly-presentation", "daily-audio"].includes(roleSelect.value)) roleSelect.value = "general-reading";
    sync();
  });
  sync();
  const form = bindForm(el("form", { class: "stack-compact" },
    el("div", { class: "form-grid" },
      field("Título", input("title", resource.title, { required: true, maxlength: 180 })),
      field("Crédito o atribución", input("credit", resource.source?.credit ?? resource.source?.provider ?? "", { maxlength: 180 })),
      field("Función", roleSelect), field("Tipo", typeSelect),
      field("Lección", lSelect), field("Día", dSelect),
      field("Dirección del recurso", url, { help: "Pega el enlace HTTPS al archivo. Para un dominio nuevo, consulta Fuentes y horarios." }),
      field("O cargar archivo", upload),
      articleField,
      field("Descripción", area("description", resource.description, { rows: "2" }), { wide: true })),
    el("div", { class: "row" },
      button("Guardar recurso", { type: "submit" }),
      selected ? removalButton(ctx, quarter, resource) : null)),
  async data => {
    const file = data.get("file");
    const article = String(data.get("article") ?? "").trim();
    const hasFile = file instanceof File && file.size > 0;
    let assetId;
    if (hasFile && article) throw new Error("Elige un archivo o un artículo redactado para este recurso.");
    if (hasFile || article) {
      const uploadData = new FormData();
      if (article) {
        uploadData.append("article", article);
        uploadData.append("name", "articulo.md");
      } else {
        uploadData.append("file", file);
        if (typeSelect.value === "attachment") uploadData.append("asAttachment", "true");
        if (typeSelect.value === "article") uploadData.append("asArticle", "true");
      }
      const response = await ctx.draftRequest("assets", { method: "POST", data: uploadData });
      assetId = response.asset.id;
    }
    const address = assetId ? "" : data.get("url")?.trim() ?? "";
    if (!address && !assetId) throw new Error("Agrega un archivo, una URL o una ruta pública. Si el material semanal aún no existe, su espacio seguirá pendiente.");
    return ctx.change("resource.upsert", {
      quarterId: quarter.id, id: resource.id, type: data.get("type"), role: data.get("role"),
      title: data.get("title"), description: data.get("description"), credit: data.get("credit"),
      url: address, assetId,
      lessonNumber: data.get("lessonNumber") ? Number(data.get("lessonNumber")) : null,
      dayId: data.get("dayId") || null,
    }, "Recurso guardado.", { selection: { resourceNew: null } });
  });
  const section = card(title, form, { caption: resource.id });
  section.id = "resource-editor";
  return section;
}

function removalButton(ctx, quarter, resource) {
  const optional = ["daily-audio", "weekly-presentation"].includes(resource.role);
  const label = optional ? "Dejar pendiente" : "Eliminar recurso";
  return button(label, { appearance: "danger", onClick: async event => {
    const control = event.currentTarget;
    if (!await confirmDialog(label, "Se quitará «" + resource.title + "» de este borrador.", label)) return;
    control.disabled = true;
    try {
      await ctx.change("resource.remove", { quarterId: quarter.id, id: resource.id },
        "Recurso eliminado del borrador.", { selection: { resourceId: "" } });
    } catch (error) {
      ctx.notify(error.message, "error");
    } finally {
      control.disabled = false;
    }
  } });
}

function readings(ctx, quarter) {
  const readings = quarter.reavivados ?? [];
  const selected = readings.find(item => item.date === ctx.selection.readingDate);
  const rows = readings.slice().sort((a, b) => a.date.localeCompare(b.date)).map(item =>
    [item.date, item.reading, ctx.canEdit ? button("Editar", { appearance: "small secondary", onClick: () => {
      ctx.selection.readingDate = item.date;
      ctx.render();
      document.getElementById("reading-editor")?.scrollIntoView({ block: "start" });
    } }) : "—"]);
  const form = ctx.canEdit ? bindForm(el("form", { class: "stack-compact", id: "reading-editor" },
    el("div", { class: "form-grid" },
      field("Fecha", input("date", selected?.date, { type: "date", required: true })),
      field("Lectura", input("reading", selected?.reading, { placeholder: "Ej. Salmos 23", required: true })),
      field("Libro", select("bookId", [["", "Sin enlace bíblico"], ...bookNames.map((book, i) => [i + 1, book])],
        selected?.bookId ?? "")),
      field("Capítulo", input("chapter", selected?.chapter, { type: "number", min: 1, max: 150 }))),
    el("div", { class: "row" }, button("Guardar lectura extra", { type: "submit", appearance: "secondary" }),
      selected ? button("Nueva lectura", { appearance: "quiet", onClick: () => {
        ctx.selection.readingDate = "";
        ctx.render();
      } }) : null)),
  data => ctx.change("reading.upsert", {
    quarterId: quarter.id, date: data.get("date"), reading: data.get("reading"),
    bookId: data.get("bookId") ? Number(data.get("bookId")) : undefined,
    chapter: data.get("chapter") ? Number(data.get("chapter")) : undefined,
  }, "Lectura extra guardada.")) : null;
  return card("Lecturas extra · Reavivados", el("div", { class: "stack" }, form,
    readings.length ? el("details", { class: "disclosure" }, el("summary", {}, "Lecturas registradas (" + readings.length + ")"),
      table(["Fecha", "Lectura", ""], rows, { label: "Lecturas de Reavivados" })) : empty("Sin lecturas extra registradas en este trimestre.")));
}
