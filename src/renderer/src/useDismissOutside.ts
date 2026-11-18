import { useEffect } from 'react'

/** Elements that count as "inside" a drawer: the drawer itself and the buttons that toggle it. */
const INSIDE_SELECTOR = '.drawer, [data-drawer-toggle]'

/**
 * While `active`, calls `onDismiss` when the user presses the mouse anywhere outside a drawer.
 * Capture phase, so it still fires when a handler deeper in the tree stops propagation.
 * Clicks inside the book (an iframe, invisible to this document) must be wired up separately by the caller.
 */
export function useDismissOutside(active: boolean, onDismiss: () => void): void {
  useEffect(() => {
    if (!active) return
    const listener = (event: MouseEvent): void => {
      const target = event.target as Element | null
      if (target?.closest?.(INSIDE_SELECTOR)) return
      onDismiss()
    }
    document.addEventListener('mousedown', listener, true)
    return () => document.removeEventListener('mousedown', listener, true)
  }, [active, onDismiss])
}
