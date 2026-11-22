import {
  actionLink, area, bindForm, button, card, checkbox, el, empty, feedback, field, formattedDate, input,
  readingPreview, referencesList, roleLabel, select, setFeedback, status, table,
} from "./dom.mjs";
import { catalogTarget, lessonLabel, quarterLabel } from "./views-content.mjs";

const samePath = value => typeof value === "string" && value.startsWith("/admin/") && !value.startsWith("//") && !value.includes("\\") ? value : "";
const busyJobs = new Set(["queued", "running", "processing", "building"]);
const changedStates = { changed: "Cambios detectados", unchanged: "Sin cambios", skipped: "Omitido", available: "Disponible" };

function jobStatus(value) {
  return status(value, changedStates[value]);
}

function messageButton(label, handler, { appearance = "secondary", ...options } = {}) {
  return button(label, {
    appearance, ...options, onClick: async event => {
      const control = event.currentTarget;
      control.disabled = true;
      try {
        await handler();
      } catch (error) {
        const errors = document.querySelector(".flash");
        if (errors) setFeedback(errors, error);
      } finally {
        control.disabled = false;
      }
    },
  });
}

export function importView(ctx) {
  const jobs = el("div", { class: "stack-compact", "aria-live": "polite" }, el("p", { class: "muted" }, "Cargando importaciones…"));
  const detail = el("div", { class: "stack" });
  let refreshTimer;
  let detailRequest = 0;
  let activeJobId = ctx.selection.jobId;
  const setJob = async id => {
    activeJobId = id;
    ctx.selection.jobId = id;
    const attempt = ++detailRequest;
    detail.replaceChildren(el("p", { class: "muted" }, "Cargando material…"));
    try {
      const { job } = await ctx.draftRequest("import/" + encodeURIComponent(id));
      if (!detail.isConnected || detailRequest !== attempt) return;
      detail.replaceChildren(importDetail(ctx, job));
    } catch (error) {
      if (detail.isConnected && detailRequest === attempt) setFeedback(detail, error);
    }
  };
  async function loadJobs() {
    clearTimeout(refreshTimer);
    try {
      const { jobs: items = [] } = await ctx.draftRequest("import");
      if (!jobs.isConnected) return;
      jobs.replaceChildren(items.length ? el("ul", { class: "list" }, items.map(job => {
        const name = job.name || job.title || job.items?.map(item => item.name).filter(Boolean).join(", ") || "Importación";
        return el("li", { class: "row row-between" },
          el("div", { class: "item-text" }, el("strong", {}, name),
            el("span", { class: "muted small" }, formattedDate(job.createdAt))),
          el("div", { class: "row" }, jobStatus(job.status),
            ctx.canEdit && ["partial", "failed"].includes(job.status) && job.items.some(item => item.hasOriginal && item.status === "failed")
              ? messageButton("Reintentar", async () => {
                const { job: retry } = await ctx.draftRequest("import/" + encodeURIComponent(job.id) + "/retry", { method: "POST" });
                await setJob(retry.id);
                await loadJobs();
              }, { appearance: "secondary small" }) : null,
            button("Abrir", { appearance: "secondary small", onClick: () => setJob(job.id) })));
      })) : empty("Aún no hay fuentes importadas en este borrador."));
      const active = items.find(job => job.id === activeJobId);
      if (active && detail.dataset.lastStatus !== active.status) {
        detail.dataset.lastStatus = active.status;
        await setJob(active.id);
      }
      if (items.some(job => busyJobs.has(job.status))) {
        refreshTimer = setTimeout(() => { if (jobs.isConnected) void loadJobs(); }, 3500);
      }
    } catch (error) {
      if (jobs.isConnected) setFeedback(jobs, error);
    }
  }
  const content = el("div", { class: "stack" },
    ctx.canEdit ? newImport(ctx, async (job, selection) => {
      if (selection) Object.assign(ctx.selection, selection);
      await setJob(job.id);
      await loadJobs();
    }) : null,
    card("Cola de importación", jobs, {
      action: messageButton("Actualizar", loadJobs, { appearance: "secondary small" }),
    }),
    detail);
  queueMicrotask(loadJobs);
  return ctx.page("Importar contenido", "Carga archivos, enlaces o texto y confirma qué fragmentos van a cada día.", content);
}

