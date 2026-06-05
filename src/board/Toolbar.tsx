import { PALETTE, type Tool } from './useTool'

const TOOLS: Tool[] = ['pen','eraser','line','rect','ellipse','arrow','text','select']

interface Props {
  tool: Tool; setTool: (t: Tool) => void
  color: string; setColor: (c: string) => void
  size: number; setSize: (n: number) => void
  showGrid: boolean; toggleGrid: () => void
  onUndo: () => void; onRedo: () => void; onClear: () => void; onFullscreen: () => void
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
      <input type="range" min={1} max={24} value={p.size} onChange={e => p.setSize(+e.target.value)} />
      <span className="sep" />
      <button onClick={p.onUndo}>undo</button>
      <button onClick={p.onRedo}>redo</button>
      <button onClick={p.onClear}>clear</button>
      <button className={p.showGrid ? 'active' : ''} onClick={p.toggleGrid}>grid</button>
      <button onClick={p.onFullscreen}>⤢</button>
    </div>
  )
}
