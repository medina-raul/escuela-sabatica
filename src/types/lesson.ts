import type { AudioResource, Resource, ResourceAutomationConfig } from "./resource";
import type { BibleRefContent, BibleReference } from "./bible";

export type ContentBlock =
  | { type: "heading"; level: 2 | 3 | 4; text: string }
  | { type: "paragraph"; text: string }
  | { type: "quote"; text: string; reference?: BibleReference }
  | { type: "bible-reference"; reference: BibleReference }
  | {
      type: "callout";
      variant: "verse" | "note" | "question";
      text: string;
      reference?: BibleReference;
    }
  | { type: "question"; text: string }
  | { type: "image"; src: string; alt: string };

export type LessonDay = {
  id: string;
  dayName:
    | "Sábado"
    | "Domingo"
    | "Lunes"
    | "Martes"
    | "Miércoles"
    | "Jueves"
    | "Viernes";
  date?: string;
  title: string;
  subtitle?: string;
  image?: string;
  audio?: AudioResource;
  keyVerse?: BibleRefContent;
  studyReferences?: BibleReference[];
  contentMarkdown?: string;
  contentBlocks?: ContentBlock[];
  resources?: Resource[];
};

export type Lesson = {
  id: string;
  number: number;
  title: string;
  subtitle?: string;
  dateRange: string;
  startDate?: string;
  endDate?: string;
  summary?: string;
  image?: string;
  keyVerse?: BibleRefContent;
  days: LessonDay[];
  resources?: Resource[];
  egwNotes?: string;
};

export type Quarter = {
  id: string;
  title: string;
  subtitle?: string;
  dateRange: string;
  year: number;
  quarterNumber: 1 | 2 | 3 | 4;
  description: string;
  coverImage?: string;
  keyVerse?: BibleRefContent;
  lessons: Lesson[];
  resources?: Resource[];
  reavivados?: { date: string; reading: string }[];
  resourceAutomation?: ResourceAutomationConfig;
};
