import { useEffect, useReducer, useCallback } from 'react'
import { historyReducer, initialHistory, type ObjectMap } from '../lib/history'
import { loadObjects, saveObject, softDeleteObject, clearBoard } from '../lib/objects'
import type { BoardObject } from '../lib/types'

export function useBoardObjects(boardId: string | null) {
  const [hist, dispatch] = useReducer(historyReducer, undefined, initialHistory)

  useEffect(() => {
    if (!boardId) return
    let alive = true
    loadObjects(boardId).then(rows => {
      if (!alive) return
      const map: ObjectMap = {}; rows.forEach(r => (map[r.id] = r))
      dispatch({ kind: 'reset', objects: map })
    }).catch(console.error)
    return () => { alive = false }
  }, [boardId])

  const commit = useCallback((o: BoardObject) => {
    dispatch({ kind: 'add', object: o })
    saveObject(o).catch(console.error)
  }, [])

  const remove = useCallback((id: string) => {
    dispatch({ kind: 'remove', id })
    softDeleteObject(id).catch(console.error)
  }, [])

  const clear = useCallback(() => {
    if (!boardId) return
    dispatch({ kind: 'reset', objects: {} })
    clearBoard(boardId).catch(console.error)
  }, [boardId])

  const objects = Object.values(hist.present)
  return { objects, commit, remove, clear, dispatch, hist }
}