function newImport(ctx, onJob) {
  const fields = el("div", { class: "stack-compact" },
    field("Archivos PDF, HTML y Markdown", input("files", "", {
      type: "file", multiple: true, accept: ".pdf,.html,.htm,.md,.markdown,.txt",
    }), { help: "Puedes combinar formatos en un solo trabajo." }),
    field("URL de origen", area("urls", "", { rows: "2", placeholder: "Un enlace HTTPS por línea" }),
      { help: ctx.capabilities.browser ? "Si la página limita el acceso, sube el archivo guardado en tu equipo."
        : "Se detecta el contenido. Para habilitar un dominio, usa Fuentes y horarios." }),
    field("Texto o Markdown pegado", area("text", "", { rows: "3" })));
  const form = bindForm(el("form", { class: "stack", enctype: "multipart/form-data" },
    el("div", { class: "file-box" }, fields),
    el("div", { class: "row" }, button("Analizar fuentes", { type: "submit", lead: "import" }),
      el("span", { class: "muted small" }, "Los originales quedan guardados en privado."))),
  async (data, messages) => {
    const files = data.getAll("files").filter(file => file instanceof File && file.size > 0);
    const urls = String(data.get("urls") ?? "").trim();
    const text = String(data.get("text") ?? "").trim();
    if (!files.length && !urls && !text) throw new Error("Agrega al menos un archivo, un enlace o texto.");
    const payload = new FormData();
    for (const file of files) payload.append("files", file);
    if (urls) payload.set("urls", urls);
    if (text) payload.set("text", text);
    payload.set("kind", "auto");
    messages.replaceChildren(feedback(ctx.capabilities.browser ? "Analizando las fuentes. Un PDF escaneado puede tardar varios minutos…" : "Registrando las fuentes…"));
    const { job } = await ctx.draftRequest("import", { method: "POST", data: payload });
    messages.replaceChildren(feedback(ctx.capabilities.browser ? "Fuentes analizadas." : "Trabajo registrado en la cola.", "success"));
    await onJob(job);
  });
  const target = catalogTarget(ctx);
  const guided = bindForm(el("form", { class: "stack-compact" }, target.node,
    button("Consultar los siete días", { type: "submit", appearance: "secondary" })),
  async () => {
    const quarter = ctx.draft.snapshot.quarters[target.quarter.value];
    const lesson = quarter?.lessons?.find(item => item.id === target.lesson.value);
    if (!lesson) throw new Error("Elige una lección para consultar Adventech.");
    const { job } = await ctx.draftRequest("import/adventech", {
      method: "POST", data: { year: quarter.year, quarterNumber: quarter.quarterNumber, lessonNumber: lesson.number },
    });
    await onJob(job, { quarterId: quarter.id, lessonId: lesson.id });
  });
  return card("Nueva importación", el("div", { class: "stack" }, form,
    el("details", { class: "disclosure" }, el("summary", {}, "Importar desde Adventech"), guided)));
}

function importDetail(ctx, job) {
  const form = el("form", { class: "stack" });
  const selected = new Map();
  const suggested = [];
  const anyFragments = (job.items ?? []).some(item => item.result?.fragments?.length);
  const run = el("div", { class: "stack" });
  for (const [itemIndex, item] of (job.items ?? []).entries()) {
    const result = item.result;
    const originalHref = "/admin/api/drafts/" + encodeURIComponent(ctx.draft.id)
      + "/import/" + encodeURIComponent(job.id) + "/original/" + itemIndex;
    const fragments = [];
    for (const [fragmentIndex, fragment] of (result?.fragments ?? []).entries()) {
      const part = importFragment(ctx, fragment, itemIndex, fragmentIndex, selected);
      fragments.push(part.node);
      if (fragment.suggestedDayId) suggested.push(part.selectSuggested);
    }
    run.append(el("details", { class: "disclosure", open: Boolean(fragments.length) },
      el("summary", {}, item.name || result?.name || "Fuente " + (itemIndex + 1)),
      el("div", { class: "stack-compact" },
        el("div", { class: "row" }, jobStatus(item.status),
          result?.kind ? el("span", { class: "small muted" }, result.kind) : null,
          ctx.capabilities.browser && item.original ? messageButton("Guardar original", async () => {
            const blob = await ctx.draftRequest("import/" + job.id + "/original/" + itemIndex);
            const href = URL.createObjectURL(blob);
            const link = el("a", { href, download: item.name || "original" });
            link.click();
            setTimeout(() => URL.revokeObjectURL(href), 1000);
          }, { appearance: "secondary small" }) : !ctx.capabilities.browser && (result || item.original || item.hasOriginal)
            ? actionLink("Descargar original", originalHref, "small secondary", { download: true }) : null),
        result?.originUrl ? el("p", { class: "muted small wrap" }, result.originUrl) : null,
        result?.sha256 ? el("p", { class: "muted small wrap" }, "Huella SHA-256 · " + result.sha256.replace(/^sha256:/, "")) : null,
        result?.warnings?.length ? feedback("Puntos a revisar", "warn", result.warnings) : null,
        item.error ? feedback(typeof item.error === "string" ? item.error : item.error.message || "Error al procesar la fuente.", "error") : null,
        fragments,
        !fragments.length && result && !item.error ? empty("Sin fragmentos. Revisa el archivo original.") : null)));
  }
  if (busyJobs.has(job.status)) form.append(feedback("El trabajo sigue en curso."));
  if (job.error) form.append(feedback(typeof job.error === "string" ? job.error : job.error.message, "error"));
  form.append(run);
  if (ctx.canEdit && anyFragments) {
    form.append(el("div", { class: "row" },
      suggested.length > 1 ? button("Seleccionar destinos sugeridos", { appearance: "secondary", onClick: () => {
        suggested.forEach(choose => choose());
      } }) : null,
      button("Aplicar selección al borrador", { type: "submit" }),
      el("span", { class: "muted small" }, "Confirma destino, título, fecha y texto de cada fragmento.")));
    bindForm(form, async () => {
      if (!selected.size) throw new Error("Selecciona los fragmentos que deseas aplicar.");
      const assignments = [...selected.values()].map(read => read());
      const targets = new Set(assignments.map(item => [item.quarterId, item.lessonId, item.dayId].join("/")));
      if (targets.size !== assignments.length) throw new Error("Asignaste más de un fragmento al mismo día. Combina el texto o elige otro destino.");
      await ctx.draftRequest("import/" + encodeURIComponent(job.id) + "/apply", {
        method: "POST", data: { version: ctx.draft.version, assignments },
      });
      ctx.selection.jobId = job.id;
      if (assignments.length === 1) {
        const [assignment] = assignments;
        ctx.selection.quarterId = assignment.quarterId;
        ctx.selection.lessonId = assignment.lessonId;
        ctx.selection.dayId = assignment.dayId;
      }
      await ctx.refreshDraft();
      ctx.notify(assignments.length === 1 ? "Fragmento guardado en la lección." : assignments.length + " fragmentos guardados en las lecciones.");
    });
  }
  return card("Resultado de la importación", form, { action: jobStatus(job.status) });
}

