import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * Schema migrations, applied in order. Each entry runs once and bumps
 * `PRAGMA user_version`, so an existing database is upgraded in place.
 * Never edit a released migration: append a new one instead.
 */
const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE contacts (
    id           INTEGER PRIMARY KEY,
    channel      TEXT NOT NULL,
    external_id  TEXT NOT NULL,
    display_name TEXT,
    created_at   TEXT NOT NULL,
    UNIQUE (channel, external_id)
  );

  CREATE TABLE conversations (
    id              INTEGER PRIMARY KEY,
    contact_id      INTEGER NOT NULL UNIQUE REFERENCES contacts (id),
    mode            TEXT NOT NULL DEFAULT 'bot' CHECK (mode IN ('bot', 'human')),
    flow            TEXT,
    unread          INTEGER NOT NULL DEFAULT 0,
    last_message_at TEXT NOT NULL
  );
  CREATE INDEX conversations_recent ON conversations (last_message_at DESC);

  CREATE TABLE messages (
    id                  INTEGER PRIMARY KEY,
    conversation_id     INTEGER NOT NULL REFERENCES conversations (id),
    channel             TEXT NOT NULL,
    direction           TEXT NOT NULL CHECK (direction IN ('in', 'out')),
    author              TEXT NOT NULL CHECK (author IN ('customer', 'bot', 'agent')),
    text                TEXT NOT NULL,
    provider_message_id TEXT,
    status              TEXT NOT NULL CHECK (status IN ('received', 'sent', 'failed')),
    error               TEXT,
    created_at          TEXT NOT NULL
  );
  CREATE INDEX messages_by_conversation ON messages (conversation_id, id);
  -- A redelivered webhook carries the same provider id. This index is what
  -- turns the redelivery into a no-op, and it survives restarts.
  CREATE UNIQUE INDEX messages_provider_id
    ON messages (channel, provider_message_id)
    WHERE provider_message_id IS NOT NULL;

  CREATE TABLE orders (
    id              INTEGER PRIMARY KEY,
    conversation_id INTEGER NOT NULL REFERENCES conversations (id),
    items           TEXT NOT NULL,
    customer_name   TEXT NOT NULL,
    phone           TEXT NOT NULL,
    address         TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'new'
                    CHECK (status IN ('new', 'confirmed', 'shipped', 'completed', 'cancelled')),
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
  );
  CREATE INDEX orders_recent ON orders (created_at DESC);

  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    csrf_token TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );
  `,
];

/**
 * Opens (or creates) the database and brings its schema up to date.
 *
 * Pass `":memory:"` for a throwaway database, which is what the tests use.
 */
export function openDatabase(path: string): DatabaseSync {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });

  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON;");
  if (path !== ":memory:") {
    // WAL lets the dashboard read while a webhook writes, and survives a crash
    // mid-write without corrupting the file.
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA synchronous = NORMAL;");
  }
  db.exec("PRAGMA busy_timeout = 5000;");

  migrate(db);
  return db;
}

function migrate(db: DatabaseSync): void {
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number } | undefined;
  const current = row?.user_version ?? 0;

  for (let version = current; version < MIGRATIONS.length; version++) {
    const sql = MIGRATIONS[version];
    if (sql === undefined) break;
    db.exec("BEGIN");
    try {
      db.exec(sql);
      db.exec(`PRAGMA user_version = ${version + 1}`);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
}
