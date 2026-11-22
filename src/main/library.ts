import { createHash } from 'node:crypto'
import { createReadStream, promises as fs, type Dirent } from 'node:fs'
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
  path: string | null // null = not in the current folder (absent)
  hash: string | null
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
          WHERE b.path IS NOT NULL
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

  findIdByPath(path: string): number | null {
    const row = this.db.prepare('SELECT id FROM books WHERE path = ?').get(path) as { id: number } | undefined
    return row?.id ?? null
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

    const rows = this.db.prepare('SELECT id, path, hash, size, mtime_ms, cover_path FROM books').all() as KnownBook[]
    const byPath = new Map<string, KnownBook>()
    const byHash = new Map<string, KnownBook>()
    for (const row of rows) {
      if (row.path) byPath.set(row.path, row)
      if (row.hash) byHash.set(row.hash, row)
    }
    const paths = [...found.keys()].sort()

    // 1. Content hashes. Files whose path, size and mtime are unchanged keep the hash we already have.
    const hashes = new Map<string, string | null>()
    const needHash = paths.filter((path) => {
      const row = byPath.get(path)
      const file = found.get(path)!
      if (row?.hash && row.size === file.size && row.mtime_ms === file.mtimeMs) {
        hashes.set(path, row.hash)
        return false
      }
      return true
    })
    let done = 0
    let lastEmit = 0
    const emit = (total: number, force = false): void => {
      const now = Date.now()
      if (!force && now - lastEmit < 60) return
      lastEmit = now
      onProgress({ phase: 'indexing', done, total })
    }
    emit(needHash.length, true)
    await mapPool(needHash, PARSE_CONCURRENCY, async (path) => {
      hashes.set(path, await hashFile(path))
      done++
      emit(needHash.length)
    })

    // 2. Decide, for every file, which book it is. Pass 1: content we already know (moved, renamed, back from another
    //    folder). Pass 2: unknown content either replaced the file of an existing book in place, or is a new book.
    const owner = new Map<number, string>() // book id -> the path it will have
    const seen = new Set<string>()
    const duplicates = new Set<string>() // second copies of the same content: ignored
    const unresolved: string[] = []
    // Files that already are where their book says go first, so a book with two identical copies stays put.
    const inPlace = (path: string): boolean => byPath.get(path)?.hash === hashes.get(path)
    const ordered = [...paths].sort((a, b) => Number(inPlace(b)) - Number(inPlace(a)))
    for (const path of ordered) {
      const hash = hashes.get(path)
      if (!hash) continue // unreadable file
      if (seen.has(hash)) {
        duplicates.add(path)
        continue
      }
      seen.add(hash)
      const row = byHash.get(hash)
      if (row) owner.set(row.id, path)
      else unresolved.push(path)
    }
    const reindex: Array<{ row: KnownBook | null; path: string; hash: string }> = []
    for (const path of unresolved) {
      const hash = hashes.get(path)!
      const file = found.get(path)!
      const row = byPath.get(path)
      if (row && !owner.has(row.id)) {
        owner.set(row.id, path)
        // A book without a hash yet (library from an older version) whose file is untouched only needs its hash
        // recorded, which step 3 does; anything else was replaced and is re-read.
        if (!(row.hash === null && row.size === file.size && row.mtime_ms === file.mtimeMs)) reindex.push({ row, path, hash })
      } else {
        reindex.push({ row: null, path, hash })
      }
    }

    // 3. Apply the paths. Books whose file is gone from the folder are only marked absent (path = NULL): nothing is
    //    deleted. (An empty folder, e.g. an unmounted drive, hides nothing.)
    let removed = 0
    this.db.transaction(() => {
      const next = new Map<number, string | null>()
      for (const row of rows) {
        const path = owner.get(row.id) ?? (found.size > 0 ? null : row.path)
        next.set(row.id, path)
        if (row.path && path === null) removed++
      }
      const clear = this.db.prepare('UPDATE books SET path = NULL WHERE id = ?')
      for (const row of rows) if (row.path !== next.get(row.id)) clear.run(row.id) // first free every path that changes...
      const assign = this.db.prepare('UPDATE books SET path = ?, size = ?, mtime_ms = ?, hash = COALESCE(hash, ?) WHERE id = ?')
      for (const row of rows) {
        const path = next.get(row.id)
        if (!path) continue
        const file = found.get(path)
        if (file) assign.run(path, file.size, file.mtimeMs, hashes.get(path) ?? null, row.id) // ...then hand them out
      }
    })()

    // 4. Metadata and cover for new books and for books whose file was replaced.
    let added = 0
    let updated = 0
    let unreadable = 0
    done = 0
    lastEmit = 0
    emit(reindex.length, true)
    await mapPool(reindex, PARSE_CONCURRENCY, async ({ row, path, hash }) => {
      const meta = await readMeta(path)
      if (meta.unreadable) unreadable++
      await this.upsertBook(row?.id ?? null, path, found.get(path)!, hash, meta, row?.cover_path ?? null)
      if (row) updated++
      else added++
      done++
      emit(reindex.length)
    })

    onProgress({ phase: 'done', done: reindex.length, total: reindex.length })
    return { total: found.size - duplicates.size, added, updated, removed, unreadable }
  }

  private async upsertBook(
    id: number | null,
    path: string,
    file: FoundFile,
    hash: string,
    meta: ParsedMeta,
    previousCover: string | null
  ): Promise<void> {
    let bookId = id
    if (bookId === null) {
      bookId = (
        this.db
          .prepare(
            `INSERT INTO books(path, hash, title, author, language, size, mtime_ms, added_at)
             VALUES(@path, @hash, @title, @author, @language, @size, @mtime, @now) RETURNING id`
          )
          .get({ path, hash, title: meta.title, author: meta.author, language: meta.language, size: file.size, mtime: file.mtimeMs, now: Date.now() }) as { id: number }
      ).id
    } else {
      // The file behind this book was replaced: new content, so the cached locations no longer apply.
      this.db
        .prepare(
          `UPDATE books SET hash = @hash, title = @title, author = @author, language = @language,
                  size = @size, mtime_ms = @mtime, locations = NULL WHERE id = @id`
        )
        .run({ id: bookId, hash, title: meta.title, author: meta.author, language: meta.language, size: file.size, mtime: file.mtimeMs })
    }
    await this.storeCover(bookId, meta.cover, previousCover)
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

function hashFile(path: string): Promise<string | null> {
  return new Promise((resolve) => {
    const hash = createHash('sha256')
    const stream = createReadStream(path)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', () => resolve(null)) // unreadable: the file is skipped
    stream.on('end', () => resolve(hash.digest('hex')))
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
