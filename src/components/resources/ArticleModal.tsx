import { useEffect, useState, useCallback, useRef } from "react";

type Props = {};

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
      if (!keepClass && !keepLanguage && !keepLinkAttribute) element.removeAttribute(attribute.name);
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

export function ArticleModal(_props: Props) {
  const [article, setArticle] = useState<{ url: string; title: string } | null>(null);
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  const openArticle = useCallback((e: CustomEvent<{ url: string; title: string }>) => {
    const { url, title } = e.detail;
    setArticle({ url, title });
    setLoading(true);
    const fullUrl = url.startsWith("http") ? url : `${location.origin}${url}`;
    fetch(fullUrl)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then((html) => {
        const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? html;
        setContent(sanitizeArticleHtml(body));
        setLoading(false);
      })
      .catch(() => {
        setContent("<p>Error al cargar el contenido.</p>");
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    const handler = (e: Event) => openArticle(e as CustomEvent);
    window.addEventListener("open-article", handler);
    return () => window.removeEventListener("open-article", handler);
  }, [openArticle]);

  const onClose = () => setArticle(null);

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
      <div className="bible-modal" style={{ maxWidth: "min(94vw, 900px)" }}>
        <div className="modal-header">
          <h2>{article.title}</h2>
          <button className="modal-close-btn" type="button" onClick={onClose} aria-label="Cerrar">✕</button>
        </div>
        <div className="modal-body">
          {loading ? (
            <p className="muted">Cargando...</p>
          ) : (
            <div className="article-content" ref={contentRef} dangerouslySetInnerHTML={{ __html: content }} />
          )}
        </div>
        <div className="modal-actions">
          <button type="button" className="ghost-button" onClick={downloadPDF}>
            Descargar PDF
          </button>
          <button type="button" className="ghost-button" onClick={() => window.print()}>
            Imprimir
          </button>
          <button type="button" className="ghost-button" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
