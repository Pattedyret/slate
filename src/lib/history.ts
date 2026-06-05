import type { BoardObject } from './types'

export type ObjectMap = Record<string, BoardObject>
export interface HistoryState { past: ObjectMap[]; present: ObjectMap; future: ObjectMap[] }
export type Action =
  | { kind: 'add'; object: BoardObject }
  | { kind: 'update'; object: BoardObject }
  | { kind: 'remove'; id: string }
  | { kind: 'reset'; objects: ObjectMap }
  | { kind: 'undo' }
  | { kind: 'redo' }

export const initialHistory = (): HistoryState => ({ past: [], present: {}, future: [] })

function commit(s: HistoryState, next: ObjectMap): HistoryState {
  return { past: [...s.past, s.present], present: next, future: [] }
}

export function historyReducer(s: HistoryState, a: Action): HistoryState {
  switch (a.kind) {
    case 'add':
    case 'update':
      return commit(s, { ...s.present, [a.object.id]: a.object })
    case 'remove': {
      const next = { ...s.present }; delete next[a.id]
      return commit(s, next)
    }
    case 'reset':
      return { ...s, present: a.objects }
    case 'undo': {
      if (!s.past.length) return s
      const previous = s.past[s.past.length - 1]
      return { past: s.past.slice(0, -1), present: previous, future: [s.present, ...s.future] }
    }
    case 'redo': {
      if (!s.future.length) return s
      const next = s.future[0]
      return { past: [...s.past, s.present], present: next, future: s.future.slice(1) }
    }
  }
}
