// Pure route helpers: safe to import from client-side React islands.
export const quarterUrl = (quarterId: string) => `/trimestres/${encodeURIComponent(quarterId)}`;
export const resourcesUrl = (quarterId: string) => `${quarterUrl(quarterId)}/recursos`;
export const lessonUrl = (quarterId: string, lessonId: string, dayId?: string) =>
  `${quarterUrl(quarterId)}/lecciones/${encodeURIComponent(lessonId)}${dayId ? `/${encodeURIComponent(dayId)}` : ""}`;
