import { PALETTE, type Tool } from './useTool'

// Package D (D2) — the radial ("pie") quick menu. An HTML/SVG overlay rendered as a
// sibling of the Konva Stage (NOT inside the canvas tree): pure UI chrome, screen-space,
// never synced. Centered at the long-press point (clamped on-screen).
//
//   center hub  : current tool glyph; tap = cancel/dismiss
//   inner ring  : the 8 tools as 45° sectors (active highlighted)
//   outer arc   : the 6 PALETTE colors as ~51° segments + a size stepper in the gap
//
// Picking a TOOL dismisses immediately (the primary intent). Picking a color or size
// keeps the wheel open so the user can tweak both in one hold.

// Tool ordering is defined INTERNALLY here so the wheel stays decoupled from the
// Toolbar's own list and from any future `TOOLS` export (a sibling package may add one).
const WHEEL_TOOLS: Tool[] = ['pen', 'eraser', 'line', 'rect', 'ellipse', 'arrow', 'text', 'select']

// Short glyphs for the tool sectors (kept terse to fit the inner ring).
const TOOL_GLYPH: Record<Tool, string> = {
  pen: '✏',
  eraser: '⌫',
  line: '╱',
  rect: '▭',
  ellipse: '◯',
  arrow: '↗',
  text: 'T',
  select: '⤡',
}

// Geometry (screen px). The full wheel spans 2 * R_OUTER + a little label room.
const R_HUB = 30
const R_TOOL_INNER = 34
const R_TOOL_OUTER = 92
const R_COLOR_INNER = 96
const R_COLOR_OUTER = 134
const PAD = 16 // breathing room used for both the SVG box and the edge clamp
const SIZE_STEP = 2
const SIZE_MIN = 1
const SIZE_MAX = 24

const VIEW = R_COLOR_OUTER + PAD // half-extent of the square SVG, center at (VIEW, VIEW)
const BOX = VIEW * 2

export interface RadialMenuProps {
  /** Screen-space center (the long-press point, in canvas-container coords). */
  point: { x: number; y: number }
  tool: Tool
  color: string
  size: number
  onTool: (t: Tool) => void
  onColor: (c: string) => void
  onSize: (n: number) => void
  onClose: () => void
}

/** Point on a circle of radius r at angle a (radians), relative to the wheel center. */
function polar(cx: number, cy: number, r: number, a: number) {
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }
}

/**
 * SVG path for an annular sector (a ring "slice") from angle a0 to a1, between radii
 * rIn and rOut, centered at (cx, cy). Angles in radians, drawn clockwise.
 */
function annularSector(cx: number, cy: number, rIn: number, rOut: number, a0: number, a1: number) {
  const p0 = polar(cx, cy, rOut, a0)
  const p1 = polar(cx, cy, rOut, a1)
  const p2 = polar(cx, cy, rIn, a1)
  const p3 = polar(cx, cy, rIn, a0)
  const largeArc = a1 - a0 > Math.PI ? 1 : 0
  return [
    `M ${p0.x} ${p0.y}`,
    `A ${rOut} ${rOut} 0 ${largeArc} 1 ${p1.x} ${p1.y}`,
    `L ${p2.x} ${p2.y}`,
    `A ${rIn} ${rIn} 0 ${largeArc} 0 ${p3.x} ${p3.y}`,
    'Z',
  ].join(' ')
}

