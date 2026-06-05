import { useEffect, useReducer, useCallback, useRef } from 'react'
import { historyReducer, initialHistory, type ObjectMap } from '../lib/history'
import { loadObjects, saveObject, softDeleteObject, clearBoard } from '../lib/objects'
import type { BoardObject } from '../lib/types'

export function useBoardObjects(boardId: string | null) {
  const [hist, dispatch] = useReducer(historyReducer, undefined, initialHistory)

  // Mirror reducer state into a ref so callbacks always read fresh state
  const histRef = useRef(hist)
  useEffect(() => { histRef.current = hist }, [hist])

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

  const persistDiff = (before: ObjectMap, after: ObjectMap) => {
    const ids = new Set([...Object.keys(before), ...Object.keys(after)])
    ids.forEach(id => {
      const b = before[id], a = after[id]
      if (a && a !== b) saveObject(a).catch(console.error)          // added or changed
      else if (b && !a) softDeleteObject(id).catch(console.error)   // removed
    })
  }

  const commit = useCallback((o: BoardObject) => {
    dispatch({ kind: 'add', object: o })
    saveObject(o).catch(console.error)
  }, [])

  const update = useCallback((o: BoardObject) => {
    dispatch({ kind: 'update', object: o })
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

  const undo = useCallback(() => {
    const next = historyReducer(histRef.current, { kind: 'undo' })
    persistDiff(histRef.current.present, next.present)
    dispatch({ kind: 'undo' })
  }, [])

  const redo = useCallback(() => {
    const next = historyReducer(histRef.current, { kind: 'redo' })
    persistDiff(histRef.current.present, next.present)
    dispatch({ kind: 'redo' })
  }, [])

  const objects = Object.values(hist.present)
  return { objects, commit, update, remove, clear, undo, redo, dispatch, hist }
}
