import type { Book } from 'epubjs'
import { findMatches, foldQuery } from '../../shared/textsearch'

export const MIN_QUERY_LENGTH = 2
export const MAX_RESULTS = 500

export interface SearchOutcome {
  cfis: string[] // one CFI range per match, in reading order
  truncated: boolean // stopped at MAX_RESULTS
}

interface SpineSection {
  url: string
  cfiFromRange(range: Range): string
}

const SKIPPED_ELEMENTS = new Set(['script', 'style', 'title', 'head'])
const SHOW_TEXT = 4 // NodeFilter.SHOW_TEXT

/**
 * Searches every chapter of the book. Chapters are read and parsed here, independently of the reader: epub.js'
 * own Section.load() stores its document on the section object, which the viewer also relies on, so it is not
 * safe to call while chapters are being displayed. Matches are per text node (a phrase split by inline markup
 * such as <em> is not found).
 */
export async function searchBook(book: Book, query: string, isCancelled: () => boolean): Promise<SearchOutcome> {
  const needle = foldQuery(query)
  const outcome: SearchOutcome = { cfis: [], truncated: false }
  if (needle.length < MIN_QUERY_LENGTH) return outcome

  const sections = (book.spine as unknown as { spineItems: SpineSection[] }).spineItems
  for (const section of sections) {
    if (isCancelled()) break
    let doc: Document
    try {
      doc = (await book.load(section.url)) as Document
    } catch {
      continue // unreadable chapter: skip it
    }
    if (!doc?.documentElement) continue

    const walker = doc.createTreeWalker(doc.documentElement, SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentNode as Element | null
      if (parent && SKIPPED_ELEMENTS.has((parent.localName ?? '').toLowerCase())) continue
      for (const [start, end] of findMatches(node.nodeValue ?? '', needle)) {
        const range = doc.createRange()
        range.setStart(node, start)
        range.setEnd(node, end)
        outcome.cfis.push(section.cfiFromRange(range))
        if (outcome.cfis.length >= MAX_RESULTS) return { ...outcome, truncated: true }
      }
    }
  }
  return outcome
}
