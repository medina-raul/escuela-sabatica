function appendNode(parent, child) {
  if (child === null || child === undefined || child === false) return;
  if (Array.isArray(child)) {
    for (const item of child) appendNode(parent, item);
    return;
  }
  parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
}

export function el(tag, attributes, ...children) {
  const node = document.createElement(tag);
  let value;
  for (const [key, item] of Object.entries(attributes ?? {})) {
    if (item === undefined || item === null) continue;
    if (key === "value") {
      value = item;
    } else if (typeof item === "function" && key.startsWith("on")) {
      node.addEventListener(key.slice(2).toLowerCase(), item);
    } else if (typeof item === "boolean" && !key.startsWith("aria-")) {
      if (item) node.setAttribute(key, "");
    } else {
      node.setAttribute(key, String(item));
    }
  }
  for (const child of children) appendNode(node, child);
  if (value !== undefined) node.value = String(value);
  return node;
}

const iconPaths = {
  book: "M12 6.5v14M3.5 4.5H7c2 0 3.7.7 5 2 1.3-1.3 3-2 5-2h3.5v14H17c-2 0-3.7.7-5 2-1.3-1.3-3-2-5-2H3.5z",
  home: "m3 11 9-8 9 8M5 10v10h14V10m-9 10v-6h4v6",
  calendar: "M5 5h14a2 2 0 0 1 2 2v12H3V7a2 2 0 0 1 2-2zm2-2v4m10-4v4M3 10h18m-13 4h2m4 0h2",
  import: "M3 14v6h18v-6M12 16V4m-4 4 4-4 4 4",
  folder: "M3 7h7l2 2h9v11H3zM3 7V4h7l2 3",
  site: "M3 5h18v14H3zM3 9h18M8 9v10",
  sources: "M17 7h-6a5 5 0 0 0-5 5v1m1 4h6a5 5 0 0 0 5-5v-1M14 4l3 3-3 3M10 14l-3 3 3 3",
  check: "M6 3h11l3 3v15H5V3zm3 10 2 2 4-4",
  users: "M16 21v-3a3 3 0 0 0-3-3H6a3 3 0 0 0-3 3v3m18 0v-3a3 3 0 0 0-2-2.8M10 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm7 .5a4 4 0 0 1 0 7",
  plus: "M12 5v14M5 12h14",
  arrow: "M5 12h14m-5-5 5 5-5 5",
  logout: "M10 4H4v16h6m1-8h10m-4-4 4 4-4 4",
  menu: "M4 6h16M4 12h16M4 18h16",
  eye: "M3 12s3-5 9-5 9 5 9 5-3 5-9 5-9-5-9-5zm12 0a3 3 0 1 0-6 0 3 3 0 0 0 6 0",
};

export function icon(name, size = 18) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  const properties = {
    viewBox: "0 0 24 24", width: size, height: size, fill: "none",
    stroke: "currentColor", "stroke-width": "1.65", "stroke-linecap": "round",
    "stroke-linejoin": "round", "aria-hidden": "true", focusable: "false",
  };
  for (const [key, value] of Object.entries(properties)) svg.setAttribute(key, value);
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", iconPaths[name] ?? iconPaths.arrow);
  svg.append(path);
  return svg;
}

export function button(label, options = {}) {
  const { appearance = "", type = "button", lead, onClick, ...attributes } = options;
  return el("button", { class: "button " + appearance, type, onclick: onClick, ...attributes },
    lead ? icon(lead, 16) : null, label);
}

export function actionLink(label, href, appearance = "secondary", attrs = {}) {
  return el("a", { class: "button " + appearance, href, ...attrs }, label);
}

export function field(label, control, options = {}) {
  const { help, wide } = options;
  return el("label", { class: "field" + (wide ? " wide" : "") },
    el("span", {}, label), control, help ? el("small", {}, help) : null);
}

export function input(name, value = "", attributes = {}) {
  return el("input", { name, value, ...attributes });
}

export function select(name, options, value = "", attributes = {}) {
  const rows = options.map(item => Array.isArray(item) ? item : [item, item]);
  return el("select", { name, value, ...attributes },
    rows.map(([key, label]) => el("option", { value: key }, label)));
}

export function area(name, value = "", attributes = {}) {
  return el("textarea", { name, value, ...attributes });
}

export function checkbox(name, label, checked = false, attributes = {}) {
  return el("label", { class: "check" }, el("input", { name, type: "checkbox", checked, ...attributes }), label);
}

export function values(form) {
  return Object.fromEntries(new FormData(form));
}

export function feedback(message, tone = "info", details = []) {
  const list = Array.isArray(details) && details.length
    ? el("ul", {}, details.map(detail => el("li", {}, typeof detail === "string" ? detail : (detail?.message ?? String(detail)))))
    : null;
  return el("div", { class: "notice " + tone, role: tone === "error" ? "alert" : "status" }, message, list);
}

export function setFeedback(target, error) {
  target.replaceChildren(feedback(error.message || "No se pudo completar la acción.", "error", error.details));
}

export function bindForm(form, handler) {
  const messages = el("div", { class: "form-notice", "aria-live": "polite" });
  form.append(messages);
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (form.getAttribute("aria-busy") === "true") return;
    const active = [...form.querySelectorAll("button[type=submit]")].filter(node => !node.disabled);
    form.setAttribute("aria-busy", "true");
    messages.replaceChildren();
    try {
      const data = new FormData(form);
      for (const node of active) node.disabled = true;
      await handler(data, messages, event);
      delete form.dataset.cmsDirty;
    } catch (error) {
      if (form.isConnected) setFeedback(messages, error);
    } finally {
      for (const node of active) node.disabled = false;
      form.removeAttribute("aria-busy");
    }
  });
  return form;
}

