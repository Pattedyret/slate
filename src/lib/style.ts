// (C) Render-time style helpers shared by Canvas (Konva nodes) and the text-edit overlay
// (HTML). Keeping the enum→render mapping in one place keeps storage compact (enums) and
// the rendering consistent across the canvas bitmap and the DOM textarea.
import type { DashStyle, FontFamilyKey } from './types'

// FontFamilyKey → CSS font stack (Contract C4 / spec §4.6). `marker` + `mono` are
// self-hosted woff2 (see styles.css @font-face); all stacks fall back to system families.
export const FONT_STACKS: Record<FontFamilyKey, string> = {
  sans: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: '"JetBrains Mono", ui-monospace, "SFMono-Regular", monospace',
  marker: '"Permanent Marker", "Comic Sans MS", cursive',
}

export const DEFAULT_FONT: FontFamilyKey = 'sans'
export const DEFAULT_DASH: DashStyle = 'solid'

/** Resolve a (possibly absent/legacy) fontFamily key to its CSS stack. */
export function fontStack(key: FontFamilyKey | undefined): string {
  return FONT_STACKS[key ?? DEFAULT_FONT]
}

/**
 * Map a dash enum → Konva `dash` array, scaled by stroke width so the pattern stays
 * readable from 1px hairlines to 24px strokes (spec §6.2). `'solid'` (and absent/legacy)
 * returns `undefined` so the prop is omitted — passing `[]` can render oddly in Konva.
 *   dashed → [3*size, 2*size]
 *   dotted → [0.1*size, 2.5*size]  (near-zero on-segment + round caps ⇒ circular dots)
 */
export function dashArray(style: DashStyle | undefined, size: number): number[] | undefined {
  switch (style) {
    case 'dashed': return [3 * size, 2 * size]
    case 'dotted': return [0.1 * size, 2.5 * size]
    default: return undefined // 'solid' or legacy/absent
  }
}
