import { actionLink, bindForm, button, card, el, empty, feedback, field, formattedDate, icon, input, roleLabel, select, setSectionFocus, status } from "./dom.mjs";
import { calendarView, lessonView, resourcesView } from "./views-content.mjs";
import { siteView } from "./views-site.mjs";
import { importView, publicationView, sourcesView, usersView } from "./views-workflow.mjs";

const app = document.querySelector("#app");
let state = {
  user: null, csrf: "", dashboard: null, draft: null, issues: [],
  history: [], release: null, selection: {}, flash: null,
};
let draftLoad = 0;
let transport;
let firstLogin = false;
let publicationTimer;
let sending = false;

const pages = {
  inicio: { title: "Inicio", icon: "home", view: dashboardView },
  calendario: { title: "Años y trimestres", icon: "calendar", view: calendarView, needsDraft: true },
  lecciones: { title: "Lecciones", icon: "book", view: lessonView, needsDraft: true },
  importar: { title: "Importar", icon: "import", view: importView, needsDraft: true },
  recursos: { title: "Biblioteca", icon: "folder", view: resourcesView, needsDraft: true },
  sitio: { title: "Apariencia y navegación", icon: "site", view: siteView, needsDraft: true },
  fuentes: { title: "Fuentes y horarios", icon: "sources", view: sourcesView },
  publicacion: { title: "Publicación", icon: "check", view: publicationView, needsDraft: true },
  equipo: { title: "Usuarios y permisos", icon: "users", view: usersView, capability: "manage" },
};

function brand() {
  return el("div", { class: "brand" },
    el("span", { class: "brand-mark" }, icon("book", 24)),
    el("span", { class: "brand-copy" }, el("strong", {}, "Escuela Sabática CL"), el("span", {}, "Panel editorial")));
}

async function request(path, { method = "GET", data } = {}) {
  if (transport) return transport(path, { method, data });
  const headers = new Headers({ Accept: "application/json" });
  const init = { method, headers, credentials: "same-origin", cache: "no-store" };
  if (method !== "GET" && state.csrf) headers.set("X-CSRF-Token", state.csrf);
  if (data instanceof FormData) init.body = data;
  else if (data !== undefined) {
    headers.set("Content-Type", "application/json");
    init.body = JSON.stringify(data);
  }
  const result = await fetch("/admin/api/" + path, init);
  const body = await result.json().catch(() => ({}));
  if (!result.ok) {
    if (result.status === 401 && state.user && path !== "login") {
      clearSession();
      renderLogin("La sesión terminó. Vuelve a ingresar.");
    }
    const error = new Error(body.error || "No se pudo completar la solicitud.");
    error.status = result.status;
    error.details = body.details;
    throw error;
  }
  return body;
}

function clearSession() {
  clearTimeout(publicationTimer);
  ++draftLoad;
  state = {
    user: null, csrf: "", dashboard: null, draft: null, issues: [],
    history: [], release: null, selection: {}, flash: null,
  };
}

function currentRoute() {
  const name = window.location.hash.slice(1);
  const item = Object.hasOwn(pages, name) ? pages[name] : null;
  if (!item || (item.capability && !state.dashboard?.capabilities?.[item.capability])) return "inicio";
  return name;
}

function navigate(name) {
  if (currentRoute() === name) return render({ focus: true });
  window.location.hash = name;
}

function renderLogin(message) {
  document.title = "Iniciar sesión | Escuela Sabática CL";
  const form = bindForm(el("form", { class: "stack" },
    field("Usuario", input("username", transport ? "rmedina" : "", {
      autocomplete: "username", required: true, readonly: Boolean(transport), autofocus: !transport,
    })),
    field(firstLogin ? "Contraseña para este navegador" : "Contraseña", input("password", "", {
      type: "password", autocomplete: firstLogin ? "new-password" : "current-password", required: true, autofocus: Boolean(transport),
    })),
    button("Entrar al panel", { type: "submit", appearance: "full", lead: "arrow" })),
  async formData => {
    const session = await request("login", { method: "POST", data: Object.fromEntries(formData) });
    if (!session.user) throw new Error("No se recibió una sesión válida.");
    state.user = session.user;
    state.csrf = session.csrf ?? "";
    firstLogin = false;
    await initializeDashboard();
  });
  app.replaceChildren(el("div", { class: "auth-page" },
    el("aside", { class: "auth-side" }, brand(),
      el("div", { class: "auth-copy" }, el("h2", {}, "Estudio y edición"), el("p", {}, "Lecciones, recursos y publicaciones de Escuela Sabática CL.")),
      el("p", { class: "auth-foot" }, transport ? "Borradores en este navegador" : "Entorno local")),
    el("main", { class: "auth-main" },
      el("section", { class: "auth-card" },
        el("h1", {}, "Iniciar sesión"),
        firstLogin ? el("p", { class: "muted" }, "Primera vez aquí. Escribe la clave que usarás para abrir tus borradores.") : null,
        message ? feedback(message, "warn") : null,
        form))));
}

