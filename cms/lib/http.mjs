export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function requireCondition(condition, status, message) {
  if (!condition) throw new HttpError(status, message);
}

export function record(value) {
  requireCondition(value && typeof value === "object" && !Array.isArray(value), 400, "Se esperaba un objeto.");
  return value;
}

export function requiredText(value, label, max = 120) {
  requireCondition(typeof value === "string" && value.trim().length >= 1 && value.trim().length <= max, 400, `Revisa ${label}.`);
  return value.trim();
}

export async function readBody(request, limit) {
  const length = request.headers["content-length"];
  if (length !== undefined) {
    requireCondition(/^\d+$/.test(length), 400, "Longitud de solicitud inválida.");
    requireCondition(Number(length) <= limit, 413, "El contenido supera el tamaño permitido.");
  }
  const chunks = [];
  let received = 0;
  // Keeping the stream open lets the router send an HTTP error when a chunked body exceeds the limit.
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    received += chunk.length;
    requireCondition(received <= limit, 413, "El contenido supera el tamaño permitido.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, received);
}

export async function readJson(request, limit = 256 * 1024) {
  requireCondition(/^application\/json(?:\s*;|$)/i.test(request.headers["content-type"] ?? ""), 415, "Se requiere una solicitud JSON.");
  const body = await readBody(request, limit);
  if (!body.length) return {};
  let data;
  try {
    data = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
  } catch {
    throw new HttpError(400, "Los datos enviados no tienen un formato válido.");
  }
  return record(data);
}

export async function readForm(request, limit) {
  const contentType = request.headers["content-type"] ?? "";
  requireCondition(/^multipart\/form-data\s*;/i.test(contentType), 415, "Se requiere un formulario de archivos.");
  const body = await readBody(request, limit);
  try {
    return await new Response(body, { headers: { "content-type": contentType } }).formData();
  } catch {
    throw new HttpError(400, "El formulario de archivos no se pudo leer.");
  }
}

export function readCookie(request, name) {
  for (const item of (request.headers.cookie ?? "").split(";")) {
    const [key, value] = item.trim().split("=", 2);
    if (key === name && value && /^[a-zA-Z0-9_-]{32,128}$/.test(value)) return value;
  }
  return null;
}

export function json(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

export function originHeaders(response, preview = false) {
  response.setHeader("Cache-Control", "private, no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("X-Robots-Tag", "noindex, nofollow");
  response.setHeader("Content-Security-Policy", preview
    ? "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; media-src 'self'; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
    : "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
}
