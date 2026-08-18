export type BibleReference = {
  book: string;
  chapter: number;
  verseStart: number;
  verseEnd?: number;
  display: string;
  osis?: string;
  toEnd?: boolean;
  crossChapter?: { chapter: number; verseEnd: number };
};

export type BibleRefContent = {
  reference: BibleReference;
  text?: string;
};

export type BibleVerse = {
  number: number;
  text: string;
};

export type BiblePassage = {
  reference: BibleReference;
  version: string;
  verses: BibleVerse[];
};

export type CommentaryBlock = {
  type: "heading" | "paragraph";
  text: string;
};

export type CommentaryEntry = {
  reference: BibleReference;
  title?: string;
  content: string;
  source?: string;
  verse?: number;
  blocks?: CommentaryBlock[];
};
