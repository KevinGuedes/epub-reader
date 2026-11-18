import type { FontKey, ReaderSettings, TextAlign, ThemeId } from './types'

export const THEME_PRESETS: Record<
  Exclude<ThemeId, 'custom'>,
  { label: string; background: string; color: string; linkColor: string }
> = {
  // Warm themes first: "sand" is the default. Contrast (WCAG): sand text 8.5:1, café text 10.8:1.
  sand: { label: 'Areia', background: '#d9c8b4', color: '#3a2a15', linkColor: '#7a3e0a' },
  light: { label: 'Claro', background: '#fbfbf8', color: '#1f2328', linkColor: '#0b5cad' },
  sepia: { label: 'Sépia', background: '#f4ecd8', color: '#433422', linkColor: '#8a4b08' },
  cafe: { label: 'Café', background: '#2a2118', color: '#e4d3bb', linkColor: '#e0a458' },
  dark: { label: 'Escuro', background: '#1e1f22', color: '#d7d9dc', linkColor: '#7ab7ff' },
  black: { label: 'Preto', background: '#000000', color: '#c8c8c8', linkColor: '#6cb0ff' }
}

export const DEFAULT_SETTINGS: ReaderSettings = {
  themeId: 'sand',
  background: THEME_PRESETS.sand.background,
  color: THEME_PRESETS.sand.color,
  linkColor: THEME_PRESETS.sand.linkColor,
  fontKey: 'serif',
  customFont: '',
  fontSize: 19,
  lineHeight: 1.6,
  paragraphSpacing: 0.6,
  textWidth: 760,
  textAlign: 'left',
  autoHideBars: true
}

export const LIMITS = {
  fontSize: { min: 12, max: 40, step: 1 },
  lineHeight: { min: 1.0, max: 2.6, step: 0.05 },
  paragraphSpacing: { min: 0, max: 2, step: 0.1 },
  textWidth: { min: 420, max: 1400, step: 20 }
} as const

const THEME_IDS: readonly ThemeId[] = ['sand', 'light', 'sepia', 'cafe', 'dark', 'black', 'custom']
const FONT_KEYS: readonly FontKey[] = ['publisher', 'serif', 'sans', 'mono', 'custom']
const ALIGNS: readonly TextAlign[] = ['left', 'justify']
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/

function pickEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback
}

function pickColor(value: unknown, fallback: string): string {
  return typeof value === 'string' && HEX_COLOR.test(value) ? value.toLowerCase() : fallback
}

function pickNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

/**
 * Validates untrusted settings (from disk or from the renderer) and fills gaps with defaults.
 * The font name ends up inside a CSS string, so it is restricted to a safe character set.
 */
export function sanitizeSettings(raw: unknown): ReaderSettings {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const d = DEFAULT_SETTINGS
  const customFont =
    typeof r.customFont === 'string' ? r.customFont.replace(/[^\p{L}\p{N} _.-]/gu, '').slice(0, 60) : d.customFont

  // textWidth 0 means "full width"; anything else is clamped to the allowed range.
  const rawWidth = typeof r.textWidth === 'number' && Number.isFinite(r.textWidth) ? r.textWidth : d.textWidth
  const textWidth =
    rawWidth <= 0 ? 0 : Math.min(LIMITS.textWidth.max, Math.max(LIMITS.textWidth.min, Math.round(rawWidth)))

  return {
    themeId: pickEnum(r.themeId, THEME_IDS, d.themeId),
    background: pickColor(r.background, d.background),
    color: pickColor(r.color, d.color),
    linkColor: pickColor(r.linkColor, d.linkColor),
    fontKey: pickEnum(r.fontKey, FONT_KEYS, d.fontKey),
    customFont,
    fontSize: Math.round(pickNumber(r.fontSize, LIMITS.fontSize.min, LIMITS.fontSize.max, d.fontSize)),
    lineHeight: pickNumber(r.lineHeight, LIMITS.lineHeight.min, LIMITS.lineHeight.max, d.lineHeight),
    paragraphSpacing: pickNumber(r.paragraphSpacing, LIMITS.paragraphSpacing.min, LIMITS.paragraphSpacing.max, d.paragraphSpacing),
    textWidth,
    textAlign: pickEnum(r.textAlign, ALIGNS, d.textAlign),
    autoHideBars: typeof r.autoHideBars === 'boolean' ? r.autoHideBars : d.autoHideBars
  }
}
