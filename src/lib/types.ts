export type ObjectType = 'stroke' | 'line' | 'rect' | 'ellipse' | 'arrow' | 'text'

export interface StrokeData { points: number[]; color: string; size: number }
export interface SegData    { x1: number; y1: number; x2: number; y2: number; color: string; size: number }
export interface RectData   { x: number; y: number; w: number; h: number; color: string; size: number }
export interface TextData   { x: number; y: number; text: string; color: string; fontSize: number }

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
