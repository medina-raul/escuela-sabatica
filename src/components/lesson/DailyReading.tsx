import { useMemo, useState } from "react";
import { BibleStudyModal } from "@components/bible/BibleStudyModal";
import type { Lesson, LessonDay } from "@app-types/lesson";
import type { BibleReference } from "@app-types/bible";
import type { Resource } from "@app-types/resource";

type Props = {
  lesson: Lesson;
  day: LessonDay;
  previousDay?: LessonDay;
  nextDay?: LessonDay;
  fridayResource?: Resource;
};

// Stricter book pattern: optional digit prefix + capitalized word(s)
const BOOK_STRICT = "(?:(?:\\d+\\s+)?[A-ZÁÉÍÓÚ][a-záéíóúñü]+(?:\\s+[A-ZÁÉÍÓÚ][a-záéíóúñü]+)?)";
// Matches: Book Chapter:Verse or Book Chapter:Verse-VerseEnd
const REF_REGEX = new RegExp(`(?<![a-záéíóúñüA-Z])(\\(?${BOOK_STRICT}\\s+\\d+:\\d+(?:\\s*[-–]\\s*\\d+)?\\)?)`, "g");
// Matches: Book Chapter (no verse). NOT preceded by digit+space. Ch num not followed by : or digit.
const CHAPTER_REGEX = new RegExp(`(?<!\\d\\s)(?<![a-záéíóúñüA-Z])(\\(?${BOOK_STRICT}\\s+\\d{1,3}\\)?)(?![\\s]*[:\\d])`, "g");

// Valid Bible book names (lowercase, accent-stripped) for match validation
const VALID_BOOKS = new Set([
  "genesis", "exodo", "levitico", "numeros", "deuteronomio",
  "josue", "jueces", "rut", "1 samuel", "2 samuel",
  "1 reyes", "2 reyes", "1 cronicas", "2 cronicas",
  "esdras", "nehemias", "ester", "job", "salmos", "proverbios",
  "eclesiastes", "cantares", "isaias", "jeremias", "lamentaciones",
  "ezequiel", "daniel", "oseas", "joel", "amos",
  "abdias", "jonas", "miqueas", "nahum", "habacuc",
  "sofonias", "hageo", "zacarias", "malaquias",
  "mateo", "marcos", "lucas", "juan",
  "hechos", "romanos", "1 corintios", "2 corintios",
  "galatas", "efesios", "filipenses", "colosenses",
  "1 tesalonicenses", "2 tesalonicenses", "1 timoteo", "2 timoteo",
  "tito", "filemon", "hebreos", "santiago",
  "1 pedro", "2 pedro", "1 juan", "2 juan", "3 juan",
  "judas", "apocalipsis",
]);

const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

function isValidBook(book: string): boolean {
  return VALID_BOOKS.has(norm(book));
}

function parseRefDisplay(display: string): BibleReference | null {
  const cleaned = display.replace(/[()]/g, "").trim();
  let m = cleaned.match(/^(\d?\s*[A-Za-zÁÉÍÓÚáéíóúñÑüÜ]+(?:\s+[A-Za-zÁÉÍÓÚáéíóúñÑüÜ]+)?)\s+(\d+):(\d+)(?:\s*[-–]\s*(\d+))?/);
  if (m && isValidBook(m[1].trim())) {
    return {
      book: m[1].trim(),
      chapter: parseInt(m[2]),
      verseStart: parseInt(m[3]),
      verseEnd: m[4] ? parseInt(m[4]) : undefined,
      display: cleaned,
    };
  }
  m = cleaned.match(/^(\d?\s*[A-Za-zÁÉÍÓÚáéíóúñÑüÜ]+(?:\s+[A-Za-zÁÉÍÓÚáéíóúñÑüÜ]+)?)\s+(\d+)$/);
  if (m && isValidBook(m[1].trim())) {
    return {
      book: m[1].trim(),
      chapter: parseInt(m[2]),
      verseStart: 0,
      display: cleaned,
    };
  }
  return null;
}

