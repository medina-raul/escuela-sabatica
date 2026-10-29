import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import catalog from "@data/beliefs/beliefs.es.json";
import type { Belief, BeliefChapter, BeliefReference, OpenBeliefReferences } from "./types";
import "./beliefs.css";
import "./beliefs-reader.css";

const BeliefsReader = lazy(() => import("./BeliefsReader").then(module => ({ default: module.BeliefsReader })));
const beliefs: Belief[] = catalog.beliefs;
const categories = catalog.categories;
const STORAGE_KEY = "escuela-sabatica:beliefs-explorer:v1";
const artwork: Record<string, string> = {
  dios: "scriptures.webp",
  humanidad: "creation.webp",
  salvacion: "salvation.webp",
  iglesia: "church-v1.webp",
  "vida-cristiana": "christian-life-v1.webp",
  restauracion: "restoration-v1.webp",
};
const categoryNames: Record<string, string> = Object.fromEntries(categories.map(category => [category.id, category.title]));
const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es");
const beliefHref = (belief: Belief) => `/creencias/${belief.slug}`;

function excerpt(value: string, length = 155) {
  if (value.length <= length) return value;
  const end = value.lastIndexOf(" ", length);
  return `${value.slice(0, end > 0 ? end : length).trimEnd()}…`;
}

function nextBatch(current: number, total: number) {
  const next = Math.min(current + 9, total);
  return total - next <= 1 ? total : next;
}

function BeliefSelector({ currentSlug = "" }: { currentSlug?: string }) {
  return <label className="beliefs-selector">
    <span className="beliefs-control-label">Ir a una creencia</span>
    <span className="beliefs-select-control"><select value={currentSlug} onChange={event => {
      const selected = beliefs.find(belief => belief.slug === event.target.value);
      if (selected && selected.slug !== currentSlug) window.location.assign(beliefHref(selected));
    }}>
      <option value="" disabled>Elegir una creencia</option>
      {categories.map(category => <optgroup label={categoryNames[category.id]} key={category.id}>
        {beliefs.filter(belief => belief.categoryId === category.id).map(belief => <option value={belief.slug} key={belief.id}>{String(belief.number).padStart(2, "0")}. {belief.title}</option>)}
      </optgroup>)}
    </select><svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg></span>
  </label>;
}

function ResourceCredit() {
  return <p className="beliefs-credit">28 creencias fundamentales · Gentileza de <a href="https://www.santabiblia.cloud/beliefs" target="_blank" rel="noopener noreferrer">Santa Biblia</a> <span>(santabiblia.cloud)</span></p>;
}

