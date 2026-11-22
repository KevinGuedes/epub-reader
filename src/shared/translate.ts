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

// ---------- in-app translation (unofficial Google endpoint) ----------

export interface TranslationAlternatives {
  pos: string // part of speech as reported by the service ("noun", "verb"...)
  terms: string[]
}

export type TranslateResult =
  | { ok: true; translation: string; detected: string | null; alternatives: TranslationAlternatives[] }
  | { ok: false; reason: 'offline' | 'blocked' | 'failed' }

const MAX_ALTERNATIVE_GROUPS = 4
const MAX_TERMS_PER_GROUP = 6

/**
 * URL of the (undocumented) endpoint behind Google Translate's own web widgets. dj=1 asks for a JSON object instead of
 * nested positional arrays, which is much less fragile to parse; dt=t is the translation, dt=bd the dictionary
 * entries (alternatives) the service returns for single words.
 */
export function buildLookupUrl(text: string, bookLanguage: string | null | undefined): string {
  const params = new URLSearchParams({ client: 'gtx', sl: sourceLanguage(bookLanguage), tl: TARGET_LANGUAGE, dj: '1', q: text })
  params.append('dt', 't')
  params.append('dt', 'bd')
  return `https://translate.googleapis.com/translate_a/single?${params.toString()}`
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

/** Defensive parser: anything that does not look like the expected shape yields null instead of throwing. */
export function parseLookupResponse(json: unknown): Extract<TranslateResult, { ok: true }> | null {
  if (typeof json !== 'object' || json === null) return null
  const data = json as { sentences?: unknown; dict?: unknown; src?: unknown }
  if (!Array.isArray(data.sentences)) return null

  const translation = data.sentences
    .map((s) => (typeof s === 'object' && s !== null ? str((s as { trans?: unknown }).trans) ?? '' : ''))
    .join('')
    .trim()
  if (translation === '') return null

  const alternatives: TranslationAlternatives[] = []
  if (Array.isArray(data.dict)) {
    for (const group of data.dict) {
      if (alternatives.length >= MAX_ALTERNATIVE_GROUPS) break
      if (typeof group !== 'object' || group === null) continue
      const { pos, terms } = group as { pos?: unknown; terms?: unknown }
      if (!Array.isArray(terms)) continue
      const clean = terms.filter((t): t is string => typeof t === 'string' && t.trim() !== '').slice(0, MAX_TERMS_PER_GROUP)
      if (clean.length > 0) alternatives.push({ pos: str(pos) ?? '', terms: clean })
    }
  }
  return { ok: true, translation, detected: str(data.src), alternatives }
}