function renderError(error) {
  app.replaceChildren(el("main", { class: "main error-view" }, card("No se pudo abrir el panel",
    el("div", { class: "stack" }, feedback(error.message, "error", error.details),
      button("Reintentar", { onClick: boot, appearance: "secondary" })))));
}

async function boot() {
  try {
    const { user, csrf, setup } = await request("session");
    firstLogin = Boolean(setup);
    state.user = user;
    state.csrf = csrf ?? "";
    if (!state.user) return renderLogin();
    await initializeDashboard();
  } catch (error) {
    if (error.status !== 401) renderError(error);
  }
}

async function refreshDashboard() {
  const dashboard = await request("dashboard");
  state.dashboard = dashboard;
}

async function initializeDashboard() {
  await refreshDashboard();
  const items = state.dashboard.drafts ?? [];
  const preferred = items.find(draft => draft.status === "editing" && draft.ownerId === state.user.id)
    ?? items.find(draft => draft.status === "submitted" && state.dashboard.capabilities.review)
    ?? items.find(draft => draft.status === "editing") ?? items[0];
  if (preferred) await selectDraft(preferred.id, false);
  render({ focus: true });
}

function assignDraft(data) {
  if (!data.draft?.snapshot) return;
  if (data.draft.id !== state.draft?.id) state.selection = {};
  state.draft = data.draft;
  state.issues = data.issues ?? data.draft.issues ?? [];
  state.history = data.history ?? data.draft.history ?? [];
  state.release = data.release ?? data.draft.release ?? null;
}

async function selectDraft(id, redraw = true) {
  const attempt = ++draftLoad;
  if (id) {
    const data = await request("drafts/" + encodeURIComponent(id));
    if (attempt !== draftLoad || !state.user) return;
    assignDraft(data);
  } else {
    state.draft = null;
    state.issues = [];
    state.history = [];
    state.release = null;
    state.selection = {};
  }
  if (redraw) render({ focus: true });
}

function makeContext() {
  const draft = state.draft;
  const capabilities = state.dashboard?.capabilities ?? {};
  const ownDraft = draft?.ownerId === state.user.id;
  const currentId = draft?.id;
  const draftPath = "drafts/" + encodeURIComponent(currentId ?? "");
  const draftRequest = (path = "", options) => request(draftPath + (path ? "/" + path : ""), options);
  const stillSelected = () => currentId === state.draft?.id;
  const loadDraft = async () => {
    const data = await draftRequest();
    if (stillSelected()) assignDraft(data);
    return data;
  };
  async function change(action, data, message, options = {}) {
    const version = state.draft?.version;
    if (!stillSelected()) throw new Error("Selecciona de nuevo el borrador.");
    const result = await draftRequest("change", { method: "POST", data: { version, action, data } });
    if (stillSelected()) {
      assignDraft(result);
      await loadDraft();
      await refreshDashboard();
      if (!stillSelected()) return result;
      if (message) state.flash = { message, tone: "success" };
      if (options.selection) Object.assign(state.selection, options.selection);
      render({ focus: Boolean(options.focus) });
    }
    return result;
  }
  async function lifecycle(action, data = {}) {
    if (!stillSelected()) throw new Error("Selecciona de nuevo el borrador.");
    const result = await draftRequest(action, {
      method: "POST", data: { version: state.draft.version, ...data },
    });
    if (stillSelected()) {
      assignDraft(result);
      await loadDraft();
      await refreshDashboard();
      if (stillSelected()) render();
    }
    return result;
  }
  return {
    user: state.user, draft, capabilities, issues: state.issues, history: state.history,
    release: state.release, live: state.dashboard?.live ?? {}, drafts: state.dashboard?.drafts ?? [],
    connected: state.dashboard?.connected, publish: startPublication,
    editing: draft?.status === "editing", canEdit: capabilities.edit && draft?.status === "editing" && (capabilities.manage || ownDraft),
    canSite: capabilities.manageSite && draft?.status === "editing", selection: state.selection,
    request, draftRequest, navigate, change, lifecycle, render,
    async refreshDraft(redraw = true) {
      const fresh = await loadDraft();
      if (redraw && stillSelected()) render();
      return fresh;
    },
    async openDraft(id) {
      await refreshDashboard();
      await selectDraft(id);
    },
    async refresh() {
      await refreshDashboard();
      if (state.draft) await loadDraft();
      render();
    },
    newDraft: openCreateDraft,
    notify(message, tone = "success") {
      const target = document.querySelector(".flash");
      if (target) target.replaceChildren(feedback(message, tone));
    },
    page(title, description, content, action) {
      return [
        el("div", { class: "page-head" },
          el("div", {}, el("h1", {}, title), description ? el("p", {}, description) : null), action),
        content,
      ];
    },
  };
}

