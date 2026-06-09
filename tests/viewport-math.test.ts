import { describe, it, expect } from 'vitest'
import { worldToScreen, zoomKeepingPoint, MIN_SCALE, MAX_SCALE } from '../src/board/viewport-math'
import type { Viewport } from '../src/board/useViewport'

describe('worldToScreen', () => {
  it('maps world to screen using pan + scale', () => {
    // screenX = panX + scale * worldX, screenY = panY + scale * worldY
    expect(worldToScreen(10, 10, { scale: 2, panX: 5, panY: 5 })).toEqual({ x: 25, y: 25 })
  })

  it('is the identity at scale 1 / pan 0', () => {
    expect(worldToScreen(42, -7, { scale: 1, panX: 0, panY: 0 })).toEqual({ x: 42, y: -7 })
  })

  it('handles negative pan', () => {
    expect(worldToScreen(100, 50, { scale: 2, panX: -100, panY: -50 })).toEqual({ x: 100, y: 50 })
  })
})

describe('zoomKeepingPoint', () => {
  const vp: Viewport = { scale: 1, panX: 0, panY: 0 }

  it('keeps the anchor screen point fixed after zooming in', () => {
    const sx = 200, sy = 150
    const next = zoomKeepingPoint(vp, sx, sy, 2) // zoom in ×2
    expect(next.scale).toBe(2)
    // The world point that was under (sx,sy) must still be under (sx,sy):
    const worldBeforeX = (sx - vp.panX) / vp.scale
    const worldBeforeY = (sy - vp.panY) / vp.scale
    const screenAfterX = next.panX + next.scale * worldBeforeX
    const screenAfterY = next.panY + next.scale * worldBeforeY
    expect(screenAfterX).toBeCloseTo(sx, 6)
    expect(screenAfterY).toBeCloseTo(sy, 6)
  })

  it('keeps the anchor screen point fixed after zooming out from a panned/zoomed state', () => {
    const start: Viewport = { scale: 2, panX: -100, panY: -50 }
    const sx = 320, sy = 240
    const next = zoomKeepingPoint(start, sx, sy, 0.5) // zoom out ×0.5
    expect(next.scale).toBeCloseTo(1, 6)
    const worldBeforeX = (sx - start.panX) / start.scale
    const worldBeforeY = (sy - start.panY) / start.scale
    const screenAfterX = next.panX + next.scale * worldBeforeX
    const screenAfterY = next.panY + next.scale * worldBeforeY
    expect(screenAfterX).toBeCloseTo(sx, 6)
    expect(screenAfterY).toBeCloseTo(sy, 6)
  })

  it('clamps scale to MAX_SCALE and does not move the anchor past the cap', () => {
    const start: Viewport = { scale: MAX_SCALE, panX: 10, panY: 20 }
    const next = zoomKeepingPoint(start, 100, 100, 4) // would exceed MAX_SCALE
    expect(next.scale).toBe(MAX_SCALE)
    // No-op zoom keeps pan unchanged
    expect(next.panX).toBe(start.panX)
    expect(next.panY).toBe(start.panY)
  })

  it('clamps scale to MIN_SCALE', () => {
    const start: Viewport = { scale: MIN_SCALE, panX: 0, panY: 0 }
    const next = zoomKeepingPoint(start, 50, 50, 0.1) // would go below MIN_SCALE
    expect(next.scale).toBe(MIN_SCALE)
    expect(next.panX).toBe(start.panX)
    expect(next.panY).toBe(start.panY)
  })

  it('exposes the documented limits', () => {
    expect(MIN_SCALE).toBe(0.1)
    expect(MAX_SCALE).toBe(8)
  })
})
