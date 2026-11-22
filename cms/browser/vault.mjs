const encoder = new TextEncoder();
const decoder = new TextDecoder();
const vaultFile = "borradores.v1";
const ivLength = 12;
const saltLength = 16;
const format = 1;
const cipher = "AES-GCM";
const iterations = 600_000;

export async function digest(bytes) {
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return "sha256:" + Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
}

async function deriveKey(password, salt) {
  const seed = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    seed, { name: cipher, length: 256 }, false, ["encrypt", "decrypt"],
  );
}

async function readFile(directory, name) {
  try {
    return new Uint8Array(await (await (await directory.getFileHandle(name)).getFile()).arrayBuffer());
  } catch (error) {
    if (error.name === "NotFoundError") return null;
    throw error;
  }
}

async function writeFile(directory, name, bytes) {
  const writable = await (await directory.getFileHandle(name, { create: true })).createWritable();
  try {
    await writable.write(bytes);
    await writable.close();
  } catch (error) {
    await writable.abort().catch(() => {});
    throw error;
  }
}

async function seal(key, bytes, binding) {
  const iv = crypto.getRandomValues(new Uint8Array(ivLength));
  const encrypted = await crypto.subtle.encrypt({ name: cipher, iv, additionalData: encoder.encode(binding) }, key, bytes);
  return [iv, new Uint8Array(encrypted)];
}

async function unseal(key, bytes, offset, binding) {
  const params = {
    name: cipher, iv: bytes.subarray(offset, offset + ivLength), additionalData: encoder.encode(binding),
  };
  return new Uint8Array(await crypto.subtle.decrypt(params, key, bytes.subarray(offset + ivLength)));
}

function join(parts) {
  const bytes = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
}

function fileFor(checksum) {
  if (!/^sha256:[a-f0-9]{64}$/.test(checksum)) throw new Error("La huella del archivo no es válida.");
  return checksum.slice(7);
}

export async function openVault({
  storage = navigator.storage, locks = navigator.locks,
} = {}) {
  if (!storage?.getDirectory || !locks || !globalThis.crypto?.subtle ||
      !globalThis.FileSystemFileHandle?.prototype.createWritable && typeof navigator !== "undefined" && navigator.storage === storage) {
    throw new Error("Abre el panel en Chrome, Edge o Safari actualizado, en una ventana normal.");
  }
  let directory;
  try {
    directory = await (await storage.getDirectory()).getDirectoryHandle("escuela-sabatica-cms", { create: true });
  } catch {
    throw new Error("No se pudo activar el guardado en este navegador. Abre el panel en una ventana normal y revisa el permiso de almacenamiento.");
  }
  let key;
  let salt;

  async function save(data) {
    const parts = await seal(key, encoder.encode(JSON.stringify(data)), vaultFile);
    await writeFile(directory, vaultFile, join([Uint8Array.of(format), salt, ...parts]));
  }

  return {
    exists: async () => Boolean(await readFile(directory, vaultFile)),
    get unlocked() { return Boolean(key); },
    async unlock(password, initial) {
      await locks.request("escuela-sabatica-cms", async () => {
        const stored = await readFile(directory, vaultFile);
        if (stored && (stored[0] !== format || stored.length < 1 + saltLength + ivLength + 16)) {
          throw new Error("El archivo de borradores tiene un formato desconocido.");
        }
        salt = stored ? stored.slice(1, 1 + saltLength) : crypto.getRandomValues(new Uint8Array(saltLength));
        try {
          key = await deriveKey(password, salt);
          if (stored) await unseal(key, stored, 1 + saltLength, vaultFile);
          else await save(initial);
        } catch (error) {
          key = undefined;
          if (stored && error.name === "OperationError") throw new Error("La contraseña es incorrecta.");
          throw error;
        }
      });
      if (storage.persist) void storage.persist().catch(() => {});
    },
    lock() {
      key = undefined;
      salt = undefined;
    },
    async transact(change) {
      return locks.request("escuela-sabatica-cms", async () => {
        if (!key) throw Object.assign(new Error("Vuelve a ingresar con tu contraseña."), { status: 401 });
        const bytes = await readFile(directory, vaultFile);
        if (!bytes) throw new Error("El navegador eliminó el archivo de borradores.");
        const data = JSON.parse(decoder.decode(await unseal(key, bytes, 1 + saltLength, vaultFile)));
        const result = await change(data);
        if (result?.write) await save(data);
        return result?.value;
      });
    },
    async putAsset(bytes, checksum) {
      const file = fileFor(checksum);
      if (!key) throw new Error("Vuelve a ingresar con tu contraseña.");
      // An existing content-addressed file needs only one encrypted copy.
      try {
        if ((await (await directory.getFileHandle(file)).getFile()).size > ivLength) return;
      } catch (error) {
        if (error.name !== "NotFoundError") throw error;
      }
      await writeFile(directory, file, join(await seal(key, bytes, file)));
    },
    async getAsset(checksum) {
      const file = fileFor(checksum);
      const bytes = await readFile(directory, file);
      if (!bytes) throw new Error("Falta un archivo local. Cárgalo otra vez antes de publicar.");
      return unseal(key, bytes, 0, file);
    },
  };
}
