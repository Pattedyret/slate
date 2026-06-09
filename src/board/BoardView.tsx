import { useRef, useState, useEffect, useCallback } from 'react'
import { Canvas, LONGPRESS_MOVE_PX, type SlatePointerInfo } from './Canvas'
import { Toolbar } from './Toolbar'
import { TabBar } from './TabBar'
import { useTool } from './useTool'
import { useBoardObjects } from './useBoardObjects'
import { useBoards } from './useBoards'
import { useElementSize } from './useElementSize'
import { useViewport } from './useViewport'
import { useLongPress } from './useLongPress' // (D)
import { RadialMenu } from './RadialMenu' // (D)
import { worldToScreen } from './viewport-math' // (D)
import { useAuth } from '../auth/AuthProvider'
import { newId, type BoardObject, type ObjectType } from '../lib/types'
import { type BoardChannel } from '../lib/realtime'

let lastSent = 0
function throttledSendPoints(ch: BoardChannel | null, o: BoardObject) {
  if (!ch) return
  const now = performance.now()
  if (now - lastSent > 33) { lastSent = now; ch.sendPoints(o.id, o.type, o.data) }
}

// Feature-detect the Fullscreen API on an element (absent on iPhone Safari for non-video).
function fullscreenSupported(): boolean {
  if (typeof document === 'undefined') return false
  const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: unknown }
  return typeof el.requestFullscreen === 'function' || typeof el.webkitRequestFullscreen === 'function'
}