function NotesDialog({ open, onClose, trigger }: { open: boolean; onClose: () => void; trigger: HTMLElement | null }) {
  const dialogRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    const bodyWasLocked = document.body.classList.contains("modal-open");
    document.body.classList.add("modal-open");
    dialog?.querySelector<HTMLButtonElement>("button")?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),[tabindex="0"]')).filter(element => element.getClientRects().length > 0);
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (!bodyWasLocked) document.body.classList.remove("modal-open");
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, [open, onClose, trigger]);
  if (!open || typeof document === "undefined") return null;
  return createPortal(<div className="beliefs-notes-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="beliefs-notes-dialog" role="dialog" aria-modal="true" aria-labelledby="beliefs-notes-title" ref={dialogRef}>
      <header className="beliefs-notes-header"><h2 id="beliefs-notes-title">Notas sobre la versión</h2><button className="beliefs-notes-close" type="button" onClick={onClose} aria-label="Cerrar notas sobre la versión">×</button></header>
      <div className="beliefs-notes-body">
        <p>Las declaraciones breves de las 28 creencias fundamentales de los adventistas del séptimo día están basadas en el texto oficial de la <a href="https://institucional.adventistas.org/es/nuestras-crencias/" target="_blank" rel="noopener noreferrer">División Sudamericana</a>.</p>
        <section><h3>Exposición ampliada</h3>
          <p>La ampliación de cada tema corresponde al libro <em>Creencias de los Adventistas del Séptimo Día: Una exposición bíblica de las doctrinas fundamentales</em>, de la Asociación Ministerial de la Asociación General de la Iglesia Adventista del Séptimo Día (2006).</p>
          <p>Título original: <em>Seventh-day Adventists Believe</em>. Traducción: Armando Collins y Miguel A. Valdivia. Diagramación de interiores y tapa: Publicaciones Interamericanas. Edición en español: Asociación Casa Editora Sudamericana (ACES), 2007.</p>
          <p><a href="https://assets.adventistconnect.org/angelesv/2026/01/26073640/28-Creencias-Fundamentales.pdf" target="_blank" rel="noopener noreferrer">Consultar la edición digital de 2007 ↗</a></p>
        </section>
        <section><h3>Referencias bíblicas</h3><p>Las citas bíblicas identificadas se abren en el lector modal de Escuela Sabática, con textos, versiones y comentarios de <a href="https://www.santabiblia.cloud" target="_blank" rel="noopener noreferrer">Santa Biblia</a>. La versión inicial es Reina-Valera Actualizada 2015.</p></section>
        <p className="beliefs-rights">© Asociación Ministerial de la Asociación General de la Iglesia Adventista del Séptimo Día, 2006; © ACES, 2007.</p>
        <p>Este material es un recurso de estudio independiente y no representa un sitio oficial de la Iglesia Adventista del Séptimo Día.</p>
        <ResourceCredit />
      </div>
    </section>
  </div>, document.body);
}

function OfficialReferences({ references, title, onOpen }: { references: BeliefReference[]; title: string; onOpen: OpenBeliefReferences }) {
  const groups: Array<{ source: string; references: BeliefReference[] }> = [];
  references.forEach(reference => {
    const previous = groups.at(-1);
    if (previous?.source === reference.sourceGroup && previous.references[0].bookId === reference.bookId) previous.references.push(reference);
    else groups.push({ source: reference.sourceGroup || reference.label, references: [reference] });
  });
  return <p className="beliefs-citations">{groups.map((group, index) => <span key={`${index}-${group.source}`}>
    <button className="beliefs-citation" type="button" aria-haspopup="dialog" aria-label={`Abrir referencias bíblicas: ${group.references.map(reference => reference.label).join("; ")}`} onClick={event => onOpen(group.references, title, event.currentTarget)}>{group.source}</button>
    {index < groups.length - 1 && <span aria-hidden="true">; </span>}
  </span>)}</p>;
}

