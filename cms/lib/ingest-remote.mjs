import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { BlockList, isIP } from "node:net";

const MAX_REDIRECTS = 3;
const TOTAL_TIMEOUT_MS = 15_000;
const MAX_URL_LENGTH = 2048;

const privateV4 = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
]) {
  privateV4.addSubnet(address, prefix);
}

const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
const reservedV6 = new BlockList();
for (const [address, prefix] of [
  ["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20],
]) {
  reservedV6.addSubnet(address, prefix, "ipv6");
}

export function isPublicAddress(address) {
  if (address.includes("%")) return false;
  const family = isIP(address);
  if (family === 4) return !privateV4.check(address, "ipv4");
  if (family === 6) return globalV6.check(address, "ipv6") && !reservedV6.check(address, "ipv6");
  return false;
}

export function validateImportUrl(value, allowedHosts = []) {
  if (typeof value !== "string" || value.length > MAX_URL_LENGTH) {
    throw new Error("Ingresa una URL HTTPS válida.");
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Ingresa una URL HTTPS válida.");
  }
  const { hostname } = url;
  if (url.protocol !== "https:" || url.username || url.password || url.port) {
    throw new Error("Usa HTTPS sin credenciales ni puertos personalizados.");
  }
  if (isIP(hostname.replace(/^\[|\]$/g, "")) || !hostname.includes(".") || hostname.endsWith(".")) {
    throw new Error("Las fuentes requieren un dominio público autorizado.");
  }
  const hosts = new Set(Array.from(allowedHosts, host => String(host).trim().toLowerCase()));
  if (!hosts.has(hostname)) throw new Error(`Fuente no autorizada: ${hostname}.`);
  url.hash = "";
  return url;
}

async function resolvePublicAddress(hostname, signal, resolveAddress) {
  let onAbort;
  const aborted = new Promise((_, reject) => {
    onAbort = () => reject(new Error("Se agotó el tiempo para resolver la fuente."));
    signal.addEventListener("abort", onAbort, { once: true });
  });
  let addresses;
  try {
    signal.throwIfAborted();
    addresses = await Promise.race([resolveAddress(hostname, { all: true, order: "verbatim" }), aborted]);
  } catch {
    throw new Error("No se pudo resolver el dominio de la fuente.");
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new Error("El dominio de origen debe resolver a direcciones públicas.");
  }
  return addresses.find(({ family }) => family === 4) ?? addresses[0];
}

function readResponse(url, pinned, maxBytes, signal, openRequest, allowMissing) {
  return new Promise((resolve, reject) => {
    const req = openRequest(url, {
      agent: false,
      family: pinned.family,
      servername: url.hostname,
      rejectUnauthorized: true,
      signal,
      lookup(hostname, options, callback) {
        if (hostname !== url.hostname) {
          callback(new Error("El dominio de la conexión cambió durante la descarga."));
        } else if (options.all) {
          callback(null, [pinned]);
        } else {
          callback(null, pinned.address, pinned.family);
        }
      },
      headers: {
        "User-Agent": "EscuelaSabaticaCMS/1.0",
        Accept: url.hostname === "api.github.com" ? "application/vnd.github+json"
          : "text/html, text/markdown, text/plain, application/pdf, audio/mpeg, application/vnd.openxmlformats-officedocument.presentationml.presentation, application/octet-stream",
        "Accept-Encoding": "identity",
      },
    }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
        resolve({ redirect: res.headers.location });
        res.destroy();
        return;
      }
      const metadata = {
        status: res.statusCode,
        contentType: res.headers["content-type"] || "",
        headers: Object.fromEntries(Object.entries(res.headers).filter(([name]) =>
          ["etag", "last-modified", "content-type", "content-length"].includes(name))),
      };
      if (allowMissing && [404, 410].includes(res.statusCode)) {
        resolve({ missing: true, ...metadata });
        res.destroy();
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`La fuente respondió con HTTP ${res.statusCode}.`));
        res.destroy();
        return;
      }
      const encoding = res.headers["content-encoding"]?.toLowerCase();
      if (encoding && encoding !== "identity") {
        reject(new Error("La fuente ofreció una descarga comprimida. Carga el archivo localmente."));
        res.destroy();
        return;
      }
      const length = Number(res.headers["content-length"]);
      if (length > maxBytes) {
        reject(new Error("La fuente supera el tamaño máximo de importación."));
        res.destroy();
        return;
      }

      const chunks = [];
      let bytesRead = 0;
      res.on("error", reject);
      res.on("aborted", () => reject(new Error("La fuente interrumpió la descarga.")));
      res.on("data", chunk => {
        bytesRead += chunk.length;
        if (bytesRead > maxBytes) {
          const error = new Error("La fuente supera el tamaño máximo de importación.");
          reject(error);
          res.destroy();
          return;
        }
        chunks.push(chunk);
      });
      res.on("end", () => resolve({
        bytes: Buffer.concat(chunks, bytesRead),
        ...metadata,
      }));
    });
    req.once("error", () => reject(new Error(signal.aborted
      ? "Se agotó el tiempo de descarga de la fuente."
      : "No se pudo descargar la fuente mediante HTTPS.")));
    req.end();
  });
}

export function createImportDownloader({ resolveAddress = lookup, openRequest = request } = {}) {
  return async function download(value, { allowedHosts = [], maxBytes, checkUrl = () => {}, allowMissing = false }) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new Error("Configura un límite de descarga válido.");
    const signal = AbortSignal.timeout(TOTAL_TIMEOUT_MS);
    let url = validateImportUrl(value, allowedHosts);
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      checkUrl(url);
      const pinned = await resolvePublicAddress(url.hostname, signal, resolveAddress);
      const response = await readResponse(url, pinned, maxBytes, signal, openRequest, allowMissing);
      if ("bytes" in response || response.missing) return { ...response, url };
      if (!response.redirect || hop === MAX_REDIRECTS) {
        throw new Error("La fuente devolvió demasiadas redirecciones o una dirección inválida.");
      }
      let destination;
      try {
        destination = new URL(response.redirect, url).href;
      } catch {
        throw new Error("La fuente devolvió una redirección inválida.");
      }
      url = validateImportUrl(destination, allowedHosts);
    }
    throw new Error("La fuente superó el límite de redirecciones.");
  };
}

export const downloadImportSource = createImportDownloader();
