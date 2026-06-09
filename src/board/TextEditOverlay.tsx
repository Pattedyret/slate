import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { FontFamilyKey } from '../lib/types'
import { fontStack } from '../lib/style'
import { worldToScreen } from './viewport-math'
import type { Viewport } from './useViewport'

// (C) In-place HTML text editor (replaces the old window.prompt). Rendered inside
// `.canvas-wrap` (position:relative) so `worldToScreen` output maps directly to the
// textarea's left/top with no extra bounding-rect math. Multiline; styled to match the
// target Konva <Text> so editing is WYSIWYG.
export interface TextEditState {
  /** Object id when re-editing an existing text; null when creating a new one. */
  id: string | null
  /** World-space anchor (matches the Konva Text x/y / the click point). */
  x: number
  y: number
  text: string
  color: string
  fontSize: number
  fontFamily: FontFamilyKey
}

interface Props {
  state: TextEditState
  viewport: Viewport
  /** Commit the (possibly edited) text. Empty/whitespace ⇒ caller deletes / creates nothing. */
  onCommit(text: string): void
  /** Esc / cancel — discard without writing. */
  onCancel(): void
}

export function TextEditOverlay({ state, viewport, onCommit, onCancel }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const [value, setValue] = useState(state.text)
  // Guard against double-commit (blur fires when Ctrl+Enter / Esc moves focus away).
  const done = useRef(false)

  // Re-seed when the target object changes (open editor for a different text).
  useEffect(() => { setValue(state.text); done.current = false }, [state.id, state.x, state.y, state.text])

  // Focus + select on open so typing replaces an existing label immediately.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    el.select()
  }, [state.id, state.x, state.y])

  const commit = () => { if (done.current) return; done.current = true; onCommit(value) }
  const cancel = () => { if (done.current) return; done.current = true; onCancel() }

  const { x: left, y: top } = worldToScreen(state.x, state.y, viewport)
  // Match the on-canvas size: Konva fontSize is world units, scaled by the viewport.
  const screenFontSize = Math.max(8, state.fontSize * viewport.scale)

  return (
    <textarea
      ref={ref}
      className="text-edit-overlay"
      value={value}
      onChange={e => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        // Esc cancels; Ctrl/Cmd+Enter commits; plain Enter inserts a newline (textarea).
        if (e.key === 'Escape') { e.preventDefault(); cancel() }
        else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commit() }
        // Stop the global Delete/Backspace shape-delete handler from also firing.
        e.stopPropagation()
      }}
      style={{
        left,
        top,
        color: state.color,
        fontSize: `${screenFontSize}px`,
        fontFamily: fontStack(state.fontFamily),
        lineHeight: 1, // Konva <Text> default line-height ≈ 1; keep the overlay aligned
      }}
      spellCheck={false}
      autoComplete="off"
    />
  )
}
