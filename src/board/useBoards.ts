import { useEffect, useState, useCallback } from 'react'
import { listBoards, createBoard, renameBoard, deleteBoard } from '../lib/boards'
import type { Board } from '../lib/types'

export function useBoards(ownerId: string) {
  const [boards, setBoards] = useState<Board[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)

  useEffect(() => {
    listBoards().then(async list => {
      if (list.length === 0) list = [await createBoard(ownerId, 'Board 1', 0)]
      setBoards(list); setActiveId(list[0].id)
    }).catch(console.error)
  }, [ownerId])

  const addBoard = useCallback(async () => {
    const b = await createBoard(ownerId, `Board ${boards.length + 1}`, boards.length)
    setBoards(bs => [...bs, b]); setActiveId(b.id)
  }, [ownerId, boards.length])

  const rename = useCallback(async (id: string, title: string) => {
    await renameBoard(id, title); setBoards(bs => bs.map(b => b.id === id ? { ...b, title } : b))
  }, [])

  const remove = useCallback(async (id: string) => {
    await deleteBoard(id)
    setBoards(bs => {
      const next = bs.filter(b => b.id !== id)
      setActiveId(a => (a === id ? next[0]?.id ?? null : a))
      return next
    })
  }, [])

  return { boards, activeId, setActiveId, addBoard, rename, remove }
}
