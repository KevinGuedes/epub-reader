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
// Chapter navigation: both <nav> elements are appended at the END of <body> (the top one is positioned absolutely)
// so that no element is inserted before book content, which would shift every CFI element index.
const NAV_TOP_OFFSET = 60 // below the toolbar that overlays the page in immersive mode
const NAV_HEIGHT = 40

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
  letter-spacing: ${s.letterSpacing}em !important;
  text-align: ${s.textAlign} !important;
  max-width: ${maxWidth} !important;
  margin: 0 auto !important;
  padding: ${NAV_TOP_OFFSET + NAV_HEIGHT + 28}px 28px 64px !important; /* clears the overlaid toolbar and the chapter nav */
  position: relative !important;
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
.reader-nav {
  display: flex !important;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  min-height: ${NAV_HEIGHT}px;
}
.reader-nav.top {
  position: absolute;
  top: ${NAV_TOP_OFFSET}px;
  left: 28px;
  right: 28px;
}
.reader-nav.bottom {
  margin-top: 48px;
  align-items: flex-start;
  /* counted in the chapter height (unlike body padding), keeps the buttons clear of the overlaid progress bar */
  padding-bottom: 56px;
}
.reader-nav button {
  font: 600 14px/1.2 system-ui, "Noto Sans", sans-serif !important;
  color: inherit !important;
  background: color-mix(in srgb, ${s.color} 9%, transparent) !important;
  border: 1px solid color-mix(in srgb, ${s.color} 28%, transparent) !important;
  border-radius: 8px;
  padding: 10px 16px;
  cursor: pointer;
}
.reader-nav button:hover {
  background: color-mix(in srgb, ${s.color} 18%, transparent) !important;
}
.reader-nav button:focus-visible {
  outline: 2px solid ${s.linkColor};
  outline-offset: 2px;
}
.reader-nav button[hidden] {
  display: none !important;
}
.reader-nav .end-note {
  font: 14px/1.2 system-ui, sans-serif;
  opacity: 0.7;
  margin-left: auto;
  padding: 10px 0;
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
export function injectReaderStyle(html: string, settings: ReaderSettings, position?: ChapterPosition): string {
  if (!/<\/head>/i.test(html)) return html
  const tag = `<style id="${STYLE_ID}">${buildReaderCss(settings)}</style>`
  let out = html.replace(/<\/head>/i, () => `${tag}</head>`)
  if (position) {
    // Chapter navigation buttons are part of the HTML so the chapter is measured with them already in place.
    out = out.replace(/<\/body>/i, () => `${navHtml('top', position)}${navHtml('bottom', position)}</body>`)
  }
  return out
}

export interface ChapterPosition {
  index: number
  last: boolean
}

export const NAV_PREV = 'prev'
export const NAV_NEXT = 'next'

function navHtml(where: 'top' | 'bottom', { index, last }: ChapterPosition): string {
  const prev = index > 0 ? `<button type="button" data-reader-nav="${NAV_PREV}">← Capítulo anterior</button>` : '<span></span>'
  const next = last
    ? '<span class="end-note">Fim do livro</span>'
    : `<button type="button" data-reader-nav="${NAV_NEXT}">Próximo capítulo →</button>`
  return `<nav class="reader-nav ${where}">${prev}${next}</nav>`
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
  return [s.fontKey, s.customFont, s.fontSize, s.lineHeight, s.letterSpacing, s.paragraphSpacing, s.textWidth, s.textAlign].join('|')
}
