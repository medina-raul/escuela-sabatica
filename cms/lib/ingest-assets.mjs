import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { assetFormat } from "./asset-format.mjs";

export { MAX_ASSET_BYTES } from "./asset-format.mjs";
export { originalName } from "./file-names.mjs";

export function checksum(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function validateAsset(name, value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  const format = assetFormat(name, bytes, (data, maxOutputLength) => inflateRawSync(data, { maxOutputLength }));
  return { ...format, sha256: checksum(bytes) };
}
