import { createHash, randomUUID } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";

export function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

const schema = `
  CREATE TABLE users (
    id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, role TEXT NOT NULL,
    password_hash TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
  );
  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    csrf TEXT NOT NULL, expires_at INTEGER NOT NULL
  );
  CREATE TABLE login_attempts (
    scope TEXT PRIMARY KEY, failures INTEGER NOT NULL, expires_at INTEGER NOT NULL
  );
  CREATE TABLE drafts (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, owner_id TEXT NOT NULL REFERENCES users(id),
    status TEXT NOT NULL DEFAULT 'editing', version INTEGER NOT NULL DEFAULT 1,
    snapshot TEXT NOT NULL, base_digest TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE audit (
    sequence INTEGER PRIMARY KEY, draft_id TEXT REFERENCES drafts(id), user_id TEXT REFERENCES users(id),
    action TEXT NOT NULL, comment TEXT, created_at TEXT NOT NULL
  );
  CREATE INDEX audit_draft ON audit(draft_id, sequence DESC);
  CREATE TABLE assets (
    id TEXT PRIMARY KEY, draft_id TEXT NOT NULL REFERENCES drafts(id), name TEXT NOT NULL,
    sha256 TEXT NOT NULL, size_bytes INTEGER NOT NULL, kind TEXT NOT NULL,
    UNIQUE(draft_id, sha256, kind)
  );
  CREATE TABLE approved_hosts (host TEXT PRIMARY KEY);
  CREATE TABLE sources (
    id TEXT PRIMARY KEY, draft_id TEXT NOT NULL REFERENCES drafts(id), name TEXT NOT NULL, url TEXT NOT NULL,
    kind TEXT NOT NULL, purpose TEXT NOT NULL DEFAULT 'lesson', resource TEXT NOT NULL DEFAULT '{}',
    interval_minutes INTEGER NOT NULL, enabled INTEGER NOT NULL,
    next_run_at INTEGER NOT NULL, last_run_at TEXT, last_checksum TEXT, state TEXT NOT NULL DEFAULT 'ready'
  );
  CREATE TABLE jobs (
    id TEXT PRIMARY KEY, draft_id TEXT NOT NULL REFERENCES drafts(id), actor_id TEXT REFERENCES users(id),
    source_id TEXT REFERENCES sources(id), status TEXT NOT NULL, created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL, items TEXT NOT NULL
  );
  CREATE INDEX jobs_pending ON jobs(status, created_at);
  CREATE TABLE releases (
    id TEXT PRIMARY KEY, draft_id TEXT NOT NULL REFERENCES drafts(id), snapshot_digest TEXT NOT NULL,
    status TEXT NOT NULL, created_at TEXT NOT NULL, changes TEXT NOT NULL DEFAULT '[]', error TEXT,
    UNIQUE(draft_id, snapshot_digest)
  );
`;

export function openStore(dataDir, now = Date.now) {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") chmodSync(dataDir, 0o700);
  const filename = join(dataDir, "cms.sqlite");
  const database = new DatabaseSync(filename);
  if (process.platform !== "win32") chmodSync(filename, 0o600);
  database.exec("PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL");
  database.exec("BEGIN IMMEDIATE");
  try {
    const { user_version: version } = database.prepare("PRAGMA user_version").get();
    if (version === 0) database.exec(`${schema} PRAGMA user_version = 1;`);
    if (version > 1) throw new Error("Esta base requiere una versión más reciente del CMS.");
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    database.close();
    throw error;
  }

  const store = {
    dataDir,
    now,
    stamp: () => new Date(now()).toISOString(),
    id: randomUUID,
    get: (sql, ...params) => database.prepare(sql).get(...params),
    all: (sql, ...params) => database.prepare(sql).all(...params),
    run: (sql, ...params) => database.prepare(sql).run(...params),
    transaction(work) {
      database.exec("BEGIN IMMEDIATE");
      try {
        const result = work();
        database.exec("COMMIT");
        return result;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
    audit(action, { draftId = null, userId = null, comment = null } = {}) {
      store.run(
        "INSERT INTO audit (draft_id, user_id, action, comment, created_at) VALUES (?, ?, ?, ?, ?)",
        draftId, userId, action, comment, store.stamp(),
      );
    },
    close: () => database.close(),
  };
  return store;
}