export function card(title, children, options = {}) {
  const { caption, action, className = "" } = options;
  return el("section", { class: "card " + className },
    title ? el("div", { class: "card-head" },
      el("div", {}, el("h2", {}, title), caption ? el("p", { class: "small" }, caption) : null),
      action) : null, children);
}

export function table(headers, rows, { label } = {}) {
  return el("div", { class: "table-wrap", role: "region", "aria-label": label, tabindex: 0 },
    el("table", { "aria-label": label },
      el("thead", {}, el("tr", {}, headers.map(item => el("th", { scope: "col" }, item)))),
      el("tbody", {}, rows.map(row =>
        el("tr", {}, row.map((cell, index) =>
          el(index === 0 ? "th" : "td", index === 0 ? { scope: "row" } : {}, cell)))))));
}

const statusLabels = {
  editing: ["En edición", "blue"], submitted: ["En revisión", "gold"],
  approved: ["Aprobado", "green"], draft: ["Borrador", "blue"],
  published: ["Publicado", "green"], archived: ["Archivado", ""],
  queued: ["En cola", ""], running: ["Procesando", "blue"],
  building: ["Construyendo", "blue"], ready: ["Listo", "green"],
  partial: ["Parcial", "gold"], failed: ["Error", "red"],
  pending: ["Pendiente", "gold"], accepted: ["Revisado", "green"], active: ["Activo", "green"],
  inactive: ["Inactivo", ""],
};
export function status(value, label) {
  const [defaultLabel, tone] = statusLabels[value] ?? [String(value ?? "—"), ""];
  return el("span", { class: "status " + tone }, label ?? defaultLabel);
}

export const roleLabel = role => ({ admin: "Administrador", editor: "Editor", reviewer: "Revisor", viewer: "Consulta" })[role] ?? String(role ?? "");
export function formattedDate(value) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return new Intl.DateTimeFormat("es-CL", { dateStyle: "medium", timeStyle: "short" }).format(parsed);
}

export function empty(message) {
  return el("div", { class: "empty" }, message);
}

export function confirmDialog(title, message, label = "Confirmar") {
  return new Promise(resolve => {
    const dialog = el("dialog", { "aria-labelledby": "confirm-action" },
      el("header", { class: "dialog-head" }, el("h2", { id: "confirm-action" }, title)),
      el("div", { class: "dialog-inner stack" },
        el("p", {}, message),
        el("form", { method: "dialog", class: "row row-end" },
          button("Cancelar", { type: "submit", value: "cancel", appearance: "secondary", autofocus: true }),
          button(label, { type: "submit", value: "yes", appearance: "danger" }))));
    dialog.addEventListener("close", () => {
      const confirmed = dialog.returnValue === "yes";
      dialog.remove();
      resolve(confirmed);
    }, { once: true });
    document.body.append(dialog);
    dialog.showModal();
  });
}

function formatInline(line) {
  const parts = [];
  const tokens = /\x60([^\x60\n]+)\x60|\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|\[([^\]\n]+)\]\(([^)\n]+)\)/g;
  let offset = 0;
  for (const match of line.matchAll(tokens)) {
    if (match.index > offset) parts.push(line.slice(offset, match.index));
    if (match[1]) parts.push(el("code", {}, match[1]));
    else if (match[2]) parts.push(el("strong", {}, match[2]));
    else if (match[3]) parts.push(el("em", {}, match[3]));
    else parts.push(match[4]);
    offset = match.index + match[0].length;
  }
  parts.push(line.slice(offset));
  return parts;
}

export function readingPreview(text) {
  if (!text?.trim()) return [el("p", { class: "muted" }, "Agrega texto para ver la lectura.")];
  const blocks = [];
  let paragraph = [];
  let activeList = null;
  const flush = () => {
    if (!paragraph.length) return;
    blocks.push(el("p", {}, formatInline(paragraph.join("\n"))));
    paragraph = [];
  };
  for (const line of text.split(/\r?\n/)) {
    const heading = /^#{1,6}\s+(.+)/.exec(line);
    const quoted = /^>\s?(.*)/.exec(line);
    const listed = /^\s*([-*]|\d+\.)\s+(.+)/.exec(line);
    if (!line.trim() || heading || quoted || listed) flush();
    if (!listed) activeList = null;
    if (heading) blocks.push(el("h4", {}, formatInline(heading[1])));
    else if (quoted) blocks.push(el("blockquote", {}, formatInline(quoted[1])));
    else if (listed) {
      const tag = /\d/.test(listed[1]) ? "ol" : "ul";
      if (!activeList || activeList.tagName.toLowerCase() !== tag) {
        activeList = el(tag, {});
        blocks.push(activeList);
      }
      activeList.append(el("li", {}, formatInline(listed[2])));
    } else if (line.trim()) paragraph.push(line);
  }
  flush();
  return blocks;
}

export function referencesList(references) {
  const labels = [...new Set((references ?? []).map(reference => {
    return typeof reference === "string" ? reference : reference?.display;
  }).filter(Boolean))];
  return labels.length
    ? el("div", { class: "references", "aria-label": "Referencias bíblicas" }, labels.map(label => el("span", {}, label)))
    : el("p", { class: "muted small" }, "Sin sugerencias en este texto.");
}

export function setSectionFocus(root) {
  const heading = root.querySelector("h1");
  if (!heading) return;
  heading.setAttribute("tabindex", "-1");
  heading.focus({ preventScroll: true });
}