function openCreateDraft() {
  const title = "Crear borrador";
  const dialog = el("dialog", { "aria-labelledby": "new-draft-title" },
    el("header", { class: "dialog-head" }, el("h2", { id: "new-draft-title" }, title)));
  const form = bindForm(el("form", { class: "dialog-inner stack" },
    field("Nombre", input("title", "", { required: true, maxlength: 100, autofocus: true, placeholder: "Ej. Trimestre 2027 Q1" }),
      { help: "Usa el catálogo actual como punto de partida." }),
    el("div", { class: "row row-end" }, button("Cancelar", { appearance: "secondary", onClick: () => dialog.close() }),
      button(title, { type: "submit" }))),
  async data => {
    const { draft } = await request("drafts", { method: "POST", data: { title: data.get("title") } });
    dialog.close();
    await refreshDashboard();
    await selectDraft(draft.id, false);
    state.flash = { message: "Borrador creado.", tone: "success" };
    navigate("calendario");
  });
  dialog.append(form);
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  document.body.append(dialog);
  dialog.showModal();
}

function safeAction(fn) {
  return async () => {
    try {
      await fn();
    } catch (error) {
      const flash = document.querySelector(".flash");
      flash?.replaceChildren(feedback(error.message, "error", error.details));
    }
  };
}

async function startPublication() {
  if (sending) return;
  if (document.querySelector("form[data-cms-dirty='true']")) {
    throw new Error("Pulsa Guardar en el formulario abierto antes de publicar.");
  }
  if (!state.dashboard?.connected || !state.draft || state.issues.length || state.draft.status !== "editing") {
    navigate("publicacion");
    return;
  }
  sending = true;
  const id = state.draft.id;
  const version = state.draft.version;
  document.querySelectorAll("[data-cms-publish]").forEach(control => { control.disabled = true; });
  document.querySelector(".flash")?.replaceChildren(feedback("Preparando publicación…"));
  try {
    const data = await request("drafts/" + id + "/publish", { method: "POST", data: { version } });
    if (!state.user || state.draft?.id !== id) return;
    assignDraft(data);
    navigate("publicacion");
  } finally {
    sending = false;
    document.querySelectorAll("[data-cms-publish]").forEach(control => { control.disabled = false; });
  }
}

function schedulePublicationCheck() {
  clearTimeout(publicationTimer);
  if (!transport || state.draft?.status !== "building") return;
  const current = state.release;
  const id = state.draft.id;
  publicationTimer = setTimeout(async () => {
    try {
      const data = await request("drafts/" + id + "/check", { method: "POST" });
      if (!state.user || state.draft?.id !== id) return;
      assignDraft(data);
      if (JSON.stringify(current) !== JSON.stringify(state.release)) {
        await refreshDashboard();
        if (state.user) render();
        return;
      }
    } catch (error) {
      if (state.user) document.querySelector(".flash")?.replaceChildren(feedback(error.message, "warn"));
    }
    schedulePublicationCheck();
  }, current?.state === "submitting" ? 300 : 10_000);
}