function importFragment(ctx, fragment, item, index, selected) {
  const key = item + ":" + index;
  const label = fragment.title || fragment.location || "Fragmento " + (index + 1);
  const entry = el("details", { class: "disclosure" }, el("summary", {}, label));
  let details;
  let applyToggle;
  const open = () => {
    if (details) return;
    const sourcePreview = el("div", { class: "preview" }, readingPreview(fragment.text));
    const source = el("div", { class: "stack-compact" },
      el("h3", {}, "Texto extraído"),
      fragment.location ? el("p", { class: "muted small" }, fragment.location) : null,
      sourcePreview, referencesList(fragment.referenceSuggestions),
      fragment.suggestedKeyVerse?.reference
        ? el("p", { class: "muted small" }, "Versículo sugerido · ", fragment.suggestedKeyVerse.reference.display || fragment.suggestedKeyVerse.reference)
        : null,
      fragment.warnings?.length ? feedback("Puntos a confirmar", "warn", fragment.warnings) : null);
    if (!ctx.canEdit) {
      details = source;
      entry.append(details);
      return;
    }
    const target = catalogTarget(ctx, { lessons: true, days: true });
    const q = ctx.draft.snapshot.quarters[target.quarter.value];
    const suggestedLesson = q?.lessons?.find(lesson => lesson.number === fragment.suggestedLessonNumber);
    if (suggestedLesson) {
      target.lesson.value = suggestedLesson.id;
      target.updateDays();
    }
    if (fragment.suggestedDayId && Array.from(target.day.options).some(option => option.value === fragment.suggestedDayId)) {
      target.day.value = fragment.suggestedDayId;
    }
    const existing = el("div", { class: "preview" });
    const title = input("importedTitle", fragment.title || "");
    const date = input("importedDate", fragment.suggestedDate || "", { type: "date" });
    const text = area("importedText", fragment.text, { rows: "7" });
    const verse = input("importedVerseRef", fragment.suggestedKeyVerse?.reference?.display ?? fragment.suggestedKeyVerse?.reference ?? "");
    const verseText = area("importedVerseText", fragment.suggestedKeyVerse?.text ?? "", { rows: "2" });
    const pick = checkbox("choose", "Aplicar este fragmento", false, { "data-fragment-toggle": key });
    const toggle = pick.querySelector("input");
    applyToggle = toggle;
    function refreshCurrent() {
      const currentQuarter = ctx.draft.snapshot.quarters[target.quarter.value];
      const lesson = currentQuarter?.lessons?.find(item => item.id === target.lesson.value);
      const day = lesson?.days?.find(item => item.id === target.day.value);
      const previous = day?.contentMarkdown || (day?.contentBlocks ?? []).map(block => block.text || "").join("\n\n");
      existing.replaceChildren(el("h4", {}, day?.title || "Sin título"), ...readingPreview(previous));
    }
    for (const control of [target.quarter, target.lesson, target.day]) control.addEventListener("change", refreshCurrent);
    refreshCurrent();
    toggle.addEventListener("change", () => {
      if (toggle.checked) {
        selected.set(key, () => ({
          item, fragment: index, quarterId: target.quarter.value, lessonId: target.lesson.value, dayId: target.day.value,
          title: title.value.trim() || undefined, date: date.value || undefined, contentMarkdown: text.value,
          keyVerseReference: verse.value.trim() || undefined, keyVerseText: verseText.value.trim() || undefined,
        }));
      } else selected.delete(key);
    });
    details = el("div", { class: "stack" }, pick, target.node,
      el("div", { class: "editor-grid" }, source,
        el("div", { class: "stack-compact" }, el("h3", {}, "Lectura actual del destino"), existing)),
      el("div", { class: "form-grid" }, field("Título propuesto", title), field("Fecha propuesta", date),
        field("Texto que se guardará", text, { wide: true })),
      el("details", { class: "disclosure" }, el("summary", {}, "Versículo clave"),
        el("div", { class: "form-grid" }, field("Referencia", verse), field("Texto", verseText))));
    entry.append(details);
  };
  entry.addEventListener("toggle", () => { if (entry.open) open(); });
  return { node: entry, selectSuggested() {
    open();
    if (!applyToggle) return;
    applyToggle.checked = true;
    applyToggle.dispatchEvent(new Event("change"));
  } };
}

