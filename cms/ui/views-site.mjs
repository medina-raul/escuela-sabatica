import { area, bindForm, button, card, checkbox, el, field, input, select } from "./dom.mjs";
import { catalogQuarters, quarterLabel } from "./views-content.mjs";

const sections = [
  ["home", "Inicio"], ["lessons", "Lecciones"], ["resources", "Recursos"], ["beliefs", "Creencias"],
  ["archive", "Trimestres"], ["bible", "Biblia"], ["custom", "Personalizado"],
];
const widgetTypes = [
  ["weekly-presentation", "Presentación de la semana"],
  ["teacher-reading", "Material para maestros"],
  ["complementary-book", "Libro complementario"],
  ["reavivados", "Reavivados"],
  ["friday-reading", "Lectura del viernes"],
  ["resource-library", "Biblioteca de recursos"],
  ["notice", "Aviso de texto"],
  ["link", "Enlace"],
];
const weekDays = [
  ["", "Todos los días"], ["sabado", "Sábado"], ["domingo", "Domingo"], ["lunes", "Lunes"],
  ["martes", "Martes"], ["miercoles", "Miércoles"], ["jueves", "Jueves"], ["viernes", "Viernes"],
];
const palettes = [["clasica", "Clásica"], ["azul", "Azul"], ["oliva", "Oliva"]];
const readingFonts = [["literata", "Literata"], ["lora", "Lora"], ["georgia", "Georgia"]];
const paletteColors = { clasica: "#0b1d33", azul: "#17476b", oliva: "#344438" };

export function siteView(ctx) {
  const site = ctx.draft.snapshot.site ?? {};
  const form = el("div", { class: "stack" },
    ctx.canSite ? null : el("p", { class: "notice" }, "Vista de consulta. Los cambios de diseño requieren permiso de administración."),
    navigation(ctx, site.navigation ?? []),
    appearance(ctx, site.theme ?? {}, site.seo ?? {}),
    widgetSettings(ctx, site.widgets ?? []),
    footerSettings(ctx, site.footer ?? {}));
  return ctx.page("Apariencia y navegación", "Configura el menú, la lectura, los widgets y el pie del sitio.", form);
}

function listEditor(initial, renderRow, blank, editable, label) {
  const rows = el("ol", { class: "layout-list" });
  const readers = new Map();
  function add(value) {
    const row = el("li", { class: "layout-item" });
    const { controls, read } = renderRow(value);
    const actions = editable ? el("div", { class: "row" },
      button("↑", { appearance: "secondary small", "aria-label": "Subir elemento", onClick: () => {
        if (row.previousElementSibling) row.before(row.previousElementSibling);
        row.querySelector("button")?.focus();
      } }),
      button("↓", { appearance: "secondary small", "aria-label": "Bajar elemento", onClick: () => {
        if (row.nextElementSibling) row.after(row.nextElementSibling);
        row.querySelector("button")?.focus();
      } }),
      button("Quitar", { appearance: "quiet small", onClick: () => {
        readers.delete(row);
        row.remove();
        rows.parentElement?.querySelector(".list-add")?.focus();
      } })) : null;
    row.append(...controls, ...(actions ? [actions] : []));
    readers.set(row, read);
    rows.append(row);
    return row;
  }
  for (const value of initial) add(value);
  const addButton = editable ? button(label, { class: "button secondary small list-add", lead: "plus", onClick: () => {
    add(blank()).querySelector("input,select")?.focus();
  } }) : null;
  return {
    content: [rows, addButton],
    read: () => Array.from(rows.children, row => readers.get(row)()),
  };
}

function navigation(ctx, links) {
  const disabled = !ctx.canSite;
  const editor = listEditor(links, item => {
    const label = input("label", item.label, { required: true, disabled, maxlength: 80 });
    const href = input("href", item.href, { required: true, disabled });
    const section = select("section", sections, item.section);
    section.disabled = disabled || item.section !== "custom";
    const visible = checkbox("visible", "Visible", item.visible !== false, { disabled });
    const mobile = checkbox("mobile", "En móvil", item.mobile ?? item.section !== "archive", { disabled });
    return {
      controls: [field("Etiqueta", label), field("Destino", href), el("div", { class: "stack-compact" }, field("Sección", section), visible, mobile)],
      read: () => ({
        ...item, label: label.value.trim(), href: href.value.trim(), section: section.value,
        external: href.value.trim().startsWith("https://"), visible: visible.querySelector("input").checked, mobile: mobile.querySelector("input").checked,
      }),
    };
  }, () => ({ section: "custom", label: "", href: "", visible: true, mobile: true }), ctx.canSite, "Agregar enlace");
  const form = el("form", { class: "stack-compact" }, editor.content,
    ctx.canSite ? button("Guardar menú", { type: "submit" }) : null);
  if (ctx.canSite) bindForm(form, () => ctx.change("site.update", { navigation: editor.read() }, "Menú guardado."));
  return card("Menú principal", form, { caption: "Cambia etiquetas, orden, destinos y visibilidad." });
}

