import { useCallback, useEffect, useRef, useState } from 'react'
import ePub, { type Book, type Contents, type Location, type NavItem, type Rendition } from 'epubjs'
import { normalizeSelection, type TranslateResult } from '../../../shared/translate'
import { useStore } from '../store'
import { applyReaderStyle, injectReaderStyle, layoutKey, NAV_NEXT } from '../themes'
import { useBookSearch } from '../useBookSearch'
import { useDismissOutside } from '../useDismissOutside'
import { LIMITS, DEFAULT_SETTINGS } from '../../../shared/settings'
import { collectLines, type LineBox } from '../textLines'
import { SearchBar } from './SearchBar'
import { TopbarActions } from './TopbarActions'
import { useFullscreen } from '../useFullscreen'
import { SettingsPanel } from './SettingsPanel'
import { TocPanel } from './TocPanel'

type Panel = 'none' | 'toc' | 'settings'

interface SelectionPopover {
  text: string
  x: number // px, relative to the reader stage
  y: number
  below: boolean // placed under the selection when there is no room above it
  lookup?: { state: 'loading' } | { state: 'done'; result: TranslateResult } // set once the user asked to translate
}

const LOOKUP_ERRORS: Record<Extract<TranslateResult, { ok: false }>['reason'], string> = {
  offline: 'Sem conexão com a internet.',
  blocked: 'O Google recusou a consulta (limite de uso). Tente de novo em instantes.',
  failed: 'Não foi possível traduzir agora.'
}

const LOADING_DELAY_MS = 300 // show "Traduzindo…" only when the answer takes longer than this
const POPOVER_HALF_WIDTH = 170 // the translation card is up to ~340px wide
const POPOVER_LABEL_CHARS = 24

const SAVE_DEBOUNCE_MS = 600
const REANCHOR_DEBOUNCE_MS = 250
const REANCHOR_STABLE_MS = 300 // heights must stop changing for this long before the position is restored
const REANCHOR_MAX_WAIT_MS = 6000
const CHARS_PER_LOCATION = 1600

const BARS_HIDE_MS = 2500 // immersive mode: bars slide away after this much time without interaction
const EDGE_REVEAL_PX = 56 // pointer this close to the top/bottom window edge brings the bars back
const EDGE_THROTTLE_MS = 400
const END_TOLERANCE_PX = 3
const SCROLLBAR_REVEAL_PX = 24
const SCROLLBAR_IDLE_MS = 1000 // scrollbar stays visible this long after the last scroll

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

function percentOf(book: Book, location: Location): number {
  if (book.locations.length() > 0) {
    const value = book.locations.percentageFromCfi(location.start.cfi)
    if (typeof value === 'number' && Number.isFinite(value)) return Math.min(1, Math.max(0, value))
  }
  // Locations not generated yet: approximate by chapter index.
  const total = (book.spine as unknown as { length: number }).length || 1
  return Math.min(1, Math.max(0, location.start.index / total))
}

