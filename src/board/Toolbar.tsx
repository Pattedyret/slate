import { PALETTE, TOOLS, FONT_SIZE_MIN, FONT_SIZE_MAX, type Tool } from './useTool' // (C) TOOLS hoisted
import type { DashStyle, FontFamilyKey } from '../lib/types' // (C)

// (C) Line-style + font-family option lists (label/value pairs for the toolbar controls).
const DASH_OPTIONS: { value: DashStyle; label: string }[] = [
  { value: 'solid', label: '──' },
  { value: 'dashed', label: '- -' },
  { value: 'dotted', label: '···' },
]
const FONT_OPTIONS: { value: FontFamilyKey; label: string }[] = [
  { value: 'sans', label: 'Sans' },
  { value: 'serif', label: 'Serif' },
  { value: 'mono', label: 'Mono' },
  { value: 'marker', label: 'Marker' },
]

interface Props {
  tool: Tool; setTool: (t: Tool) => void
  color: string; setColor: (c: string) => void
  size: number; setSize: (n: number) => void
  // (C) style/text state + setters (dual-bound by BoardView: also live-edit the selection)
  dash: DashStyle; setDash: (d: DashStyle) => void
  fontFamily: FontFamilyKey; setFontFamily: (f: FontFamilyKey) => void
  fontSize: number; setFontSize: (n: number) => void
  // (C) context flags — which contextual controls to show, and whether a delete is possible
  showLineStyle: boolean; showFontControls: boolean; hasSelection: boolean
  onDelete: () => void
  showGrid: boolean; toggleGrid: () => void
  onUndo: () => void; onRedo: () => void; onClear: () => void
  // Fullscreen toggle reflects state; hidden where the API is unavailable (iOS).
  isFs: boolean; onToggleFullscreen: () => void; fullscreenSupported: boolean
  // Collapse the top menu (tab bar + toolbar).
  onCollapseMenu: () => void
}

export function Toolbar(p: Props) {
  return (
    <div className="toolbar">
      {TOOLS.map(t => (
        <button key={t} className={p.tool === t ? 'active' : ''} onClick={() => p.setTool(t)}>{t}</button>
      ))}
      <span className="sep" />
      {PALETTE.map(c => (
        <button key={c} className={'swatch' + (p.color === c ? ' active' : '')}
          style={{ background: c }} onClick={() => p.setColor(c)} aria-label={`color ${c}`} />
      ))}
      <input type="range" min={1} max={24} value={p.size} onChange={e => p.setSize(+e.target.value)} aria-label="stroke width" />

      {/* (C) Line-style toggle — shown for dashable tools or a selected dashable object. */}
      {p.showLineStyle && (
        <>
          <span className="sep" />
          {DASH_OPTIONS.map(o => (
            <button
              key={o.value}
              className={'dash-opt' + (p.dash === o.value ? ' active' : '')}
              onClick={() => p.setDash(o.value)}
              aria-label={`line style ${o.value}`}
              title={`${o.value} line`}
            >{o.label}</button>
          ))}
        </>
      )}

      {/* (C) Font family + size — shown for the text tool or a selected text object. */}
      {p.showFontControls && (
        <>
          <span className="sep" />
          <select
            className="font-select"
            value={p.fontFamily}
            onChange={e => p.setFontFamily(e.target.value as FontFamilyKey)}
            aria-label="font family"
          >
            {FONT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <input
            type="number"
            className="font-size"
            min={FONT_SIZE_MIN}
            max={FONT_SIZE_MAX}
            value={p.fontSize}
            onChange={e => p.setFontSize(+e.target.value)}
            aria-label="font size"
          />
        </>
      )}

      <span className="sep" />
      <button onClick={p.onDelete} disabled={!p.hasSelection} aria-label="Delete selected" title="Delete selected">🗑</button>
      <button onClick={p.onUndo}>undo</button>
      <button onClick={p.onRedo}>redo</button>
      <button onClick={p.onClear}>clear</button>
      <button className={p.showGrid ? 'active' : ''} onClick={p.toggleGrid}>grid</button>
      {p.fullscreenSupported && (
        <button
          className={p.isFs ? 'active' : ''}
          onClick={p.onToggleFullscreen}
          aria-label={p.isFs ? 'Exit fullscreen' : 'Enter fullscreen'}
          title={p.isFs ? 'Exit fullscreen' : 'Enter fullscreen'}
        >
          {p.isFs ? '⤡' : '⤢'}
        </button>
      )}
      <button onClick={p.onCollapseMenu} aria-label="Hide menu" title="Hide menu">⌃</button>
    </div>
  )
}
