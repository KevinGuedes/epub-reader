import { useStore } from '../store'

interface Props {
  onToggleSettings: () => void
  fullscreen: boolean
  onToggleFullscreen: () => void
}

/** Right-hand cluster of the top bar, identical on the library and reader screens: [Imersivo] [Aa] [tela cheia]. */
export function TopbarActions({ onToggleSettings, fullscreen, onToggleFullscreen }: Props): React.JSX.Element {
  const autoHide = useStore((s) => s.settings.autoHideBars)
  const patchSettings = useStore((s) => s.patchSettings)
  return (
    <>
      <button
        className={`icon-btn toggle-btn${autoHide ? ' on' : ''}`}
        aria-pressed={autoHide}
        onClick={() => patchSettings({ autoHideBars: !autoHide })}
        title={autoHide ? 'Modo imersivo ligado: barras somem ao ler' : 'Modo imersivo desligado'}
      >
        Imersivo
      </button>
      <button
        className="icon-btn"
        data-drawer-toggle
        onClick={onToggleSettings}
        aria-label="Personalizar leitura"
        title="Personalizar leitura"
      >
        Aa
      </button>
      <button
        className="icon-btn"
        onClick={onToggleFullscreen}
        aria-label={fullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
        title={fullscreen ? 'Sair da tela cheia (F11)' : 'Tela cheia (F11)'}
      >
        {fullscreen ? '🗗' : '⛶'}
      </button>
    </>
  )
}
