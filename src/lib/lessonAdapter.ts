import registry from "../../resource-automation.json";
import type { Lesson, LessonDay, Quarter } from "@app-types/lesson";
import type { Resource, ResourceRole } from "@app-types/resource";

const catalogs = import.meta.glob<{ default: Quarter }>("../data/quarters/*.json", { eager: true });
export const legacyQuarterId = registry.legacyQuarterId;
const activeEntry = registry.quarters.find(entry => entry.catalog === registry.activeCatalog);
if (!activeEntry || activeEntry.status !== "published") throw new Error("Trimestre activo no publicado");
export const activeQuarterId = activeEntry.id;

export function getQuarter(quarterId = activeQuarterId): Quarter {
  const entry = registry.quarters.find(item => item.id === quarterId);
  const catalog = entry && catalogs[`../data/quarters/${entry.id}.json`]?.default;
  if (!catalog || catalog.id !== quarterId) throw new Error(`Trimestre desconocido: ${quarterId}`);
  return catalog;
}

export function getQuarters(): Quarter[] {
  return registry.quarters
    .filter(entry => entry.status !== "draft" || import.meta.env.INCLUDE_DRAFT_QUARTERS === "1")
    .map(entry => getQuarter(entry.id));
}

export function isDraft(quarterId: string): boolean {
  return registry.quarters.some(entry => entry.id === quarterId && entry.status === "draft");
}

export function getLessons(quarterId = activeQuarterId): Lesson[] {
  return getQuarter(quarterId).lessons;
}

export function getLesson(lessonId: string, quarterId = activeQuarterId): Lesson | undefined {
  return getLessons(quarterId).find((lesson) => lesson.id === lessonId);
}

export function getDay(lessonId: string, dayId: string, quarterId = activeQuarterId): LessonDay | undefined {
  return getLesson(lessonId, quarterId)?.days.find((day) => day.id === dayId);
}

export function getAllResources(quarterId = activeQuarterId): Resource[] {
  const quarter = getQuarter(quarterId);
  const lessonResources = quarter.lessons.flatMap((lesson) => lesson.resources ?? []);
  return [...(quarter.resources ?? []), ...lessonResources];
}

export function getResource(resourceId: string, quarterId = activeQuarterId): Resource | undefined {
  return getAllResources(quarterId).find((resource) => resource.id === resourceId);
}

export function getLessonResource(lessonNumber: number, role: ResourceRole, quarterId = activeQuarterId): Resource | undefined {
  return getAllResources(quarterId).find(
    (resource) => resource.lessonNumber === lessonNumber && resource.role === role && !!resource.url && resource.url !== "#",
  );
}

export function getFridayResource(lessonNumber: number, quarterId = activeQuarterId): Resource | undefined {
  return getLessonResource(lessonNumber, "friday-reading", quarterId);
}

export function getTeacherResource(lessonNumber: number, quarterId = activeQuarterId): Resource | undefined {
  return getLessonResource(lessonNumber, "teacher-reading", quarterId);
}

export function getPresentationResource(lessonNumber: number, quarterId = activeQuarterId): Resource | undefined {
  return getLessonResource(lessonNumber, "weekly-presentation", quarterId);
}

export function getAdjacentDay(lesson: Lesson, dayId: string, offset: -1 | 1) {
  const index = lesson.days.findIndex((day) => day.id === dayId);
  if (index < 0) return undefined;
  return lesson.days[index + offset];
}
