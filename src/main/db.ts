import Database from 'better-sqlite3'

export type Db = Database.Database

// Each entry migrates the schema from version N to N+1 (tracked with PRAGMA user_version).
const MIGRATIONS: string[] = [
  `
  CREATE TABLE books (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    path        TEXT    NOT NULL UNIQUE,
    title       TEXT    NOT NULL,
    author      TEXT,
    language    TEXT,
    cover_path  TEXT,
    size        INTEGER NOT NULL,
    mtime_ms    INTEGER NOT NULL,
    added_at    INTEGER NOT NULL,
    locations   TEXT
  );

  CREATE TABLE reading_progress (
    book_id     INTEGER PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
    cfi         TEXT    NOT NULL,
    percent     REAL    NOT NULL DEFAULT 0,
    updated_at  INTEGER NOT NULL
  );

  CREATE TABLE settings (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL
  );
  `,
  // v2: a book is identified by the SHA-256 of its content, not by its path. "path" becomes nullable: NULL means the
  // file is not in the current library folder ("absent"); the row, its reading progress and locations are kept, and
  // the book comes back (even from another folder or under another name) when its content is found again.
  `
  CREATE TABLE books_v2 (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    path        TEXT UNIQUE,
    hash        TEXT UNIQUE,
    title       TEXT    NOT NULL,
    author      TEXT,
    language    TEXT,
    cover_path  TEXT,
    size        INTEGER NOT NULL,
    mtime_ms    INTEGER NOT NULL,
    added_at    INTEGER NOT NULL,
    locations   TEXT
  );
  INSERT INTO books_v2(id, path, hash, title, author, language, cover_path, size, mtime_ms, added_at, locations)
    SELECT id, path, NULL, title, author, language, cover_path, size, mtime_ms, added_at, locations FROM books;
  DROP TABLE books;
  ALTER TABLE books_v2 RENAME TO books;
  `
]

export function openDatabase(file: string): Db {
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  migrate(db)
  db.pragma('foreign_keys = ON')
  return db
}

function migrate(db: Db): void {
  const current = db.pragma('user_version', { simple: true }) as number
  if (current >= MIGRATIONS.length) return
  // Table rebuilds (DROP TABLE books) would cascade-delete reading_progress while foreign keys are enforced.
  // The pragma cannot be changed inside a transaction, so it is off for the whole migration.
  db.pragma('foreign_keys = OFF')
  for (let version = current; version < MIGRATIONS.length; version++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[version])
      db.pragma(`user_version = ${version + 1}`)
      const broken = db.pragma('foreign_key_check') as unknown[]
      if (broken.length > 0) throw new Error('Migration left dangling references')
    })()
  }
}

export function getSetting<T>(db: Db, key: string): T | undefined {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
  if (!row) return undefined
  try {
    return JSON.parse(row.value) as T
  } catch {
    return undefined
  }
}

export function setSetting(db: Db, key: string, value: unknown): void {
  db.prepare(
    'INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, JSON.stringify(value))
}
