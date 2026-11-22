import { isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * "Open with" support. The file manager starts the app as `epub-reader /path/book.epub` (the .desktop file uses %U,
 * so it may also be a file:// URL). Pure helper, no fs access: the caller checks that the file exists.
 */
export function extractEpubArg(argv: readonly string[], cwd: string): string | null {
  for (const arg of argv) {
    if (!arg || arg.startsWith('-')) continue
    let path = arg
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(arg) && !/^file:\/\//i.test(arg)) continue // other URL schemes are not files
    if (/^file:\/\//i.test(arg)) {
      try {
        path = fileURLToPath(arg)
      } catch {
        continue
      }
    }
    if (!/\.epub$/i.test(path)) continue
    return isAbsolute(path) ? path : resolve(cwd, path)
  }
  return null
}

/**
 * Books opened from outside the library folder are read-only and are not stored in the database. They get a
 * temporary NEGATIVE id (library ids are positive) valid until the app quits; the renderer never sees the path.
 */
export class ExternalBooks {
  private readonly byId = new Map<number, string>()
  private next = -1

  register(path: string): number {
    for (const [id, known] of this.byId) if (known === path) return id
    const id = this.next--
    this.byId.set(id, path)
    return id
  }

  getPath(id: number): string | null {
    return this.byId.get(id) ?? null
  }
}