function workflowAction(ctx, action, label, help, tone = "secondary") {
  const form = bindForm(el("form", { class: "stack-compact" },
    field("Comentario", area("comment", "", { rows: "2", maxlength: 1000 }), { help }),
    button(label, { type: "submit", appearance: tone })),
  data => ctx.lifecycle(action, { comment: String(data.get("comment") ?? "").trim() }));
  return form;
}

function releaseInfo(ctx) {
  const inner = el("div", { class: "stack-compact", "aria-live": "polite" });
  let timer;
  function show(release) {
    inner.replaceChildren();
    if (!release) {
      inner.append(empty("Todavía no se ha preparado una vista previa para esta revisión."));
      return;
    }
    inner.append(status(release.status));
    if (release.error) inner.append(feedback(typeof release.error === "string" ? release.error : release.error.message, "error"));
    if (release.changes?.length) {
      inner.append(el("details", { class: "disclosure" }, el("summary", {}, "Archivos con cambios"),
        el("ul", {}, release.changes.map(change => el("li", { class: "wrap" }, typeof change === "string" ? change : change.path)))));
    }
    const preview = samePath(release.previewUrl);
    const download = samePath(release.downloadUrl);
    if (preview || download) inner.append(el("div", { class: "row" },
      preview ? actionLink("Abrir vista previa", preview, "secondary", { target: "_blank", rel: "noopener" }) : null,
      download ? actionLink("Descargar paquete aprobado", download, "", { download: true }) : null));
    if (busyJobs.has(release.status)) timer = setTimeout(poll, 4000);
  }
  async function poll() {
    if (!inner.isConnected) return;
    try {
      const fresh = await ctx.refreshDraft(false);
      if (!inner.isConnected) return;
      const release = fresh.release ?? fresh.draft?.release;
      if (release && !busyJobs.has(release.status)) ctx.render();
      else show(release);
    } catch (error) {
      if (inner.isConnected) setFeedback(inner, error);
    }
  }
  show(ctx.release);
  return card("Vista previa local", [inner, ctx.capabilities.prepare && !busyJobs.has(ctx.release?.status)
    ? el("div", { class: "form-actions" },
      messageButton(ctx.release?.status === "failed" ? "Reintentar preparación" : "Preparar vista previa",
        async () => {
          clearTimeout(timer);
          await ctx.lifecycle("prepare");
        }, { appearance: "secondary", lead: "eye" }))
    : null], { caption: "Se construye con el lector público y el contenido de este borrador." });
}

const actionText = {
  create: "Borrador creado", created: "Borrador creado", change: "Contenido guardado", updated: "Contenido guardado",
  submit: "Enviado a revisión", submitted: "Enviado a revisión", approve: "Aprobado", approved: "Aprobado",
  reopen: "Devuelto a edición", reopened: "Devuelto a edición", prepare: "Preparación solicitada", prepared: "Vista previa preparada",
  restore: "Restaurado a un nuevo borrador", "import.apply": "Importación aplicada",
  "draft.created": "Borrador creado", "draft.editing": "Devuelto a edición", "draft.submitted": "Enviado a revisión",
  "draft.approved": "Versión aprobada", "draft.restored": "Borrador recuperado", "release.queued": "Preparación solicitada",
  "release.ready": "Vista previa preparada", "release.failed": "Preparación fallida", "release.downloaded": "Paquete descargado",
  "year.create": "Año creado", "quarter.create": "Trimestre creado", "quarter.update": "Trimestre actualizado",
  "quarter.status": "Estado del trimestre actualizado", "lesson.update": "Ficha de lección guardada",
  "day.update": "Lectura guardada", "import.applied": "Importación aplicada", "resource.upsert": "Recurso guardado",
  "resource.remove": "Recurso retirado", "reading.upsert": "Lectura extra guardada", "site.update": "Apariencia o navegación guardada",
};

