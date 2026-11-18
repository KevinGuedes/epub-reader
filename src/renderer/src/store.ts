import { create } from 'zustand'
import { DEFAULT_SETTINGS, THEME_PRESETS } from '../../shared/settings'
import type { ReaderSettings, ThemeId } from '../../shared/types'

export type View = { kind: 'library' } | { kind: 'reader'; bookId: number }

interface AppState {
  ready: boolean
  settings: ReaderSettings
  view: View
  init: () => Promise<void>
  patchSettings: (patch: Partial<ReaderSettings>) => void
  applyPreset: (id: Exclude<ThemeId, 'custom'>) => void
  resetSettings: () => void
  openBook: (bookId: number) => void
  closeBook: () => void
}

let persistTimer: number | undefined

export const useStore = create<AppState>((set, get) => {
  const persist = (): void => {
    window.clearTimeout(persistTimer)
    persistTimer = window.setTimeout(() => {
      void window.api.saveSettings(get().settings)
    }, 300)
  }

  return {
    ready: false,
    settings: DEFAULT_SETTINGS,
    view: { kind: 'library' },

    init: async () => {
      const settings = await window.api.getSettings()
      set({ settings, ready: true })
    },

    patchSettings: (patch) => {
      set((state) => ({ settings: { ...state.settings, ...patch } }))
      persist()
    },

    applyPreset: (id) => {
      const { background, color, linkColor } = THEME_PRESETS[id]
      set((state) => ({ settings: { ...state.settings, themeId: id, background, color, linkColor } }))
      persist()
    },

    resetSettings: () => {
      set({ settings: DEFAULT_SETTINGS })
      persist()
    },

    openBook: (bookId) => set({ view: { kind: 'reader', bookId } }),
    closeBook: () => set({ view: { kind: 'library' } })
  }
})
