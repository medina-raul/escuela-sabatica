import { useEffect, useMemo, useRef, useState } from "react";
import { getPassage, getBibleUrl } from "@lib/bibleAdapter";
import { getCommentary } from "@lib/commentaryAdapter";
import type { BiblePassage, BibleReference, CommentaryEntry } from "@app-types/bible";

type Props = {
  reference: BibleReference | null;
  onClose: () => void;
};

export function BibleStudyModal({ reference, onClose }: Props) {
  const [activeTab, setActiveTab] = useState<"bible" | "commentary">("bible");
  const [passage, setPassage] = useState<BiblePassage | null>(null);
  const [commentary, setCommentary] = useState<CommentaryEntry[]>([]);
  const [passageStatus, setPassageStatus] = useState("Cargando texto bíblico...");
  const [commentaryStatus, setCommentaryStatus] = useState("Cargando comentario bíblico...");
  const [bibleUrl, setBibleUrl] = useState("https://www.santabiblia.cloud");
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!reference) return;
    let mounted = true;
    document.body.classList.add("modal-open");
    closeRef.current?.focus();
    setActiveTab("bible");
    setPassage(null);
    setCommentary([]);
    setPassageStatus("Cargando texto bíblico...");
    setCommentaryStatus("Cargando comentario bíblico...");
    getBibleUrl(reference.book, reference.chapter)
      .then((url: string) => {
        if (mounted) setBibleUrl(url);
      })
      .catch(() => {
        // El enlace externo es accesorio y no debe afectar la lectura local.
      });

    getPassage(reference)
      .then((nextPassage) => {
        if (!mounted) return;
        setPassage(nextPassage);
        setPassageStatus("");
      })
      .catch(() => {
        if (!mounted) return;
        setPassageStatus("No fue posible cargar el texto bíblico. Intenta nuevamente.");
      });

    getCommentary(reference)
      .then((nextCommentary) => {
        if (!mounted) return;
        setCommentary(nextCommentary);
        setCommentaryStatus("");
      })
      .catch(() => {
        if (!mounted) return;
        setCommentaryStatus("No fue posible cargar el comentario bíblico. Intenta nuevamente.");
      });

    return () => {
      mounted = false;
      document.body.classList.remove("modal-open");
    };
  }, [reference]);

  useEffect(() => {
    if (!reference) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, reference]);

  const passageText = useMemo(
    () => passage?.verses.map((verse) => `${verse.number} ${verse.text}`).join("\n") ?? "",
    [passage],
  );

  if (!reference) return null;

  const copyPassage = async () => {
    await navigator.clipboard?.writeText(
      `${reference.display}\n${passageText}\n\n🔗 Escuela Sabática\n${location.origin}`
    );
  };

  const sharePassage = async () => {
    const data = {
      title: reference.display,
      text: `${passageText}\n\n📖 Escuela Sabática`,
      url: location.origin,
    };
    if (navigator.share) await navigator.share(data);
    else await navigator.clipboard?.writeText(`${data.title}\n${data.text}\n${location.origin}`);
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section
        className="bible-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bible-modal-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal-header">
          <h2 id="bible-modal-title">{reference.display}</h2>
          <button ref={closeRef} className="icon-button" type="button" onClick={onClose} aria-label="Cerrar modal">
            ×
          </button>
        </header>

        <div className="modal-tabs" role="tablist" aria-label="Contenido de referencia bíblica">
          <button
            type="button"
            className={activeTab === "bible" ? "active" : undefined}
            onClick={() => setActiveTab("bible")}
            role="tab"
            aria-selected={activeTab === "bible"}
          >
            Biblia
          </button>
          <button
            type="button"
            className={activeTab === "commentary" ? "active" : undefined}
            onClick={() => setActiveTab("commentary")}
            role="tab"
            aria-selected={activeTab === "commentary"}
          >
            Comentario
          </button>
        </div>

        <div className="modal-body">
          {activeTab === "bible" && passageStatus && <p role="status">{passageStatus}</p>}
          {!passageStatus && activeTab === "bible" && passage && (
            <>
              <select className="version-select" aria-label="Versión bíblica" defaultValue={passage.version}>
                <option value="rva2015">RVA2015</option>
              </select>
              <div className="passage">
                {passage.verses.map((verse) => (
                  <p key={verse.number}>
                    <span className="verse-number">{verse.number}</span>
                    {verse.text}
                  </p>
                ))}
              </div>
              <p className="bible-source">
                Gentileza de{" "}
                <a href="https://www.santabiblia.cloud" target="_blank" rel="noopener noreferrer">
                  www.santabiblia.cloud
                </a>
              </p>
            </>
          )}

          {activeTab === "commentary" && commentaryStatus && <p role="status">{commentaryStatus}</p>}
          {!commentaryStatus && activeTab === "commentary" && (
            <div className="passage">
              {commentary.length > 0 ? (
                <>
                  {commentary.length > 1 && (
                    <p className="commentary-range-header">{reference.display}</p>
                  )}
                  {commentary.map((entry, i) => (
                    <article className="commentary-entry" key={`${entry.source ?? reference.display}-${i}`}>
                      {commentary.length > 1 && (
                        <span className="verse-number">{entry.verse ?? (reference.verseStart ? reference.verseStart + i : i + 1)}</span>
                      )}
                      {entry.blocks?.length ? entry.blocks.map((block, blockIndex) => (
                        block.type === "heading"
                          ? <h3 key={`${block.text}-${blockIndex}`}>{block.text}</h3>
                          : <p key={`${block.text}-${blockIndex}`}>{block.text}</p>
                      )) : <p>{entry.content}</p>}
                      {commentary.length === 1 && entry.source && (
                        <p className="muted">{entry.source}</p>
                      )}
                    </article>
                  ))}
                </>
              ) : (
                <p>No encontramos comentario disponible para esta referencia.</p>
              )}
            </div>
          )}
        </div>

        <footer className="modal-actions">
          <button type="button" onClick={copyPassage}>Copiar</button>
          <button type="button" onClick={sharePassage}>Compartir</button>
          <a href={bibleUrl} target="_blank" rel="noopener noreferrer">Abrir en Biblia</a>
        </footer>
      </section>
    </div>
  );
}
