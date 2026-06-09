import { useCallback, useRef, useState } from 'react'
import { clampScale, zoomKeepingPoint } from './viewport-math'

// Re-export the zoom limits so consumers can import them from useViewport (Contract C1).
export { MIN_SCALE, MAX_SCALE } from './viewport-math'

/** Fixed step for the on-screen +/- zoom buttons. */
export const ZOOM_STEP = 1.2

/** Contract C1 — the ephemeral, per-device viewport state. Never synced, never persisted. */
export interface Viewport {
  scale: number
  panX: number
  panY: number
}

/** Contract C1 — the viewport action surface consumed by Canvas (and C/D). */
export interface ViewportApi extends Viewport {
  /** Zoom keeping the screen point (screenX, screenY) fixed. `factor` multiplies scale. */
  zoomAt(screenX: number, screenY: number, factor: number): void
  /** Additive pan by a screen-space delta. */
  panBy(dxScreen: number, dyScreen: number): void
  /** Zoom in by ZOOM_STEP, anchored on the viewport centre. */
  zoomIn(): void
  /** Zoom out by ZOOM_STEP, anchored on the viewport centre. */
  zoomOut(): void
  /** Restore scale=1, panX=0, panY=0. */
  reset(): void
}

/**
 * B-internal extension of ViewportApi: the hook also needs to know the current
 * viewport size so the +/- buttons and reset can anchor on the viewport centre.
 * Canvas consumes the frozen `ViewportApi`; BoardView (B) uses `setSize`.
 */
export interface ViewportHook extends ViewportApi {
  setSize(width: number, height: number): void
}

const INITIAL: Viewport = { scale: 1, panX: 0, panY: 0 }

export function useViewport(): ViewportHook {
  const [vp, setVp] = useState<Viewport>(INITIAL)
  // Current viewport size, used to anchor zoomIn/zoomOut on the centre.
  const sizeRef = useRef({ w: 0, h: 0 })

  const setSize = useCallback((width: number, height: number) => {
    sizeRef.current = { w: width, h: height }
  }, [])

  const zoomAt = useCallback((screenX: number, screenY: number, factor: number) => {
    setVp(prev => zoomKeepingPoint(prev, screenX, screenY, factor))
  }, [])

  const panBy = useCallback((dxScreen: number, dyScreen: number) => {
    setVp(prev => ({ ...prev, panX: prev.panX + dxScreen, panY: prev.panY + dyScreen }))
  }, [])

  const zoomAtCentre = useCallback((factor: number) => {
    setVp(prev => {
      const { w, h } = sizeRef.current
      return zoomKeepingPoint(prev, w / 2, h / 2, factor)
    })
  }, [])

  const zoomIn = useCallback(() => zoomAtCentre(ZOOM_STEP), [zoomAtCentre])
  const zoomOut = useCallback(() => zoomAtCentre(1 / ZOOM_STEP), [zoomAtCentre])
  const reset = useCallback(() => setVp(INITIAL), [])

  return {
    scale: vp.scale,
    panX: vp.panX,
    panY: vp.panY,
    zoomAt,
    panBy,
    zoomIn,
    zoomOut,
    reset,
    setSize,
  }
}

// clampScale is re-exported for completeness (used by gesture math / tests if needed).
export { clampScale }