export function BoardView() {
  const { user, signOut } = useAuth()
  const { boards, activeId, setActiveId, addBoard, rename, remove } = useBoards(user!.id)
  const { objects, commit, update, remove: removeObj, clear, undo, redo, channel, liveDrafts } = useBoardObjects(activeId)
  const t = useTool()
  const vp = useViewport()
  const [showGrid, setShowGrid] = useState(true)
  const { ref: wrapRef, size } = useElementSize<HTMLDivElement>()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null) // (D) radial menu screen point
  const [menuHidden, setMenuHidden] = useState(false)
  const [isFs, setIsFs] = useState(false)
  const appRef = useRef<HTMLDivElement>(null)
  const draft = useRef<BoardObject | null>(null)
  const origin = useRef<{ x: number; y: number } | null>(null)
  const erasing = useRef(false) // true only while the pointer is held down with the eraser
  // Press-start world point + whether the pointer has moved past LONGPRESS_MOVE_PX yet.
  // Used to DEFER the first live-broadcast so a stationary tap / long-press never emits a
  // ghost stroke on other devices (integration decision §4 / shared with D).
  const pressStart = useRef<{ x: number; y: number } | null>(null)
  const moved = useRef(false)
  const [, force] = useState(0)

  // Keep the viewport informed of the current canvas size so +/-/reset anchor on its centre.
  useEffect(() => { vp.setSize(size.width, size.height) }, [size.width, size.height, vp])

  // Clear selection when switching away from select tool
  useEffect(() => {
    if (t.tool !== 'select') setSelectedId(null)
  }, [t.tool])

  // Reflect native fullscreen state (incl. Esc-exit and Safari's webkit-prefixed event).
  useEffect(() => {
    const onChange = () => {
      const fsEl = document.fullscreenElement ??
        (document as Document & { webkitFullscreenElement?: Element }).webkitFullscreenElement ?? null
      setIsFs(!!fsEl)
    }
    document.addEventListener('fullscreenchange', onChange)
    document.addEventListener('webkitfullscreenchange', onChange)
    return () => {
      document.removeEventListener('fullscreenchange', onChange)
      document.removeEventListener('webkitfullscreenchange', onChange)
    }
  }, [])

  // (D) The radial menu is transient chrome: dismiss it on resize, window blur, or a
  // board-tab switch (it lives in stale screen coords after any of those).
  useEffect(() => {
    if (!menu) return
    const dismiss = () => setMenu(null)
    window.addEventListener('resize', dismiss)
    window.addEventListener('blur', dismiss)
    return () => {
      window.removeEventListener('resize', dismiss)
      window.removeEventListener('blur', dismiss)
    }
  }, [menu])
  // (D) Close the menu when the active board changes.
  useEffect(() => { setMenu(null) }, [activeId])

  const base = (type: ObjectType, data: BoardObject['data']): BoardObject => ({
    id: newId(), board_id: activeId!, owner_id: user!.id, type, data, updated_at: new Date().toISOString(), deleted: false,
  })

  // Canvas delivers WORLD coords (it owns the screen→world conversion). The (x,y) draw
  // logic below is unchanged from before — it always operated in world space.
  const down = (x: number, y: number, info?: SlatePointerInfo) => {
    if (!activeId) return
    // (D) arm the long-press detector on a single stationary pointer (screen coords).
    const s = worldToScreen(x, y, vp)
    lp.onDown(s.x, s.y, info?.pointerType ?? 'mouse', info?.activePointers ?? 1)
    pressStart.current = { x, y }
    moved.current = false
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
  const move = (x: number, y: number, _info?: SlatePointerInfo) => {
    // (D) movement beyond tolerance cancels the long-press (it becomes a normal draw/drag).
    const s = worldToScreen(x, y, vp)
    lp.onMove(s.x, s.y)
    if (t.tool === 'eraser') {
      if (!erasing.current) return // no hover-erase: only erase while the pointer is held down
      const hit = hitTest(x, y)
      if (hit) { removeObj(hit.id); channel.current?.sendDelete(hit.id) }
      return
    }
    const d = draft.current; if (!d) return
    if (d.type === 'stroke') { (d.data as { points: number[] }).points.push(x, y) }
    else if (origin.current) { d.data = shapeData(d.type, origin.current.x, origin.current.y, x, y, t.color, t.size) }
    // Defer the first broadcast until the pointer has clearly moved (prevents ghost strokes
    // from a stationary tap / long-press that a parallel device would otherwise render).
    // LONGPRESS_MOVE_PX is a SCREEN-px threshold; (x,y) are world coords, so convert the
    // world distance to screen px via the current scale before comparing.
    if (!moved.current && pressStart.current) {
      const worldDist = Math.hypot(x - pressStart.current.x, y - pressStart.current.y)
      if (worldDist * vp.scale > LONGPRESS_MOVE_PX) {
        moved.current = true
      }
    }
    if (moved.current) throttledSendPoints(channel.current, d)
    force(n => n + 1)
  }
  const up = (_x?: number, _y?: number, _info?: SlatePointerInfo) => {
    lp.onUp() // (D) clear any pending long-press timer on release
    erasing.current = false
    pressStart.current = null
    if (draft.current) {
      const d = draft.current
      commit(d)
      channel.current?.sendCommit(d)
      draft.current = null; origin.current = null; moved.current = false; force(n => n + 1)
    }
    // v1: undo/redo not broadcast
  }

  // A 2nd pointer landed (pan/zoom) or a long-press claimed the gesture: discard the
  // in-progress draft WITHOUT committing or broadcasting.
  const onDrawCancel = useCallback(() => {
    lp.cancel() // (D) a 2nd pointer / pointercancel also kills a pending long-press
    draft.current = null
    origin.current = null
    erasing.current = false
    pressStart.current = null
    moved.current = false
    force(n => n + 1)
    // lp is a stable controller (useLongPress); safe to omit from deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // (D) Long-press → open the radial quick menu at the press SCREEN point. The detector
  // is fed screen coords from down/move (above), so `p` is already the overlay position.
  // Opening first discards the in-progress draft so the hold never leaves a stroke/shape.
  const lp = useLongPress({
    onLongPress: (p) => {
      onDrawCancel()
      setMenu({ x: p.x, y: p.y })
    },
  })

  const hitTest = (x: number, y: number) =>
    objects.filter(o => !o.deleted).reverse().find(o => near(o, x, y))

  const onTransform = (id: string, patch: Partial<BoardObject['data']>) => {
    const o = objects.find(x => x.id === id)
    if (!o) return
    const updated: BoardObject = { ...o, data: { ...o.data, ...patch } }
    update(updated)
    channel.current?.sendCommit(updated)
  }

  const fsOk = fullscreenSupported()

  const toggleFullscreen = useCallback(() => {
    const el = appRef.current as (HTMLElement & {
      webkitRequestFullscreen?: () => Promise<void> | void
    }) | null
    if (!el) return
    const fsEl = document.fullscreenElement ??
      (document as Document & { webkitFullscreenElement?: Element }).webkitFullscreenElement ?? null
    if (fsEl) {
      const exit = document.exitFullscreen ??
        (document as Document & { webkitExitFullscreen?: () => Promise<void> | void }).webkitExitFullscreen
      exit?.call(document)
    } else {
      // Auto-collapse the menu on entering fullscreen for maximum drawing space (locked decision).
      setMenuHidden(true)
      const req = el.requestFullscreen ?? el.webkitRequestFullscreen
      const r = req?.call(el)
      if (r && typeof (r as Promise<void>).catch === 'function') (r as Promise<void>).catch(() => {})
    }
  }, [])

  // Tiny test hook so e2e can assert the viewport transform deterministically.
  // Exposed in any non-production build (dev server or a test/preview mode) — never in prod.
  useEffect(() => {
    if (import.meta.env.PROD) return
    ;(window as unknown as { __slate?: unknown }).__slate = {
      getViewport: () => ({ scale: vp.scale, panX: vp.panX, panY: vp.panY }),
      setViewport: (next: { scale?: number; panX?: number; panY?: number }) => {
        // Drive the viewport deterministically from tests. Reset to {1,0,0}, then zoom
        // about the top-left origin (so panX/panY stay 0) and finally apply the pan.
        vp.reset()
        if (typeof next.scale === 'number') vp.zoomAt(0, 0, next.scale)
        if (typeof next.panX === 'number' || typeof next.panY === 'number') {
          vp.panBy(next.panX ?? 0, next.panY ?? 0)
        }
      },
      // (D) Live, non-deleted object count + the active tool — read by the radial e2e to
      // assert "no ghost object after a long-press" and "picking a sector swaps the tool".
      getObjectCount: () => objects.filter(o => !o.deleted).length,
      getTool: () => t.tool,
    }
  }, [vp.scale, vp.panX, vp.panY, vp, objects, t.tool])

  const render = [...objects, ...Object.values(liveDrafts), ...(draft.current ? [draft.current] : [])]
  return (
    <div className="app" ref={appRef}>
      {!menuHidden && (
        <>
          <TabBar boards={boards} activeId={activeId} onSelect={setActiveId}
            onAdd={addBoard} onRename={rename} onDelete={remove} onSignOut={signOut} />
          <Toolbar {...t} showGrid={showGrid} toggleGrid={() => setShowGrid(g => !g)}
            onUndo={undo} onRedo={redo} onClear={clear}
            isFs={isFs} onToggleFullscreen={toggleFullscreen} fullscreenSupported={fsOk}
            onCollapseMenu={() => setMenuHidden(true)} />
        </>
      )}
      <div className="canvas-wrap" ref={wrapRef}>
        <Canvas width={size.width} height={size.height} objects={render} showGrid={showGrid}
          viewport={vp}
          onPointerDown={(w, info) => down(w.x, w.y, info)}
          onPointerMove={(w, info) => move(w.x, w.y, info)}
          onPointerUp={(w, info) => up(w.x, w.y, info)}
          onDrawCancel={onDrawCancel}
          selectable={t.tool === 'select'}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onTransform={onTransform}
        />
        {/* (D) Radial quick menu — sibling of the Stage, screen-space overlay, never synced. */}
        {menu && (
          <RadialMenu
            point={menu}
            tool={t.tool} color={t.color} size={t.size}
            onTool={(tool) => { t.setTool(tool); setMenu(null) }}
            onColor={t.setColor}
            onSize={t.setSize}
            onClose={() => setMenu(null)}
          />
        )}
        {menuHidden && (
          <button className="menu-handle" onClick={() => setMenuHidden(false)} aria-label="Show menu">⌄</button>
        )}
        <div className="zoom-controls">
          <button onClick={vp.zoomOut} aria-label="Zoom out">−</button>
          <button className="zoom-pct" onClick={vp.reset} aria-label="Reset view" title="Reset view">
            {Math.round(vp.scale * 100)}%
          </button>
          <button onClick={vp.zoomIn} aria-label="Zoom in">+</button>
        </div>
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
