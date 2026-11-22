import { promises as fs } from 'node:fs'
import { BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import { CH } from '../shared/channels'
import { sanitizeSettings } from '../shared/settings'
import { buildTranslateUrl, normalizeSelection } from '../shared/translate'
import type { ReaderSettings, ScanOutcome, TranslateResult } from '../shared/types'
import { getSetting, setSetting, type Db } from './db'
import type { Library } from './library'
import type { ExternalBooks } from './openwith'
import { OnlineTranslator } from './translate-online'

const LIBRARY_DIR_KEY = 'libraryDir'
const READER_SETTINGS_KEY = 'reader'

/** Library books have positive ids; read-only books opened from outside the library have negative ones. */
function toBookRef(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value === 0) throw new Error('Invalid book id')
  return value
}

function toString(value: unknown, maxLength: number): string {
  if (typeof value !== 'string' || value.length > maxLength) throw new Error('Invalid string argument')
  return value
}

/** Only our own window (served from file:// or the Vite dev server) may talk to the main process. */
function isTrusted(event: IpcMainInvokeEvent): boolean {
  const url = event.senderFrame?.url ?? ''
  const dev = process.env['ELECTRON_RENDERER_URL']
  return dev ? url.startsWith(dev) : url.startsWith('file://')
}

function handle(channel: string, listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown): void {
  ipcMain.handle(channel, (event, ...args) => {
    if (!isTrusted(event)) throw new Error('Untrusted sender')
    return listener(event, ...args)
  })
}

export interface OpenWith {
  external: ExternalBooks
  takePending(): number | null
}

export function registerIpc(db: Db, library: Library, openWith: OpenWith, translator: OnlineTranslator): void {
  const getDir = (): string | null => getSetting<string>(db, LIBRARY_DIR_KEY) ?? null

  let scanning: Promise<ScanOutcome> | null = null

  handle(CH.libraryGetDir, () => getDir())

  handle(CH.libraryChooseDir, async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = {
      title: 'Escolha a pasta com seus livros EPUB',
      properties: ['openDirectory'],
      defaultPath: getDir() ?? undefined
    }
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null
    setSetting(db, LIBRARY_DIR_KEY, result.filePaths[0])
    return result.filePaths[0]
  })

  handle(CH.libraryScan, (event) => {
    // Concurrent requests share the scan that is already running.
    if (scanning) return scanning
    const dir = getDir()
    if (!dir) return { ok: false, reason: 'no-folder' } satisfies ScanOutcome

    scanning = (async (): Promise<ScanOutcome> => {
      try {
        await fs.access(dir)
      } catch {
        return { ok: false, reason: 'folder-unavailable' }
      }
      try {
        const result = await library.scan(dir, (progress) => {
          if (!event.sender.isDestroyed()) event.sender.send(CH.libraryScanProgress, progress)
        })
        return { ok: true, result }
      } catch (error) {
        return { ok: false, reason: 'failed', message: error instanceof Error ? error.message : String(error) }
      }
    })().finally(() => {
      scanning = null
    })
    return scanning
  })

  handle(CH.libraryList, () => library.list())

  handle(CH.bookRead, async (_event, id) => {
    const ref = toBookRef(id)
    const path = ref < 0 ? openWith.external.getPath(ref) : library.getBookPath(ref)
    if (!path) throw new Error('Book not found')
    const data = await fs.readFile(path)
    return new Uint8Array(data)
  })

  // External (negative id) books have no stored progress or locations: reading them leaves no trace.
  handle(CH.bookGetProgress, (_event, id) => {
    const ref = toBookRef(id)
    return ref < 0 ? null : library.getProgress(ref)
  })

  handle(CH.bookSaveProgress, (_event, id, cfi, percent) => {
    const ref = toBookRef(id)
    if (ref > 0) library.saveProgress(ref, toString(cfi, 4096), typeof percent === 'number' ? percent : 0)
  })

  handle(CH.bookGetLocations, (_event, id) => {
    const ref = toBookRef(id)
    return ref < 0 ? null : library.getLocations(ref)
  })

  handle(CH.bookSaveLocations, (_event, id, json) => {
    const ref = toBookRef(id)
    if (ref > 0) library.saveLocations(ref, toString(json, 8 * 1024 * 1024))
  })

  handle(CH.translateLookup, async (_event, id, text): Promise<TranslateResult> => {
    const clean = normalizeSelection(toString(text, 1000))
    if (!clean) return { ok: false, reason: 'failed' }
    const ref = toBookRef(id)
    return translator.lookup(clean, ref > 0 ? library.getLanguage(ref) : null)
  })

  // The URL is built here from validated text; the renderer can never ask us to open an arbitrary URL.
  handle(CH.translateOpen, async (_event, id, text) => {
    const clean = normalizeSelection(toString(text, 1000))
    if (!clean) return false
    try {
      const ref = toBookRef(id)
      await shell.openExternal(buildTranslateUrl(clean, ref > 0 ? library.getLanguage(ref) : null))
      return true
    } catch {
      return false
    }
  })

  handle(CH.openTakePending, () => openWith.takePending())

  handle(CH.settingsGet,() => sanitizeSettings(getSetting<unknown>(db, READER_SETTINGS_KEY)))

  handle(CH.settingsSave, (_event, settings) => {
    const clean: ReaderSettings = sanitizeSettings(settings)
    setSetting(db, READER_SETTINGS_KEY, clean)
    return clean
  })
}
