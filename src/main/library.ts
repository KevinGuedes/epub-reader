import { promises as fs, type Dirent } from 'node:fs'
import { basename, extname, join, sep } from 'node:path'
import { EPub } from 'epub2'
import type { Db } from './db'
import type { BookSummary, ReadingProgress, ScanProgress, ScanResult } from '../shared/types'

const PARSE_TIMEOUT_MS = 20_000
const PARSE_CONCURRENCY = 4
const MAX_COVER_BYTES = 8 * 1024 * 1024
const MAX_LOCATIONS_BYTES = 8 * 1024 * 1024

interface ParsedMeta {
  title: string
  author: string | null
  language: string | null
  cover: { data: Buffer; ext: string } | null
  unreadable: boolean
}

interface KnownBook {
  id: number
  path: string
  size: number
  mtime_ms: number
  cover_path: string | null
}

interface FoundFile {
  size: number
  mtimeMs: number
}

const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg'
}

export class Library {
  constructor(
    private readonly db: Db,
    private readonly coversDir: string
  ) {}

  // ---------- queries ----------

  list(): BookSummary[] {
    const rows = this.db
      .prepare(
        `SELECT b.id, b.title, b.author, b.cover_path IS NOT NULL AS has_cover, b.added_at,
                COALESCE(p.percent, 0) AS percent, p.updated_at AS last_read_at
           FROM books b
           LEFT JOIN reading_progress p ON p.book_id = b.id
          ORDER BY COALESCE(p.updated_at, 0) DESC, b.title COLLATE NOCASE`
      )
      .all() as Array<{
      id: number
      title: string
      author: string | null
      has_cover: number
      added_at: number
      percent: number
      last_read_at: number | null
    }>
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      author: r.author,
      hasCover: r.has_cover === 1,
      percent: r.percent,
      lastReadAt: r.last_read_at,
      addedAt: r.added_at
    }))
  }

  getBookPath(id: number): string | null {
    const row = this.db.prepare('SELECT path FROM books WHERE id = ?').get(id) as { path: string } | undefined
    return row?.path ?? null
  }

  getLanguage(id: number): string | null {
    const row = this.db.prepare('SELECT language FROM books WHERE id = ?').get(id) as
      | { language: string | null }
      | undefined
    return row?.language ?? null
  }

  getCoverPath(id: number): string | null {
    const row = this.db.prepare('SELECT cover_path FROM books WHERE id = ?').get(id) as
      | { cover_path: string | null }
      | undefined
    return row?.cover_path ?? null
  }

  getProgress(id: number): ReadingProgress | null {
    const row = this.db
      .prepare('SELECT cfi, percent, updated_at FROM reading_progress WHERE book_id = ?')
      .get(id) as { cfi: string; percent: number; updated_at: number } | undefined
    return row ? { cfi: row.cfi, percent: row.percent, updatedAt: row.updated_at } : null
  }

  saveProgress(id: number, cfi: string, percent: number): void {
    if (!cfi || cfi.length > 4096) return
    const clamped = Math.min(1, Math.max(0, Number.isFinite(percent) ? percent : 0))
    // The book may have been removed by a concurrent scan; ignore the foreign key failure in that case.
    try {
      this.db
        .prepare(
          `INSERT INTO reading_progress(book_id, cfi, percent, updated_at) VALUES(?, ?, ?, ?)
           ON CONFLICT(book_id) DO UPDATE SET cfi = excluded.cfi, percent = excluded.percent, updated_at = excluded.updated_at`
        )
        .run(id, cfi, clamped, Date.now())
    } catch {
      /* book no longer exists */
    }
  }

  getLocations(id: number): string | null {
    const row = this.db.prepare('SELECT locations FROM books WHERE id = ?').get(id) as
      | { locations: string | null }
      | undefined
    return row?.locations ?? null
  }

  saveLocations(id: number, json: string): void {
    if (json.length > MAX_LOCATIONS_BYTES) return
    this.db.prepare('UPDATE books SET locations = ? WHERE id = ?').run(json, id)
  }

  // ---------- scanning ----------

  /**
   * Mirrors the given folder into the database: new/changed .epub files are (re)indexed and files that
   * disappeared are removed. Throws if the folder itself is not accessible, in which case nothing is touched.
   */
  async scan(root: string, onProgress: (progress: ScanProgress) => void): Promise<ScanResult> {
    const rootStat = await fs.stat(root)
    if (!rootStat.isDirectory()) throw new Error(`Not a directory: ${root}`)

    onProgress({ phase: 'discovering', done: 0, total: 0 })

    const found = new Map<string, FoundFile>()
    for await (const file of walk(root)) {
      try {
        const st = await fs.stat(file)
        if (st.isFile()) found.set(file, { size: st.size, mtimeMs: Math.floor(st.mtimeMs) })
      } catch {
        /* file vanished or is unreadable; skip */
      }
    }

    const known = new Map<string, KnownBook>()
    for (const row of this.db.prepare('SELECT id, path, size, mtime_ms, cover_path FROM books').all() as KnownBook[]) {
      known.set(row.path, row)
    }

    const toIndex: Array<{ path: string; file: FoundFile; isNew: boolean }> = []
    for (const [path, file] of found) {
      const existing = known.get(path)
      if (!existing) toIndex.push({ path, file, isNew: true })
      else if (existing.size !== file.size || existing.mtime_ms !== file.mtimeMs) toIndex.push({ path, file, isNew: false })
    }

    // Guard against wiping the library when the folder is e.g. an unmounted drive's empty mount point.
    let removed = 0
    if (found.size > 0) {
      for (const [path, book] of known) {
        if (found.has(path)) continue
        this.db.prepare('DELETE FROM books WHERE id = ?').run(book.id)
        await removeFileQuietly(book.cover_path)
        removed++
      }
    }

    let done = 0
    let added = 0
    let updated = 0
    let unreadable = 0
    let lastEmit = 0
    const emit = (force = false): void => {
      const now = Date.now()
      if (!force && now - lastEmit < 60) return
      lastEmit = now
      onProgress({ phase: 'indexing', done, total: toIndex.length })
    }
    emit(true)

    await mapPool(toIndex, PARSE_CONCURRENCY, async ({ path, file, isNew }) => {
      const meta = await readMeta(path)
      if (meta.unreadable) unreadable++
      await this.upsertBook(path, file, meta, known.get(path)?.cover_path ?? null)
      if (isNew) added++
      else updated++
      done++
      emit()
    })

    onProgress({ phase: 'done', done: toIndex.length, total: toIndex.length })
    return { total: found.size, added, updated, removed, unreadable }
  }

  private async upsertBook(path: string, file: FoundFile, meta: ParsedMeta, previousCover: string | null): Promise<void> {
    const row = this.db
      .prepare(
        `INSERT INTO books(path, title, author, language, size, mtime_ms, added_at)
         VALUES(@path, @title, @author, @language, @size, @mtime, @now)
         ON CONFLICT(path) DO UPDATE SET
           title = excluded.title, author = excluded.author, language = excluded.language,
           size = excluded.size, mtime_ms = excluded.mtime_ms, locations = NULL
         RETURNING id`
      )
      .get({
        path,
        title: meta.title,
        author: meta.author,
        language: meta.language,
        size: file.size,
        mtime: file.mtimeMs,
        now: Date.now()
      }) as { id: number }

    await this.storeCover(row.id, meta.cover, previousCover)
  }

  private async storeCover(id: number, cover: ParsedMeta['cover'], previous: string | null): Promise<void> {
    if (!cover) {
      if (previous) {
        await removeFileQuietly(previous)
        this.db.prepare('UPDATE books SET cover_path = NULL WHERE id = ?').run(id)
      }
      return
    }
    const target = join(this.coversDir, `${id}.${cover.ext}`)
    try {
      await fs.writeFile(target, cover.data)
      if (previous && previous !== target) await removeFileQuietly(previous)
      this.db.prepare('UPDATE books SET cover_path = ? WHERE id = ?').run(target, id)
    } catch {
      /* cover is optional */
    }
  }
}