function sidebar(route, ctx) {
  const drawer = el("aside", { class: "sidebar" });
  const nav = el("nav", { id: "section-nav", "aria-label": "Secciones del CMS" });
  const toggle = button("Menú", { appearance: "secondary mobile-menu", lead: "menu", "aria-expanded": "false", "aria-controls": "section-nav", onClick: () => {
    const open = drawer.classList.toggle("is-open");
    toggle.setAttribute("aria-expanded", String(open));
  } });
  drawer.append(el("div", { class: "sidebar-top" }, brand(), toggle));
  const groups = [
    ["Panel", ["inicio"]],
    ["Contenido", ["calendario", "lecciones", "importar", "recursos"]],
    ["Operación", ["sitio", "fuentes", "publicacion", "equipo"]],
  ];
  for (const [label, names] of groups) {
    const links = names.filter(name => !pages[name].capability || ctx.capabilities[pages[name].capability]);
    nav.append(el("div", { class: "nav-group" }, el("div", { class: "nav-label" }, label),
      links.map(name => el("a", {
        href: "#" + name, class: "nav-link", "aria-current": name === route ? "page" : null,
        onclick: () => {
          drawer.classList.remove("is-open");
          toggle.setAttribute("aria-expanded", "false");
        },
      }, icon(pages[name].icon), pages[name].title))));
  }
  drawer.append(nav, el("div", { class: "sidebar-footer" }, el("span", {}, transport ? "Borrador en este navegador" : "Entorno local")));
  return drawer;
}

function topbar(route, ctx) {
  const initials = ctx.user.username.slice(0, 2).toUpperCase();
  const logout = button("Salir", { appearance: "quiet small", lead: "logout", onClick: safeAction(async () => {
    await request("logout", { method: "POST", data: {} });
    clearSession();
    renderLogin();
  }) });
  return el("header", { class: "topbar" }, el("span", { class: "crumb" }, "Administración / " + pages[route].title),
    el("div", { class: "topbar-tools" },
      transport && ctx.draft ? button(ctx.draft.status === "building" ? "Ver publicación" : "Publicar", {
        appearance: "small", "data-cms-publish": "", disabled: sending,
        onClick: safeAction(ctx.draft.status === "building" ? () => navigate("publicacion") : startPublication),
      }) : null,
      el("div", { class: "topbar-user" }, el("span", { class: "avatar", "aria-hidden": "true" }, initials),
        el("span", {}, el("strong", {}, ctx.user.username), el("small", {}, roleLabel(ctx.user.role)))),
      logout));
}

function draftSelector(ctx) {
  if (transport) return null;
  const draftChoice = select("working-draft", [["", "Elegir borrador"], ...ctx.drafts.map(item => [item.id, item.title])],
    ctx.draft?.id ?? "");
  draftChoice.addEventListener("change", async () => {
    draftChoice.disabled = true;
    try {
      await selectDraft(draftChoice.value);
    } catch (error) {
      document.querySelector(".flash")?.replaceChildren(feedback(error.message, "error", error.details));
    } finally {
      draftChoice.disabled = false;
      draftChoice.value = state.draft?.id ?? "";
    }
  });
  return el("div", { class: "scope" },
    el("div", {}, el("label", {}, "Borrador activo ", draftChoice),
      ctx.draft ? status(ctx.draft.status) : null),
    el("div", { class: "scope-status" },
      ctx.draft ? button("Actualizar", { appearance: "quiet small", "aria-label": "Actualizar borrador", onClick: safeAction(() => ctx.refreshDraft()) }) : null,
      ctx.capabilities.edit ? button("Crear borrador", { appearance: "secondary small", lead: "plus", onClick: ctx.newDraft }) : null));
}

