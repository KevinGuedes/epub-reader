// Pure helpers for the "translate selection" feature (shared so they can be unit-tested in plain Node).

export const MAX_SELECTION_CHARS = 100
const TARGET_LANGUAGE = 'pt' // Google Translate uses "pt" for Brazilian Portuguese

const EDGE_PUNCTUATION = /^[\s"'“”‘’«»()[\]{}.,;:!?…—–-]+|[\s"'“”‘’«»()[\]{}.,;:!?…—–-]+$/gu

/**
 * Cleans a raw text selection: collapses whitespace and trims surrounding punctuation.
 * Returns null when nothing useful is left or the selection is too long to be a word or short phrase.
 */
export function normalizeSelection(raw: string): string | null {
  const text = raw.replace(/\s+/g, ' ').replace(EDGE_PUNCTUATION, '')
  if (text.length === 0 || text.length > MAX_SELECTION_CHARS) return null
  return text
}

/** "pt-BR" -> "pt"; anything unusable (or already Portuguese, nothing to translate) -> "auto". */
export function sourceLanguage(bookLanguage: string | null | undefined): string {
  const primary = (bookLanguage ?? '').split(/[-_]/)[0].toLowerCase()
  if (!/^[a-z]{2,3}$/.test(primary)) return 'auto'
  if (primary === 'pt' || primary === 'und' || primary === 'mul' || primary === 'zxx') return 'auto'
  return primary
}

export function buildTranslateUrl(text: string, bookLanguage: string | null | undefined): string {
  const params = new URLSearchParams({
    sl: sourceLanguage(bookLanguage),
    tl: TARGET_LANGUAGE,
    text,
    op: 'translate'
  })
  return `https://translate.google.com/?${params.toString()}`
}