export function publicationView(ctx) {
  if (ctx.capabilities.browser) return browserPublication(ctx);
  const current = ctx.draft;
  const ownDraft = (current.ownerId ?? current.owner?.id ?? current.owner) === ctx.user.id
    || (current.owner?.username ?? current.owner) === ctx.user.username;
  const issues = ctx.issues ?? [];
  const conditions = issues.length
    ? feedback("Completa estos puntos antes de enviar a revisión.", "warn", issues.slice(0, 12))
    : feedback("Validación del catálogo completa.", "success");
  const actions = [];
  if (ctx.canEdit && issues.length === 0) {
    actions.push(workflowAction(ctx, "submit", "Enviar a revisión", "Añade un contexto breve para quien revisa.", ""));
  }
  if (current.status === "submitted" && ctx.capabilities.review && !ownDraft && ctx.release?.status === "ready") {
    actions.push(workflowAction(ctx, "approve", "Aprobar versión", "Confirma que revisaste la vista previa.", ""));
  }
  if (current.status === "submitted" && ctx.capabilities.review && !ownDraft && ctx.release?.status !== "ready") {
    actions.push(feedback("Prepara la vista previa de esta revisión para poder aprobar."));
  }
  if (current.status === "submitted" && ctx.capabilities.review && ownDraft) {
    actions.push(feedback("Otra persona con permiso de revisión puede aprobar este borrador."));
  }
  if (current.status !== "editing" && (ctx.capabilities.review || (ctx.capabilities.edit && ownDraft && current.status === "submitted"))) {
    actions.push(workflowAction(ctx, "reopen", "Volver a edición", "Al reabrir, se deberá revisar la versión siguiente."));
  }
  const release = releaseInfo(ctx);
  const timeline = ctx.history.length
    ? el("ul", { class: "list history" }, ctx.history.map(item =>
      el("li", { class: "item-text" }, el("strong", {}, actionText[item.action] ?? item.action),
        el("span", { class: "muted small" }, item.actor?.username ?? item.actor ?? "Sistema", " · ", formattedDate(item.createdAt)),
        item.comment ? el("p", {}, item.comment) : null)))
    : empty("Sin eventos para este borrador.");
  const restore = ctx.capabilities.manage && current.status === "approved"
    ? bindForm(el("form", { class: "stack-compact" },
      field("Nombre del borrador", input("title", ("Restauración · " + current.title).slice(0, 100), { required: true, maxlength: 100 })),
      button("Crear copia de esta versión", { appearance: "secondary", type: "submit" })),
    async data => {
      const result = await ctx.draftRequest("restore", { method: "POST", data: { title: data.get("title") } });
      await ctx.openDraft(result.draft.id);
    }) : null;
  const body = el("div", { class: "stack" },
    el("div", { class: "grid-2" },
      card("Estado de revisión", el("div", { class: "stack" }, conditions, actions),
        { caption: "Revisión " + current.version, action: status(current.status) }),
      release),
    card("Historial", timeline),
    restore ? card("Recuperar versión", restore, { caption: "La copia inicia un borrador separado." }) : null);
  return ctx.page("Revisión y publicación", current.title, body);
}

function browserPublication(ctx) {
  const release = ctx.release;
  const messages = {
    submitting: "Enviando los cambios a GitHub…",
    validating: "GitHub está comprobando los cambios.",
    deploying: "Validación lista. Vercel está actualizando el sitio.",
    published: "Los cambios ya están publicados.",
    failed: "La publicación se detuvo. Tus cambios siguen guardados. Puedes volver a intentarlo.",
  };
  const connection = bindForm(el("form", { class: "stack-compact", autocomplete: "off" },
    el("p", {}, "Conecta el repositorio una vez en este navegador. Después podrás publicar con el botón del panel."),
    field("Acceso de GitHub", input("token", "", { type: "password", required: true, autocomplete: "off", spellcheck: "false" })),
    el("div", { class: "row" }, button("Conectar GitHub", { type: "submit" }),
      actionLink("Crear acceso en GitHub", "https://github.com/settings/personal-access-tokens/new", "secondary", { target: "_blank", rel: "noopener noreferrer" })),
    el("p", { class: "muted small" }, "Selecciona el repositorio medina-raul/escuela-sabatica y el permiso Contents · Read and write.")),
  async data => {
    await ctx.request("publication/connect", { method: "POST", data: { token: data.get("token") } });
    await ctx.refresh();
    ctx.notify("GitHub conectado. Ya puedes publicar.");
  });
  const body = el("div", { class: "stack" },
    card("Estado", el("div", { class: "stack" },
      release ? feedback(messages[release.state] ?? "Estado de publicación actualizado.",
        release.state === "published" ? "success" : release.state === "failed" ? "warn" : "info")
        : el("p", {}, "Pulsa Publicar cuando termines de guardar tus cambios."),
      release?.error ? feedback(release.error, "warn") : null,
      ctx.issues.length ? feedback("Revisa estos puntos antes de publicar.", "warn", ctx.issues.slice(0, 12)) : null,
      el("div", { class: "row" },
        ctx.connected && ctx.canEdit && !ctx.issues.length ? messageButton("Publicar", ctx.publish, { appearance: "", "data-cms-publish": "" }) : null,
        release?.state === "published" ? actionLink("Ver sitio publicado", "/", "secondary", { target: "_blank", rel: "noopener" }) : null,
        release?.state === "failed" && release.log ? actionLink("Ver la validación", release.log, "secondary", { target: "_blank", rel: "noopener noreferrer" }) : null))),
    ctx.connected ? el("details", { class: "card disclosure" }, el("summary", {}, "Cambiar el acceso de GitHub"), connection)
      : card("Configurar publicación", connection));
  return ctx.page("Publicación", "", body);
}

const intervals = [[60, "Cada hora"], [1440, "Diaria"], [10080, "Semanal"], [43200, "Cada 30 días"]];
const roles = [["admin", "Administrador"], ["editor", "Editor"], ["reviewer", "Revisor"], ["viewer", "Consulta"]];
const owns = (ctx, draft) => ctx.capabilities.manage || draft?.ownerId === ctx.user.id;
const editableDestinations = ctx => ctx.drafts.filter(draft => draft.status === "editing" && owns(ctx, draft));

