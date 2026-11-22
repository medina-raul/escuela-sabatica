export function extensionOf(name) {
  const file = name.split(/[\\/]/).at(-1);
  const dot = file.lastIndexOf(".");
  return dot > 0 ? file.slice(dot) : "";
}

export function originalName(value, fallback) {
  const name = typeof value === "string" ? value.split(/[\\/]/).at(-1).trim() : "";
  const cleaned = name.replace(/[\p{Cc}\p{Cf}]/gu, "").trim();
  if (!cleaned || cleaned === "." || cleaned === "..") return fallback;
  if (cleaned.length <= 180) return cleaned;
  const ext = extensionOf(cleaned).slice(0, 15);
  return cleaned.slice(0, 180 - ext.length) + ext;
}