function dashboardView(ctx) {
  const quarter = (ctx.live.quarters ?? []).find(item => item.id === ctx.live.activeQuarterId);
  if (transport) {
    return ctx.page("Panel editorial", "Elige qué quieres editar. Guarda los cambios y pulsa Publicar cuando estén listos.",
      el("div", { class: "stack" },
        card("Trimestre publicado", el("strong", {}, quarter?.title || "Sin trimestre activo")),
        el("div", { class: "grid-3" },
          quick("lecciones", "Edita las lecturas y citas bíblicas"),
          quick("recursos", "Agrega materiales a la biblioteca o a una lección"),
          quick("importar", "Abre un PDF, un documento o un enlace"),
          quick("calendario", "Consulta o prepara otro trimestre"),
          quick("fuentes", "Configura el origen de audios y presentaciones"),
          quick("sitio", "Edita los menús y los módulos del sitio"))),
      actionLink("Ver sitio", "/", "secondary", { target: "_blank", rel: "noopener" }));
  }
  const drafts = ctx.drafts;
  const numberWaiting = drafts.filter(item => item.status === "submitted").length;
  const start = el("div", { class: "stack" },
    el("div", { class: "grid-2" },
      card(null, [
        el("span", { class: "eyebrow" }, "Trimestre publicado"),
        el("strong", {}, quarter?.title || ctx.live.activeQuarterId || "Sin trimestre activo"),
        el("p", { class: "muted" }, quarter ? String(quarter.year) + " · Trimestre " + quarter.quarterNumber : ""),
        actionLink("Gestionar trimestres", "#calendario"),
      ], { className: "active-card" }),
      card("Actividad editorial", el("div", { class: "metric-row" },
        el("div", { class: "metric" }, el("strong", {}, (ctx.live.quarters ?? []).length), el("span", {}, "Trimestres")),
        el("div", { class: "metric" }, el("strong", {}, drafts.length), el("span", {}, "Borradores")),
        el("div", { class: "metric" }, el("strong", {}, numberWaiting), el("span", {}, "En revisión"))))),
    el("div", { class: "grid-3" },
      quick("calendario", "Organiza el próximo período"),
      quick("lecciones", "Edita lecturas y referencias"),
      quick("importar", "Trabaja desde PDF, HTML, Markdown o URL")),
    card("Borradores", drafts.length ? el("ul", { class: "list" }, drafts.map(item =>
      el("li", { class: "row row-between" },
        el("div", { class: "item-text" }, el("strong", {}, item.title),
          el("span", { class: "small muted" }, formattedDate(item.updatedAt))),
        el("div", { class: "row" }, status(item.status),
          button(ctx.draft?.id === item.id ? "Revisar estado" : "Abrir", {
            appearance: "secondary small",
            onClick: safeAction(async () => {
              await selectDraft(item.id, false);
              navigate("publicacion");
            }),
          }))))) : empty("Aún no hay borradores.")));
  return ctx.page("Panel editorial", "Gestiona el contenido y revisa los cambios pendientes.", start,
    ctx.capabilities.edit ? button("Crear borrador", { lead: "plus", onClick: ctx.newDraft }) : null);
}

function quick(name, description) {
  return el("a", { class: "card card-link", href: "#" + name }, icon(pages[name].icon, 21),
    el("h3", {}, pages[name].title), el("p", { class: "muted small" }, description));
}

function render({ focus = false } = {}) {
  if (!state.user) return renderLogin();
  const ctx = makeContext();
  const route = currentRoute();
  const selected = pages[route];
  document.title = selected.title + " | Escuela Sabática CL";
  const flash = el("div", { class: "flash", "aria-live": "polite" },
    state.flash ? feedback(state.flash.message, state.flash.tone) : null);
  state.flash = null;
  const skipLink = el("a", { class: "skip-link", href: "#main-content", onclick: event => {
    event.preventDefault();
    document.getElementById("main-content")?.focus();
  } }, "Saltar al contenido");
  const page = selected.needsDraft && !ctx.draft
    ? ctx.page(selected.title, "", card("Elige un borrador",
      empty(ctx.capabilities.edit ? "Selecciona un borrador o crea uno para empezar." : "Solicita acceso a un borrador al equipo editorial.")))
    : selected.view(ctx);
  app.replaceChildren(skipLink, el("div", { class: "shell" }, sidebar(route, ctx),
    el("div", { class: "content" }, topbar(route, ctx),
      el("main", { id: "main-content", class: "main", tabindex: "-1" },
        draftSelector(ctx), flash, page))));
  if (focus) {
    window.scrollTo(0, 0);
    setSectionFocus(app);
  }
  schedulePublicationCheck();
}

window.addEventListener("hashchange", () => {
  if (state.user && state.dashboard) render({ focus: true });
});

window.addEventListener("input", event => {
  if (!transport) return;
  const form = event.target.closest?.("form");
  if (form?.querySelector("button[type='submit']")) form.dataset.cmsDirty = "true";
});

export async function startBrowserPortal(createTransport) {
  try {
    transport = await createTransport();
    await boot();
  } catch (error) {
    app.replaceChildren(el("main", { class: "main error-view" }, card("No se pudo abrir el panel",
      el("div", { class: "stack" }, feedback(error.message, "error"),
        button("Reintentar", { onClick: () => startBrowserPortal(createTransport), appearance: "secondary" })))));
  }
}

if (!document.documentElement.hasAttribute("data-cms-browser")) boot();