function sourceConfiguration(ctx, source, onSave, onCancel) {
  const feeds = source ?? {};
  const purpose = select("purpose", [
    ["lesson", "Extraer lecciones"],
    ["resource", "Verificar un recurso"],
    ["quarter-resources", "Consultar audio y PPT del trimestre"],
    ["resource-index", "Buscar audios o PPT desde un índice"],
  ], feeds.purpose ?? "lesson");
  const kind = select("kind", [["auto", "Detectar formato"], ["pdf", "PDF"], ["html", "HTML"], ["markdown", "Markdown"]],
    feeds.kind || "auto");
  const url = input("url", feeds.url, { placeholder: "https://fuente.cl/material" });
  const urlField = field("URL", url, { wide: true });
  const kindField = field("Formato", kind);
  const editable = editableDestinations(ctx);
  const choices = editable.filter(draft => draft.id !== feeds.draftId).map(item => [item.id, item.title]);
  if (feeds.draftId) choices.unshift([feeds.draftId, ctx.drafts.find(draft => draft.id === feeds.draftId)?.title ?? "Borrador de origen"]);
  const preferred = feeds.draftId ?? (ctx.canEdit ? ctx.draft?.id : editable[0]?.id) ?? "";
  const draftChoice = select("draftId", [["", "Elige un borrador"], ...choices], preferred, { required: true });
  const resourceSettings = el("div", { class: "stack-compact wide" });
  const q = select("quarterId", [], "");
  const lesson = select("lessonNumber", [], "");
  const day = select("dayId", [], "");
  const title = input("resourceTitle", feeds.resource?.title, { maxlength: 180 });
  const credit = input("credit", feeds.resource?.credit, { maxlength: 180 });
  const type = select("type", [["audio", "Audio diario"], ["ppt", "Presentación semanal"]], feeds.resource?.type ?? "audio");
  let catalog = draftChoice.value === ctx.draft?.id ? ctx.draft.snapshot.quarters : {};
  let query = 0;
  const lessonField = field("Lección", lesson);
  const dayField = field("Día", day);
  const typeField = field("Tipo de material", type);
  const titleField = field("Título del material", title);
  const creditField = field("Crédito", credit);
  const updateDays = () => {
    const selected = catalog[q.value]?.lessons?.find(item => String(item.number) === lesson.value);
    day.replaceChildren(...(selected?.days ?? []).map(item => el("option", { value: item.id }, item.dayName)));
    if (feeds.resource?.dayId && Array.from(day.options).some(item => item.value === feeds.resource.dayId)) day.value = feeds.resource.dayId;
  };
  const updateLessons = () => {
    lesson.replaceChildren(...(catalog[q.value]?.lessons ?? []).map(item => el("option", { value: item.number }, lessonLabel(item))));
    if (feeds.resource?.lessonNumber && Array.from(lesson.options).some(item => Number(item.value) === feeds.resource.lessonNumber)) {
      lesson.value = String(feeds.resource.lessonNumber);
    }
    updateDays();
  };
  const updateQuarter = () => {
    const choices = Object.values(catalog).sort((a, b) => b.year - a.year || b.quarterNumber - a.quarterNumber);
    q.replaceChildren(...choices.map(item => el("option", { value: item.id }, quarterLabel(item))));
    if (catalog[feeds.resource?.quarterId]) q.value = feeds.resource.quarterId;
    updateLessons();
  };
  const updateDraft = async () => {
    const sequence = ++query;
    if (!draftChoice.value) {
      catalog = {};
      updateQuarter();
      return;
    }
    if (draftChoice.value === ctx.draft?.id) {
      catalog = ctx.draft.snapshot.quarters;
      updateQuarter();
      return;
    }
    try {
      const result = await ctx.request("drafts/" + encodeURIComponent(draftChoice.value));
      if (sequence !== query) return;
      catalog = result.draft.snapshot.quarters;
      updateQuarter();
    } catch (error) {
      if (sequence !== query) return;
      catalog = {};
      updateQuarter();
      ctx.notify(error.message, "error");
    }
  };
  const updatePurpose = () => {
    const withResource = purpose.value !== "lesson";
    const single = purpose.value === "resource";
    urlField.hidden = purpose.value === "quarter-resources";
    url.required = !urlField.hidden;
    kindField.hidden = withResource;
    resourceSettings.hidden = !withResource;
    q.required = withResource;
    typeField.hidden = !single && purpose.value !== "resource-index";
    for (const field of [lessonField, dayField, titleField, creditField]) field.hidden = !single;
    dayField.hidden = !single || type.value !== "audio";
    lesson.required = single;
    day.required = single && type.value === "audio";
    title.required = single;
  };
  resourceSettings.append(el("div", { class: "form-grid" },
    field("Trimestre de destino", q), typeField, lessonField, dayField, titleField, creditField));
  q.addEventListener("change", updateLessons);
  lesson.addEventListener("change", updateDays);
  type.addEventListener("change", updatePurpose);
  purpose.addEventListener("change", updatePurpose);
  draftChoice.addEventListener("change", updateDraft);
  updateQuarter();
  updatePurpose();
  if (draftChoice.value && draftChoice.value !== ctx.draft?.id) void updateDraft();

  const frequency = Number(feeds.intervalMinutes) || 10080;
  const frequencyOptions = intervals.some(([value]) => value === frequency)
    ? intervals : [...intervals, [frequency, "Cada " + frequency + " minutos"]];
  const form = bindForm(el("form", { class: "stack-compact" },
    el("div", { class: "form-grid" },
      field("Nombre", input("name", feeds.name, { maxlength: 120, required: true })),
    field("Tarea", purpose, { help: "Los audios y PPT identificados con certeza pasan al borrador para su revisión conjunta." }),
      urlField, kindField, field("Borrador de destino", draftChoice),
      field("Frecuencia", select("intervalMinutes", frequencyOptions, frequency)), resourceSettings),
    checkbox("enabled", "Ejecutar en el horario configurado", feeds.enabled ?? true),
    el("div", { class: "row" },
      button(source ? "Guardar cambios" : "Agregar fuente", { type: "submit" }),
      source ? button("Cancelar", { appearance: "quiet", onClick: onCancel }) : null)),
  async data => {
    const resource = data.get("purpose") === "lesson" ? undefined : { quarterId: q.value };
    if (data.get("purpose") === "resource-index") resource.type = type.value;
    if (data.get("purpose") === "resource") {
      Object.assign(resource, {
        title: title.value, credit: credit.value, type: type.value, lessonNumber: Number(lesson.value),
        role: type.value === "audio" ? "daily-audio" : "weekly-presentation",
        dayId: type.value === "audio" ? day.value : undefined,
      });
    }
    await ctx.request(source ? "sources/" + encodeURIComponent(source.id) : "sources", {
      method: source ? "PATCH" : "POST", data: {
        name: data.get("name"), kind: data.get("purpose") === "lesson" ? kind.value : "auto",
        url: urlField.hidden ? undefined : url.value.trim(), draftId: draftChoice.value,
        purpose: purpose.value, resource, intervalMinutes: Number(data.get("intervalMinutes")), enabled: data.has("enabled"),
      },
    });
    await onSave();
  });
  return form;
}

