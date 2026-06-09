import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createLongPress, LONGPRESS_MS, type LongPressPoint } from '../src/board/useLongPress'

// Package D (D1) — unit tests for the long-press state machine.
// The detector is timing + movement based, so we drive it under fake timers and assert
// exactly when it fires, when it stays silent, and what point it reports.

describe('createLongPress', () => {
  let fired: LongPressPoint[]
  const make = (overrides: Partial<Parameters<typeof createLongPress>[0]> = {}) =>
    createLongPress({ onLongPress: (p) => fired.push(p), ...overrides })

  beforeEach(() => {
    vi.useFakeTimers()
    fired = []
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('fires after the default delay (500ms) when the pointer stays still and down', () => {
    const lp = make()
    lp.onDown(100, 100, 'pen', 1)
    vi.advanceTimersByTime(LONGPRESS_MS - 1)
    expect(fired).toHaveLength(0) // not yet
    vi.advanceTimersByTime(1)
    expect(fired).toHaveLength(1)
    expect(fired[0]).toEqual({ x: 100, y: 100, pointerType: 'pen' })
  })

  it('reports the press-start screen point and pointer type', () => {
    const lp = make()
    lp.onDown(42, 7, 'touch', 1)
    vi.advanceTimersByTime(LONGPRESS_MS)
    expect(fired).toEqual([{ x: 42, y: 7, pointerType: 'touch' }])
  })

  it('does NOT fire if the pointer is released before the delay', () => {
    const lp = make()
    lp.onDown(0, 0, 'mouse', 1)
    vi.advanceTimersByTime(300)
    lp.onUp()
    vi.advanceTimersByTime(500)
    expect(fired).toHaveLength(0)
  })

  it('does NOT fire if movement exceeds the tolerance (default 8px) before the delay', () => {
    const lp = make()
    lp.onDown(0, 0, 'pen', 1)
    expect(lp.onMove(5, 5)).toBe(true) // hypot ≈ 7.07 < 8 → still a candidate
    expect(lp.onMove(7, 7)).toBe(false) // hypot ≈ 9.9 > 8 → cancelled
    vi.advanceTimersByTime(LONGPRESS_MS)
    expect(fired).toHaveLength(0)
  })

  it('STILL fires when the pointer jitters within tolerance the whole time', () => {
    const lp = make()
    lp.onDown(50, 50, 'pen', 1)
    // Sub-tolerance jitter (each within 8px of the start) must not cancel.
    expect(lp.onMove(52, 51)).toBe(true)
    expect(lp.onMove(49, 53)).toBe(true)
    expect(lp.onMove(54, 50)).toBe(true)
    vi.advanceTimersByTime(LONGPRESS_MS)
    expect(fired).toHaveLength(1)
    // The reported point is the ORIGINAL press start, not the latest jitter position.
    expect(fired[0]).toMatchObject({ x: 50, y: 50 })
  })

  it('measures tolerance from the press start, not cumulatively across small moves', () => {
    const lp = make()
    lp.onDown(0, 0, 'pen', 1)
    // Three +3px steps: cumulative 9px, but each is within 8px of the START (0,0).
    expect(lp.onMove(3, 0)).toBe(true)
    expect(lp.onMove(6, 0)).toBe(true) // 6 < 8 → still ok
    expect(lp.onMove(9, 0)).toBe(false) // 9 > 8 → cancel (distance from start)
    vi.advanceTimersByTime(LONGPRESS_MS)
    expect(fired).toHaveLength(0)
  })

  it('does NOT arm when a second pointer is already down (activePointers > 1)', () => {
    const lp = make()
    lp.onDown(10, 10, 'touch', 2) // gesture, not a single stationary pointer
    vi.advanceTimersByTime(LONGPRESS_MS)
    expect(fired).toHaveLength(0)
  })

  it('cancel() stops a pending long-press (e.g. a 2nd pointer / pointercancel)', () => {
    const lp = make()
    lp.onDown(20, 20, 'pen', 1)
    vi.advanceTimersByTime(200)
    lp.cancel()
    vi.advanceTimersByTime(500)
    expect(fired).toHaveLength(0)
  })

  it('onMove after cancellation returns false and does not re-arm', () => {
    const lp = make()
    lp.onDown(0, 0, 'pen', 1)
    lp.cancel()
    expect(lp.onMove(0, 0)).toBe(false)
    vi.advanceTimersByTime(LONGPRESS_MS)
    expect(fired).toHaveLength(0)
  })

  it('re-arms cleanly on a fresh down after a previous press fired', () => {
    const lp = make()
    lp.onDown(1, 1, 'pen', 1)
    vi.advanceTimersByTime(LONGPRESS_MS)
    expect(fired).toHaveLength(1)
    // New gesture.
    lp.onDown(2, 2, 'pen', 1)
    vi.advanceTimersByTime(LONGPRESS_MS)
    expect(fired).toHaveLength(2)
    expect(fired[1]).toMatchObject({ x: 2, y: 2 })
  })

  it('a fresh down cancels any still-pending previous timer (only the latest arms)', () => {
    const lp = make()
    lp.onDown(0, 0, 'pen', 1)
    vi.advanceTimersByTime(300)
    lp.onDown(99, 99, 'pen', 1) // re-press before the first fired
    vi.advanceTimersByTime(300) // total 600 from first down, 300 from second
    expect(fired).toHaveLength(0) // first was superseded, second not yet at 500
    vi.advanceTimersByTime(200) // second reaches 500
    expect(fired).toHaveLength(1)
    expect(fired[0]).toMatchObject({ x: 99, y: 99 })
  })

  it('honors custom delayMs and moveTolPx', () => {
    const lp = make({ delayMs: 1000, moveTolPx: 20 })
    lp.onDown(0, 0, 'pen', 1)
    expect(lp.onMove(15, 0)).toBe(true) // within custom 20px tolerance
    vi.advanceTimersByTime(999)
    expect(fired).toHaveLength(0)
    vi.advanceTimersByTime(1)
    expect(fired).toHaveLength(1)
  })
})
