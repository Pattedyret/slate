import { useState } from 'react'
import type { DashStyle, FontFamilyKey } from '../lib/types'

export type Tool = 'pen' | 'eraser' | 'line' | 'rect' | 'ellipse' | 'arrow' | 'text' | 'select'
export const PALETTE = ['#eaeefb', '#ffd34e', '#ff6f6f', '#5ad19a', '#8aa0ff', '#ffb86b']

// (C) Hoisted from Toolbar (Contract C5) — D's radial menu also needs the canonical tool list.
export const TOOLS: Tool[] = ['pen', 'eraser', 'line', 'rect', 'ellipse', 'arrow', 'text', 'select']

// (C) Font-size bounds — separate from `size` (stroke width, 1–24). Conflating them is a trap.
export const FONT_SIZE_MIN = 12
export const FONT_SIZE_MAX = 96
// Exported so the dual-binding path in BoardView clamps the value it patches onto the
// selected object too (an empty/out-of-range number input must not write fontSize 0/NaN).
export const clampFontSize = (n: number) =>
  Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(Number.isFinite(n) ? n : FONT_SIZE_MIN)))

export function useTool() {
  const [tool, setTool] = useState<Tool>('pen')
  const [color, setColor] = useState(PALETTE[0])
  const [size, setSize] = useState(4)
  // (C) C5 additions — dashed-line style + text font family/size, all distinct from `size`.
  const [dash, setDash] = useState<DashStyle>('solid')
  const [fontFamily, setFontFamily] = useState<FontFamilyKey>('sans')
  const [fontSize, setFontSizeRaw] = useState(20)
  const setFontSize = (n: number) => setFontSizeRaw(clampFontSize(n))
  return {
    tool, setTool, color, setColor, size, setSize,
    dash, setDash, fontFamily, setFontFamily, fontSize, setFontSize,
  }
}
