import { Stage, Layer, Line, Rect, Ellipse, Arrow, Text, Circle, Transformer } from 'react-konva'
import { useMemo, useRef, useEffect } from 'react'
import Konva from 'konva'
import type { BoardObject, StrokeData, SegData, RectData, TextData } from '../lib/types'
import { strokeOutline } from '../lib/freehand'
import type { ViewportApi } from './useViewport'

// Shared with the radial-menu package (D): movement beyond this many *screen* px
// while a single pointer is down means it's a drag/draw, not a stationary long-press.
export const LONGPRESS_MOVE_PX = 8

export type SlatePointerType = 'pen' | 'touch' | 'mouse'

export interface SlatePointerInfo {
  pointerId: number
  pointerType: SlatePointerType
  /** How many pointers are currently down (1 = draw, 2 = gesture). */
  activePointers: number
}

// Contract C3. `width`/`height` are additive B-internal props (Konva needs explicit
// pixel dims); BoardView measures them via useElementSize and passes them down.
export interface CanvasProps {
  width: number
  height: number
  objects: BoardObject[]
  showGrid: boolean
  // viewport (from useViewport) — Canvas applies it to the Stage and handles wheel
  // + 2-finger gestures internally:
  viewport: ViewportApi
  // unified single-pointer events, in WORLD coords (fired only when activePointers === 1
  // and not a gesture):
  onPointerDown?(world: { x: number; y: number }, info: SlatePointerInfo): void
  onPointerMove?(world: { x: number; y: number }, info: SlatePointerInfo): void
  onPointerUp?(world: { x: number; y: number }, info: SlatePointerInfo): void
  // called when a 2nd pointer lands or a long-press claims the gesture:
  onDrawCancel?(): void
  // selection (existing, unchanged semantics):
  selectable?: boolean
  selectedId?: string | null
  onSelect?(id: string | null): void
  onTransform?(id: string, patch: Partial<StrokeData & SegData & RectData & TextData>): void
  // text editing (C): double-tap/click an existing text object:
  onEditText?(id: string): void
}

const GRID_GAP = 24
const DOT_RADIUS = 1.2
const MIN_ON_SCREEN_GAP = 6 // density guard: hide/sparsen the grid below this on-screen spacing

/** Dotted grid drawn in WORLD space over the visible world rectangle. */
function GridDots({
  width, height, scale, panX, panY,
}: { width: number; height: number; scale: number; panX: number; panY: number }) {
  const dots = useMemo(() => {
    if (scale <= 0) return []
    // Density guard: sparsen the grid when dots would crowd together at deep zoom-out.
    let gap = GRID_GAP
    while (gap * scale < MIN_ON_SCREEN_GAP) gap *= 5
    // Visible world rectangle (inverse transform of the viewport box).
    const worldLeft = -panX / scale
    const worldTop = -panY / scale
    const worldRight = (width - panX) / scale
    const worldBottom = (height - panY) / scale
    const i0 = Math.floor(worldLeft / gap)
    const i1 = Math.ceil(worldRight / gap)
    const j0 = Math.floor(worldTop / gap)
    const j1 = Math.ceil(worldBottom / gap)
    const radius = DOT_RADIUS / scale
    const out: JSX.Element[] = []
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        out.push(
          <Circle
            key={`${i}:${j}`}
            x={i * gap}
            y={j * gap}
            radius={radius}
            fill="#3a3f4b"
            listening={false}
            perfectDrawEnabled={false}
          />,
        )
      }
    }
    return out
    // Memoise on the quantised index bounds (computed from the rounded inputs), NOT on raw
    // continuous pan, so a pan doesn't rebuild the array every frame unless a row/col changes.
  }, [
    Math.floor(-panX / scale / GRID_GAP),
    Math.ceil((width - panX) / scale / GRID_GAP),
    Math.floor(-panY / scale / GRID_GAP),
    Math.ceil((height - panY) / scale / GRID_GAP),
    scale,
  ])
  return <>{dots}</>
}

const RESIZE_TYPES = new Set(['rect', 'ellipse'])

function toPointerType(t: string): SlatePointerType {
  return t === 'pen' || t === 'touch' ? t : 'mouse'
}

