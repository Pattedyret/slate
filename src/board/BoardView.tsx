import { useRef, useState, useEffect } from 'react'
import { Canvas } from './Canvas'
import { Toolbar } from './Toolbar'
import { TabBar } from './TabBar'
import { useTool } from './useTool'
import { useBoardObjects } from './useBoardObjects'
import { useBoards } from './useBoards'
import { useElementSize } from './useElementSize'
import { useAuth } from '../auth/AuthProvider'
import { newId, type BoardObject, type ObjectType } from '../lib/types'
import { type BoardChannel } from '../lib/realtime'

let lastSent = 0
function throttledSendPoints(ch: BoardChannel | null, o: BoardObject) {
  if (!ch) return
  const now = performance.now()
  if (now - lastSent > 33) { lastSent = now; ch.sendPoints(o.id, o.type, o.data) }
}

export function BoardView() {
  const { user, signOut } = useAuth()
  const { boards, activeId, setActiveId, addBoard, rename, remove } = useBoards(user!.id)
  const { objects, commit, update, remove: removeObj, clear, undo, redo, channel, liveDrafts } = useBoardObjects(activeId)
  const t = useTool()
  const [showGrid, setShowGrid] = useState(true)
  const { ref: wrapRef, size } = useElementSize<HTMLDivElement>()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const draft = useRef<BoardObject | null>(null)
  const origin = useRef<{ x: number; y: number } | null>(null)
  const erasing = useRef(false) // true only while the pointer is held down with the eraser
  const [, force] = useState(0)

  // Clear selection when switching away from select tool
  useEffect(() => {
    if (t.tool !== 'select') setSelectedId(null)
  }, [t.tool])

  const base = (type: ObjectType, data: BoardObject['data']): BoardObject => ({
    id: newId(), board_id: activeId!, owner_id: user!.id, type, data, updated_at: new Date().toISOString(), deleted: false,
  })

  const down = (x: number, y: number) => {
    if (!activeId) return
    if (t.tool === 'pen') draft.current = base('stroke', { points: [x, y], color: t.color, size: t.size })
    else if (t.tool === 'eraser') {
      erasing.current = true
      const hit = hitTest(x, y)
      if (hit) { removeObj(hit.id); channel.current?.sendDelete(hit.id) }
      return
    }
    else if (t.tool === 'text') {
      const text = window.prompt('Text:')
      if (text) {
        const o = base('text', { x, y, text, color: t.color, fontSize: 20 })
        commit(o)
        channel.current?.sendCommit(o)
      }
      return
    } else if (t.tool === 'select') { return }
    else { origin.current = { x, y }; draft.current = base(t.tool, shapeData(t.tool, x, y, x, y, t.color, t.size)) }
    force(n => n + 1)
  }
  const move = (x: number, y: number) => {
    if (t.tool === 'eraser') {
      if (!erasing.current) return // no hover-erase: only erase while the pointer is held down
      const hit = hitTest(x, y)
      if (hit) { removeObj(hit.id); channel.current?.sendDelete(hit.id) }
      return
    }
    const d = draft.current; if (!d) return
    if (d.type === 'stroke') { (d.data as { points: number[] }).points.push(x, y) }
    else if (origin.current) { d.data = shapeData(d.type, origin.current.x, origin.current.y, x, y, t.color, t.size) }
    throttledSendPoints(channel.current, d)
    force(n => n + 1)
  }
  const up = () => {
    erasing.current = false
    if (draft.current) {
      const d = draft.current
      commit(d)
      channel.current?.sendCommit(d)
      draft.current = null; origin.current = null; force(n => n + 1)
    }
    // v1: undo/redo not broadcast
  }

  const hitTest = (x: number, y: number) =>
    objects.filter(o => !o.deleted).reverse().find(o => near(o, x, y))

  const onTransform = (id: string, patch: Partial<BoardObject['data']>) => {
    const o = objects.find(x => x.id === id)
    if (!o) return
    const updated: BoardObject = { ...o, data: { ...o.data, ...patch } }
    update(updated)
    channel.current?.sendCommit(updated)
  }

  const onFullscreen = () => document.documentElement.requestFullscreen?.()

  const render = [...objects, ...Object.values(liveDrafts), ...(draft.current ? [draft.current] : [])]
  return (
    <div className="app">
      <TabBar boards={boards} activeId={activeId} onSelect={setActiveId}
        onAdd={addBoard} onRename={rename} onDelete={remove} onSignOut={signOut} />
      <Toolbar {...t} showGrid={showGrid} toggleGrid={() => setShowGrid(g => !g)}
        onUndo={undo} onRedo={redo}
        onClear={clear} onFullscreen={onFullscreen} />
      <div className="canvas-wrap" ref={wrapRef}>
        <Canvas width={size.width} height={size.height} objects={render} showGrid={showGrid}
          onPointerDown={down} onPointerMove={move} onPointerUp={up}
          selectable={t.tool === 'select'}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onTransform={onTransform}
        />
      </div>
    </div>
  )
}

// helpers — (ox,oy) is the fixed press origin; (cx,cy) is the current pointer.
function shapeData(type: string, ox: number, oy: number, cx: number, cy: number, color: string, size: number): BoardObject['data'] {
  if (type === 'line' || type === 'arrow') return { x1: ox, y1: oy, x2: cx, y2: cy, color, size }
  const x = Math.min(ox, cx), y = Math.min(oy, cy)
  return { x, y, w: Math.abs(cx - ox), h: Math.abs(cy - oy), color, size }
}

function near(o: BoardObject, x: number, y: number): boolean {
  const d = o.data as unknown as Record<string, unknown>
  if (o.type === 'stroke') {
    const pts = d['points'] as number[]
    for (let i = 0; i < pts.length; i += 2) if (Math.hypot((pts[i] as number) - x, (pts[i + 1] as number) - y) < 12) return true
    return false
  }
  if (o.type === 'text') return Math.abs((d['x'] as number) - x) < 60 && Math.abs((d['y'] as number) - y) < 24
  const bx = (d['x'] as number | undefined) ?? Math.min(d['x1'] as number, d['x2'] as number)
  const by = (d['y'] as number | undefined) ?? Math.min(d['y1'] as number, d['y2'] as number)
  const bw = (d['w'] as number | undefined) ?? Math.abs((d['x2'] as number) - (d['x1'] as number))
  const bh = (d['h'] as number | undefined) ?? Math.abs((d['y2'] as number) - (d['y1'] as number))
  return x >= bx - 8 && x <= bx + bw + 8 && y >= by - 8 && y <= by + bh + 8
}