// ---------- helpers ----------

async function* walk(dir: string): AsyncGenerator<string> {
  let entries: Dirent[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      yield* walk(full)
    } else if ((entry.isFile() || entry.isSymbolicLink()) && entry.name.toLowerCase().endsWith('.epub')) {
      yield full
    }
  }
}

async function mapPool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++]
      await fn(item)
    }
  })
  await Promise.all(workers)
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

async function removeFileQuietly(path: string | null): Promise<void> {
  if (!path) return
  try {
    await fs.unlink(path)
  } catch {
    /* already gone */
  }
}

function text(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed ? trimmed : null
  }
  return null
}

async function readMeta(file: string): Promise<ParsedMeta> {
  const fallbackTitle = basename(file, extname(file))
  let epub: EPub
  try {
    epub = await withTimeout(EPub.createAsync(file) as unknown as Promise<EPub>, PARSE_TIMEOUT_MS)
  } catch {
    return { title: fallbackTitle, author: null, language: null, cover: null, unreadable: true }
  }

  const metadata = epub.metadata as unknown as Record<string, unknown>
  return {
    title: text(metadata.title) ?? fallbackTitle,
    author: text(metadata.creator),
    language: text(metadata.language),
    cover: await readCover(epub),
    unreadable: false
  }
}

async function readCover(epub: EPub): Promise<ParsedMeta['cover']> {
  const manifest = epub.manifest as unknown as Record<string, Record<string, unknown>>
  const candidates: string[] = []

  const declared = (epub.metadata as unknown as Record<string, unknown>).cover
  if (typeof declared === 'string' && manifest[declared]) candidates.push(declared)

  for (const [id, item] of Object.entries(manifest)) {
    const properties = typeof item.properties === 'string' ? item.properties.split(/\s+/) : []
    if (properties.includes('cover-image')) candidates.push(id)
  }
  for (const [id, item] of Object.entries(manifest)) {
    const mime = String(item['media-type'] ?? '')
    if (/^cover([-_ ]?image)?$/i.test(id) && mime.startsWith('image/')) candidates.push(id)
  }

  for (const id of new Set(candidates)) {
    try {
      // epub2 returns Bluebird promises whose typings are not installed; treat them as plain promises.
      const [data, mime] = await withTimeout(epub.getImageAsync(id) as unknown as Promise<[Buffer, string]>, PARSE_TIMEOUT_MS)
      const ext = MIME_EXT[String(mime).toLowerCase()]
      if (ext && data.length > 0 && data.length <= MAX_COVER_BYTES) return { data, ext }
    } catch {
      /* try the next candidate */
    }
  }
  return null
}

/** True when `child` is located under `parent` (plain string check on already-resolved paths). */
export function isInside(parent: string, child: string): boolean {
  return child.startsWith(parent.endsWith(sep) ? parent : parent + sep)
}
