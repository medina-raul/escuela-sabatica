import { useEffect, useState, useCallback, useId, useRef } from "react";
import { BibleStudyModal } from "@components/bible/BibleStudyModal";
import type { BibleReference } from "@app-types/bible";
import { findBibleReferenceMatches } from "@lib/bibleReferenceParser";

type Props = {};
type Article = { url: string; title: string; credit?: string; previewUrl?: string };
type OpenArticle = Pick<Article, "url" | "title" | "credit"> & { format?: string };

function drivePreviewUrl(source: string): string | undefined {
  const match = source.match(/^https:\/\/drive\.google\.com\/file\/d\/([\w-]+)\/view$/);
  return match ? "https://drive.google.com/file/d/" + match[1] + "/preview" : undefined;
}

const ARTICLE_TAGS = new Set([
  "ARTICLE", "SECTION", "DIV", "P", "H1", "H2", "H3", "H4", "H5", "H6",
  "UL", "OL", "LI", "BLOCKQUOTE", "STRONG", "EM", "B", "I", "A", "BR",
  "HR", "CODE", "SUP", "SUB", "SPAN",
]);

function sanitizeArticleHtml(rawHtml: string) {
  const document = new DOMParser().parseFromString(rawHtml, "text/html");
  document
    .querySelectorAll("script,style,iframe,object,embed,form,input,button,svg,math,template,link,meta,base")
    .forEach((element) => element.remove());

  for (const element of Array.from(document.body.querySelectorAll("*"))) {
    if (!ARTICLE_TAGS.has(element.tagName)) {
      element.replaceWith(...Array.from(element.childNodes));
      continue;
    }
    for (const attribute of Array.from(element.attributes)) {
      const keepClass = attribute.name === "class";
      const keepLanguage = attribute.name === "lang" || attribute.name === "dir";
      const keepLinkAttribute = element.tagName === "A" && attribute.name === "href";
      const keepListNumber = /^\d+$/.test(attribute.value) && (
        (element.tagName === "LI" && attribute.name === "value") ||
        (element.tagName === "OL" && attribute.name === "start")
      );
      if (!keepClass && !keepLanguage && !keepLinkAttribute && !keepListNumber) element.removeAttribute(attribute.name);
    }
    if (element instanceof HTMLAnchorElement) {
      const href = element.getAttribute("href")?.trim() ?? "";
      try {
        const parsed = new URL(href, location.origin);
        if (!href || !["http:", "https:"].includes(parsed.protocol)) throw new Error("unsafe URL");
        element.href = parsed.href;
        element.target = "_blank";
        element.rel = "noopener noreferrer";
      } catch {
        element.replaceWith(...Array.from(element.childNodes));
      }
    }
  }
  return document.body.innerHTML;
}

function enhanceBibleReferences(root: HTMLElement, onOpen: (reference: BibleReference) => void): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let currentNode: Node | null;
  while ((currentNode = walker.nextNode())) {
    const textNode = currentNode as Text;
    const parent = textNode.parentElement;
    if (textNode.nodeValue?.trim() && !parent?.closest("a, code, .bible-inline")) textNodes.push(textNode);
  }

  for (const textNode of textNodes) {
    const value = textNode.nodeValue ?? "";
    const matches = findBibleReferenceMatches(value);
    if (matches.length === 0) continue;

    const fragment = document.createDocumentFragment();
    let cursor = 0;
    for (const { index, length, reference } of matches) {
      if (index > cursor) fragment.append(value.slice(cursor, index));
      const link = document.createElement("span");
      link.className = "bible-inline";
      link.setAttribute("role", "button");
      link.tabIndex = 0;
      link.textContent = value.slice(index, index + length);
      link.addEventListener("click", () => onOpen(reference));
      link.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen(reference);
        }
      });
      fragment.append(link);
      cursor = index + length;
    }
    if (cursor < value.length) fragment.append(value.slice(cursor));
    textNode.replaceWith(fragment);
  }
}

