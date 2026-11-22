import { findBibleReferenceMatches } from "../../src/lib/bibleReferenceParser.ts";
import { applyChange, listQuarters, publicationIssues } from "../lib/catalog-model.mjs";
import { adventechLessonUrls } from "../lib/ingest-text.mjs";
import { assignImportedFragment } from "../lib/lesson-import.mjs";
import { mergeEditorialSnapshot, publishableSnapshot } from "../lib/publication-model.mjs";
import { githubClient } from "./github.mjs";
import { analyzeSource, downloadSource, prepareAsset, publicSource } from "./import.mjs";
import { digest, openVault } from "./vault.mjs";

const user = { id: "rmedina", username: "rmedina", role: "editor" };
const working = "cambios";
const capabilities = { browser: true, edit: true, manageSite: true, sources: true };
const encoder = new TextEncoder();
const iso = () => new Date().toISOString();
const value = value => ({ value });
const saved = value => ({ value, write: true });
const pending = publication => ["submitting", "validating", "deploying"].includes(publication?.state);

async function deployedCatalog() {
  const response = await fetch("/admin/catalog.json", { cache: "no-store", signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error("No se pudo leer el contenido publicado. Recarga el panel.");
  return response.json();
}

function initialState(data) {
  const { snapshot } = data;
  return {
    connection: "",
    draft: { title: "Cambios del sitio", base: snapshot, snapshot, version: 1, updatedAt: iso() },
    publication: null,
    jobs: [],
    assets: {},
    history: [],
  };
}

function heading({ draft, publication }) {
  return { id: working, title: draft.title, version: draft.version, updatedAt: draft.updatedAt, ownerId: user.id,
    status: pending(publication) ? "building" : "editing" };
}

function description(state) {
  return {
    draft: { ...heading(state), snapshot: state.draft.snapshot },
    issues: publicationIssues(state.draft.snapshot), history: state.history, release: state.publication,
  };
}

function changeDraft(state, snapshot, action, comment) {
  state.draft.snapshot = snapshot;
  state.draft.version++;
  state.draft.updatedAt = iso();
  state.history = [{ action, comment, actor: user.username, createdAt: state.draft.updatedAt }, ...state.history].slice(0, 60);
  return description(state);
}

function requireEditing(state, version) {
  if (pending(state.publication)) throw new Error("Espera a que termine la publicación para guardar más cambios.");
  if (version !== undefined && version !== state.draft.version) {
    throw new Error("Hay cambios nuevos en otra pestaña. Actualiza el panel antes de guardar.");
  }
}

function getJob(state, id) {
  const job = state.jobs.find(item => item.id === id);
  if (!job) throw new Error("La importación ya no está disponible.");
  return job;
}

function importInputs(form) {
  const files = form.getAll("files").filter(file => file instanceof File && file.size);
  const urls = String(form.get("urls") ?? "").split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const text = String(form.get("text") ?? "").trim();
  const sources = [
    ...files.map(file => ({ name: file.name, file })),
    ...urls.map(url => ({ name: url, url })),
    ...(text ? [{ name: "Texto pegado", text }] : []),
  ];
  if (!sources.length || sources.length > 12) throw new Error("Agrega de uno a doce archivos, enlaces o textos por cada importación.");
  return sources;
}

async function buildJob(vault, sources) {
  const items = [];
  for (const source of sources) {
    let original;
    const remember = async (bytes, checksum) => {
      await vault.putAsset(bytes, checksum);
      original = checksum;
    };
    try {
      if (source.file?.size > 24 * 1024 * 1024) throw new Error("El archivo supera los 24 MB. Divídelo antes de subirlo.");
      const prepared = source.url ? await downloadSource(source.url)
        : { name: source.name, bytes: source.file ? new Uint8Array(await source.file.arrayBuffer()) : encoder.encode(source.text) };
      const result = await analyzeSource(prepared, remember);
      items.push({ name: result.name, result, original, status: "ready" });
    } catch (error) {
      items.push({ name: source.name, error: error.message, original, status: "failed" });
    }
  }
  const failures = items.filter(item => item.status === "failed").length;
  return { id: crypto.randomUUID(), createdAt: iso(), items, status: failures ? failures === items.length ? "failed" : "partial" : "ready" };
}

function applied(state, job, assignments) {
  if (!Array.isArray(assignments) || !assignments.length || assignments.length > 105) throw new Error("Selecciona los fragmentos que quieres guardar.");
  const targets = new Set();
  let snapshot = state.draft.snapshot;
  for (const assignment of assignments) {
    const key = [assignment.quarterId, assignment.lessonId, assignment.dayId].join("/");
    if (targets.has(key)) throw new Error("Asigna un solo fragmento a cada día.");
    targets.add(key);
    snapshot = assignImportedFragment(snapshot, job, assignment);
  }
  return changeDraft(state, snapshot, "import.applied", assignments.length + " día(s)");
}

function edit(state, { action, data }) {
  let snapshot = state.draft.snapshot;
  if (action === "day.update" && data.importJobId) {
    snapshot = assignImportedFragment(snapshot, getJob(state, data.importJobId), {
      ...data, item: data.importItem, fragment: data.importFragment,
    });
  } else if (action === "resource.upsert") {
    const { assetId, asset: _asset, sourceUrl: _sourceUrl, ...fields } = data;
    if (assetId) {
      fields.asset = Object.hasOwn(state.assets, assetId) && state.assets[assetId];
      if (!fields.asset) throw new Error("Carga otra vez el archivo antes de guardar.");
    } else if (fields.url?.startsWith("https://")) {
      const host = publicSource(fields.url).hostname;
      snapshot = applyChange(snapshot, "resource.host.allow", { quarterId: fields.quarterId, host });
    }
    snapshot = applyChange(snapshot, action, fields);
  } else {
    const { contentSource: _source, ...fields } = data;
    snapshot = applyChange(snapshot, action, fields);
  }
  return changeDraft(state, snapshot, action, [data.quarterId, data.lessonId, data.dayId].filter(Boolean).join(" · "));
}

async function checkPublication(state) {
  const publication = state.publication;
  if (!pending(publication)) return value(description(state));
  const github = githubClient(state.connection);
  try {
    if (publication.state === "submitting") {
      await github.submit(publication);
      publication.state = "validating";
      publication.error = null;
      return saved(description(state));
    }
    const phase = await github.check(publication);
    Object.assign(publication, phase, { error: null });
    if (phase.state === "deploying") {
      const deployed = await deployedCatalog();
      if (await github.includes(deployed.commit ?? "", publication.candidate)) {
        // Carry forward later private work in this browser while adopting the site now published.
        const before = state.draft.base;
        state.draft.snapshot = mergeEditorialSnapshot(publishableSnapshot(state.draft.snapshot, before), state.draft.snapshot, deployed.snapshot);
        state.draft.base = deployed.snapshot;
        state.draft.version++;
        state.draft.updatedAt = iso();
        publication.state = "published";
        publication.finishedAt = iso();
      }
    }
    if (phase.state === "validating" && !phase.log && Date.now() - Date.parse(publication.queuedAt) > 15 * 60_000) {
      publication.state = "failed";
      publication.error = "GitHub aún no inició la validación. Reintenta desde el panel.";
    }
  } catch (error) {
    publication.error = error.message;
    if (publication.state === "submitting" && [401, 403, 404, 409, 422].includes(error.status)) publication.state = "failed";
  }
  return saved(description(state));
}

export async function createBrowserRequest() {
  const vault = await openVault();
  return async function request(path, { method = "GET", data } = {}) {
    if (path === "session" && method === "GET") {
      return { user: vault.unlocked ? user : null, setup: !await vault.exists() };
    }
    if (path === "login" && method === "POST") {
      if (data.username?.toLowerCase().trim() !== user.username || typeof data.password !== "string" || data.password.length > 200) {
        throw new Error("Usa el usuario rmedina y tu contraseña de este navegador.");
      }
      const setup = !await vault.exists();
      if (setup && data.password.length < 8) throw new Error("Crea una contraseña de 8 caracteres o más.");
      const initial = setup ? initialState(await deployedCatalog()) : null;
      await vault.unlock(data.password, initial);
      return { user };
    }
    if (!vault.unlocked) throw Object.assign(new Error("Vuelve a ingresar con tu contraseña."), { status: 401 });
    if (path === "logout" && method === "POST") {
      await vault.transact(() => { vault.lock(); });
      return { user: null };
    }
    if (path === "references" && method === "POST") {
      if (typeof data.text !== "string" || data.text.length > 200_000) throw new Error("El texto supera el tamaño permitido.");
      return { references: findBibleReferenceMatches(data.text).slice(0, 300).map(match => match.reference) };
    }
    return vault.transact(async state => {
      if (path === "dashboard" && method === "GET") {
        const { base } = state.draft;
        const quarters = listQuarters(base);
        return value({ user, capabilities, connected: Boolean(state.connection), drafts: [heading(state)],
          live: { quarters, activeQuarterId: quarters.find(quarter => quarter.active)?.id } });
      }
      if (path === "publication/connect" && method === "POST") {
        const token = String(data.token ?? "").trim();
        if (!/^github_pat_[A-Za-z0-9_]{30,240}$/.test(token)) throw new Error("Pega el acceso de tipo fine-grained que te entregó GitHub.");
        await githubClient(token).validate();
        state.connection = token;
        return saved({ connected: true });
      }
      const [, id, action, jobId, operation, index] = path.split("/");
      if (!path.startsWith("drafts/") || id !== working) throw new Error("El panel no reconoce esta operación.");
      if (!action && method === "GET") return value(description(state));
      if (action === "check" && method === "POST") return checkPublication(state);
      if (action === "import" && method === "GET") {
        if (!jobId) return value({ jobs: state.jobs });
        const job = getJob(state, jobId);
        if (operation === "original") {
          const item = job.items[Number(index)];
          if (!item?.original) throw new Error("No se encontró el archivo original.");
          return value(new Blob([await vault.getAsset(item.original)], { type: "application/octet-stream" }));
        }
        return value({ job });
      }
      requireEditing(state, data?.version);
      if (action === "publish" && method === "POST") {
        if (!state.connection) throw new Error("Conecta GitHub por primera vez para publicar.");
        const publication = await githubClient(state.connection).prepare({
          base: state.draft.base, snapshot: state.draft.snapshot, readAsset: vault.getAsset,
        });
        state.publication = { ...publication, state: "submitting" };
        return saved(description(state));
      }
      if (action === "change" && method === "POST") return saved(edit(state, data));
      if (action === "assets" && method === "POST") {
        const { bytes, ...format } = await prepareAsset(data);
        const checksum = await digest(bytes);
        await vault.putAsset(bytes, checksum);
        const asset = { ...format, sha256: checksum, id: crypto.randomUUID() };
        state.assets[asset.id] = asset;
        return saved({ asset });
      }
      if (action === "import" && method === "POST") {
        if (operation === "apply") return saved(applied(state, getJob(state, jobId), data.assignments));
        const sources = jobId === "adventech" ? adventechLessonUrls(data).map(url => ({ name: url, url })) : importInputs(data);
        const job = await buildJob(vault, sources);
        state.jobs = [job, ...state.jobs].slice(0, 30);
        return saved({ job });
      }
      throw new Error("El panel no reconoce esta operación.");
    });
  };
}