export function Reader({ bookId }: { bookId: number }): React.JSX.Element {
  const closeBook = useStore((s) => s.closeBook)
  const settings = useStore((s) => s.settings)

  const hostRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const popoverRef = useRef<SelectionPopover | null>(null)
  const selectionContentsRef = useRef<Contents | null>(null)
  const bookRef = useRef<Book | null>(null)
  const renditionRef = useRef<Rendition | null>(null)
  const settingsRef = useRef(settings)
  const lastCfiRef = useRef<string | null>(null)
  const lastLayoutRef = useRef(layoutKey(settings))
  const reanchorTimerRef = useRef<number | undefined>(undefined)
  const reanchorCfiRef = useRef<string | null>(null)
  const seekTimerRef = useRef<number | undefined>(undefined)
  const keyHandlerRef = useRef<(event: KeyboardEvent) => void>(() => {})
  const goChapterRef = useRef<(delta: 1 | -1, atEnd?: boolean) => void>(() => {})
  const lastRevealRef = useRef(0)
  const scrollIdleRef = useRef<number | undefined>(undefined)
  settingsRef.current = settings
  // The ruler position lives in a ref and is written straight to the element: going through React state (render +
  // commit per mousemove) and a CSS transition made it visibly trail the pointer.
  const [rulerShown, setRulerShown] = useState(false)
  // Box in stage coordinates. The pointer centers a nominal one-line box; the keyboard snaps to real text lines.
  const rulerBoxRef = useRef<{ top: number; height: number } | null>(null)
  const rulerElRef = useRef<HTMLDivElement | null>(null)
  const placeRuler = (el: HTMLDivElement | null): void => {
    const box = rulerBoxRef.current
    if (!el || !box) return
    el.style.top = `${box.top}px`
    el.style.height = `${box.height}px`
  }
  const setRulerBox = (top: number, height: number): void => {
    rulerBoxRef.current = { top, height }
    if (rulerElRef.current) placeRuler(rulerElRef.current)
    else setRulerShown(true)
  }
  // Who drives the ruler: the last input used. Only refs are touched below, because the content hook that calls
  // these is registered once and keeps the closures of the first render.
  const rulerOwnerRef = useRef<'mouse' | 'key'>('mouse')
  const pointerYRef = useRef<number | null>(null) // stage coordinates
  const appliedPointerYRef = useRef<number | null>(null)
  const rulerFrameRef = useRef(0)
  const lineCacheRef = useRef<{ doc: Document; sig: string; lo: number; hi: number; lines: LineBox[] } | null>(null)

  /** Text lines near the viewport in stage coordinates; measured lines are cached until the layout changes. */
  const stageLines = (contents: Contents, frame: HTMLIFrameElement, stage: HTMLElement, h: number) => {
    const doc = contents.document
    const offset = frame.getBoundingClientRect().top - stage.getBoundingClientRect().top
    const lo = -offset - 80
    const hi = -offset + h + 80
    const sig = `${doc.documentElement.scrollHeight}|${frame.clientWidth}|${JSON.stringify(settingsRef.current)}`
    let cache = lineCacheRef.current
    if (!cache || cache.doc !== doc || cache.sig !== sig || lo < cache.lo || hi > cache.hi) {
      // Measure one extra screen on each side so ordinary scrolling does not trigger a new measurement.
      cache = { doc, sig, lo: lo - h, hi: hi + h, lines: collectLines(doc, lo - h, hi + h) }
      lineCacheRef.current = cache
    }
    return cache.lines.filter((l) => l.bottom >= lo && l.top <= hi).map((l) => ({ top: l.top + offset, bottom: l.bottom + offset }))
  }

  /** Highlight the line nearest to the pointer, with that line's own height (same look as keyboard navigation). */
  const snapRulerToPointer = (): void => {
    const y = pointerYRef.current
    const contents = (renditionRef.current?.getContents() as unknown as Contents[] | undefined)?.[0]
    const frame = contents?.document.defaultView?.frameElement as HTMLIFrameElement | null | undefined
    const stage = stageRef.current
    if (y === null || !contents || !frame || !stage) return
    appliedPointerYRef.current = y
    const lines = stageLines(contents, frame, stage, stage.clientHeight)
    let best: { top: number; bottom: number } | undefined
    let bestDist = Infinity
    for (const l of lines) {
      const d = y < l.top ? l.top - y : y > l.bottom ? y - l.bottom : 0
      if (d < bestDist) {
        best = l
        bestDist = d
      }
    }
    if (best) setRulerBox(best.top, best.bottom - best.top)
    else {
      const cfg = settingsRef.current
      const height = cfg.fontSize * cfg.lineHeight
      setRulerBox(y - height / 2, height)
    }
  }
  const scheduleRulerSnap = (): void => {
    if (rulerFrameRef.current) return
    rulerFrameRef.current = requestAnimationFrame(() => {
      rulerFrameRef.current = 0
      snapRulerToPointer()
    })
  }

  const [title, setTitle] = useState('')
  const [toc, setToc] = useState<NavItem[]>([])
  const [percent, setPercent] = useState(0)
  const [locationsReady, setLocationsReady] = useState(false)
  const [panel, setPanel] = useState<Panel>('none')
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [popover, setPopoverState] = useState<SelectionPopover | null>(null)
  const [barsVisible, setBarsVisible] = useState(true)
  const [revealTick, setRevealTick] = useState(0)
  const [pointerOnBars, setPointerOnBars] = useState(false)
  const [focusOnBars, setFocusOnBars] = useState(false)
  const [searchFocusToken, setSearchFocusToken] = useState(0)
  const [scrolling, setScrolling] = useState(false)

  const search = useBookSearch(bookRef, renditionRef, hostRef, bookId)

  // Drawers (índice / personalização) close when the user clicks anywhere outside them.
  const closePanel = useCallback(() => setPanel('none'), [])
  useDismissOutside(panel !== 'none', closePanel)

  // The ref mirrors the state so event handlers living inside epub.js callbacks always see the current value.
  const setPopover = useCallback((next: SelectionPopover | null) => {
    popoverRef.current = next
    setPopoverState(next)
  }, [])

  const lookupPendingRef = useRef(false)

  const clearSelection = useCallback(() => {
    selectionContentsRef.current?.document.getSelection()?.removeAllRanges()
    setPopover(null)
  }, [setPopover])

  // Translates inside the reader (online). The card replaces the "Traduzir" button; the selection stays in place.
  const translateSelection = useCallback(async () => {
    const current = popoverRef.current
    if (!current || current.lookup?.state === 'loading' || lookupPendingRef.current) return
    if (!navigator.onLine) {
      setPopover({ ...current, lookup: { state: 'done', result: { ok: false, reason: 'offline' } } })
      return
    }
    // Most answers arrive within a few dozen ms. Showing the "Traduzindo…" card for those only makes the popover
    // jump twice (button -> small card -> full card), so the wait state appears only if the answer is really slow.
    lookupPendingRef.current = true
    const waitTimer = window.setTimeout(() => {
      const now = popoverRef.current
      if (now && now.text === current.text && !now.lookup) setPopover({ ...now, lookup: { state: 'loading' } })
    }, LOADING_DELAY_MS)
    let result: TranslateResult
    try {
      result = await window.api.lookupTranslation(bookId, current.text)
    } finally {
      window.clearTimeout(waitTimer)
      lookupPendingRef.current = false
    }
    const latest = popoverRef.current
    if (!latest || latest.text !== current.text) return // the selection changed while we were waiting
    setPopover({ ...latest, lookup: { state: 'done', result } })
  }, [bookId, setPopover])

  // Secondary action: the same text in Google Translate, in the system browser.
  const openInGoogle = useCallback(async () => {
    const current = popoverRef.current
    if (!current) return
    if (await window.api.openTranslate(bookId, current.text)) clearSelection()
  }, [bookId, clearSelection])

  // Immersive mode: pointer near the top/bottom edge of the window (y in window coordinates) reveals the bars.
  const edgeMove = useCallback((x: number, y: number) => {
    // The right edge counts too: that is where the (hidden) scrollbar is, and it must be reachable to drag it.
    const nearSide = x >= window.innerWidth - SCROLLBAR_REVEAL_PX
    if (!nearSide && y > EDGE_REVEAL_PX && y < window.innerHeight - EDGE_REVEAL_PX) return
    const now = performance.now()
    if (now - lastRevealRef.current < EDGE_THROTTLE_MS) return
    lastRevealRef.current = now
    setBarsVisible(true)
    setRevealTick((t) => t + 1)
  }, [])

  // ---------- open the book, restore position, persist progress ----------
  useEffect(() => {
    let disposed = false
    let saveTimer: number | undefined
    let pending: { cfi: string; percent: number } | null = null

    const flush = (): void => {
      window.clearTimeout(saveTimer)
      saveTimer = undefined
      if (pending) {
        void window.api.saveProgress(bookId, pending.cfi, pending.percent)
        pending = null
      }
    }
    const queueSave = (cfi: string, value: number): void => {
      pending = { cfi, percent: value }
      window.clearTimeout(saveTimer)
      saveTimer = window.setTimeout(flush, SAVE_DEBOUNCE_MS)
    }

    // Closing the window within the debounce window must not lose the last few seconds of progress.
    window.addEventListener('beforeunload', flush)

    let book: Book | null = null
    let rendition: Rendition | null = null

    void (async () => {
      try {
        const [bytes, progress, savedLocations] = await Promise.all([
          window.api.readBook(bookId),
          window.api.getProgress(bookId),
          window.api.getLocations(bookId)
        ])
        if (disposed || !hostRef.current) return

        book = ePub(toArrayBuffer(bytes))
        bookRef.current = book

        await book.ready
        if (disposed || !hostRef.current) return

        // Serialize hooks may rewrite a chapter's HTML (section.output) before it reaches the iframe. Registered only after
        // the book is unpacked: epub.js' own resource-substitution hook is added then and would otherwise run after
        // this one and overwrite its result.
        book.spine.hooks.serialize.register(
          (_output: string, section: { output: string; index: number; next(): unknown }) => {
            section.output = injectReaderStyle(section.output, settingsRef.current, {
              index: section.index,
              last: !section.next()
            })
          }
        )

        // One chapter at a time: the scroll area never changes size while reading; chapters are changed with the
        // buttons at their start/end (or the arrow keys).
        rendition = book.renderTo(hostRef.current, {
          manager: 'default',
          flow: 'scrolled-doc',
          width: '100%',
          height: '100%',
          spread: 'none',
          allowScriptedContent: false
        })
        renditionRef.current = rendition

        // Every chapter document gets the user's reading style as soon as it is loaded.
        rendition.hooks.content.register((contents: Contents) => {
          applyReaderStyle(contents, settingsRef.current)
          // The book lives in an iframe, so outside-click detection on the app document never sees clicks on the text.
          contents.document.addEventListener('mousedown', () => setPanel('none'))
          // Own (non-passive) listener instead of rendition.on('keydown'): epub.js forwards keys passively, which makes
          // preventDefault() a no-op and lets the browser also act on the key (double scroll, zoom...).
          contents.document.addEventListener('keydown', (event) => keyHandlerRef.current(event))
          contents.document.addEventListener('click', (event) => {
            const button = (event.target as Element | null)?.closest?.('[data-reader-nav]')
            if (button) goChapterRef.current(button.getAttribute('data-reader-nav') === NAV_NEXT ? 1 : -1)
          })
          // Immersive mode: the pointer near the top/bottom edge of the window brings the bars back.
          contents.document.addEventListener('mousemove', (event) => {
            const frame = contents.document.defaultView?.frameElement as HTMLIFrameElement | null
            const box = frame?.getBoundingClientRect()
            edgeMove(event.clientX + (box?.left ?? 0), event.clientY + (box?.top ?? 0))
            // Reading ruler: Y relative to the stage (the iframe fills the host, which fills the stage).
            const y = event.clientY + (box ? box.top - (stageRef.current?.getBoundingClientRect().top ?? 0) : 0)
            pointerYRef.current = y
            // After keyboard use, a few pixels of hand tremor must not take the ruler away from the arrow keys.
            if (rulerOwnerRef.current === 'key' && Math.abs(y - (appliedPointerYRef.current ?? -1e9)) < 6) return
            rulerOwnerRef.current = 'mouse'
            scheduleRulerSnap()
          })
          // Selection collapsed (click elsewhere, new chapter, Esc...) -> the popover no longer applies.
          contents.document.addEventListener('selectionchange', () => {
            if (contents.document.getSelection()?.isCollapsed) setPopover(null)
          })
        })

        rendition.on('selected', (_cfiRange: string, contents: Contents) => {
          const view = contents.document.defaultView
          const selection = view?.getSelection()
          const text = selection ? normalizeSelection(selection.toString()) : null
          const frame = view?.frameElement as HTMLIFrameElement | null
          const stage = stageRef.current
          if (!selection || selection.rangeCount === 0 || !text || !frame || !stage) {
            setPopover(null)
            return
          }
          // Selection rect is relative to the chapter iframe; translate it into stage coordinates.
          const rect = selection.getRangeAt(0).getBoundingClientRect()
          const frameRect = frame.getBoundingClientRect()
          const stageRect = stage.getBoundingClientRect()
          const top = frameRect.top + rect.top - stageRect.top
          const bottom = frameRect.top + rect.bottom - stageRect.top
          const center = frameRect.left + rect.left + rect.width / 2 - stageRect.left
          const below = top < 56
          selectionContentsRef.current = contents
          setPopover({
            text,
            below,
            x: Math.min(Math.max(center, POPOVER_HALF_WIDTH), Math.max(POPOVER_HALF_WIDTH, stageRect.width - POPOVER_HALF_WIDTH)),
            y: below ? bottom + 8 : top - 8
          })
        })

        // Scrolling moves the text away from the popover: dismiss it instead of leaving it floating.
        // epub.js creates .epub-container asynchronously and 'scroll' does not bubble, so listen in the capture phase.
        hostRef.current.addEventListener(
          'scroll',
          () => {
            if (popoverRef.current) setPopover(null)
            // The text moved under a still pointer (wheel, scrollbar): re-pick the line under it.
            if (rulerOwnerRef.current === 'mouse' && pointerYRef.current !== null) scheduleRulerSnap()
            // Immersive mode: the scrollbar shows while scrolling (like an overlay scrollbar) and fades after a pause.
            setScrolling(true)
            window.clearTimeout(scrollIdleRef.current)
            scrollIdleRef.current = window.setTimeout(() => setScrolling(false), SCROLLBAR_IDLE_MS)
          },
          { capture: true, passive: true }
        )

        rendition.on('relocated', (location: Location) => {
          if (!book || !location?.start?.cfi) return
          // While chapters are re-flowing after a layout change the visible position drifts; neither remember nor
          // save those intermediate positions, the anchor taken before the change is restored afterwards.
          if (reanchorCfiRef.current) return
          const value = percentOf(book, location)
          lastCfiRef.current = location.start.cfi
          setPercent(value)
          queueSave(location.start.cfi, value)
        })

        if (savedLocations) {
          book.locations.load(savedLocations)
          setLocationsReady(true)
        }

        try {
          await rendition.display(progress?.cfi)
        } catch {
          await rendition.display() // saved position no longer valid (e.g. file was replaced)
        }
        if (disposed) return
        setStatus('ready')

        void book.loaded.metadata.then((metadata) => !disposed && setTitle(metadata.title ?? ''))
        void book.loaded.navigation.then((navigation) => !disposed && setToc(navigation.toc))

        if (!savedLocations) {
          await book.ready
          await book.locations.generate(CHARS_PER_LOCATION)
          if (disposed) return
          void window.api.saveLocations(bookId, book.locations.save())
          setLocationsReady(true)
          const current = renditionRef.current?.currentLocation() as unknown as Location | undefined
          if (current?.start?.cfi) setPercent(percentOf(book, current))
        }
      } catch (e) {
        if (disposed) return
        setError(e instanceof Error ? e.message : String(e))
        setStatus('error')
      }
    })()

    return () => {
      disposed = true
      window.removeEventListener('beforeunload', flush)
      flush()
      window.clearTimeout(reanchorTimerRef.current)
      window.clearTimeout(seekTimerRef.current)
      try {
        rendition?.destroy()
        book?.destroy()
      } catch {
        /* nothing useful to do if teardown fails */
      }
      renditionRef.current = null
      bookRef.current = null
    }
  }, [bookId])

  // ---------- apply settings live ----------
  useEffect(() => {
    const rendition = renditionRef.current
    if (!rendition) return
    const contents = rendition.getContents() as unknown as Contents[]
    contents.forEach((c) => applyReaderStyle(c, settings))

    // Layout changes shift pixel positions; re-anchor on the saved CFI so the reader keeps their place.
    const key = layoutKey(settings)
    if (key === lastLayoutRef.current) return
    lastLayoutRef.current = key

    // Freeze the anchor at the first change of a burst (e.g. dragging a slider), then wait until every chapter has
    // finished re-flowing (total height stops changing) before scrolling back to it.
    if (!reanchorCfiRef.current) reanchorCfiRef.current = lastCfiRef.current
    if (!reanchorCfiRef.current) return
    window.clearTimeout(reanchorTimerRef.current)
    const started = performance.now()
    let lastHeight = -1
    let stableSince = started
    const poll = (): void => {
      const now = performance.now()
      const height = hostRef.current?.querySelector('.epub-container')?.scrollHeight ?? 0
      if (height !== lastHeight) {
        lastHeight = height
        stableSince = now
      }
      if (now - stableSince < REANCHOR_STABLE_MS && now - started < REANCHOR_MAX_WAIT_MS) {
        reanchorTimerRef.current = window.setTimeout(poll, 100)
        return
      }
      const cfi = reanchorCfiRef.current
      const release = (): void => {
        reanchorTimerRef.current = window.setTimeout(() => {
          reanchorCfiRef.current = null
        }, 200) // let the 'relocated' event of this display() pass before tracking positions again
      }
      if (cfi) void rendition.display(cfi).then(release, release)
      else reanchorCfiRef.current = null
    }
    reanchorTimerRef.current = window.setTimeout(poll, REANCHOR_DEBOUNCE_MS)
  }, [settings])

  // ---------- immersive mode (auto-hide bars) ----------
  const autoHide = settings.autoHideBars
  // Focus only keeps the bars open for keyboard navigation (:focus-visible); a mouse click leaves focus on the button too.
  const barsHeld = panel !== 'none' || search.open || pointerOnBars || focusOnBars
  useEffect(() => {
    if (!autoHide || barsHeld) {
      setBarsVisible(true)
      return
    }
    const timer = window.setTimeout(() => setBarsVisible(false), BARS_HIDE_MS)
    return () => window.clearTimeout(timer)
  }, [autoHide, barsHeld, revealTick])

  useEffect(() => {
    const onMove = (event: MouseEvent): void => edgeMove(event.clientX, event.clientY)
    window.addEventListener('mousemove', onMove)
    return () => window.removeEventListener('mousemove', onMove)
  }, [edgeMove])

  // The bars leave/enter the layout when the mode changes, so the text area changes size.
  useEffect(() => {
    const id = window.requestAnimationFrame(() => {
      try {
        const host = hostRef.current
        if (host) renditionRef.current?.resize(host.clientWidth, host.clientHeight)
      } catch {
        /* rendition not ready yet */
      }
    })
    return () => window.cancelAnimationFrame(id)
  }, [autoHide])

  const { fullscreen, toggleFullscreen } = useFullscreen()

  // ---------- chapter navigation ----------
  goChapterRef.current = (delta, atEnd = false): void => {
    const rendition = renditionRef.current
    const book = bookRef.current
    if (!rendition || !book) return
    const location = rendition.currentLocation() as unknown as Location | undefined
    const index = location?.start?.index
    if (typeof index !== 'number') return
    const current = book.spine.get(index) as unknown as { next(): { href: string } | undefined; prev(): { href: string } | undefined } | null
    const target = delta > 0 ? current?.next() : current?.prev()
    if (!target) return
    setPanel('none')
    void rendition.display(target.href).then(() => {
      const scroller = hostRef.current?.querySelector<HTMLElement>('.epub-container')
      scroller?.scrollTo({ top: atEnd ? scroller.scrollHeight : 0 })
    })
  }

  // ---------- keyboard ----------
  const changeFontSize = (next: number): void => {
    const { min, max } = LIMITS.fontSize
    useStore.getState().patchSettings({ fontSize: Math.min(max, Math.max(min, next)) })
  }

  const moveRulerByLine = (scroller: HTMLElement, dir: 1 | -1): void => {
    const contents = (renditionRef.current?.getContents() as unknown as Contents[] | undefined)?.[0]
    const frame = contents?.document.defaultView?.frameElement as HTMLIFrameElement | null | undefined
    const stage = stageRef.current
    if (!contents || !frame || !stage) return
    rulerOwnerRef.current = 'key'
    appliedPointerYRef.current = pointerYRef.current // the pointer must really move to take over again
    const h = scroller.clientHeight
    const bandTop = h * 0.25
    const bandBottom = h * 0.75
    const cur = rulerBoxRef.current
    const first = cur === null
    let centerY = cur ? cur.top + cur.height / 2 : h * 0.3

    for (let attempt = 0; attempt < 3; attempt++) {
      const lines = stageLines(contents, frame, stage, h)
      const mid = (l: { top: number; bottom: number }): number => (l.top + l.bottom) / 2
      let target: { top: number; bottom: number } | undefined
      if (first) target = lines.reduce<typeof target>((best, l) => (!best || Math.abs(mid(l) - centerY) < Math.abs(mid(best) - centerY) ? l : best), undefined)
      else if (dir > 0) target = lines.find((l) => mid(l) > centerY + 2)
      else target = [...lines].reverse().find((l) => mid(l) < centerY - 2)

      if (!target) {
        const before = scroller.scrollTop
        scroller.scrollBy({ top: dir * h * 0.5 })
        const moved = scroller.scrollTop - before
        if (moved === 0) return // start/end of the chapter
        centerY -= moved
        continue
      }
      let { top, bottom } = target
      const m = (top + bottom) / 2
      const clamped = Math.min(bandBottom, Math.max(bandTop, m))
      if (clamped !== m && !first) {
        const before = scroller.scrollTop
        scroller.scrollBy({ top: m - clamped })
        const moved = scroller.scrollTop - before
        top -= moved
        bottom -= moved
      }
      setRulerBox(top, bottom - top)
      return
    }
  }

  // Font/spacing/width changes re-flow the text: once it settled, put the ruler back on the line under the pointer.
  const reflowKey = `${settings.fontSize}|${settings.lineHeight}|${settings.letterSpacing}|${settings.paragraphSpacing}|${settings.textWidth}|${settings.fontKey}|${settings.customFont}|${settings.textAlign}`
  useEffect(() => {
    const id = window.setTimeout(() => {
      if (rulerOwnerRef.current === 'mouse' && pointerYRef.current !== null) snapRulerToPointer()
    }, 350)
    return () => window.clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reflowKey])

  keyHandlerRef.current = (event: KeyboardEvent): void => {
    // Keys typed into a form control (or used to operate an open dropdown, whose focus sits on an <option>)
    // belong to that control: Esc must close the dropdown only, not the whole drawer.
    const mod = (event.ctrlKey || event.metaKey) && !event.altKey

    // Shortcuts with Ctrl work everywhere, including while a form control has focus.
    if (mod && (event.key === 'f' || event.key === 'F')) {
      setPanel('none')
      search.openBar()
      setSearchFocusToken((n) => n + 1)
      event.preventDefault()
      return
    }
    if (mod && (event.key === '+' || event.key === '=')) {
      changeFontSize(settingsRef.current.fontSize + LIMITS.fontSize.step)
      event.preventDefault()
      return
    }
    if (mod && (event.key === '-' || event.key === '_')) {
      changeFontSize(settingsRef.current.fontSize - LIMITS.fontSize.step)
      event.preventDefault()
      return
    }
    if (mod && event.key === '0') {
      changeFontSize(DEFAULT_SETTINGS.fontSize)
      event.preventDefault()
      return
    }
    if (event.key === 'F11') {
      toggleFullscreen()
      event.preventDefault()
      return
    }

    const target = event.target as HTMLElement | null
    if (target?.closest?.('input, select, textarea, option')) return

    if (event.key === 'Escape') {
      if (popoverRef.current) clearSelection()
      else if (search.open) search.closeBar()
      else if (panel !== 'none') setPanel('none')
      else if (!document.fullscreenElement) closeBook()
      return
    }

    if ((event.key === 't' || event.key === 'T') && !event.ctrlKey && !event.metaKey && !event.altKey && popoverRef.current) {
      if (popoverRef.current.lookup?.state === 'done') void openInGoogle() // second T: continue in the browser
      else void translateSelection()
      event.preventDefault()
      return
    }

    const scroller = hostRef.current?.querySelector<HTMLElement>('.epub-container')
    if (!scroller) return
    const page = scroller.clientHeight * 0.9
    const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - END_TOLERANCE_PX
    const atTop = scroller.scrollTop <= END_TOLERANCE_PX
    switch (event.key) {
      case 'ArrowRight':
        goChapterRef.current(1)
        break
      case 'ArrowLeft':
        goChapterRef.current(-1)
        break
      case 'ArrowDown':
      case 'ArrowUp': {
        const dir = event.key === 'ArrowDown' ? 1 : -1
        const cfg = settingsRef.current
        if (!cfg.readingRuler || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) {
          scroller.scrollBy({ top: 60 * dir })
          break
        }
        // Reading ruler driven by the keyboard: snaps to the real text lines (measured in the DOM, so headings,
        // paragraph gaps and font changes are followed). Near the 25%/75% band edges the text scrolls instead.
        moveRulerByLine(scroller, dir)
        break
      }
      case 'PageDown':
        if (atBottom) goChapterRef.current(1)
        else scroller.scrollBy({ top: page })
        break
      case 'PageUp':
        if (atTop) goChapterRef.current(-1, true)
        else scroller.scrollBy({ top: -page })
        break
      case ' ':
        if (event.shiftKey ? atTop : atBottom) goChapterRef.current(event.shiftKey ? -1 : 1, event.shiftKey)
        else scroller.scrollBy({ top: event.shiftKey ? -page : page })
        break
      case 'Home':
        scroller.scrollTo({ top: 0 })
        break
      case 'End':
        scroller.scrollTo({ top: scroller.scrollHeight })
        break
      default:
        return
    }
    event.preventDefault()
  }

  useEffect(() => {
    const listener = (event: KeyboardEvent): void => keyHandlerRef.current(event)
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])

  // ---------- actions ----------
  const goTo = useCallback((href: string) => {
    void renditionRef.current?.display(href)
    setPanel('none')
  }, [])

  const seek = useCallback((value: number) => {
    setPercent(value)
    window.clearTimeout(seekTimerRef.current)
    seekTimerRef.current = window.setTimeout(() => {
      const book = bookRef.current
      if (!book || book.locations.length() === 0) return
      void renditionRef.current?.display(book.locations.cfiFromPercentage(value))
    }, 150)
  }, [])

  const togglePanel = (next: Exclude<Panel, 'none'>): void => setPanel((current) => (current === next ? 'none' : next))

  return (
    <div className={`screen reader${autoHide ? ' autohide' : ''}${autoHide && !barsVisible && !scrolling ? ' sb-off' : ''}${fullscreen ? ' fullscreen' : ''}`}>
      <header
        className={`topbar${autoHide && !barsVisible ? ' bars-hidden' : ''}`}
        onMouseEnter={() => setPointerOnBars(true)}
        onMouseLeave={() => setPointerOnBars(false)}
        onFocusCapture={(e) => setFocusOnBars((e.target as HTMLElement).matches(':focus-visible'))}
        onBlurCapture={() => setFocusOnBars(false)}
      >
        <button className="icon-btn" onClick={closeBook} aria-label="Voltar para a biblioteca" title="Biblioteca (Esc)">
          ←
        </button>
        <button className="icon-btn" data-drawer-toggle onClick={() => togglePanel('toc')} aria-label="Índice" title="Índice">
          ☰
        </button>
        <div className="reader-title" title={title}>
          {title}
        </div>
        <TopbarActions
          onToggleSettings={() => togglePanel('settings')}
          fullscreen={fullscreen}
          onToggleFullscreen={toggleFullscreen}
        />
      </header>
      {search.open && <SearchBar search={search} focusToken={searchFocusToken} />}

      <div ref={stageRef} className="reader-stage">
        <div ref={hostRef} className="reader-host" />
        {settings.readingRuler && rulerShown && (
          <div
            ref={(el) => {
              rulerElRef.current = el
              placeRuler(el)
            }}
            className="reading-ruler"
            aria-hidden="true"
          />
        )}
        {popover && (
          <div
            className={`sel-popover ${popover.below ? 'below' : ''}`}
            style={{ left: popover.x, top: popover.y }}
            // Keep the text selected (and the keyboard focus where it is) while the button is clicked.
            onMouseDown={(e) => e.preventDefault()}
          >
            {!popover.lookup ? (
              <button className="sel-btn" onClick={() => void translateSelection()} title="Traduzir para português (T)">
                Traduzir “
                {popover.text.length > POPOVER_LABEL_CHARS ? `${popover.text.slice(0, POPOVER_LABEL_CHARS)}…` : popover.text}”
              </button>
            ) : (
              <div className="sel-card" role="status" aria-live="polite">
                <div className="sel-card-src">{popover.text}</div>
                {popover.lookup.state === 'loading' && <div className="sel-card-wait">Traduzindo…</div>}
                {popover.lookup.state === 'done' && popover.lookup.result.ok && (
                  <>
                    <div className="sel-card-tr">{popover.lookup.result.translation}</div>
                    {popover.lookup.result.alternatives.map((group, i) => (
                      <div className="sel-card-alt" key={i}>
                        {group.pos && <em>{group.pos}</em>} {group.terms.join(', ')}
                      </div>
                    ))}
                  </>
                )}
                {popover.lookup.state === 'done' && !popover.lookup.result.ok && (
                  <div className="sel-card-err">{LOOKUP_ERRORS[popover.lookup.result.reason]}</div>
                )}
                <button className="sel-card-link" onClick={() => void openInGoogle()} title="Abrir no Google Tradutor (T)">
                  Abrir no Google ↗
                </button>
              </div>
            )}
          </div>
        )}
        {status === 'loading' && <div className="overlay muted">Abrindo livro…</div>}
        {status === 'error' && (
          <div className="overlay">
            <p>Não foi possível abrir este livro.</p>
            {error && <p className="muted">{error}</p>}
            <button className="primary-btn" onClick={closeBook}>
              Voltar
            </button>
          </div>
        )}
      </div>

      <footer
        className={`progressbar${autoHide && !barsVisible ? ' bars-hidden' : ''}`}
        onMouseEnter={() => setPointerOnBars(true)}
        onMouseLeave={() => setPointerOnBars(false)}
        onFocusCapture={(e) => setFocusOnBars((e.target as HTMLElement).matches(':focus-visible'))}
        onBlurCapture={() => setFocusOnBars(false)}
      >
        <input
          type="range"
          min={0}
          max={1}
          step={0.001}
          value={percent}
          style={{ '--pct': `${percent * 100}%` } as React.CSSProperties}
          disabled={!locationsReady}
          onChange={(e) => seek(Number(e.target.value))}
          aria-label="Posição no livro"
          title={locationsReady ? 'Ir para uma posição do livro' : 'Calculando posições…'}
        />
        <span className="progress-label">{Math.round(percent * 100)}%</span>
      </footer>

      {panel === 'toc' && <TocPanel items={toc} onSelect={goTo} onClose={() => setPanel('none')} />}
      {panel === 'settings' && <SettingsPanel onClose={() => setPanel('none')} />}
    </div>
  )
}
