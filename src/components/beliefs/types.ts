export type BeliefReference = {
  id: string;
  bookId: number;
  book: string;
  chapterStart: number;
  chapterEnd: number;
  verseStart: number | null;
  verseEnd: number | null;
  label: string;
  sourceGroup: string;
};

export type Belief = {
  id: string;
  number: number;
  slug: string;
  title: string;
  categoryId: string;
  paragraphs: string[];
  referenceText: string;
  references: BeliefReference[];
  source: { officialSpanishWebUrl: string };
};

export type BeliefChapter = {
  beliefNumber: number;
  bookChapterTitle: string;
  printedPages: number[];
  blocks: Array<{
    kind: string;
    text: string;
    title?: string;
    pdfPage?: number;
    citations?: Array<{ start: number; end: number; referenceIds: string[] }>;
  }>;
  references: BeliefReference[];
};

export type OpenBeliefReferences = (
  references: BeliefReference[],
  title: string,
  trigger: HTMLElement,
) => void;
