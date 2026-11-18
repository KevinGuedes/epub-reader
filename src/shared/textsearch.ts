// Pure text-search helpers (no DOM), shared so they can be unit-tested in plain Node.
// Matching ignores case, accents and runs of whitespace ("acao" finds "Ação", "a  b" finds "a\nb").

export interface Folded {
  text: string
  /** map[i] = offset in the original string of the character that produced folded char i. */
  map: number[]
}

const WHITESPACE = /\s/u

export function foldWithMap(original: string): Folded {
  let text = ''
  const map: number[] = []
  let offset = 0
  for (const ch of original) {
    if (WHITESPACE.test(ch)) {
      // collapse any whitespace run into a single space, mapped to the first whitespace char of the run
      if (text.length > 0 && text[text.length - 1] !== ' ') {
        text += ' '
        map.push(offset)
      }
    } else {
      const folded = ch.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
      for (let i = 0; i < folded.length; i++) map.push(offset)
      text += folded
    }
    offset += ch.length
  }
  return { text, map }
}

/** Normalised form of a user query (same folding as the text it is matched against). */
export function foldQuery(query: string): string {
  return foldWithMap(query.trim()).text
}

/** Non-overlapping matches of an already folded query, as [start, end) offsets in the ORIGINAL string. */
export function findMatches(original: string, foldedQuery: string): Array<[number, number]> {
  if (foldedQuery.length === 0) return []
  const { text, map } = foldWithMap(original)
  const matches: Array<[number, number]> = []
  let from = 0
  for (;;) {
    const index = text.indexOf(foldedQuery, from)
    if (index < 0) break
    const start = map[index]
    const lastOffset = map[index + foldedQuery.length - 1]
    const lastCodePoint = original.codePointAt(lastOffset) ?? 0
    matches.push([start, lastOffset + (lastCodePoint > 0xffff ? 2 : 1)])
    from = index + foldedQuery.length
  }
  return matches
}
