import { supabase } from './supabase'
import type { Board } from './types'

export async function listBoards(): Promise<Board[]> {
  const { data, error } = await supabase.from('boards')
    .select('*').order('sort_order', { ascending: true })
  if (error) throw error
  return data ?? []
}

export async function createBoard(ownerId: string, title = 'Board', sort_order = 0): Promise<Board> {
  const { data, error } = await supabase.from('boards')
    .insert({ owner_id: ownerId, title, sort_order }).select().single()
  if (error) throw error
  return data
}

export async function renameBoard(id: string, title: string): Promise<void> {
  const { error } = await supabase.from('boards').update({ title }).eq('id', id)
  if (error) throw error
}

export async function deleteBoard(id: string): Promise<void> {
  const { error } = await supabase.from('boards').delete().eq('id', id)
  if (error) throw error
}

export async function reorderBoard(id: string, sort_order: number): Promise<void> {
  const { error } = await supabase.from('boards').update({ sort_order }).eq('id', id)
  if (error) throw error
}
