import { readFileSync } from "node:fs";
import path from "node:path";
import { snapshotFromDocuments } from "./catalog-model.mjs";

export * from "./catalog-model.mjs";

export function loadSnapshot(root) {
  return snapshotFromDocuments(relative => JSON.parse(readFileSync(path.join(root, relative), "utf8")));
}
