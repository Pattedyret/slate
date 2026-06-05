import { Stage, Layer, Line, Rect, Ellipse, Arrow, Text, Circle, Transformer } from 'react-konva'
import { useMemo, useRef, useEffect } from 'react'
import Konva from 'konva'
import type { BoardObject, StrokeData, SegData, RectData, TextData } from '../lib/types'
import { strokeOutline } from '../lib/freehand'

interface Props {
  width: number; height: number; objects: BoardObject[]; showGrid: boolean
  onPointerDown?: (x: number, y: number) => void
  onPointerMove?: (x: number, y: number) => void
  onPointerUp?: () => void
  selectable?: boolean
  selectedId?: string | null
  onSelect?: (id: string | null) => void
  onTransform?: (id: string, patch: Partial<StrokeData & SegData & RectData & TextData>) => void
}

function GridDots({ w, h }: { w: number; h: number }) {
  const dots = useMemo(() => {
    const gap = 24, out: JSX.Element[] = []
    for (let x = gap; x < w; x += gap)
      for (let y = gap; y < h; y += gap)
        out.push(<Circle key={`${x}-${y}`} x={x} y={y} radius={1.2} fill="#3a3f4b" listening={false} />)
    return out
  }, [w, h])
  return <>{dots}</>
}

const RESIZE_TYPES = new Set(['rect', 'ellipse'])

export function Canvas({
  width, height, objects, showGrid,
  onPointerDown, onPointerMove, onPointerUp,
  selectable, selectedId, onSelect, onTransform,
}: Props) {
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
      if (node) {
        tr.nodes([node as Konva.Node])
      } else {
        tr.nodes([])
      }
    } else {
      tr.nodes([])
    }
    layer.batchDraw()
  }, [selectedId, selectable, objects])

  const pos = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    const p = e.target.getStage()!.getPointerPosition()!
    return [p.x, p.y] as const
  }

  return (
    <Stage
      width={width}
      height={height}
      style={{ background: '#1d2027', touchAction: 'none' }}
      onMouseDown={e => {
        // Only fire pointer down when not in select mode, or when clicking the stage background
        if (selectable) {
          if (e.target === e.target.getStage()) onSelect?.(null)
          return
        }
        onPointerDown?.(...pos(e as Konva.KonvaEventObject<MouseEvent>))
      }}
      onMouseMove={e => {
        if (selectable) return
        onPointerMove?.(...pos(e as Konva.KonvaEventObject<MouseEvent>))
      }}
      onMouseUp={() => {
        if (selectable) return
        onPointerUp?.()
      }}
      onTouchStart={e => {
        e.evt.preventDefault()
        if (selectable) {
          if (e.target === e.target.getStage()) onSelect?.(null)
          return
        }
        onPointerDown?.(...pos(e as Konva.KonvaEventObject<TouchEvent>))
      }}
      onTouchMove={e => {
        e.evt.preventDefault()
        if (selectable) return
        onPointerMove?.(...pos(e as Konva.KonvaEventObject<TouchEvent>))
      }}
      onTouchEnd={() => {
        if (selectable) return
        onPointerUp?.()
      }}
    >
      <Layer listening={false}>{showGrid && <GridDots w={width} h={height} />}</Layer>
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
