import { useEffect } from 'react'
import { Library } from './components/Library'
import { Reader } from './components/Reader'
import { useStore } from './store'
import { applyChromeTheme } from './themes'

export default function App(): React.JSX.Element | null {
  const ready = useStore((s) => s.ready)
  const settings = useStore((s) => s.settings)
  const view = useStore((s) => s.view)
  const init = useStore((s) => s.init)
  const openBook = useStore((s) => s.openBook)

  useEffect(() => {
    void init()
  }, [init])

  useEffect(() => {
    applyChromeTheme(settings)
  }, [settings])

  // "Open with" from the file manager: at launch and while the app is already running.
  useEffect(() => {
    if (!ready) return
    const take = (): void => {
      void window.api.takePendingOpen().then((id) => id !== null && openBook(id))
    }
    take()
    return window.api.onOpenRequested(take)
  }, [ready, openBook])

  if (!ready) return null
  return view.kind === 'reader' ? <Reader key={view.bookId} bookId={view.bookId} /> : <Library />
}