export function RadialMenu({ point, tool, color, size, onTool, onColor, onSize, onClose }: RadialMenuProps) {
  // Clamp the wheel center so the full ring stays on screen. Uses the canvas-wrap box
  // (the overlay's offset parent) to know the available area.
  const wrap = typeof document !== 'undefined' ? document.querySelector('.canvas-wrap') : null
  const bounds = wrap?.getBoundingClientRect()
  const maxX = bounds ? bounds.width - VIEW : Number.POSITIVE_INFINITY
  const maxY = bounds ? bounds.height - VIEW : Number.POSITIVE_INFINITY
  const cx = Math.max(VIEW, Math.min(point.x, maxX))
  const cy = Math.max(VIEW, Math.min(point.y, maxY))

  // SVG-local center.
  const c = VIEW

  // 8 tool sectors, starting at the top (−90°) so 'pen' sits at 12 o'clock.
  const toolStep = (2 * Math.PI) / WHEEL_TOOLS.length
  const startAngle = -Math.PI / 2 - toolStep / 2

  // 6 color segments around the full ring, also starting at the top.
  const colorStep = (2 * Math.PI) / PALETTE.length
  const colorStart = -Math.PI / 2 - colorStep / 2

  const clampSize = (n: number) => Math.max(SIZE_MIN, Math.min(SIZE_MAX, n))

  return (
    // Full-bleed dismiss layer: a tap anywhere outside the wheel closes it.
    <div className="radial-overlay" onPointerDown={onClose} role="presentation">
      <div
        className="radial-menu"
        style={{ left: cx - VIEW, top: cy - VIEW, width: BOX, height: BOX }}
        // Stop taps on the wheel itself from bubbling to the dismiss layer.
        onPointerDown={(e) => e.stopPropagation()}
        role="menu"
        aria-label="Quick tool menu"
      >
        <svg width={BOX} height={BOX} viewBox={`0 0 ${BOX} ${BOX}`}>
          {/* Outer ring — COLORS */}
          {PALETTE.map((col, i) => {
            const a0 = colorStart + i * colorStep
            const a1 = a0 + colorStep
            const active = col === color
            return (
              <path
                key={`color-${col}`}
                className={'radial-color' + (active ? ' active' : '')}
                d={annularSector(c, c, R_COLOR_INNER, R_COLOR_OUTER, a0, a1)}
                fill={col}
                onPointerDown={(e) => { e.stopPropagation(); onColor(col) }}
                role="menuitemradio"
                aria-checked={active}
                aria-label={`color ${col}`}
              />
            )
          })}

          {/* Inner ring — TOOLS */}
          {WHEEL_TOOLS.map((tl, i) => {
            const a0 = startAngle + i * toolStep
            const a1 = a0 + toolStep
            const mid = (a0 + a1) / 2
            const labelR = (R_TOOL_INNER + R_TOOL_OUTER) / 2
            const lp = polar(c, c, labelR, mid)
            const active = tl === tool
            return (
              <g
                key={`tool-${tl}`}
                className={'radial-tool' + (active ? ' active' : '')}
                onPointerDown={(e) => { e.stopPropagation(); onTool(tl) }}
                role="menuitem"
                aria-label={tl}
              >
                <path d={annularSector(c, c, R_TOOL_INNER, R_TOOL_OUTER, a0, a1)} />
                <text x={lp.x} y={lp.y} className="radial-glyph" dominantBaseline="central" textAnchor="middle">
                  {TOOL_GLYPH[tl]}
                </text>
              </g>
            )
          })}

          {/* Center hub — current tool; tap to dismiss */}
          <g
            className="radial-hub"
            onPointerDown={(e) => { e.stopPropagation(); onClose() }}
            role="menuitem"
            aria-label="Close menu"
          >
            <circle cx={c} cy={c} r={R_HUB} />
            <text x={c} y={c} className="radial-hub-glyph" dominantBaseline="central" textAnchor="middle">
              {TOOL_GLYPH[tool]}
            </text>
          </g>
        </svg>

        {/* Size stepper — overlaid at the bottom of the wheel */}
        <div className="radial-size" role="group" aria-label="Stroke size">
          <button
            type="button"
            className="radial-size-btn"
            aria-label="Decrease size"
            disabled={size <= SIZE_MIN}
            onPointerDown={(e) => { e.stopPropagation(); onSize(clampSize(size - SIZE_STEP)) }}
          >
            −
          </button>
          <span className="radial-size-val" aria-label={`size ${size}`}>{size}</span>
          <button
            type="button"
            className="radial-size-btn"
            aria-label="Increase size"
            disabled={size >= SIZE_MAX}
            onPointerDown={(e) => { e.stopPropagation(); onSize(clampSize(size + SIZE_STEP)) }}
          >
            +
          </button>
        </div>
      </div>
    </div>
  )
}
