import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { HttpError, readCookie, requireCondition } from "./http.mjs";
import { sha256 } from "./store.mjs";

const hash = promisify(scrypt);
const roleNames = new Set(["admin", "editor", "reviewer", "viewer"]);
const sessionName = "es_cms_session";
const sessionLifetime = 8 * 60 * 60 * 1000;
const loginWindow = 10 * 60 * 1000;
const dummySalt = randomBytes(16);
const dummyHash = randomBytes(64);

function identifier(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function safeUser(row) {
  return { id: row.id, username: row.username, role: row.role, active: Boolean(row.active), createdAt: row.created_at };
}

export function capabilities(user) {
  return {
    edit: user.role === "admin" || user.role === "editor",
    review: user.role === "admin" || user.role === "reviewer",
    manage: user.role === "admin",
    manageSite: user.role === "admin",
    prepare: user.role === "admin" || user.role === "editor" || user.role === "reviewer",
  };
}

export async function addUser(store, { username, password, role }, by = null) {
  const name = identifier(username);
  requireCondition(/^[a-z0-9][a-z0-9_.-]{2,63}$/.test(name), 400, "El usuario debe tener entre 3 y 64 caracteres, con letras sin tilde, números, punto, guion o guion bajo.");
  requireCondition(roleNames.has(role), 400, "Elige un rol válido.");
  requireCondition(typeof password === "string" && password.length >= 12 && Buffer.byteLength(password) <= 256, 400, "Usa una contraseña de al menos 12 caracteres y hasta 256 bytes.");
  const salt = randomBytes(16);
  const key = await hash(password, salt, 64);
  return store.transaction(() => {
    if (by) requireCondition(store.get("SELECT 1 FROM users WHERE id = ? AND role = 'admin' AND active = 1", by), 403, "Se requiere una cuenta administradora activa.");
    requireCondition(!store.get("SELECT 1 FROM users WHERE username = ?", name), 409, "Ese nombre de usuario ya existe.");
    const id = store.id();
    store.run("INSERT INTO users (id, username, role, password_hash, created_at) VALUES (?, ?, ?, ?, ?)",
      id, name, role, `${salt.toString("hex")}:${key.toString("hex")}`, store.stamp());
    store.audit("user.created", { userId: by, comment: `${name} · ${role}` });
    return safeUser(store.get("SELECT * FROM users WHERE id = ?", id));
  });
}

export function listUsers(store) {
  return store.all("SELECT id, username, role, active, created_at FROM users ORDER BY username").map(safeUser);
}

export function updateUser(store, id, data, by) {
  return store.transaction(() => {
    const row = store.get("SELECT * FROM users WHERE id = ?", id);
    requireCondition(row, 404, "Usuario desconocido.");
    const role = data.role ?? row.role;
    const active = data.active ?? Boolean(row.active);
    requireCondition(roleNames.has(role) && typeof active === "boolean", 400, "El rol o estado del usuario no es válido.");
    if (row.role === "admin" && row.active && (role !== "admin" || !active)) {
      const { count } = store.get("SELECT count(*) AS count FROM users WHERE role = 'admin' AND active = 1");
      requireCondition(count > 1, 409, "Debe quedar al menos una cuenta administradora activa.");
    }
    if (row.role !== role || Boolean(row.active) !== active) {
      store.run("UPDATE users SET role = ?, active = ? WHERE id = ?", role, Number(active), id);
      store.run("DELETE FROM sessions WHERE user_id = ?", id);
      store.audit("user.updated", { userId: by, comment: `${row.username} · ${role} · ${active ? "activa" : "desactivada"}` });
    }
    return safeUser(store.get("SELECT * FROM users WHERE id = ?", id));
  });
}

export function setSessionCookie(response, token = "") {
  response.setHeader("Set-Cookie", `${sessionName}=${token}; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=${token ? sessionLifetime / 1000 : 0}`);
}

export async function login(store, data) {
  const name = identifier(data.username);
  const password = data.password;
  requireCondition(name.length <= 64 && typeof password === "string" && Buffer.byteLength(password) <= 256, 400, "Credenciales inválidas.");
  const userScope = sha256(name);
  const now = store.now();
  // Reserve the attempt before the asynchronous hash to apply the same bound under concurrency.
  store.transaction(() => {
    store.run("DELETE FROM login_attempts WHERE expires_at <= ?", now);
    for (const [scope, maximum] of [[userScope, 8], ["local", 80]]) {
      const attempt = store.get("SELECT failures FROM login_attempts WHERE scope = ?", scope);
      requireCondition((attempt?.failures ?? 0) < maximum, 429, "Demasiados intentos de acceso. Vuelve a intentarlo en unos minutos.");
      store.run(`INSERT INTO login_attempts (scope, failures, expires_at) VALUES (?, 1, ?)
        ON CONFLICT(scope) DO UPDATE SET failures = failures + 1`, scope, now + loginWindow);
    }
  });
  const row = store.get("SELECT * FROM users WHERE username = ?", name);
  const stored = row ? row.password_hash.split(":").map(part => Buffer.from(part, "hex")) : [dummySalt, dummyHash];
  const computed = await hash(password, stored[0], 64);
  if (!timingSafeEqual(stored[1], computed) || !row?.active) {
    throw new HttpError(401, "El usuario o la contraseña no son correctos.");
  }
  const token = randomBytes(32).toString("base64url");
  const csrf = randomBytes(32).toString("base64url");
  return store.transaction(() => {
    const current = store.get("SELECT * FROM users WHERE id = ? AND active = 1", row.id);
    requireCondition(current && current.password_hash === row.password_hash, 401, "La cuenta ya no está disponible.");
    store.run("DELETE FROM login_attempts WHERE scope = ?", userScope);
    store.run("DELETE FROM sessions WHERE expires_at <= ?", now);
    store.run("INSERT INTO sessions (token_hash, user_id, csrf, expires_at) VALUES (?, ?, ?, ?)", sha256(token), current.id, csrf, now + sessionLifetime);
    store.audit("session.login", { userId: current.id });
    return { user: safeUser(current), token, csrf };
  });
}

export function sessionForHash(store, tokenHash) {
  if (!tokenHash) return null;
  const row = store.get(`SELECT u.id, u.username, u.role, u.active, u.created_at, s.csrf, s.token_hash
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1`, tokenHash, store.now());
  return row ? { user: safeUser(row), csrf: row.csrf, tokenHash: row.token_hash } : null;
}

export function sessionForRequest(store, request) {
  const token = readCookie(request, sessionName);
  return token ? sessionForHash(store, sha256(token)) : null;
}

export function requireEditor(user) {
  requireCondition(capabilities(user).edit, 403, "Tu perfil no puede editar borradores.");
}

export function requireAdmin(user) {
  requireCondition(capabilities(user).manage, 403, "Solo una cuenta administradora puede hacer este cambio.");
}

export function checkRequestMutation(request, origin, session) {
  requireCondition(request.headers.origin === origin, 403, "El origen de la solicitud no coincide con este portal.");
  if (!session) return;
  const token = request.headers["x-csrf-token"];
  const valid = typeof token === "string" && /^[\w-]+$/.test(token) && token.length === session.csrf.length
    && timingSafeEqual(Buffer.from(token), Buffer.from(session.csrf));
  requireCondition(valid, 403, "La sesión del formulario venció. Recarga la página.");
}