export function Canvas({
  width, height, objects, showGrid, viewport,
  onPointerDown, onPointerMove, onPointerUp, onDrawCancel,
  selectable, selectedId, onSelect, onTransform,
  // onEditText is part of the C3 contract; B declares it but does not wire it (C does).
  onEditText: _onEditText,
}: CanvasProps) {
  const { scale, panX, panY } = viewport
  const stageRef = useRef<Konva.Stage>(null)
  const transformerRef = useRef<Konva.Transformer>(null)
  const layerRef = useRef<Konva.Layer>(null)

  const selectedObj = selectedId ? objects.find(o => o.id === selectedId) : undefined
  const isResizable = selectedObj ? RESIZE_TYPES.has(selectedObj.type) : false

  // Attach Transformer to the selected node whenever selectedId changes
  useEffect(() => {
    const tr = transformerRef.current
    const layer = layerRef.current
    if (!tr || !layer) return
    if (selectedId && selectable) {
      const node = layer.findOne('#' + selectedId)
      tr.nodes(node ? [node as Konva.Node] : [])
    } else {
      tr.nodes([])
    }
    layer.batchDraw()
  }, [selectedId, selectable, objects])

  // ----- Refs read by the once-bound DOM listeners (avoid stale closures) -----
  const vpRef = useRef(viewport)
  vpRef.current = viewport
  const selectableRef = useRef(selectable)
  selectableRef.current = selectable
  const cbRef = useRef({ onPointerDown, onPointerMove, onPointerUp, onDrawCancel })
  cbRef.current = { onPointerDown, onPointerMove, onPointerUp, onDrawCancel }

  // Active pointers tracked by pointerId.
  const pointers = useRef(new Map<number, { x: number; y: number; type: SlatePointerType }>())
  // Latched while a multi-touch gesture is (or was) active; cleared only when all pointers lift.
  const gestureActive = useRef(false)
  // Previous two-finger centroid + distance, for incremental pan+pinch.
  const lastGesture = useRef<{ cx: number; cy: number; dist: number } | null>(null)

  // Screen pixel (relative to the stage container) → WORLD coords.
  const toWorld = (clientX: number, clientY: number) => {
    const container = stageRef.current?.container()
    const rect = container?.getBoundingClientRect()
    const sx = clientX - (rect?.left ?? 0)
    const sy = clientY - (rect?.top ?? 0)
    const vp = vpRef.current
    return { x: (sx - vp.panX) / vp.scale, y: (sy - vp.panY) / vp.scale }
  }
  const toLocal = (clientX: number, clientY: number) => {
    const rect = stageRef.current?.container()?.getBoundingClientRect()
    return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) }
  }

  // Bind the unified Pointer-Events + wheel listeners ONCE to the Stage container.
  useEffect(() => {
    const container = stageRef.current?.container()
    if (!container) return

    const info = (pointerId: number, type: SlatePointerType): SlatePointerInfo => ({
      pointerId, pointerType: type, activePointers: pointers.current.size,
    })

    const beginGesture = () => {
      // Two fingers down: cancel any in-progress single-pointer draft exactly once.
      if (!gestureActive.current) {
        gestureActive.current = true
        cbRef.current.onDrawCancel?.()
      }
      const pts = [...pointers.current.values()]
      if (pts.length >= 2) {
        const [a, b] = pts
        lastGesture.current = {
          cx: (a.x + b.x) / 2,
          cy: (a.y + b.y) / 2,
          dist: Math.hypot(a.x - b.x, a.y - b.y),
        }
      }
    }

    const onPointerDown = (e: PointerEvent) => {
      const type = toPointerType(e.pointerType)
      const local = toLocal(e.clientX, e.clientY)
      pointers.current.set(e.pointerId, { x: local.x, y: local.y, type })
      // Capture so pointerup/move keep firing on this container even if the pointer leaves
      // it — otherwise the pointers map can wedge and block subsequent draws.
      try { container.setPointerCapture(e.pointerId) } catch { /* not capturable — ignore */ }

      if (pointers.current.size >= 2) {
        beginGesture()
        return
      }
      // Single pointer. In select mode, let Konva handle node-drag/Transformer/hit-tests —
      // do NOT emit a draw event. Background-deselect is handled by the Stage onMouseDown.
      if (gestureActive.current || selectableRef.current) return
      cbRef.current.onPointerDown?.(toWorld(e.clientX, e.clientY), info(e.pointerId, type))
    }

    const onPointerMove = (e: PointerEvent) => {
      const tracked = pointers.current.get(e.pointerId)
      const type = tracked?.type ?? toPointerType(e.pointerType)
      const local = toLocal(e.clientX, e.clientY)
      if (tracked) { tracked.x = local.x; tracked.y = local.y }

      // Two-finger pan + pinch.
      if (pointers.current.size >= 2) {
        const pts = [...pointers.current.values()]
        const [a, b] = pts
        const cx = (a.x + b.x) / 2
        const cy = (a.y + b.y) / 2
        const dist = Math.hypot(a.x - b.x, a.y - b.y)
        const prev = lastGesture.current
        if (prev) {
          const vp = vpRef.current
          vp.panBy(cx - prev.cx, cy - prev.cy)
          if (prev.dist > 0 && dist > 0) {
            vp.zoomAt(cx, cy, dist / prev.dist)
          }
        }
        lastGesture.current = { cx, cy, dist }
        return
      }

      if (pointers.current.size === 1 && !gestureActive.current && !selectableRef.current) {
        cbRef.current.onPointerMove?.(toWorld(e.clientX, e.clientY), info(e.pointerId, type))
      }
    }

    const endPointer = (e: PointerEvent) => {
      const tracked = pointers.current.get(e.pointerId)
      const type = tracked?.type ?? toPointerType(e.pointerType)
      const wasGesture = gestureActive.current
      const wasSingle = pointers.current.size === 1
      pointers.current.delete(e.pointerId)

      if (pointers.current.size === 0) {
        // All fingers up — clear the gesture latch so a fresh single touch can draw again.
        gestureActive.current = false
        lastGesture.current = null
      } else if (pointers.current.size === 1) {
        // Dropped from 2 → 1: do NOT resume drawing; just re-seat the gesture baseline.
        lastGesture.current = null
        return
      }

      if (wasSingle && !wasGesture && !selectableRef.current) {
        cbRef.current.onPointerUp?.(toWorld(e.clientX, e.clientY), info(e.pointerId, type))
      }
    }

    const onPointerCancel = (e: PointerEvent) => {
      pointers.current.delete(e.pointerId)
      if (pointers.current.size === 0) {
        gestureActive.current = false
        lastGesture.current = null
      }
      cbRef.current.onDrawCancel?.()
    }

    const onWheel = (e: WheelEvent) => {
      e.preventDefault() // non-passive listener so this is honored
      const vp = vpRef.current
      const local = toLocal(e.clientX, e.clientY)
      if (e.ctrlKey || e.metaKey) {
        // Pinch (trackpad) / ctrl|⌘+wheel (mouse) → zoom to cursor.
        const factor = Math.exp(-e.deltaY * 0.01)
        vp.zoomAt(local.x, local.y, factor)
      } else if (e.shiftKey) {
        // Shift+wheel → pan X (plain mouse wheels only emit deltaY).
        vp.panBy(-(e.deltaY || e.deltaX), 0)
      } else {
        // Plain wheel / two-finger trackpad scroll → pan.
        vp.panBy(-e.deltaX, -e.deltaY)
      }
    }

    container.addEventListener('pointerdown', onPointerDown)
    container.addEventListener('pointermove', onPointerMove)
    container.addEventListener('pointerup', endPointer)
    container.addEventListener('pointercancel', onPointerCancel)
    container.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      container.removeEventListener('pointerdown', onPointerDown)
      container.removeEventListener('pointermove', onPointerMove)
      container.removeEventListener('pointerup', endPointer)
      container.removeEventListener('pointercancel', onPointerCancel)
      container.removeEventListener('wheel', onWheel)
    }
    // Bind once: callbacks/viewport/selectable are read through refs above.
  }, [])

  return (
    <Stage
      ref={stageRef}
      width={width}
      height={height}
      scaleX={scale}
      scaleY={scale}
      x={panX}
      y={panY}
      style={{ background: '#1d2027', touchAction: 'none' }}
      // Background-deselect in select mode. (Konva's own events still drive node-drag/Transformer.)
      onMouseDown={e => { if (selectable && e.target === e.target.getStage()) onSelect?.(null) }}
      onTouchStart={e => { if (selectable && e.target === e.target.getStage()) onSelect?.(null) }}
    >
      <Layer listening={false}>
        {showGrid && <GridDots width={width} height={height} scale={scale} panX={panX} panY={panY} />}
      </Layer>
      <Layer ref={layerRef}>
        {objects.filter(o => !o.deleted).map(o => {
          const commonSelectProps = selectable
            ? {
                draggable: true,
                onClick: () => onSelect?.(o.id),
                onTap: () => onSelect?.(o.id),
              }
            : {}

          if (o.type === 'stroke') {
            const d = o.data as StrokeData
            const dragProps = selectable
              ? {
                  onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => {
                    const node = e.target
                    const dx = node.x()
                    const dy = node.y()
                    // Reset node position — points are in absolute coords
                    node.position({ x: 0, y: 0 })
                    const newPoints = d.points.map((v, i) => i % 2 === 0 ? v + dx : v + dy)
                    onTransform?.(o.id, { points: newPoints })
                  },
                  onTransformEnd: (e: Konva.KonvaEventObject<Event>) => {
                    const n = e.target; n.scaleX(1); n.scaleY(1); n.rotation(0)
                  },
                }
              : {}
            return (
              <Line
                key={o.id}
                id={o.id}
                points={strokeOutline(d.points, d.size)}
                closed
                fill={d.color}
                {...commonSelectProps}
                {...dragProps}
              />
            )
          }

          if (o.type === 'line' || o.type === 'arrow') {
            const d = o.data as SegData
            const pts = [d.x1, d.y1, d.x2, d.y2]
            const dragProps = selectable
              ? {
                  onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => {
                    const node = e.target
                    const dx = node.x()
                    const dy = node.y()
                    // Points are absolute coords inside Konva — reset position and translate endpoints
                    node.position({ x: 0, y: 0 })
                    onTransform?.(o.id, { x1: d.x1 + dx, y1: d.y1 + dy, x2: d.x2 + dx, y2: d.y2 + dy })
                  },
                  onTransformEnd: (e: Konva.KonvaEventObject<Event>) => {
                    const n = e.target; n.scaleX(1); n.scaleY(1); n.rotation(0)
                  },
                }
              : {}
            return o.type === 'arrow'
              ? (
                <Arrow
                  key={o.id}
                  id={o.id}
                  points={pts}
                  stroke={d.color}
                  fill={d.color}
                  strokeWidth={d.size}
                  pointerLength={10}
                  pointerWidth={10}
                  {...commonSelectProps}
                  {...dragProps}
                />
              )
              : (
                <Line
                  key={o.id}
                  id={o.id}
                  points={pts}
                  stroke={d.color}
                  strokeWidth={d.size}
                  lineCap="round"
                  {...commonSelectProps}
                  {...dragProps}
                />
              )
          }

          if (o.type === 'rect') {
            const d = o.data as RectData
            const dragProps = selectable
              ? {
                  onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => {
                    const node = e.target
                    onTransform?.(o.id, { x: node.x(), y: node.y() })
                  },
                  onTransformEnd: (e: Konva.KonvaEventObject<Event>) => {
                    const node = e.target as Konva.Rect
                    const scaleX = node.scaleX()
                    const scaleY = node.scaleY()
                    const newW = Math.abs(node.width() * scaleX)
                    const newH = Math.abs(node.height() * scaleY)
                    node.scaleX(1)
                    node.scaleY(1)
                    node.rotation(0)
                    onTransform?.(o.id, { x: node.x(), y: node.y(), w: newW, h: newH })
                  },
                }
              : {}
            return (
              <Rect
                key={o.id}
                id={o.id}
                x={d.x}
                y={d.y}
                width={d.w}
                height={d.h}
                stroke={d.color}
                strokeWidth={d.size}
                {...commonSelectProps}
                {...dragProps}
              />
            )
          }

          if (o.type === 'ellipse') {
            const d = o.data as RectData
            // Stored as top-left x,y + w,h; Konva Ellipse uses center + radii
            const cx = d.x + d.w / 2
            const cy = d.y + d.h / 2
            const dragProps = selectable
              ? {
                  onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => {
                    const node = e.target as Konva.Ellipse
                    // node.x()/y() is the new center; convert back to top-left
                    onTransform?.(o.id, { x: node.x() - d.w / 2, y: node.y() - d.h / 2 })
                  },
                  onTransformEnd: (e: Konva.KonvaEventObject<Event>) => {
                    const node = e.target as Konva.Ellipse
                    const scaleX = node.scaleX()
                    const scaleY = node.scaleY()
                    const newRx = Math.abs(node.radiusX() * scaleX)
                    const newRy = Math.abs(node.radiusY() * scaleY)
                    node.scaleX(1)
                    node.scaleY(1)
                    node.rotation(0)
                    const newW = newRx * 2
                    const newH = newRy * 2
                    // node.x()/y() is still the center after transform — convert back to top-left
                    onTransform?.(o.id, { x: node.x() - newW / 2, y: node.y() - newH / 2, w: newW, h: newH })
                  },
                }
              : {}
            return (
              <Ellipse
                key={o.id}
                id={o.id}
                x={cx}
                y={cy}
                radiusX={Math.abs(d.w) / 2}
                radiusY={Math.abs(d.h) / 2}
                stroke={d.color}
                strokeWidth={d.size}
                {...commonSelectProps}
                {...dragProps}
              />
            )
          }

          if (o.type === 'text') {
            const d = o.data as TextData
            const dragProps = selectable
              ? {
                  onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => {
                    const node = e.target
                    onTransform?.(o.id, { x: node.x(), y: node.y() })
                  },
                  onTransformEnd: (e: Konva.KonvaEventObject<Event>) => {
                    const n = e.target; n.scaleX(1); n.scaleY(1); n.rotation(0)
                  },
                }
              : {}
            return (
              <Text
                key={o.id}
                id={o.id}
                x={d.x}
                y={d.y}
                text={d.text}
                fill={d.color}
                fontSize={d.fontSize}
                {...commonSelectProps}
                {...dragProps}
              />
            )
          }

          return null
        })}
        {selectable && (
          <Transformer
            ref={transformerRef}
            rotateEnabled={false}
            enabledAnchors={isResizable
              ? ['top-left', 'top-center', 'top-right', 'middle-right', 'bottom-right', 'bottom-center', 'bottom-left', 'middle-left']
              : []}
          />
        )}
      </Layer>
    </Stage>
  )
}