export function sourcesView(ctx) {
  if (ctx.capabilities.browser) return browserSources(ctx);
  const list = el("div", { class: "stack", "aria-live": "polite" }, el("p", { class: "muted" }, "Cargando fuentes…"));
  const supported = el("div", { class: "stack-compact" });
  const edit = el("div", { class: "stack" });
  let selected = null;
  let releaseTimer;
  const canEditSource = ctx.capabilities.edit || ctx.capabilities.manage;
  function showEdit() {
    edit.replaceChildren(canEditSource && (editableDestinations(ctx).length || selected?.draftId)
      ? card(selected ? "Editar fuente" : "Nueva fuente", sourceConfiguration(ctx, selected, async () => {
        selected = null;
        showEdit();
        await load();
      }, () => { selected = null; showEdit(); }))
      : empty("Selecciona o crea un borrador en edición para configurar una fuente."));
  }
  async function load() {
    clearTimeout(releaseTimer);
    try {
      const { sources = [], allowedHosts = [] } = await ctx.request("sources");
      if (!list.isConnected) return;
      const rows = sources.map(source => {
        const mayManage = canEditSource && owns(ctx, ctx.drafts.find(draft => draft.id === source.draftId));
        return [
        el("div", { class: "item-text" }, el("strong", {}, source.name),
          source.url ? el("span", { class: "muted small wrap" }, source.url) : null),
        el("div", { class: "item-text" }, el("span", {}, source.enabled ? "Programada" : "Pausada"),
          source.enabled && source.nextRunAt ? el("span", { class: "small muted" }, formattedDate(source.nextRunAt)) : null),
        jobStatus(source.state ?? source.lastStatus ?? source.status ?? "pending"),
        formattedDate(source.lastRunAt ?? source.lastRun ?? source.lastCheckedAt),
        el("div", { class: "row" },
          mayManage ? button("Editar", { appearance: "secondary small", onClick: () => {
            selected = source;
            showEdit();
            edit.scrollIntoView({ block: "start" });
          } }) : null,
          mayManage ? messageButton("Ejecutar ahora", async () => {
            await ctx.request("sources/" + encodeURIComponent(source.id) + "/run", { method: "POST", data: {} });
            await load();
            if (list.isConnected) ctx.notify("Ejecución solicitada.");
          }, { appearance: "secondary small" }) : null),
        ];
      });
      list.replaceChildren(rows.length ? table(["Fuente", "Horario", "Resultado", "Última revisión", ""], rows,
        { label: "Fuentes programadas" }) : empty("Aún no hay fuentes programadas."));
      if (sources.some(source => busyJobs.has(source.state ?? source.lastStatus ?? source.status))) {
        releaseTimer = setTimeout(() => { if (list.isConnected) void load(); }, 4000);
      }
      supported.replaceChildren(allowedHosts.length
        ? el("ul", { class: "list" }, allowedHosts.map(host => el("li", {}, typeof host === "string" ? host : host.host)))
        : empty("Aún no hay dominios habilitados."));
      if (ctx.capabilities.manage) {
        supported.append(bindForm(el("form", { class: "stack-compact" },
          field("Dominio exacto", input("host", "", { required: true, placeholder: "recursos.ejemplo.cl" })),
          button("Habilitar dominio", { appearance: "secondary", type: "submit" })),
        async data => {
          await ctx.request("hosts", { method: "POST", data: { host: data.get("host") } });
          await load();
        }));
      }
    } catch (error) {
      if (list.isConnected) setFeedback(list, error);
    }
  }
  showEdit();
  queueMicrotask(load);
  return ctx.page("Fuentes y horarios", "Configura revisiones periódicas, incluidos el audio y el PPT semanal.", el("div", { class: "stack" },
    card("Fuentes programadas", list, { action: messageButton("Actualizar", load, { appearance: "secondary small" }) }),
    el("div", { class: "grid-2" }, edit, card("Dominios permitidos", supported))));
}