function appearance(ctx, theme, seo) {
  const disabled = !ctx.canSite;
  const palette = select("palette", palettes, theme.palette ?? "clasica", { disabled });
  const font = select("readingFont", readingFonts, theme.readingFont ?? "literata", { disabled });
  const accent = input("accent", theme.accent ?? "#d4af37", { disabled, type: "color" });
  const previewHead = el("div", { class: "palette-head" }, "Escuela Sabática CL");
  const previewText = el("p", {}, "Texto de lectura para revisar el contraste y la tipografía elegida.");
  const previewAccent = el("strong", {}, "Versículo para memorizar");
  const preview = el("div", { class: "palette-preview" }, previewHead, previewText, previewAccent);
  function syncPreview() {
    previewHead.style.backgroundColor = paletteColors[palette.value] ?? paletteColors.clasica;
    previewText.style.fontFamily = (readingFonts.find(([id]) => id === font.value)?.[1] ?? "Georgia") + ", Georgia, serif";
    previewAccent.style.borderLeft = "4px solid " + accent.value;
    previewAccent.style.paddingLeft = "9px";
  }
  for (const control of [palette, font, accent]) control.addEventListener("input", syncPreview);
  syncPreview();
  const styleForm = el("form", { class: "stack-compact" }, field("Paleta", palette),
    field("Tipografía de lectura", font), field("Color de acento", accent), preview,
    ctx.canSite ? button("Guardar apariencia", { type: "submit" }) : null);
  if (ctx.canSite) bindForm(styleForm, data => ctx.change("site.update", {
    theme: { ...theme, palette: data.get("palette"), readingFont: data.get("readingFont"), accent: data.get("accent") },
  }, "Apariencia guardada."));

  const seoForm = el("form", { class: "stack-compact" },
    field("Título del sitio", input("title", seo.title, { disabled, required: true, maxlength: 120 })),
    field("Descripción", area("description", seo.description, { disabled, required: true, maxlength: 320, rows: "3" })),
    field("Imagen al compartir", input("image", seo.image, { disabled, required: true, placeholder: "/images/og-cover.svg" })),
    ctx.canSite ? button("Guardar datos del sitio", { type: "submit", appearance: "secondary" }) : null);
  if (ctx.canSite) bindForm(seoForm, data => ctx.change("site.update", {
    seo: { ...seo, title: data.get("title"), description: data.get("description"), image: data.get("image") },
  }, "Datos del sitio guardados."));
  return el("div", { class: "grid-2" }, card("Apariencia", styleForm), card("Datos para buscadores y redes", seoForm));
}

function widgetSettings(ctx, widgets) {
  const disabled = !ctx.canSite;
  const quarters = [["", "Todos los trimestres"], ...catalogQuarters(ctx).map(({ quarter }) => [quarter.id, quarterLabel(quarter)])];
  const editor = listEditor(widgets, widget => {
    const kind = select("type", widgetTypes, widget.type, { disabled });
    const title = input("title", widget.title, { disabled, required: true });
    const scope = select("quarterId", quarters, widget.quarterId ?? "", { disabled });
    const day = select("dayId", weekDays, widget.dayId ?? "", { disabled });
    const enabled = checkbox("enabled", "Visible", widget.enabled !== false, { disabled });
    const text = area("text", widget.text, { disabled, rows: "2" });
    const href = input("href", widget.href, { disabled, placeholder: "https://… o /recursos" });
    const textField = field("Texto del aviso", text);
    const hrefField = field("Destino", href);
    const sync = () => {
      textField.hidden = kind.value !== "notice";
      hrefField.hidden = kind.value !== "link";
      text.required = !textField.hidden && !disabled;
      href.required = !hrefField.hidden && !disabled;
    };
    kind.addEventListener("change", sync);
    sync();
    return {
      controls: [
        el("div", { class: "stack-compact" }, field("Tipo", kind), field("Título", title)),
        el("div", { class: "stack-compact" }, field("Trimestre", scope), textField, hrefField),
        el("div", { class: "stack-compact" }, field("Día", day), enabled),
      ],
      read: () => ({
        ...widget, type: kind.value, title: title.value.trim(),
        enabled: enabled.querySelector("input").checked, placement: "sidebar",
        quarterId: scope.value || undefined, dayId: day.value || undefined,
        text: kind.value === "notice" ? text.value.trim() : undefined,
        href: kind.value === "link" ? href.value.trim() : undefined,
      }),
    };
  }, () => ({ id: "widget-" + crypto.randomUUID().slice(0, 12), type: "notice", title: "", enabled: true }), ctx.canSite, "Agregar widget");
  const form = el("form", { class: "stack-compact" }, editor.content,
    ctx.canSite ? button("Guardar widgets", { type: "submit" }) : null);
  if (ctx.canSite) bindForm(form, () => ctx.change("site.update", { widgets: editor.read() }, "Widgets guardados."));
  return card("Widgets de la barra lateral", form, { caption: "Ordena los bloques y define dónde aparecen." });
}

function footerSettings(ctx, footer) {
  const disabled = !ctx.canSite;
  const editor = listEditor(footer.links ?? [], link => {
    const label = input("label", link.label, { required: true, disabled });
    const href = input("href", link.href, { required: true, disabled });
    const description = input("description", link.description, { disabled });
    const iconUrl = input("iconUrl", link.iconUrl, { disabled });
    return {
      controls: [
        field("Etiqueta", label), el("div", { class: "stack-compact" }, field("Destino", href), field("Icono", iconUrl)),
        field("Descripción", description),
      ],
      read: () => ({
        ...link, label: label.value.trim(), href: href.value.trim(), description: description.value.trim(),
        iconUrl: iconUrl.value.trim() || undefined,
      }),
    };
  }, () => ({ label: "", href: "", description: "" }), ctx.canSite, "Agregar enlace al pie");
  const form = el("form", { class: "stack-compact" },
    el("div", { class: "form-grid" },
      field("Nombre", input("brand", footer.brand, { disabled, required: true })),
      field("Créditos", input("credits", footer.credits, { disabled, required: true }))),
    editor.content, ctx.canSite ? button("Guardar pie de página", { type: "submit", appearance: "secondary" }) : null);
  if (ctx.canSite) bindForm(form, data => ctx.change("site.update", {
    footer: { ...footer, brand: data.get("brand"), credits: data.get("credits"), links: editor.read() },
  }, "Pie de página guardado."));
  return card("Pie de página", form);
}
