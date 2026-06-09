import { useEffect, useRef, useState } from 'react'

export interface ElementSize {
  width: number
  height: number
}

/**
 * Measures a wrapper element with a ResizeObserver and returns its content-box size.
 *
 * Attach the returned `ref` to a wrapper (`.canvas-wrap`) — NOT to the canvas itself:
 * observing the canvas feedback-loops, since the canvas size is derived from the
 * measurement. Initial size falls back to the window minus the two 44px bars so the
 * very first paint (before the observer fires) is reasonable.
 */
export function useElementSize<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T | null>(null)
  const [size, setSize] = useState<ElementSize>(() => ({
    width: typeof window !== 'undefined' ? window.innerWidth : 0,
    height: typeof window !== 'undefined' ? window.innerHeight - 88 : 0,
  }))

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const measure = () => {
      const rect = el.getBoundingClientRect()
      setSize(prev =>
        prev.width === rect.width && prev.height === rect.height
          ? prev
          : { width: rect.width, height: rect.height },
      )
    }

    measure() // initial measurement once the wrapper is mounted

    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return { ref, size }
}
