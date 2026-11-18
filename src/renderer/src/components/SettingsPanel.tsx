import { LIMITS, THEME_PRESETS } from '../../../shared/settings'
import type { FontKey, ThemeId } from '../../../shared/types'
import { useStore } from '../store'

const FONT_OPTIONS: Array<{ key: FontKey; label: string }> = [
  { key: 'publisher', label: 'Do livro (original)' },
  { key: 'serif', label: 'Serifada' },
  { key: 'sans', label: 'Sem serifa' },
  { key: 'mono', label: 'Monoespaçada' },
  { key: 'custom', label: 'Outra (instalada no sistema)' }
]

interface SliderProps {
  label: string
  value: number
  display: string
  min: number
  max: number
  step: number
  disabled?: boolean
  onChange: (value: number) => void
}

function Slider({ label, value, display, min, max, step, disabled, onChange }: SliderProps): React.JSX.Element {
  return (
    <label className="field">
      <span className="field-head">
        <span>{label}</span>
        <span className="field-value">{display}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        style={{ '--pct': `${((value - min) / (max - min)) * 100}%` } as React.CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  )
}

export function SettingsPanel({ onClose }: { onClose: () => void }): React.JSX.Element {
  const settings = useStore((s) => s.settings)
  const patch = useStore((s) => s.patchSettings)
  const applyPreset = useStore((s) => s.applyPreset)
  const reset = useStore((s) => s.resetSettings)

  const presetIds = Object.keys(THEME_PRESETS) as Array<Exclude<ThemeId, 'custom'>>

  return (
    <aside className="drawer" aria-label="Personalizar leitura">
      <header className="drawer-head">
        <h2>Leitura</h2>
        <button className="icon-btn" onClick={onClose} aria-label="Fechar">
          ✕
        </button>
      </header>

      <div className="drawer-body">
        <section>
          <h3>Tema</h3>
          <div className="swatches">
            {presetIds.map((id) => {
              const preset = THEME_PRESETS[id]
              return (
                <button
                  key={id}
                  className={`swatch ${settings.themeId === id ? 'active' : ''}`}
                  style={{ background: preset.background, color: preset.color }}
                  onClick={() => applyPreset(id)}
                >
                  Aa
                  <small>{preset.label}</small>
                </button>
              )
            })}
          </div>
          <div className="color-row">
            <label>
              Fundo
              <input
                type="color"
                value={settings.background}
                onChange={(e) => patch({ themeId: 'custom', background: e.target.value })}
              />
            </label>
            <label>
              Texto
              <input
                type="color"
                value={settings.color}
                onChange={(e) => patch({ themeId: 'custom', color: e.target.value })}
              />
            </label>
            <label>
              Links
              <input
                type="color"
                value={settings.linkColor}
                onChange={(e) => patch({ themeId: 'custom', linkColor: e.target.value })}
              />
            </label>
          </div>
        </section>

        <section>
          <h3>Fonte</h3>
          <select
            value={settings.fontKey}
            onChange={(e) => patch({ fontKey: e.target.value as FontKey })}
            aria-label="Família da fonte"
          >
            {FONT_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
          {settings.fontKey === 'custom' && (
            <input
              type="text"
              className="text-input"
              placeholder="Ex.: Literata, Bookerly, Inter"
              value={settings.customFont}
              maxLength={60}
              onChange={(e) => patch({ customFont: e.target.value })}
            />
          )}

          <Slider
            label="Tamanho"
            value={settings.fontSize}
            display={`${settings.fontSize}px`}
            {...LIMITS.fontSize}
            onChange={(fontSize) => patch({ fontSize })}
          />
          <Slider
            label="Espaçamento entre linhas"
            value={settings.lineHeight}
            display={settings.lineHeight.toFixed(2)}
            {...LIMITS.lineHeight}
            onChange={(lineHeight) => patch({ lineHeight })}
          />
          <Slider
            label="Espaço entre parágrafos"
            value={settings.paragraphSpacing}
            display={`${settings.paragraphSpacing.toFixed(1)} em`}
            {...LIMITS.paragraphSpacing}
            onChange={(paragraphSpacing) => patch({ paragraphSpacing })}
          />
        </section>

        <section>
          <h3>Página</h3>
          <label className="check">
            <input
              type="checkbox"
              checked={settings.textWidth === 0}
              onChange={(e) => patch({ textWidth: e.target.checked ? 0 : 760 })}
            />
            Usar a largura total da janela
          </label>
          <Slider
            label="Largura do texto"
            value={settings.textWidth === 0 ? LIMITS.textWidth.max : settings.textWidth}
            display={settings.textWidth === 0 ? 'total' : `${settings.textWidth}px`}
            {...LIMITS.textWidth}
            disabled={settings.textWidth === 0}
            onChange={(textWidth) => patch({ textWidth })}
          />
          <div className="segmented" role="group" aria-label="Alinhamento">
            <button className={settings.textAlign === 'left' ? 'active' : ''} onClick={() => patch({ textAlign: 'left' })}>
              Esquerda
            </button>
            <button
              className={settings.textAlign === 'justify' ? 'active' : ''}
              onClick={() => patch({ textAlign: 'justify' })}
            >
              Justificado
            </button>
          </div>
        </section>

        <button className="link-btn" onClick={reset}>
          Restaurar padrões
        </button>
      </div>
    </aside>
  )
}