export function ArticleModal(_props: Props) {
  const [article, setArticle] = useState<Article | null>(null);
  const [activeReference, setActiveReference] = useState<BibleReference | null>(null);
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  const openArticle = useCallback((e: CustomEvent<OpenArticle>) => {
    const { url, title, format, credit } = e.detail;
    const previewUrl = format === "pdf" ? drivePreviewUrl(url) : undefined;
    if (format === "pdf" && !previewUrl) return;
    requestRef.current?.abort();
    setArticle({ url, title, credit, previewUrl });
    setActiveReference(null);
    setContent("");
    if (previewUrl) {
      setLoading(false);
      return;
    }
    const request = new AbortController();
    requestRef.current = request;
    setLoading(true);
    const fullUrl = url.startsWith("http") ? url : `${location.origin}${url}`;
    fetch(fullUrl, { signal: request.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then((html) => {
        if (request.signal.aborted) return;
        const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? html;
        const visibleBody = body.replace(/(?:Trimestre en preparación\.\s*)?Extracción pendiente de revisión editorial\.\s*/gi, "");
        setContent(sanitizeArticleHtml(visibleBody));
        setLoading(false);
      })
      .catch(() => {
        if (request.signal.aborted) return;
        setContent("<p>Error al cargar el contenido.</p>");
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    const handler = (e: Event) => openArticle(e as CustomEvent<OpenArticle>);
    window.addEventListener("open-article", handler);
    return () => {
      requestRef.current?.abort();
      window.removeEventListener("open-article", handler);
    };
  }, [openArticle]);

  useEffect(() => {
    if (loading || !content || !contentRef.current) return;
    const root = contentRef.current;
    // This effect owns the sanitized HTML and its reference links. React must
    // not replace them when opening or closing the nested Bible modal.
    root.innerHTML = content;
    enhanceBibleReferences(root, setActiveReference);
  }, [content, loading]);

  const onClose = useCallback(() => {
    requestRef.current?.abort();
    setArticle(null);
    setActiveReference(null);
  }, []);

  const previewUrl = article?.previewUrl;
  useEffect(() => {
    if (!previewUrl) return;
    const previousFocus = document.activeElement;
    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, [previewUrl, onClose]);

  const downloadPDF = async () => {
    if (!contentRef.current || !article) return;
    const { default: html2pdf } = await import("html2pdf.js");
    const el = contentRef.current;
    await html2pdf().set({
      margin: 10,
      filename: `${article.title.replace(/\s+/g, "-").toLowerCase()}.pdf`,
      image: { type: "jpeg", quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
    }).from(el).save();
  };

  if (!article) return null;

  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={previewUrl ? "bible-modal article-pdf-modal" : "bible-modal"} role="dialog" aria-modal="true" aria-labelledby={titleId} style={previewUrl ? undefined : { maxWidth: "min(94vw, 900px)" }}>
        <div className="modal-header">
          <h2 id={titleId}>{article.title}</h2>
          <button className="modal-close-btn" ref={closeButtonRef} type="button" onClick={onClose} aria-label="Cerrar">✕</button>
        </div>
        <div className="modal-body">
          {previewUrl ? (
            <>
              {article.credit && <p className="article-pdf-credit muted">{article.credit}</p>}
              <iframe className="article-pdf-frame" src={previewUrl} title={article.title} referrerPolicy="no-referrer" />
            </>
          ) : loading ? (
            <p className="muted">Cargando...</p>
          ) : (
            <div className="article-content" ref={contentRef} />
          )}
        </div>
        <div className="modal-actions">
          {previewUrl ? (
            <a className="ghost-button" href={article.url} target="_blank" rel="noopener noreferrer">Abrir PDF original ↗</a>
          ) : (
            <>
              <button type="button" className="ghost-button" onClick={downloadPDF}>Descargar PDF</button>
              <button type="button" className="ghost-button" onClick={() => window.print()}>Imprimir</button>
            </>
          )}
          <button type="button" className="ghost-button" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </div>
      <BibleStudyModal reference={activeReference} onClose={() => setActiveReference(null)} />
    </div>
  );
}
