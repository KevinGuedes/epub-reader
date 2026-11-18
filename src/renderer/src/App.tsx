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

  useEffect(() => {
    void init()
  }, [init])

  useEffect(() => {
    applyChromeTheme(settings)
  }, [settings])

  if (!ready) return null
  return view.kind === 'reader' ? <Reader key={view.bookId} bookId={view.bookId} /> : <Library />
}