function findReferences(text: string, knownRefs: BibleReference[], onOpen: (ref: BibleReference) => void): React.ReactNode[] {
  const allMatches: { index: number; length: number; reference: BibleReference }[] = [];

  // 1. Match known references
  for (const ref of knownRefs) {
    for (const form of [`[${ref.display}]`, `(${ref.display})`, ref.display]) {
      let idx = text.indexOf(form);
      while (idx >= 0) {
        allMatches.push({ index: idx, length: form.length, reference: ref });
        idx = text.indexOf(form, idx + 1);
      }
    }
  }

  // 2. Match generic verse references (may extend knownRefs that lack verse range)
  let m: RegExpExecArray | null;
  while ((m = REF_REGEX.exec(text)) !== null) {
    const match = m;
    const display = match[0];
    const overIdx = allMatches.findIndex(am =>
      match.index < am.index + am.length && match.index + display.length > am.index
    );
    if (overIdx >= 0) {
      if (display.length > allMatches[overIdx].length) {
        const parsed = parseRefDisplay(display);
        if (parsed) {
          allMatches[overIdx] = { index: match.index, length: display.length, reference: parsed };
        }
      }
    } else {
      const parsed = parseRefDisplay(display);
      if (parsed) {
        allMatches.push({ index: match.index, length: display.length, reference: parsed });
      }
    }
  }

  // 3. Match chapter-only references (Book Chapter without verse)
  CHAPTER_REGEX.lastIndex = 0;
  while ((m = CHAPTER_REGEX.exec(text)) !== null) {
    const match = m;
    const display = match[0];
    const overIdx = allMatches.findIndex(am =>
      match.index < am.index + am.length && match.index + display.length > am.index
    );
    if (overIdx >= 0) {
      if (display.length > allMatches[overIdx].length) {
        const parsed = parseRefDisplay(display);
        if (parsed) {
          allMatches[overIdx] = { index: match.index, length: display.length, reference: parsed };
        }
      }
    } else {
      const parsed = parseRefDisplay(display);
      if (parsed) {
        allMatches.push({ index: match.index, length: display.length, reference: parsed });
      }
    }
  }

  // 4. Continuation references: "1 Corintios 8; 10" or "1 Corintios 9:24-27; 10:31-11:1"
  // Matches: ;\s*\d+:\d+(-\d+:\d+)?(-\d+)?(:\d+)? or ;\s*\d+(?![:])  (chapter-only continuation)
  const CONT_REGEX = /;\s*(\d+:\d+(?:\s*[-–]\s*\d+(?::\d+)?)?)|;\s*(\d+)(?![:0-9])/g;
  // Find all known matches for context
  const allSorted = [...allMatches].sort((a, b) => a.index - b.index);
  CONT_REGEX.lastIndex = 0;
  let cm: RegExpExecArray | null;
  while ((cm = CONT_REGEX.exec(text)) !== null) {
    const display = cm[0].replace(/^;\s*/, ""); // strip "; "
    const matchStart = cm.index + cm[0].indexOf(display); // position of the actual ref
    const overIdx = allMatches.findIndex(am =>
      matchStart < am.index + am.length && matchStart + display.length > am.index
    );
    if (overIdx >= 0) {
      if (display.length > allMatches[overIdx].length) {
        const book = allMatches[overIdx].reference.book;
        const crossMatch = display.match(/^(\d+):(\d+)\s*[-–]\s*(\d+):(\d+)$/);
        if (crossMatch) {
          const ch1 = parseInt(crossMatch[1]), vs1 = parseInt(crossMatch[2]);
          const ch2 = parseInt(crossMatch[3]), vs2 = parseInt(crossMatch[4]);
          const display1 = `${ch1}:${vs1}`;
          const ref1: BibleReference = { book, chapter: ch1, verseStart: vs1, toEnd: true, display: display1 };
          allMatches[overIdx] = { index: matchStart, length: display1.length, reference: ref1 };
          const display2 = `${ch2}:${vs2}`;
          const ref2: BibleReference = { book, chapter: ch2, verseStart: vs2, display: display2 };
          const afterDash = display.substring(display.indexOf("-") + 1);
          allMatches.push({ index: matchStart + display.length - afterDash.length, length: display2.length, reference: ref2 });
        } else {
          const combinedDisplay = `${book} ${display}`;
          const parsed = parseRefDisplay(combinedDisplay);
          if (parsed) {
            allMatches[overIdx] = { index: matchStart, length: display.length, reference: parsed };
          }
        }
      }
    } else {
      let prevMatch: typeof allSorted[0] | null = null;
      for (let i = allSorted.length - 1; i >= 0; i--) {
        if (allSorted[i].index + allSorted[i].length <= cm.index) {
          prevMatch = allSorted[i];
          break;
        }
      }
      if (!prevMatch) continue;
      const book = prevMatch.reference.book;
      const crossMatch = display.match(/^(\d+):(\d+)\s*[-–]\s*(\d+):(\d+)$/);
      if (crossMatch) {
        const ch1 = parseInt(crossMatch[1]), vs1 = parseInt(crossMatch[2]);
        const ch2 = parseInt(crossMatch[3]), vs2 = parseInt(crossMatch[4]);
        const display1 = `${ch1}:${vs1}`;
        const ref1: BibleReference = { book, chapter: ch1, verseStart: vs1, toEnd: true, display: display1 };
        allMatches.push({ index: matchStart, length: display1.length, reference: ref1 });
        const display2 = `${ch2}:${vs2}`;
        const ref2: BibleReference = { book, chapter: ch2, verseStart: vs2, display: display2 };
        const afterDash = display.substring(display.indexOf("-") + 1);
        allMatches.push({ index: matchStart + display.length - afterDash.length, length: display2.length, reference: ref2 });
        continue;
      }
      const combinedDisplay = `${book} ${display}`;
      const parsed = parseRefDisplay(combinedDisplay);
      if (parsed) {
        allMatches.push({ index: matchStart, length: display.length, reference: parsed });
      }
    }
  }

  // Dedup overlapping, prefer longer
  allMatches.sort((a, b) => a.index - b.index || b.length - a.length);
  const filtered: typeof allMatches = [];
  for (const m of allMatches) {
    const last = filtered[filtered.length - 1];
    if (filtered.length === 0 || m.index >= last.index + last.length) {
      filtered.push(m);
    }
  }

  const parts: React.ReactNode[] = [];
  let cursor = 0;
  for (const { index, length, reference } of filtered) {
    if (index > cursor) parts.push(text.slice(cursor, index));
    parts.push(
      <span className="bible-inline" key={`${reference.display}-${index}`} onClick={() => onOpen(reference)}>
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

export function DailyReading({ lesson, day, previousDay, nextDay, fridayResource }: Props) {
  const [activeReference, setActiveReference] = useState<BibleReference | null>(null);
  const references = day.studyReferences ?? [];
  const lines = useMemo(() => (day.contentMarkdown ?? "").split("\n").filter(Boolean), [day.contentMarkdown]);
  const fridayInvitationIndex = useMemo(
    () => day.id === "viernes" ? lines.findIndex((line) => !line.startsWith("#") && line.trim() !== "---") : -1,
    [day.id, lines],
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
            // Horizontal rule
            if (line === "---" || line.trim() === "") return null;
            // ### / #### Heading
            if (line.startsWith("#### ")) {
              return <h5 key={line}>{findReferences(line.slice(5).trim(), references, setActiveReference)}</h5>;
            }
            // ### Heading
            if (line.startsWith("### ")) {
              return <h4 key={line}>{findReferences(line.slice(4).trim(), references, setActiveReference)}</h4>;
            }
            // > Blockquote
            if (line.startsWith("> ")) {
              return (
                <blockquote key={line}>
                  {findReferences(line.slice(2).trim(), references, setActiveReference)}
                </blockquote>
              );
            }
            // Escaped backtick prompt: `text` → reading prompt
            const promptText = line.startsWith("`") && line.endsWith("`") ? line.slice(1, -1).trim() : line;
            const isPrompt = line.startsWith("`") && line.endsWith("`");
            
            // The first complete Friday block always opens that lesson's complementary reading.
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
            // Horizontal rule or empty
            if (line === "---" || line.trim() === "") return null;
            // Regular paragraph
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
            <a className="ghost-button" href={`/lecciones/${lesson.id}/${previousDay.id}`}>
              ← {previousDay.dayName}
            </a>
          ) : (
            <span />
          )}
          {nextDay ? (
            <a className="primary-button" href={`/lecciones/${lesson.id}/${nextDay.id}`}>
              {nextDay.dayName} →
            </a>
          ) : (
            <a className="primary-button" href={`/lecciones/${lesson.id}`}>Volver a la semana</a>
          )}
        </nav>
      </article>

      <BibleStudyModal reference={activeReference} onClose={() => setActiveReference(null)} />
    </>
  );
}
