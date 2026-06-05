import { describe, it, expect } from 'vitest'
import { historyReducer, initialHistory } from '../src/lib/history'
import type { BoardObject } from '../src/lib/types'

const mk = (id: string): BoardObject => ({
  id, board_id: 'b', owner_id: 'u', type: 'stroke',
  data: { points: [0,0], color: '#fff', size: 2 }, updated_at: '', deleted: false,
})

describe('historyReducer', () => {
  it('adds, undoes, and redoes', () => {
    let s = initialHistory()
    s = historyReducer(s, { kind: 'add', object: mk('1') })
    expect(s.present['1']).toBeTruthy()
    s = historyReducer(s, { kind: 'undo' })
    expect(s.present['1']).toBeUndefined()
    s = historyReducer(s, { kind: 'redo' })
    expect(s.present['1']).toBeTruthy()
  })

  it('a new action clears the redo stack', () => {
    let s = initialHistory()
    s = historyReducer(s, { kind: 'add', object: mk('1') })
    s = historyReducer(s, { kind: 'undo' })
    s = historyReducer(s, { kind: 'add', object: mk('2') })
    s = historyReducer(s, { kind: 'redo' })
    expect(s.present['1']).toBeUndefined()
    expect(s.present['2']).toBeTruthy()
  })

  it('reset clears undo history', () => {
    let s = initialHistory()
    s = historyReducer(s, { kind: 'add', object: mk('1') })
    s = historyReducer(s, { kind: 'add', object: mk('2') })
    s = historyReducer(s, { kind: 'reset', objects: { x: mk('x') } })
    expect(Object.keys(s.present)).toEqual(['x'])
    // undo should be a no-op — past was wiped
    s = historyReducer(s, { kind: 'undo' })
    expect(Object.keys(s.present)).toEqual(['x'])
  })

  it('sync preserves undo history', () => {
    let s = initialHistory()
    s = historyReducer(s, { kind: 'add', object: mk('1') })
    s = historyReducer(s, { kind: 'sync', objects: { '1': mk('1'), '2': mk('2') } })
    expect(s.present['1']).toBeTruthy()
    expect(s.present['2']).toBeTruthy()
    // undo should pop back to the snapshot before add('1'), i.e. {}
    s = historyReducer(s, { kind: 'undo' })
    expect(s.present).toEqual({})
  })
})
