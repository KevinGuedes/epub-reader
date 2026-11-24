export interface LineBox {
  top: number
  bottom: number
}

const MIN_LINE_PX = 2

/**
 * Visual text lines of a document that intersect [minY, maxY] (document viewport coordinates), top to bottom.
 * Rects of all text nodes are merged by vertical overlap, so inline markup (links, <em>, ...) on the same
 * line yields a single line, while headings, big initials or tables keep their own real heights.
 */
export function collectLines(doc: Document, minY: number, maxY: number): LineBox[] {
  const body = doc.body
  if (!body) return []
  const rects: LineBox[] = []
  const walker = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT
      const parent = node.parentElement
      if (!parent || parent.closest('.reader-nav')) return NodeFilter.FILTER_REJECT // app chrome, not book text
      // Cheap pre-filter: skip whole nodes that are entirely outside the wanted band.
      const box = parent.getBoundingClientRect()
      return box.bottom < minY || box.top > maxY ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
    }
  })
  const range = doc.createRange()
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    range.selectNodeContents(node)
    for (const r of Array.from(range.getClientRects())) {
      if (r.width > 0 && r.height >= MIN_LINE_PX && r.bottom >= minY && r.top <= maxY) {
        rects.push({ top: r.top, bottom: r.bottom })
      }
    }
  }
  rects.sort((a, b) => a.top - b.top || a.bottom - b.bottom)

  const lines: LineBox[] = []
  for (const r of rects) {
    const last = lines[lines.length - 1]
    if (last) {
      const overlap = Math.min(last.bottom, r.bottom) - Math.max(last.top, r.top)
      if (overlap > 0.5 * Math.min(last.bottom - last.top, r.bottom - r.top)) {
        last.top = Math.min(last.top, r.top)
        last.bottom = Math.max(last.bottom, r.bottom)
        continue
      }
    }
    lines.push({ ...r })
  }
  return lines
}
