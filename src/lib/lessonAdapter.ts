import quarterData from "@data/quarters/2026-q3.json";
import type { Lesson, LessonDay, Quarter } from "@app-types/lesson";
import type { Resource, ResourceRole } from "@app-types/resource";

export const quarter = quarterData as unknown as Quarter;

export function getQuarter(): Quarter {
  return quarter;
}

export function getLessons(): Lesson[] {
  return quarter.lessons;
}

export function getLesson(lessonId: string): Lesson | undefined {
  return quarter.lessons.find((lesson) => lesson.id === lessonId);
}

export function getDay(lessonId: string, dayId: string): LessonDay | undefined {
  return getLesson(lessonId)?.days.find((day) => day.id === dayId);
}

export function getAllResources(): Resource[] {
  const lessonResources = quarter.lessons.flatMap((lesson) => lesson.resources ?? []);
  return [...(quarter.resources ?? []), ...lessonResources];
}

export function getResource(resourceId: string): Resource | undefined {
  return getAllResources().find((resource) => resource.id === resourceId);
}

export function getLessonResource(lessonNumber: number, role: ResourceRole): Resource | undefined {
  return getAllResources().find(
    (resource) => resource.lessonNumber === lessonNumber && resource.role === role,
  );
}

export function getFridayResource(lessonNumber: number): Resource | undefined {
  return getLessonResource(lessonNumber, "friday-reading");
}

export function getTeacherResource(lessonNumber: number): Resource | undefined {
  return getLessonResource(lessonNumber, "teacher-reading");
}

export function getPresentationResource(lessonNumber: number): Resource | undefined {
  return getLessonResource(lessonNumber, "weekly-presentation");
}

export function getAdjacentDay(lesson: Lesson, dayId: string, offset: -1 | 1) {
  const index = lesson.days.findIndex((day) => day.id === dayId);
  if (index < 0) return undefined;
  return lesson.days[index + offset];
}