function browserSources(ctx) {
  const target = catalogTarget(ctx, { lessons: false });
  const quarter = ctx.draft?.snapshot.quarters[target.quarter.value];
  if (!quarter) return ctx.page("Fuentes y horarios", "", empty("Selecciona un trimestre para configurar sus fuentes."));
  target.quarter.addEventListener("change", () => {
    ctx.selection.quarterId = target.quarter.value;
    ctx.render();
  });
  const automation = quarter.resourceAutomation ?? {};
  function source(type, title, historical) {
    const current = automation.sourceIndexes?.[type]?.url ?? "";
    const url = input("url", current, { type: "url", placeholder: "https://…", readonly: !ctx.canEdit });
    const form = bindForm(el("form", { class: "stack-compact" },
      field("Enlace a la página o repositorio", url),
      !current && historical ? el("p", { class: "muted small" }, "Este trimestre ya tiene una fuente configurada.") : null,
      ctx.canEdit ? button(current ? "Guardar fuente" : "Agregar fuente", { type: "submit", appearance: "secondary" }) : null),
    async data => ctx.change("resource.index", { quarterId: quarter.id, type, url: data.get("url") }, "Fuente guardada. Pulsa Publicar para activar el seguimiento."));
    return card(title, form);
  }
  return ctx.page("Fuentes y horarios", "Pega el enlace una vez y publica. Se buscarán materiales nuevos tres noches por semana.",
    el("div", { class: "stack" }, card("Trimestre", target.node),
      el("div", { class: "grid-2" }, source("audio", "Audios diarios", automation.audioDiscovery),
        source("ppt", "Presentaciones semanales", automation.presentationDiscovery))));
}

export function usersView(ctx) {
  const list = el("div", { class: "stack" }, el("p", { class: "muted" }, "Cargando usuarios…"));
  async function load() {
    try {
      const { users = [] } = await ctx.request("users");
      if (!list.isConnected) return;
      list.replaceChildren(users.length ? el("ul", { class: "list" }, users.map(user => {
        const canChange = user.id !== ctx.user.id;
        const role = select("role", roles, user.role, { disabled: !canChange });
        const active = checkbox("active", "Cuenta activa", user.active !== false && user.active !== 0, { disabled: !canChange });
        const row = el("form", { class: "row" }, field("Permisos", role), active,
          canChange ? button("Guardar acceso", { type: "submit", appearance: "secondary small" }) : null);
        if (canChange) bindForm(row, async data => {
          await ctx.request("users/" + encodeURIComponent(user.id), {
            method: "PATCH", data: { role: data.get("role"), active: data.has("active") },
          });
          await load();
        });
        return el("li", { class: "row row-start row-between" },
          el("div", { class: "item-text" }, el("strong", {}, user.username),
            el("span", { class: "muted small" }, roleLabel(user.role))), row);
      })) : empty("No se encontraron cuentas."));
    } catch (error) {
      if (list.isConnected) setFeedback(list, error);
    }
  }
  const form = bindForm(el("form", { class: "stack-compact" },
    field("Usuario", input("username", "", { required: true, autocomplete: "off", minlength: 3, maxlength: 64, pattern: "[A-Za-z0-9][A-Za-z0-9_.\\-]{2,63}" }),
      { help: "Letras sin tildes, números, punto, guion o guion bajo." }),
    field("Contraseña inicial", input("password", "", { type: "password", required: true, minlength: 12, autocomplete: "new-password" }),
      { help: "Usa al menos 12 caracteres." }),
    field("Rol", select("role", roles, "editor")), button("Crear cuenta", { type: "submit" })),
  async (data, messages) => {
    await ctx.request("users", { method: "POST", data: Object.fromEntries(data) });
    form.reset();
    messages.replaceChildren(feedback("Cuenta creada.", "success"));
    await load();
  });
  queueMicrotask(load);
  return ctx.page("Usuarios y permisos", "Asigna acceso de edición, revisión o consulta.", el("div", { class: "grid-2" },
    card("Cuentas", list), card("Nueva cuenta", form)));
}
