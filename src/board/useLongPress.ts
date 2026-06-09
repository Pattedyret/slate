import { useEffect, useMemo, useRef } from 'react'

// Package D — long-press detection for the radial quick menu.
//
// A long-press arms on a SINGLE stationary primary pointer and fires after
// `delayMs` if the pointer has not moved beyond `moveTolPx` and has not been
// released. It is cancelled by: movement beyond tolerance, release, a second
// pointer (BoardView routes Canvas's onDrawCancel → cancel()), or pointercancel.
//
// Coordinates are SCREEN px (relative to the canvas container). BoardView converts
// world → screen via worldToScreen before calling onDown/onMove, so the point this
// hook reports back is already in the space the absolutely-positioned overlay needs.

export const LONGPRESS_MS = 500

export interface LongPressPoint {
  x: number
  y: number
  pointerType: string
}

export interface LongPressOptions {
  delayMs?: number
  moveTolPx?: number
  onLongPress: (p: LongPressPoint) => void
}

export interface LongPressController {
  /** A primary pointer went down at screen (x, y). `activePointers` from SlatePointerInfo. */
  onDown: (x: number, y: number, pointerType: string, activePointers: number) => void
  /** The pointer moved to screen (x, y). Returns true while still a long-press candidate. */
  onMove: (x: number, y: number) => boolean
  /** The pointer was released. */
  onUp: () => void
  /** Hard cancel (2nd pointer, pointercancel, route change, blur, etc.). */
  cancel: () => void
}

/**
 * Plain (non-React) factory holding the timer + tolerance state machine. Kept free of
 * React state so it can be unit-tested directly under fake timers (no render needed) —
 * the menu open/close state lives in BoardView, never here.
 */
export function createLongPress(opts: LongPressOptions): LongPressController {
  const delayMs = opts.delayMs ?? LONGPRESS_MS
  const moveTolPx = opts.moveTolPx ?? 8

  let timer: ReturnType<typeof setTimeout> | null = null
  let startX = 0
  let startY = 0
  let pointerType = 'mouse'
  let armed = false

  const clear = () => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    armed = false
  }

  const onDown = (x: number, y: number, type: string, activePointers: number) => {
    clear()
    // Only a single primary pointer may arm the menu — a 2nd pointer is a pan/zoom gesture.
    if (activePointers > 1) return
    startX = x
    startY = y
    pointerType = type
    armed = true
    timer = setTimeout(() => {
      timer = null
      if (!armed) return
      armed = false
      opts.onLongPress({ x: startX, y: startY, pointerType })
    }, delayMs)
  }

  const onMove = (x: number, y: number): boolean => {
    if (!armed) return false
    if (Math.hypot(x - startX, y - startY) > moveTolPx) {
      clear()
      return false
    }
    return true
  }

  const onUp = () => clear()

  const cancel = () => clear()

  return { onDown, onMove, onUp, cancel }
}

/**
 * Thin React wrapper: a stable controller whose `onLongPress` always calls the latest
 * callback (via a ref), so BoardView can close over fresh state without re-creating it.
 */
export function useLongPress(opts: LongPressOptions): LongPressController {
  const cbRef = useRef(opts.onLongPress)
  cbRef.current = opts.onLongPress

  const controller = useMemo(
    () =>
      createLongPress({
        delayMs: opts.delayMs,
        moveTolPx: opts.moveTolPx,
        onLongPress: (p) => cbRef.current(p),
      }),
    // Stable for the component's lifetime; the latest callback is read through cbRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  // Defensive: cancel any pending timer if the component unmounts mid-press.
  useEffect(() => () => controller.cancel(), [controller])

  return controller
}