function ExpandedBelief({ belief, onOpen }: { belief: Belief; onOpen: OpenBeliefReferences }) {
  const [expanded, setExpanded] = useState(false);
  const [chapter, setChapter] = useState<BeliefChapter | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!expanded || chapter) return;
    const controller = new AbortController();
    setStatus("loading");
    const chapterId = String(belief.number).padStart(2, "0");
    fetch(`/data/beliefs/chapters/${chapterId}.json`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error("Chapter unavailable");
        const data = await response.json() as BeliefChapter;
        if (data.beliefNumber !== belief.number || !Array.isArray(data.blocks) || !Array.isArray(data.references)) throw new Error("Invalid chapter");
        return data;
      })
      .then(data => { if (!controller.signal.aborted) { setChapter(data); setStatus("ready"); } })
      .catch(() => { if (!controller.signal.aborted) setStatus("error"); });
    return () => controller.abort();
  }, [expanded, chapter, belief.number, attempt]);
  const referenceMap = useMemo(() => new Map((chapter?.references ?? []).map(reference => [reference.id, reference])), [chapter]);

  function paragraph(block: BeliefChapter["blocks"][number], blockIndex: number) {
    if (!block.citations?.length) return block.text;
    const parts: Array<string | React.JSX.Element> = [];
    let cursor = 0;
    block.citations.forEach((citation, index) => {
      if (citation.start < cursor || citation.end > block.text.length || citation.end <= citation.start) return;
      const text = block.text.slice(citation.start, citation.end);
      const references = citation.referenceIds.map(id => referenceMap.get(id)).filter((reference): reference is BeliefReference => Boolean(reference));
      parts.push(block.text.slice(cursor, citation.start));
      parts.push(references.length ? <button key={`${blockIndex}-${index}`} className="beliefs-citation" type="button" aria-haspopup="dialog" aria-label={`Abrir referencias bíblicas: ${references.map(reference => reference.label).join("; ")}`} onClick={event => onOpen(references, belief.title, event.currentTarget)}>{text}</button> : text);
      cursor = citation.end;
    });
    parts.push(block.text.slice(cursor));
    return parts;
  }

  return <section className="beliefs-expansion" aria-label={`Exposición ampliada: ${belief.title}`}>
    <button className="beliefs-expansion-toggle" type="button" aria-expanded={expanded} aria-controls={`belief-expansion-${belief.number}`} onClick={() => setExpanded(value => !value)}>
      <span className="beliefs-expansion-copy"><span className="beliefs-eyebrow">Exposición ampliada</span><strong>{expanded ? "Ocultar exposición completa" : "Leer la exposición completa"}</strong></span>
      <span className="beliefs-expansion-meta">Edición 2007 <span aria-hidden="true">{expanded ? "⌃" : "⌄"}</span></span>
    </button>
    {expanded && <div className="beliefs-expansion-content" id={`belief-expansion-${belief.number}`}>
      {status === "loading" && <p className="beliefs-status" role="status">Cargando la exposición…</p>}
      {status === "error" && <div className="beliefs-error" role="alert"><p>No se pudo cargar el texto de esta creencia.</p><button type="button" onClick={() => setAttempt(value => value + 1)}>Intentar de nuevo</button></div>}
      {chapter && <>
        <header className="beliefs-expansion-header"><div><p className="beliefs-eyebrow">Lectura ampliada</p><h2>{chapter.bookChapterTitle}</h2></div><small>Edición 2007 · págs. {chapter.printedPages[0]}–{chapter.printedPages[1]}</small></header>
        <div className="beliefs-expanded-text">{chapter.blocks.map((block, index) => {
          if (block.kind === "heading") return <h3 key={index}>{block.text}</h3>;
          if (block.kind === "figure") return <figure key={index}><figcaption><strong>{block.title}</strong> {block.text}</figcaption></figure>;
          return <p key={index}>{paragraph(block, index)}</p>;
        })}</div>
      </>}
    </div>}
  </section>;
}

type ExplorerState = { query: string; category: string; visibleCount: number; initialBatch: number };

