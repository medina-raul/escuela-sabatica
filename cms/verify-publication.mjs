import { execFileSync } from "node:child_process";
import { parse } from "parse5";
import { localResourceUrls, publicationIssues, resourceAssetUrls, snapshotFromDocuments, applyChange } from "./lib/catalog-model.mjs";
import { checksum, validateAsset } from "./lib/ingest-assets.mjs";
import { editorialResourcePath } from "./lib/publication-model.mjs";

const allowedData = /^(?:resource-automation\.json|src\/data\/(?:site-config\.json|quarters\/\d{4}-q[1-4]\.json))$/;
const allowedAsset = /\.(?:html|pdf|pptx|mp3|mp4|download)$/i;
const articleTags = new Set(["html", "head", "meta", "title", "body", "article", "h2", "p", "blockquote"]);
const [base, candidate] = process.argv.slice(2);

function git(...args) {
  return execFileSync("git", args, { maxBuffer: 34 * 1024 * 1024 });
}

function blob(ref, path) {
  if (!allowedData.test(path) && !path.startsWith("public/recursos/")) throw new Error("Ruta no permitida: " + path);
  return git("show", ref + ":" + path);
}

function validArticle(bytes) {
  if (bytes.length > 2_000_000) return false;
  const pending = [parse(bytes.toString("utf8"))];
  let article = false;
  while (pending.length) {
    const node = pending.pop();
    if (node.tagName && !articleTags.has(node.tagName)) return false;
    if (node.tagName === "article") article = true;
    if (node.attrs?.some(({ name, value }) =>
      !(node.tagName === "html" && name === "lang" && value === "es" ||
        node.tagName === "meta" && name === "charset" && value === "utf-8"))) return false;
    for (const child of node.childNodes ?? []) pending.push(child);
  }
  return article;
}

function verify() {
  if (![base, candidate].every(sha => /^[a-f0-9]{40}$/.test(sha ?? ""))) {
    throw new Error("Publicación sin versiones válidas.");
  }
  const parents = git("show", "-s", "--format=%P", candidate).toString("utf8").trim();
  if (parents !== base) throw new Error("El sitio cambió durante el envío. Vuelve a pulsar Publicar en el panel.");
  const raw = git("diff", "--raw", "--no-renames", "-z", base, candidate).toString("utf8").split("\0");
  const changes = new Map();
  for (let i = 0; i < raw.length - 1; i += 2) {
    const [before, after, , , status] = raw[i].slice(1).split(" ");
    const path = raw[i + 1];
    if (!["000000", "100644"].includes(before) || !["000000", "100644"].includes(after) || !["A", "M", "D"].includes(status)) {
      throw new Error("La publicación incluye un archivo no permitido.");
    }
    if (!allowedData.test(path) && (!path.startsWith("public/") ||
        editorialResourcePath(path.slice(6)) !== path || !allowedAsset.test(path))) {
      throw new Error("La publicación solo puede editar contenido y materiales: " + path);
    }
    changes.set(path, status);
  }
  if (!changes.size) throw new Error("La publicación no contiene cambios.");
  const load = ref => snapshotFromDocuments(path => JSON.parse(blob(ref, path).toString("utf8")));
  const previous = load(base);
  const snapshot = load(candidate);
  const issues = publicationIssues(snapshot);
  if (issues.length) throw new Error(issues.join("\n"));
  if (snapshot.registry.legacyQuarterId !== previous.registry.legacyQuarterId || snapshot.registry.schemaVersion !== previous.registry.schemaVersion) {
    throw new Error("El registro cambió campos que el CMS no puede modificar.");
  }
  applyChange(snapshot, "site.update", snapshot.site);
  const entries = new Map(snapshot.registry.quarters.map(entry => [entry.catalog, entry]));
  const previousEntries = new Map(previous.registry.quarters.map(entry => [entry.id, entry]));
  for (const entry of snapshot.registry.quarters) {
    if (entry.status === "draft" && (previousEntries.get(entry.id)?.status !== "draft" || changes.has(entry.catalog))) {
      throw new Error("Los trimestres en preparación se guardan en el navegador.");
    }
  }
  const assets = new Map(resourceAssetUrls(snapshot).map(({ url, sha256 }) => [editorialResourcePath(url), sha256]));
  const local = new Set(localResourceUrls(snapshot).map(editorialResourcePath));
  const previousUrls = new Set(localResourceUrls(previous).map(editorialResourcePath));
  for (const [path, type] of changes) {
    if (allowedData.test(path)) {
      if (type === "D" || path.startsWith("src/data/quarters/") && !entries.has(path)) throw new Error("Catálogo sin un trimestre válido.");
      continue;
    }
    if (type === "D") {
      if (!previousUrls.has(path) || local.has(path)) throw new Error("El recurso eliminado sigue en uso.");
      continue;
    }
    const bytes = blob(candidate, path);
    if (!bytes.length || bytes.length > 32 * 1024 * 1024 || checksum(bytes) !== assets.get(path)) {
      throw new Error("Hay un recurso sin registro o con una huella distinta: " + path);
    }
    if (path.endsWith(".html")) {
      if (!validArticle(bytes)) throw new Error("El artículo contiene marcado que el CMS no puede publicar.");
    } else if (!path.endsWith(".download")) {
      validateAsset(path, bytes);
    } else if (!/^public\/recursos\/\d{4}-q[1-4]\/adjuntos\//.test(path)) {
      throw new Error("Los adjuntos deben servirse exclusivamente como descargas.");
    }
  }
  return snapshot;
}

function writeManifests(snapshot) {
  for (const entry of snapshot.registry.quarters.filter(item => item.status !== "draft")) {
    const manifest = "public/manifests/" + entry.id + ".json";
    const args = ["scripts/audit_resources.py", "--catalog", entry.catalog, "--manifest", manifest, "--write-manifest"];
    execFileSync("python3", args, { stdio: "inherit" });
    if (entry.catalog === snapshot.registry.activeCatalog) {
      execFileSync("python3", [...args.slice(0, 4), "public/resource-manifest.json", "--write-manifest"], { stdio: "inherit" });
    }
  }
}

const snapshot = verify();
if (process.argv[4] === "--manifests") writeManifests(snapshot);
