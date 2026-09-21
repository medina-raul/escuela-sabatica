import { useState } from "react";
import { BibleStudyModal } from "@components/bible/BibleStudyModal";
import type { BibleReference } from "@app-types/bible";
import { findBibleReferenceMatches } from "@lib/bibleReferenceParser";

type Props = {
  text: string;
};

function findReferences(text: string, onOpen: (ref: BibleReference) => void): React.ReactNode[] {
  const matches = findBibleReferenceMatches(text);
  if (matches.length === 0) return [text];

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

export function ManuscriptReader({ text }: Props) {
  const [activeReference, setActiveReference] = useState<BibleReference | null>(null);
  return (
    <>
      <p>{findReferences(text, setActiveReference)}</p>
      <BibleStudyModal reference={activeReference} onClose={() => setActiveReference(null)} />
    </>
  );
}
