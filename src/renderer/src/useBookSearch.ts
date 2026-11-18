import { useCallback, useEffect, useRef, useState } from 'react'
import type { Book, Rendition } from 'epubjs'
import { MIN_QUERY_LENGTH, searchBook } from './bookSearch'

const DEBOUNCE_MS = 300
const HIGHLIGHT_CLASS = 'search-hit'
const SCROLL_MARGIN_PX = 96 // keeps the match clear of the top edge after jumping to it

type Annotations = {
  highlight(cfi: string, data: object, cb: () => void, className: string, styles: Record<string, string>): void
  remove(cfi: string, type: string): void
}

export interface BookSearch {
  open: boolean
  query: string
  total: number
  current: number // 0-based; -1 when there is no match
  searching: boolean
  truncated: boolean
  openBar(): void
  closeBar(): void
  setQuery(value: string): void
  step(direction: 1 | -1): void
}

export function useBookSearch(
  bookRef: React.RefObject<Book | null>,
  renditionRef: React.RefObject<Rendition | null>,
  hostRef: React.RefObject<HTMLElement | null>,
  bookId: number
): BookSearch {
  const [open, setOpen] = useState(false)
  const [query, setQueryState] = useState('')
  const [cfis, setCfis] = useState<string[]>([])
  const [current, setCurrent] = useState(-1)
  const [searching, setSearching] = useState(false)
  const [truncated, setTruncated] = useState(false)
  const runRef = useRef(0) // bumped to cancel an in-flight search
  const markedRef = useRef<string | null>(null)
  const timerRef = useRef<number | undefined>(undefined)

  const unmark = useCallback(() => {
    const annotations = renditionRef.current?.annotations as unknown as Annotations | undefined
    if (annotations && markedRef.current) {
      try {
        annotations.remove(markedRef.current, 'highlight')
      } catch {
        /* the chapter may already be gone */
      }
    }
    markedRef.current = null
  }, [renditionRef])

  const show = useCallback(
    async (cfi: string) => {
      const rendition = renditionRef.current
      if (!rendition) return
      unmark()
      const annotations = rendition.annotations as unknown as Annotations
      annotations.highlight(cfi, {}, () => {}, HIGHLIGHT_CLASS, { fill: '#ffc83d', 'fill-opacity': '0.55', 'mix-blend-mode': 'normal' })
      markedRef.current = cfi
      try {
        await rendition.display(cfi)
        hostRef.current?.querySelector<HTMLElement>('.epub-container')?.scrollBy({ top: -SCROLL_MARGIN_PX })
      } catch {
        /* position no longer valid: ignore */
      }
    },
    [hostRef, renditionRef, unmark]
  )

  const run = useCallback(
    (text: string) => {
      const id = ++runRef.current
      unmark()
      setCfis([])
      setCurrent(-1)
      setTruncated(false)
      const book = bookRef.current
      if (!book || text.trim().length < MIN_QUERY_LENGTH) {
        setSearching(false)
        return
      }
      setSearching(true)
      void searchBook(book, text, () => id !== runRef.current)
        .then((outcome) => {
          if (id !== runRef.current) return
          setCfis(outcome.cfis)
          setTruncated(outcome.truncated)
          setSearching(false)
          if (outcome.cfis.length > 0) {
            setCurrent(0)
            void show(outcome.cfis[0])
          }
        })
        .catch(() => id === runRef.current && setSearching(false))
    },
    [bookRef, show, unmark]
  )

  const setQuery = useCallback(
    (value: string) => {
      setQueryState(value)
      window.clearTimeout(timerRef.current)
      timerRef.current = window.setTimeout(() => run(value), DEBOUNCE_MS)
    },
    [run]
  )

  const step = useCallback(
    (direction: 1 | -1) => {
      if (cfis.length === 0) return
      const next = (current + direction + cfis.length) % cfis.length
      setCurrent(next)
      void show(cfis[next])
    },
    [cfis, current, show]
  )

  const closeBar = useCallback(() => {
    window.clearTimeout(timerRef.current)
    runRef.current++
    unmark()
    setOpen(false)
    setSearching(false)
    setCfis([])
    setCurrent(-1)
    setQueryState('')
  }, [unmark])

  // A different book starts with a clean search.
  useEffect(() => {
    return () => {
      window.clearTimeout(timerRef.current)
      runRef.current++
    }
  }, [bookId])

  return {
    open,
    query,
    total: cfis.length,
    current,
    searching,
    truncated,
    openBar: () => setOpen(true),
    closeBar,
    setQuery,
    step
  }
}
