import type { Contents } from 'epubjs'
import type { ReaderSettings } from '../../shared/types'

const STYLE_ID = 'reader-theme'

export const FONT_STACKS = {
  serif: 'Georgia, "Noto Serif", "DejaVu Serif", "Liberation Serif", serif',
  sans: '"Noto Sans", "DejaVu Sans", "Liberation Sans", Arial, sans-serif',
  mono: '"DejaVu Sans Mono", "Liberation Mono", "Noto Sans Mono", monospace'
} as const

/** Returns the CSS font-family to force on the book, or null to keep the publisher's fonts. */
export function resolveFontFamily(s: ReaderSettings): string | null {
  switch (s.fontKey) {
    case 'publisher':
      return null
    case 'custom': {
      const name = s.customFont.trim()
      return name ? `"${name}", ${FONT_STACKS.serif}` : null
    }
    default:
      return FONT_STACKS[s.fontKey]
  }
}

/** Selectors whose own colors/fonts/sizes from the book CSS are neutralised so the user's choices win. */
const TEXT_ELEMENTS =
  'p, div, span, li, dd, dt, td, th, blockquote, em, strong, i, b, u, section, article, aside, figcaption, font, center'

/**
 * Builds the stylesheet injected into every chapter document. `!important` is deliberate: this is the user's
 * explicit reading preference and must override whatever the book's own CSS says.
 */
export function buildReaderCss(s: ReaderSettings): string {
  const family = resolveFontFamily(s)
  const maxWidth = s.textWidth > 0 ? `${s.textWidth}px` : 'none'

  return `
html {
  background: ${s.background} !important;
}
body {
  background: ${s.background} !important;
  color: ${s.color} !important;
  ${family ? `font-family: ${family} !important;` : ''}
  font-size: ${s.fontSize}px !important;
  line-height: ${s.lineHeight} !important;
  text-align: ${s.textAlign} !important;
  max-width: ${maxWidth} !important;
  margin: 0 auto !important;
  padding: 28px 28px 56px !important;
  box-sizing: border-box !important;
  -webkit-font-smoothing: antialiased;
  overflow-wrap: break-word;
}
body :is(${TEXT_ELEMENTS}) {
  color: inherit !important;
  background-color: transparent !important;
  ${family ? 'font-family: inherit !important;' : ''}
}
body :is(p, div, span, li, dd, dt, td, th, blockquote, section, article, font) {
  font-size: inherit !important;
  line-height: inherit !important;
}
body :is(p, li, dd, blockquote) {
  text-align: ${s.textAlign} !important;
}
body p {
  margin-top: 0 !important;
  margin-bottom: ${s.paragraphSpacing}em !important;
}
h1, h2, h3, h4, h5, h6 {
  color: inherit !important;
  ${family ? 'font-family: inherit !important;' : ''}
  line-height: 1.25 !important;
}
a, a * {
  color: ${s.linkColor} !important;
}
img, svg, video {
  max-width: 100% !important;
  height: auto;
}
pre, code, kbd, samp {
  white-space: pre-wrap !important;
  font-family: ${FONT_STACKS.mono} !important;
}
::selection {
  background: ${s.linkColor}55;
}
`
}

/**
 * Embeds the reader stylesheet in a chapter's HTML *before* it is loaded into its iframe. epub.js measures the
 * chapter height right after load; if our style only arrives later (content hook) the first measurement uses the
 * publisher's CSS (e.g. 1.8k px instead of 9k px) and the chapter then "grows", which makes the scroll position
 * jump, especially when a chapter is re-inserted above the viewport while scrolling up.
 * The same <style id> is updated later by applyReaderStyle, so there is only ever one.
 */
export function injectReaderStyle(html: string, settings: ReaderSettings): string {
  if (!/<\/head>/i.test(html)) return html
  const tag = `<style id="${STYLE_ID}">${buildReaderCss(settings)}</style>`
  return html.replace(/<\/head>/i, () => `${tag}</head>`)
}

/** (Re)applies the reader stylesheet to one chapter document. Safe to call repeatedly. */
export function applyReaderStyle(contents: Contents, settings: ReaderSettings): void {
  const doc = contents.document
  if (!doc) return
  const parent = doc.head ?? doc.documentElement
  let style = doc.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (!style) {
    style = doc.createElement('style')
    style.id = STYLE_ID
  }
  style.textContent = buildReaderCss(settings)
  // Keep it last in <head> so it also wins ties against stylesheets the book or epub.js add later.
  parent.appendChild(style)
}

/** Mirrors the reading theme onto the app chrome (library, toolbars, panels). */
export function applyChromeTheme(s: ReaderSettings): void {
  const root = document.documentElement.style
  root.setProperty('--bg', s.background)
  root.setProperty('--fg', s.color)
  root.setProperty('--link', s.linkColor)
  root.setProperty('color-scheme', isDark(s.background) ? 'dark' : 'light')
}

/** Perceived brightness of a #rrggbb color is below the midpoint. */
function isDark(hex: string): boolean {
  const n = Number.parseInt(hex.slice(1), 16)
  const luma = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255
  return luma < 0.5
}

/** Settings that change text layout (and therefore require re-anchoring the reading position). */
export function layoutKey(s: ReaderSettings): string {
  return [s.fontKey, s.customFont, s.fontSize, s.lineHeight, s.paragraphSpacing, s.textWidth, s.textAlign].join('|')
}
