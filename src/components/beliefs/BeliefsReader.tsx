import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BibleStudyModal } from "@components/bible/BibleStudyModal";
import { expandBeliefReferences } from "@lib/beliefReferenceAdapter";
import type { BeliefReference } from "./types";
import "./beliefs-reader.css";

type Props = {
  references: BeliefReference[];
  title: string;
  onClose: () => void;
  returnFocus?: HTMLElement | null;
};

export function BeliefsReader({ references, title, onClose, returnFocus }: Props) {
  const passages = useMemo(() => expandBeliefReferences(references), [references]);
  const [index, setIndex] = useState(0);
  const focusTarget = useRef<HTMLElement | null>(returnFocus ?? (
    typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null
  ));
  const focusFrame = useRef<number | undefined>(undefined);
  const originalLabels = [...new Set(references.map((reference) => reference.sourceGroup || reference.label))].join("; ");
  const activeIndex = Math.min(index, Math.max(0, passages.length - 1));

  useEffect(() => {
    setIndex(0);
  }, [references]);

  useEffect(() => {
    if (returnFocus) focusTarget.current = returnFocus;
  }, [returnFocus]);

  const restoreFocus = useCallback(() => {
    if (focusFrame.current !== undefined) window.cancelAnimationFrame(focusFrame.current);
    focusFrame.current = window.requestAnimationFrame(() => {
      if (focusTarget.current?.isConnected) focusTarget.current.focus({ preventScroll: true });
    });
  }, []);

  useEffect(() => () => restoreFocus(), [restoreFocus]);

  const close = useCallback(() => {
    onClose();
    restoreFocus();
  }, [onClose, restoreFocus]);

  if (!passages.length || typeof document === "undefined") return null;

  return createPortal(
    <BibleStudyModal
      appearance="santa-biblia"
      onClose={close}
      reference={passages[activeIndex]}
      referenceNavigation={passages.length > 1 ? {
        label: `${title} · ${originalLabels} · Pasaje ${activeIndex + 1} de ${passages.length}`,
        onPrevious: activeIndex > 0 ? () => setIndex(activeIndex - 1) : undefined,
        onNext: activeIndex < passages.length - 1 ? () => setIndex(activeIndex + 1) : undefined,
      } : undefined}
    />,
    document.body,
  );
}
