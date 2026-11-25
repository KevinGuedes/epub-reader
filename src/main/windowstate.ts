import { readFileSync, renameSync, writeFileSync } from 'node:fs'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface WindowState {
  /** Size/position of the window when not maximized. x/y are absent when never moved by a reliable source. */
  bounds: Rect
  maximized: boolean
}

export const DEFAULT_SIZE = { width: 1100, height: 820 }
export const MIN_SIZE = { width: 640, height: 480 }
const MAX_DIMENSION = 20000
// Part of the window that must overlap a screen so the title bar can still be grabbed.
const MIN_VISIBLE = { width: 120, height: 60 }

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** Validates whatever was read from disk; anything unexpected means "no saved state". */
export function parseWindowState(raw: unknown): WindowState | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const b = r.bounds as Record<string, unknown> | undefined
  if (!b || !finite(b.x) || !finite(b.y) || !finite(b.width) || !finite(b.height)) return null
  if (b.width < MIN_SIZE.width || b.height < MIN_SIZE.height) return null
  if (b.width > MAX_DIMENSION || b.height > MAX_DIMENSION) return null
  if (Math.abs(b.x) > MAX_DIMENSION || Math.abs(b.y) > MAX_DIMENSION) return null
  return {
    bounds: { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) },
    maximized: r.maximized === true
  }
}

function overlap(a: Rect, b: Rect): { width: number; height: number } {
  return {
    width: Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
    height: Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  }
}

/**
 * Bounds to open the window with. The saved position is only used while it is still on some screen (monitors come
 * and go); otherwise the saved size is kept (shrunk to fit the primary screen) and the OS centers the window.
 */
export function resolveBounds(saved: WindowState | null, workAreas: Rect[]): Partial<Rect> & { width: number; height: number } {
  if (!saved) return { ...DEFAULT_SIZE }
  const { bounds } = saved
  const visible = workAreas.some((area) => {
    const o = overlap(bounds, area)
    return o.width >= MIN_VISIBLE.width && o.height >= MIN_VISIBLE.height
  })
  if (visible) return { ...bounds }
  const primary = workAreas[0]
  return {
    width: primary ? Math.min(bounds.width, primary.width) : bounds.width,
    height: primary ? Math.min(bounds.height, primary.height) : bounds.height
  }
}

export function loadWindowState(file: string): WindowState | null {
  try {
    return parseWindowState(JSON.parse(readFileSync(file, 'utf8')))
  } catch {
    return null
  }
}

export function saveWindowState(file: string, state: WindowState): void {
  try {
    const tmp = `${file}.tmp`
    writeFileSync(tmp, JSON.stringify(state))
    renameSync(tmp, file)
  } catch {
    /* best effort: failing to remember the window must never break the app */
  }
}
