import { localResourceUrls, publicationIssues, resourceAssetUrls, snapshotFiles, snapshotFromDocuments } from "../lib/catalog-model.mjs";
import { editorialResourcePath, mergeEditorialSnapshot, publishableSnapshot } from "../lib/publication-model.mjs";

export const repository = "medina-raul/escuela-sabatica";
const githubOrigin = "https://api.github.com";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function base64(bytes) {
  const parts = [];
  for (let i = 0; i < bytes.length; i += 0x4000) {
    parts.push(String.fromCharCode(...bytes.subarray(i, i + 0x4000)));
  }
  return btoa(parts.join(""));
}

export function githubClient(token, fetcher = fetch) {
  async function call(path, { method = "GET", body, nullable = false } = {}) {
    let response;
    try {
      response = await fetcher(githubOrigin + "/repos/" + repository + path, {
        method,
        headers: {
          Accept: "application/vnd.github+json", Authorization: "Bearer " + token,
          "X-GitHub-Api-Version": "2022-11-28",
          ...(body && { "Content-Type": "application/json" }),
        },
        ...(body && { body: JSON.stringify(body) }),
        cache: "no-store", redirect: "error", referrerPolicy: "no-referrer", credentials: "omit",
        signal: AbortSignal.timeout(45_000),
      });
    } catch {
      throw new Error("Se interrumpió la conexión con GitHub. Revisa tu conexión e inténtalo otra vez.");
    }
    if (nullable && response.status === 404) return null;
    if (!response.ok) {
      const message = {
        401: "Tu conexión con GitHub venció. Vuelve a conectarla.",
        403: "GitHub rechazó la operación. Revisa que la conexión tenga permiso de escritura en Contenido.",
        404: "GitHub no encontró el repositorio o tu conexión carece de acceso.",
        409: "La publicación cambió mientras la preparabas. Vuelve a intentarlo.",
        422: "GitHub rechazó el cambio. Comprueba que los archivos y el permiso de escritura sean válidos.",
        429: "GitHub recibió demasiadas solicitudes. Espera un momento y vuelve a intentarlo.",
      }[response.status];
      throw Object.assign(new Error(message || "GitHub no pudo procesar la solicitud. Inténtalo nuevamente."), { status: response.status });
    }
    return response.json();
  }

  async function validate() {
    const repo = await call("");
    if (repo.full_name !== repository || repo.default_branch !== "main" || repo.permissions?.push === false) {
      throw new Error("Conecta una cuenta con permiso para publicar en el repositorio de Escuela Sabática.");
    }
    // A public repo can return read metadata to a token without any write grant.
    await call("/git/ref/heads/main");
  }

  async function readSnapshot(sha) {
    async function read(path) {
      const blob = await call("/contents/" + path + "?ref=" + sha);
      if (blob.type !== "file" || blob.encoding !== "base64") throw new Error("No se pudo leer el catálogo publicado.");
      const bytes = Uint8Array.from(atob(blob.content.replace(/\s/g, "")), letter => letter.charCodeAt(0));
      return JSON.parse(decoder.decode(bytes));
    }
    const registry = await read("resource-automation.json");
    const documents = new Map([["resource-automation.json", registry]]);
    await Promise.all(["src/data/site-config.json", ...registry.quarters.map(entry => entry.catalog)].map(async path => {
      if (!/^(?:src\/data\/site-config\.json|src\/data\/quarters\/\d{4}-q[1-4]\.json)$/.test(path)) {
        throw new Error("El registro de trimestres de GitHub contiene una ruta inválida.");
      }
      documents.set(path, await read(path));
    }));
    return snapshotFromDocuments(path => documents.get(path));
  }

  async function prepare({ base, snapshot, readAsset }) {
    const main = (await call("/git/ref/heads/main")).object.sha;
    const [commit, latest] = await Promise.all([call("/git/commits/" + main), readSnapshot(main)]);
    const merged = mergeEditorialSnapshot(base, publishableSnapshot(snapshot, base), latest);
    const issues = publicationIssues(merged);
    if (issues.length) throw Object.assign(new Error("Completa las lecciones antes de publicar el trimestre."), { details: issues.slice(0, 12) });
    const files = snapshotFiles(latest);
    const currentAssets = new Map(resourceAssetUrls(latest).map(({ url, sha256 }) => [url, sha256]));
    const newUrls = new Set(localResourceUrls(merged));
    const tree = [];
    async function add(path, bytes) {
      const blob = await call("/git/blobs", { method: "POST", body: { content: base64(bytes), encoding: "base64" } });
      tree.push({ path, mode: "100644", type: "blob", sha: blob.sha });
    }
    for (const [path, text] of snapshotFiles(merged)) {
      if (text !== files.get(path)) await add(path, encoder.encode(text));
    }
    for (const { url, sha256 } of resourceAssetUrls(merged)) {
      if (currentAssets.get(url) !== sha256) await add(editorialResourcePath(url), await readAsset(sha256));
    }
    for (const url of new Set(localResourceUrls(latest))) {
      if (!newUrls.has(url)) tree.push({ path: editorialResourcePath(url), mode: "100644", type: "blob", sha: null });
    }
    if (!tree.length) throw new Error("Todavía no hay cambios para publicar. Los trimestres en preparación siguen en tu borrador.");
    const { sha: treeSha } = await call("/git/trees", { method: "POST", body: { base_tree: commit.tree.sha, tree } });
    const { sha: candidate } = await call("/git/commits", {
      method: "POST", body: { message: "content(cms): publicación editorial", tree: treeSha, parents: [main] },
    });
    return { candidate, main, branch: "cms/publicar/" + crypto.randomUUID(), queuedAt: new Date().toISOString() };
  }

  async function submit(publication) {
    const route = "/git/ref/heads/" + publication.branch;
    const existing = await call(route, { nullable: true });
    if (existing?.object.sha === publication.candidate) return;
    if (existing && existing.object.sha !== publication.main) throw new Error("Esta publicación cambió en GitHub. Prepara otra desde el panel.");
    if (!existing) {
      await call("/git/refs", {
        method: "POST", body: { ref: "refs/heads/" + publication.branch, sha: publication.main },
      });
    }
    await call("/git/refs/heads/" + publication.branch, {
      method: "PATCH", body: { sha: publication.candidate, force: false },
    });
  }

  async function check({ branch, candidate }) {
    const runUrl = "/actions/workflows/cms-publish.yml/runs?event=push&head_sha=" + candidate + "&branch=" + encodeURIComponent(branch) + "&per_page=10";
    const [head, response] = await Promise.all([
      call("/git/ref/heads/main"),
      call(runUrl, { nullable: true }).catch(error => {
        if (error.status === 403) return null; // Public Actions status can also be queried without the editor token.
        throw error;
      }),
    ]);
    const liveSha = head.object.sha;
    const included = await includes(liveSha, candidate);
    if (included) return { state: "deploying", main: liveSha };
    const runs = response?.workflow_runs ?? (await fetcher(githubOrigin + "/repos/" + repository + runUrl, {
      credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store", signal: AbortSignal.timeout(15_000),
    }).then(result => result.ok ? result.json() : null).catch(() => null))?.workflow_runs;
    const run = runs?.[0];
    const log = run && Number.isSafeInteger(run.id) ? "https://github.com/" + repository + "/actions/runs/" + run.id : undefined;
    if (run?.status === "completed" && run.conclusion !== "success") return { state: "failed", log };
    return { state: "validating", log };
  }

  async function includes(head, candidate) {
    if (!/^[a-f0-9]{40}$/.test(head)) return false;
    if (head === candidate) return true;
    const comparison = await call("/compare/" + candidate + "..." + head + "?per_page=1", { nullable: true });
    return comparison?.status === "ahead" || comparison?.status === "identical";
  }

  return { prepare, submit, check, includes, readSnapshot, validate };
}