export default function BeliefsPage({ slug }: { slug?: string }) {
  const belief = slug ? beliefs.find(item => item.slug === slug) : undefined;
  const [explorer, setExplorer] = useState<ExplorerState>({ query: "", category: "all", visibleCount: 9, initialBatch: 9 });
  const [restored, setRestored] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [selection, setSelection] = useState<{ references: BeliefReference[]; title: string; trigger: HTMLElement } | null>(null);
  const notesTrigger = useRef<HTMLElement | null>(null);
  const closeNotes = useCallback(() => setNotesOpen(false), []);
  const closeReader = useCallback(() => setSelection(null), []);
  const onOpen: OpenBeliefReferences = (references, title, trigger) => setSelection({ references, title, trigger });

  useEffect(() => {
    if (slug) return;
    const initialBatch = window.matchMedia("(max-width: 620px)").matches ? 3 : 9;
    let state: ExplorerState = { query: "", category: "all", initialBatch, visibleCount: initialBatch };
    try {
      const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "null") as Partial<ExplorerState> | null;
      if (saved && typeof saved.query === "string" && (saved.category === "all" || categories.some(category => category.id === saved.category))) {
        state = { query: saved.query, category: saved.category!, initialBatch, visibleCount: saved.initialBatch === initialBatch ? Math.max(initialBatch, Math.min(28, Number(saved.visibleCount) || initialBatch)) : initialBatch };
      }
    } catch { /* Browsing storage may be unavailable; the catalog still works. */ }
    setExplorer(state);
    setRestored(true);
    const viewport = window.matchMedia("(max-width: 620px)");
    const updateBatch = () => {
      const batch = viewport.matches ? 3 : 9;
      setExplorer(current => current.initialBatch === batch ? current : { ...current, initialBatch: batch, visibleCount: batch });
    };
    viewport.addEventListener("change", updateBatch);
    return () => viewport.removeEventListener("change", updateBatch);
  }, [slug]);
  useEffect(() => {
    if (!restored || slug) return;
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(explorer)); } catch { /* Storage is optional. */ }
  }, [explorer, restored, slug]);

  const filtered = useMemo(() => {
    const query = normalize(explorer.query.trim());
    return beliefs.filter(item => (explorer.category === "all" || item.categoryId === explorer.category)
      && (!query || normalize(`${item.number} ${item.title} ${item.paragraphs.join(" ")} ${item.references.map(reference => reference.label).join(" ")}`).includes(query)));
  }, [explorer.query, explorer.category]);
  const visible = filtered.slice(0, explorer.visibleCount);
  const openNotes = (trigger: HTMLElement) => { notesTrigger.current = trigger; setNotesOpen(true); };
  const index = belief ? beliefs.findIndex(item => item.slug === belief.slug) : -1;
  const previous = beliefs[index - 1];
  const next = beliefs[index + 1];
  const image = `/images/beliefs/${artwork[belief?.categoryId ?? "dios"]}`;

  return <div className="beliefs-resource">
    {belief && <div className="beliefs-toolbar">
      <a className="beliefs-back" href="/creencias"><span aria-hidden="true">←</span>Volver a las 28 creencias</a>
      <BeliefSelector currentSlug={belief.slug} />
    </div>}
    <header className="beliefs-hero">
      <div className="beliefs-hero-art" aria-hidden="true"><img src={image} alt="" width="1536" height="1024" decoding="async" /></div>
      <div className="beliefs-hero-copy"><p className="beliefs-eyebrow">{belief ? categoryNames[belief.categoryId] : "Un recorrido de estudio"}</p><h1>{belief?.title ?? "28 creencias fundamentales"}</h1><p className="beliefs-subtitle">{belief ? "Declaración oficial · División Sudamericana" : "Una fe para vivir cada día. Explora las enseñanzas bíblicas que compartimos los adventistas del séptimo día."}</p></div>
    </header>

    {belief ? <>
      <article className="beliefs-statement"><div className="beliefs-meta"><span>{String(belief.number).padStart(2, "0")}</span><span>Declaración oficial</span></div>{belief.paragraphs.map((text, paragraphIndex) => <p key={paragraphIndex}>{text}</p>)}
        <section aria-label="Referencias bíblicas de la declaración oficial"><OfficialReferences references={belief.references} title={belief.title} onOpen={onOpen} /></section>
        <p className="beliefs-source"><a href={belief.source.officialSpanishWebUrl} target="_blank" rel="noopener noreferrer">Ver declaración oficial en la División Sudamericana ↗</a></p>
      </article>
      <ExpandedBelief belief={belief} onOpen={onOpen} />
    </> : <>
      <aside className="beliefs-notice beliefs-inner" aria-label="Aviso sobre este recurso"><p>Este material es un recurso de estudio independiente y no representa un sitio oficial de la Iglesia Adventista del Séptimo Día. Para más detalles sobre el texto que se presenta a continuación, consulta las <button type="button" className="beliefs-notes-link" aria-haspopup="dialog" onClick={event => openNotes(event.currentTarget)}>Notas sobre la versión</button>.</p></aside>
      <section className="beliefs-explorer beliefs-inner" aria-labelledby="belief-list-heading">
        <div className="beliefs-explorer-heading"><div><p className="beliefs-eyebrow">Un recorrido por nuestra fe</p><h2 id="belief-list-heading">Encuentra un tema para explorar.</h2></div></div>
        <div className="beliefs-tools">
          <label className="beliefs-search-field"><span className="beliefs-control-label">Buscar creencias</span><span className="beliefs-search"><svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></svg><input type="search" placeholder="Título, tema o cita bíblica" value={explorer.query} onChange={event => setExplorer(current => ({ ...current, query: event.target.value, visibleCount: current.initialBatch }))} /></span></label>
          <BeliefSelector />
        </div>
        <div className="beliefs-categories" role="group" aria-label="Filtrar por tema"><button type="button" aria-pressed={explorer.category === "all"} onClick={() => setExplorer(current => ({ ...current, category: "all", visibleCount: current.initialBatch }))}>Todas <span>28</span></button>{categories.map(category => <button type="button" key={category.id} aria-pressed={explorer.category === category.id} onClick={() => setExplorer(current => ({ ...current, category: category.id, visibleCount: current.initialBatch }))}>{categoryNames[category.id]} <span>{category.beliefNumbers.length}</span></button>)}</div>
        <p className="beliefs-count" role="status" aria-live="polite">Mostrando {visible.length} de {filtered.length} {filtered.length === 1 ? "creencia" : "creencias"}</p>
        {visible.length ? <><div className="beliefs-grid" id="belief-grid">{visible.map(item => <a className="beliefs-card" href={beliefHref(item)} key={item.id} aria-label={`${item.number}. ${item.title}: leer creencia`}>
          <span className="beliefs-card-art" aria-hidden="true"><img src={`/images/beliefs/${artwork[item.categoryId]}`} alt="" width="1536" height="1024" loading="lazy" decoding="async" /><span className="beliefs-number">{String(item.number).padStart(2, "0")}</span></span>
          <span className="beliefs-card-copy"><span className="beliefs-card-category">{categoryNames[item.categoryId]}</span><strong className="beliefs-card-title">{item.title}</strong><span className="beliefs-card-excerpt">{excerpt(item.paragraphs[0])}</span><span className="beliefs-card-footer"><span>{item.references.length} pasajes bíblicos</span><span>Leer creencia <span aria-hidden="true">→</span></span></span></span>
        </a>)}</div>{visible.length < filtered.length && <button className="beliefs-more" type="button" aria-controls="belief-grid" onClick={() => setExplorer(current => ({ ...current, visibleCount: nextBatch(current.visibleCount, filtered.length) }))}>Mostrar {nextBatch(explorer.visibleCount, filtered.length) - visible.length} {nextBatch(explorer.visibleCount, filtered.length) - visible.length === 1 ? "creencia" : "creencias"} más <span aria-hidden="true">⌄</span></button>}</>
          : <div className="beliefs-empty"><p>No encontramos una creencia para esa búsqueda.</p><button type="button" onClick={() => setExplorer(current => ({ ...current, query: "", category: "all", visibleCount: current.initialBatch }))}>Limpiar búsqueda</button></div>}
      </section>
    </>}

    <footer className="beliefs-footer"><button className="beliefs-notes-link" type="button" aria-haspopup="dialog" onClick={event => openNotes(event.currentTarget)}>Notas sobre la versión <span aria-hidden="true">↗</span></button><ResourceCredit /></footer>
    {belief && <nav className="beliefs-pager" aria-label="Recorrer las 28 creencias"><a href={previous ? beliefHref(previous) : "/creencias"}><span aria-hidden="true">←</span><span><small>{previous ? "Creencia anterior" : "El recorrido completo"}</small><strong>{previous?.title ?? "Las 28 creencias"}</strong></span></a>{next && <a href={beliefHref(next)}><span><small>Creencia siguiente</small><strong>{next.title}</strong></span><span aria-hidden="true">→</span></a>}</nav>}
    <NotesDialog open={notesOpen} onClose={closeNotes} trigger={notesTrigger.current} />
    {selection && <Suspense fallback={<p className="beliefs-status" role="status">Abriendo el lector bíblico…</p>}><BeliefsReader references={selection.references} title={selection.title} returnFocus={selection.trigger} onClose={closeReader} /></Suspense>}
  </div>;
}
