export type ObjectType = 'stroke' | 'line' | 'rect' | 'ellipse' | 'arrow' | 'text'

// (C) Shared style enums (Contract C4). Stored as enums (not raw Konva arrays / CSS
// strings) so the JSONB stays compact and the UI is a small toggle/dropdown.
export type DashStyle = 'solid' | 'dashed' | 'dotted'
export type FontFamilyKey = 'sans' | 'serif' | 'mono' | 'marker'

export interface StrokeData { points: number[]; color: string; size: number }
// (C) dash? is optional + render-time-defaulted to 'solid' (legacy rows omit it).
export interface SegData    { x1: number; y1: number; x2: number; y2: number; color: string; size: number; dash?: DashStyle }
export interface RectData   { x: number; y: number; w: number; h: number; color: string; size: number; dash?: DashStyle }
// (C) fontFamily? is optional + render-time-defaulted to 'sans' (legacy rows omit it).
export interface TextData   { x: number; y: number; text: string; color: string; fontSize: number; fontFamily?: FontFamilyKey }

export type ObjectData = StrokeData | SegData | RectData | TextData

export interface BoardObject {
  id: string
  board_id: string
  owner_id: string
  type: ObjectType
  data: ObjectData
  updated_at: string
  deleted: boolean
}

export interface Board {
  id: string
  owner_id: string
  title: string
  sort_order: number
  created_at: string
}

export const newId = () => crypto.randomUUID()
