import { useEffect, useReducer, useCallback, useRef, useState } from 'react'
import { historyReducer, initialHistory, type ObjectMap } from '../lib/history'
import { loadObjects, saveObject, softDeleteObject, clearBoard } from '../lib/objects'
import type { BoardObject } from '../lib/types'
import { joinBoard, type BoardChannel } from '../lib/realtime'

export function useBoardObjects(boardId: string | null) {
  const [hist, dispatch] = useReducer(historyReducer, undefined, initialHistory)

  // Mirror reducer state into a ref so callbacks always read fresh state
  const histRef = useRef(hist)
  useEffect(() => { histRef.current = hist }, [hist])

  const chan = useRef<BoardChannel | null>(null)
  const [liveDrafts, setLiveDrafts] = useState<Record<string, BoardObject>>({})

  useEffect(() => {
    if (!boardId) return
    let alive = true
    setLiveDrafts({})
    loadObjects(boardId).then(rows => {
      if (!alive) return
      const map: ObjectMap = {}; rows.forEach(r => (map[r.id] = r))
      dispatch({ kind: 'reset', objects: map })
    }).catch(console.error)

    chan.current = joinBoard(boardId, {
      onLive: m => setLiveDrafts(d => ({ ...d, [m.id]: { id: m.id, board_id: boardId, owner_id: '', type: m.type, data: m.data, updated_at: '', deleted: false } })),
      onCommit: o => {
        setLiveDrafts(d => { const n = { ...d }; delete n[o.id]; return n })
        dispatch({ kind: 'sync', objects: { ...histRef.current.present, [o.id]: o } })
      },
      onDelete: id => {
        setLiveDrafts(d => { const n = { ...d }; delete n[id]; return n })
        const next = { ...histRef.current.present }; delete next[id]
        dispatch({ kind: 'sync', objects: next })
      },
    })

    return () => { alive = false; chan.current?.leave(); chan.current = null }
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
  return { objects, commit, update, remove, clear, undo, redo, dispatch, hist, channel: chan, liveDrafts }
}
