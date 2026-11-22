import { contextBridge, ipcRenderer } from 'electron'
import { CH } from '../shared/channels'
import type { Api, ScanProgress } from '../shared/types'

// The renderer gets this narrow, typed API and nothing else: no fs, no ipcRenderer, no Node.
const api: Api = {
  getLibraryDir: () => ipcRenderer.invoke(CH.libraryGetDir),
  chooseLibraryDir: () => ipcRenderer.invoke(CH.libraryChooseDir),
  scanLibrary: () => ipcRenderer.invoke(CH.libraryScan),
  onScanProgress: (callback) => {
    const listener = (_event: unknown, progress: ScanProgress): void => callback(progress)
    ipcRenderer.on(CH.libraryScanProgress, listener)
    return () => {
      ipcRenderer.removeListener(CH.libraryScanProgress, listener)
    }
  },
  listBooks: () => ipcRenderer.invoke(CH.libraryList),
  readBook: (id) => ipcRenderer.invoke(CH.bookRead, id),
  getProgress: (id) => ipcRenderer.invoke(CH.bookGetProgress, id),
  saveProgress: (id, cfi, percent) => ipcRenderer.invoke(CH.bookSaveProgress, id, cfi, percent),
  getLocations: (id) => ipcRenderer.invoke(CH.bookGetLocations, id),
  saveLocations: (id, json) => ipcRenderer.invoke(CH.bookSaveLocations, id, json),
  lookupTranslation: (bookId, text) => ipcRenderer.invoke(CH.translateLookup, bookId, text),
  openTranslate: (bookId, text) => ipcRenderer.invoke(CH.translateOpen, bookId, text),
  takePendingOpen: () => ipcRenderer.invoke(CH.openTakePending),
  onOpenRequested: (callback) => {
    const listener = (): void => callback()
    ipcRenderer.on(CH.openRequested, listener)
    return () => {
      ipcRenderer.removeListener(CH.openRequested, listener)
    }
  },
  getSettings: () => ipcRenderer.invoke(CH.settingsGet),
  saveSettings: (settings) => ipcRenderer.invoke(CH.settingsSave, settings)
}

contextBridge.exposeInMainWorld('api', api)
