import { useMemo, useState } from "react";
import { BibleStudyModal } from "@components/bible/BibleStudyModal";
import type { Lesson, LessonDay } from "@app-types/lesson";
import type { BibleReference } from "@app-types/bible";
import type { Resource } from "@app-types/resource";
import { lessonUrl } from "@lib/quarterRoutes";
import { findBibleReferenceMatches } from "@lib/bibleReferenceParser";

type Props = {
  lesson: Lesson;
  quarterId: string;
  day: LessonDay;
  previousDay?: LessonDay;
  nextDay?: LessonDay;
  fridayResource?: Resource;
};

function findReferences(text: string, knownRefs: BibleReference[], onOpen: (ref: BibleReference) => void): React.ReactNode[] {
  const matches = findBibleReferenceMatches(text, knownRefs);
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  for (const { index, length, reference } of matches) {
    if (index > cursor) parts.push(text.slice(cursor, index));
    parts.push(
      <span
        className="bible-inline"
        key={`${reference.display}-${index}`}
        role="button"
        tabIndex={0}
        aria-label={`Abrir ${reference.display}`}
        onClick={() => onOpen(reference)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onOpen(reference);
          }
        }}
      >
        {text.slice(index, index + length)}
      </span>,
    );
    cursor = index + length;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}

function renderInlineEmphasis(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const emphasis = /(\*\*([^*]+)\*\*|\*([^*]+)\*|_([^_]+)_)/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = emphasis.exec(text)) !== null) {
    if (match.index > cursor) parts.push(text.slice(cursor, match.index));
    const content = match[2] ?? match[3] ?? match[4] ?? "";
    parts.push(
      match[2]
        ? <strong key={`${match.index}-${content}`}>{content}</strong>
        : <em key={`${match.index}-${content}`}>{content}</em>,
    );
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}

export function DailyReading({ lesson, quarterId, day, previousDay, nextDay, fridayResource }: Props) {
  const [activeReference, setActiveReference] = useState<BibleReference | null>(null);
  const references = day.studyReferences ?? [];
  const lines = useMemo(() => (day.contentMarkdown ?? "").split("\n").filter(Boolean), [day.contentMarkdown]);
  const fridayInvitationIndex = useMemo(
    () => day.id !== "viernes" ? -1 : day.fridayReadingAnchor
      ? lines.findIndex(line => line === day.fridayReadingAnchor)
      : lines.findIndex((line) => !line.startsWith("#") && line.trim() !== "---"),
    [day.id, day.fridayReadingAnchor, lines],
  );

  return (
    <>
      <article className="reading-card">
        {day.keyVerse && (
          <div className="verse-block">
            <span aria-hidden="true">☼</span>
            <div>
              <strong>Versículo clave</strong>
              <blockquote>“{day.keyVerse.text}”</blockquote>
              <span className="muted">{day.keyVerse.reference.display}</span>
            </div>
          </div>
        )}

        <div className="reading-body">
          {lines.map((line, lineIndex) => {
            if (line === "---" || line.trim() === "") return null;
            if (line.startsWith("#### ")) {
              return <h5 key={line}>{findReferences(line.slice(5).trim(), references, setActiveReference)}</h5>;
            }
            if (line.startsWith("### ")) {
              return <h4 key={line}>{findReferences(line.slice(4).trim(), references, setActiveReference)}</h4>;
            }
            if (line.startsWith("> ")) {
              return (
                <blockquote key={line}>
                  {findReferences(line.slice(2).trim(), references, setActiveReference)}
                </blockquote>
              );
            }

            const promptText = line.startsWith("`") && line.endsWith("`") ? line.slice(1, -1).trim() : line;
            const isPrompt = line.startsWith("`") && line.endsWith("`");

            // Q4 ancla la recomendación final; Q3 conserva su invitación inicial.
            if (lineIndex === fridayInvitationIndex && fridayResource) {
              return (
                <p className={isPrompt ? "reading-prompt" : ""} key={line}>
                  <button
                    type="button"
                    className="viernes-reading-link"
                    data-article-url={fridayResource.url}
                    data-article-title={fridayResource.title}
                    data-friday-reading-trigger="true"
                    aria-haspopup="dialog"
                  >
                    {isPrompt ? <em>{renderInlineEmphasis(promptText)}</em> : renderInlineEmphasis(promptText)}
                  </button>
                </p>
              );
            }

            if (isPrompt) {
              return (
                <p className="reading-prompt" key={line}>
                  <em>{findReferences(promptText, references, setActiveReference)}</em>
                </p>
              );
            }
            return <p key={line}>{findReferences(line, references, setActiveReference)}</p>;
          })}
        </div>

        {references.length > 0 && (
          <div className="reference-row" aria-label="Referencias de estudio">
            {references.map((reference) => (
              <button className="reference-chip" type="button" key={reference.display} onClick={() => setActiveReference(reference)}>
                {reference.display}
              </button>
            ))}
          </div>
        )}

        {day.id === "viernes" && (
          <div className="viernes-complement">
            <div className="section-separator" style={{ margin: "var(--space-4) 0" }}></div>
            {fridayResource ? (
              <button
                type="button"
                className="viernes-complement-link"
                data-article-url={fridayResource.url}
                data-article-title={`Comentario de la semana — Lección ${lesson.number}`}
              >
                <span className="viernes-complement-icon">
                  <img src="/images/covers/article-cover.svg" alt="" width="64" height="80" loading="lazy" />
                </span>
                <div>
                  <strong>Comentario de la semana</strong>
                  <span>Material de estudio complementario</span>
                </div>
                <span className="viernes-complement-arrow">Leer →</span>
              </button>
            ) : (
              <div className="viernes-complement-link viernes-complement-disabled">
                <span className="viernes-complement-icon">
                  <img src="/images/covers/article-cover.svg" alt="" width="64" height="80" loading="lazy" style={{ opacity: 0.35 }} />
                </span>
                <div>
                  <strong>Comentario de la semana</strong>
                  <span>Material de estudio — Próximamente</span>
                </div>
              </div>
            )}
          </div>
        )}

        <nav className="daily-nav" aria-label="Navegación entre días">
          {previousDay ? (
            <a className="ghost-button" href={lessonUrl(quarterId, lesson.id, previousDay.id)}>
              ← {previousDay.dayName}
            </a>
          ) : (
            <span />
          )}
          {nextDay ? (
            <a className="primary-button" href={lessonUrl(quarterId, lesson.id, nextDay.id)}>
              {nextDay.dayName} →
            </a>
          ) : (
            <a className="primary-button" href={lessonUrl(quarterId, lesson.id)}>Volver a la semana</a>
          )}
        </nav>
      </article>

      <BibleStudyModal reference={activeReference} onClose={() => setActiveReference(null)} />
    </>
  );
}
