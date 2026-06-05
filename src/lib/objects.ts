import { supabase } from './supabase'
import type { BoardObject } from './types'

export async function loadObjects(boardId: string): Promise<BoardObject[]> {
  const { data, error } = await supabase.from('objects')
    .select('*').eq('board_id', boardId).eq('deleted', false)
    .order('updated_at', { ascending: true })
  if (error) throw error
  return data ?? []
}

export async function saveObject(o: BoardObject): Promise<void> {
  const { error } = await supabase.from('objects').upsert({
    id: o.id, board_id: o.board_id, owner_id: o.owner_id,
    type: o.type, data: o.data, deleted: o.deleted,
    updated_at: new Date().toISOString(),
  })
  if (error) throw error
}

export async function softDeleteObject(id: string): Promise<void> {
  const { error } = await supabase.from('objects')
    .update({ deleted: true, updated_at: new Date().toISOString() }).eq('id', id)
  if (error) throw error
}

export async function clearBoard(boardId: string): Promise<void> {
  const { error } = await supabase.from('objects')
    .update({ deleted: true, updated_at: new Date().toISOString() }).eq('board_id', boardId)
  if (error) throw error
}
