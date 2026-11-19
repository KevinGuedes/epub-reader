import { useCallback, useEffect, useState } from 'react'

export function useFullscreen(): { fullscreen: boolean; toggleFullscreen: () => void } {
  const [fullscreen, setFullscreen] = useState(false)
  useEffect(() => {
    const onChange = (): void => setFullscreen(document.fullscreenElement !== null)
    document.addEventListener('fullscreenchange', onChange)
    onChange()
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])
  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void document.documentElement.requestFullscreen().catch(() => {})
  }, [])
  return { fullscreen, toggleFullscreen }
}
