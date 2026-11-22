// Types shared by the main process, the preload script and the renderer.

export type ThemeId = 'sand' | 'light' | 'sepia' | 'cafe' | 'dark' | 'black' | 'custom'
export type FontKey = 'publisher' | 'serif' | 'sans' | 'mono' | 'custom'
export type TextAlign = 'left' | 'justify'

export interface ReaderSettings {
  themeId: ThemeId
  background: string // #rrggbb
  color: string // #rrggbb
  linkColor: string // #rrggbb
  fontKey: FontKey
  customFont: string // installed font family name, used when fontKey === 'custom'
  fontSize: number // px
  lineHeight: number // unitless multiplier
  paragraphSpacing: number // em
  textWidth: number // max text column width in px, 0 = full width
  textAlign: TextAlign
  autoHideBars: boolean // hide the reader's top/bottom bars while reading (immersive mode)
}

export interface BookSummary {
  id: number
  title: string
  author: string | null
  hasCover: boolean
  percent: number // 0..1
  lastReadAt: number | null // epoch ms
  addedAt: number // epoch ms
}

export interface ReadingProgress {
  cfi: string
  percent: number // 0..1
  updatedAt: number // epoch ms
}

export interface ScanProgress {
  phase: 'discovering' | 'indexing' | 'done'
  done: number
  total: number
}

export interface ScanResult {
  total: number // epub files found in the folder
  added: number
  updated: number
  removed: number
  unreadable: number // files indexed with fallback metadata because parsing failed
}

export type ScanOutcome =
  | { ok: true; result: ScanResult }
  | { ok: false; reason: 'no-folder' | 'folder-unavailable' | 'failed'; message?: string }

export interface Api {
  getLibraryDir(): Promise<string | null>
  chooseLibraryDir(): Promise<string | null>
  scanLibrary(): Promise<ScanOutcome>
  onScanProgress(callback: (progress: ScanProgress) => void): () => void
  listBooks(): Promise<BookSummary[]>
  readBook(id: number): Promise<Uint8Array>
  getProgress(id: number): Promise<ReadingProgress | null>
  saveProgress(id: number, cfi: string, percent: number): Promise<void>
  getLocations(id: number): Promise<string | null>
  saveLocations(id: number, json: string): Promise<void>
  /** Opens Google Translate (-> pt-BR) for the selected text in the system browser. Resolves false on failure. */
  openTranslate(bookId: number, text: string): Promise<boolean>
  /** Book the OS asked us to open ("Open with"); returned once. Negative ids are read-only books outside the library. */
  takePendingOpen(): Promise<number | null>
  /** Fires when another "Open with" request arrives while the app is running (then call takePendingOpen). */
  onOpenRequested(callback: () => void): () => void
  getSettings(): Promise<ReaderSettings>
  saveSettings(settings: ReaderSettings): Promise<ReaderSettings>
}
