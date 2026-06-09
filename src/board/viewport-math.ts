import type { Viewport } from './useViewport'

// Zoom limits (Contract C1). Defined here (the pure-math layer) and re-exported from
// useViewport.ts so consumers (C/D) can import them from either module.
export const MIN_SCALE = 0.1
export const MAX_SCALE = 8

/** Clamp a scale value to the allowed zoom range. */
export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))
}

/**
 * Contract C2 — world → screen.
 * For HTML/SVG overlays positioned over the canvas wrapper.
 *   screenX = panX + scale * worldX
 *   screenY = panY + scale * worldY
 */
export function worldToScreen(wx: number, wy: number, vp: Viewport): { x: number; y: number } {
  return { x: vp.panX + vp.scale * wx, y: vp.panY + vp.scale * wy }
}

/**
 * Pure zoom-to-point helper. Multiplies the current scale by `factor`, clamps the
 * result to [MIN_SCALE, MAX_SCALE], and recomputes pan so the world point currently
 * under the screen pixel (screenX, screenY) stays under that same pixel.
 *
 * Section 3.3 (canonical zoom-to-cursor):
 *   worldX = (screenX - panX) / oldScale
 *   newScale = clamp(oldScale * factor)
 *   panX = screenX - worldX * newScale
 *
 * When the clamp makes newScale === oldScale the transform is unchanged (no "stick").
 */
export function zoomKeepingPoint(
  vp: Viewport,
  screenX: number,
  screenY: number,
  factor: number,
): Viewport {
  const newScale = clampScale(vp.scale * factor)
  if (newScale === vp.scale) return vp
  const worldX = (screenX - vp.panX) / vp.scale
  const worldY = (screenY - vp.panY) / vp.scale
  return {
    scale: newScale,
    panX: screenX - worldX * newScale,
    panY: screenY - worldY * newScale,
  }
}
