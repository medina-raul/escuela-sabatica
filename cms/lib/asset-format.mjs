import { extensionOf, originalName } from "./file-names.mjs";
import { isPdf } from "./ingest-text.mjs";

export const MAX_ASSET_BYTES = 32 * 1024 * 1024;

const decoder = new TextDecoder();
const decode = bytes => decoder.decode(bytes);

function zipEndOffset(bytes, view) {
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65_557); offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50 && offset + 22 + view.getUint16(offset + 20, true) === bytes.length) {
      return offset;
    }
  }
  return -1;
}

function powerpointArchive(bytes, view, inflate) {
  // Validate ZIP metadata and the OOXML content type. No entries are written to disk.
  const end = zipEndOffset(bytes, view);
  if (end < 0 || view.getUint32(end + 4, true) !== 0) return false;
  const count = view.getUint16(end + 10, true);
  const directorySize = view.getUint32(end + 12, true);
  const directoryStart = view.getUint32(end + 16, true);
  if (count < 2 || count > 4096 || count !== view.getUint16(end + 8, true) ||
      directoryStart + directorySize !== end) return false;

  const names = new Set();
  let offset = directoryStart;
  let totalExpanded = 0;
  let hasPresentationType = false;
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) return false;
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const dataSize = view.getUint32(offset + 20, true);
    const expandedSize = view.getUint32(offset + 24, true);
    const nameSize = view.getUint16(offset + 28, true);
    const next = offset + 46 + nameSize + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
    const local = view.getUint32(offset + 42, true);
    totalExpanded += expandedSize;
    if (flags & 1 || ![0, 8].includes(method) || totalExpanded > 160 * 1024 * 1024 ||
        !nameSize || next > end || local + 30 > directoryStart ||
        view.getUint32(local, true) !== 0x04034b50) return false;

    const name = decode(bytes.subarray(offset + 46, offset + 46 + nameSize));
    const localNameSize = view.getUint16(local + 26, true);
    const content = local + 30 + localNameSize + view.getUint16(local + 28, true);
    if (content + dataSize > directoryStart ||
        method !== view.getUint16(local + 8, true) ||
        flags !== view.getUint16(local + 6, true) ||
        name !== decode(bytes.subarray(local + 30, local + 30 + localNameSize)) ||
        names.has(name) || name.startsWith("/") || name.includes("\\") ||
        name.split("/").includes("..") ||
        /(?:^|\/)(?:vbaProject(?:Signature)?\.bin|activeX|embeddings)(?:\/|$)/i.test(name)) return false;
    names.add(name);
    if (name === "[Content_Types].xml") {
      if (expandedSize > 512 * 1024) return false;
      const data = bytes.subarray(content, content + dataSize);
      let xml;
      try {
        xml = decode(method === 8 ? inflate(data, 512 * 1024) : data);
      } catch {
        return false;
      }
      const presentationType = "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml";
      hasPresentationType = xml.includes(presentationType) && !/macroEnabled|vbaProject/i.test(xml);
    }
    offset = next;
  }
  return offset === end && hasPresentationType && names.has("ppt/presentation.xml");
}

function mp3Frame(bytes, offset) {
  if (offset + 4 > bytes.length) return false;
  const version = (bytes[offset + 1] >> 3) & 3;
  const layer = (bytes[offset + 1] >> 1) & 3;
  const bitrate = bytes[offset + 2] >> 4;
  const rate = (bytes[offset + 2] >> 2) & 3;
  return bytes[offset] === 0xff && (bytes[offset + 1] & 0xe0) === 0xe0
    && version !== 1 && layer === 1 && bitrate > 0 && bitrate < 15 && rate < 3;
}

function isMp3(bytes) {
  if (mp3Frame(bytes, 0)) return true;
  if (decode(bytes.subarray(0, 3)) !== "ID3" || bytes[3] < 2 || bytes[3] > 4) return false;
  let size = 0;
  for (const byte of bytes.subarray(6, 10)) {
    if (byte > 127) return false;
    size = size * 128 + byte;
  }
  const footerLength = bytes[3] === 4 && (bytes[5] & 0x10) ? 10 : 0;
  return mp3Frame(bytes, 10 + size + footerLength);
}

const ASSET_FORMATS = {
  ".pdf": ["pdf", bytes => isPdf(bytes) && decode(bytes.subarray(-2048)).includes("%%EOF")],
  ".pptx": ["ppt", (bytes, view, inflate) => bytes.length >= 10_000 && powerpointArchive(bytes, view, inflate)],
  ".mp3": ["audio", bytes => bytes.length >= 10_000 && isMp3(bytes)],
  ".mp4": ["video", (bytes, view) => bytes.length > 16 && view.getUint32(0) >= 16 &&
    view.getUint32(0) <= bytes.length && decode(bytes.subarray(4, 8)) === "ftyp"],
  ".png": ["image", bytes => bytes.length > 24 &&
    [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte) &&
    decode(bytes.subarray(12, 16)) === "IHDR"],
  ".jpg": ["image", bytes => bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff],
  ".jpeg": ["image", bytes => bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff],
  ".gif": ["image", bytes => /^(GIF87a|GIF89a)$/.test(decode(bytes.subarray(0, 6)))],
  ".webp": ["image", bytes => bytes.length > 16 && decode(bytes.subarray(0, 4)) === "RIFF" &&
    decode(bytes.subarray(8, 12)) === "WEBP"],
};

export function assetFormat(name, bytes, inflate) {
  const safeName = originalName(name, "material");
  if (!bytes.length || bytes.length > MAX_ASSET_BYTES) {
    throw new Error("El archivo debe tener contenido y pesar hasta 32 MB.");
  }
  const extension = extensionOf(safeName).toLowerCase();
  const format = ASSET_FORMATS[extension];
  if (!format) {
    throw new Error("Sube PDF, PPTX, MP3, MP4 o una imagen PNG, JPG, GIF o WebP. Los artículos HTML pasan por la importación de texto.");
  }
  const [kind, matches] = format;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (!matches(bytes, view, inflate)) {
    throw new Error(`El archivo no contiene un formato ${extension.slice(1).toUpperCase()} admitido.`);
  }
  return { name: safeName, sizeBytes: bytes.length, kind };
}
