import { describe, it, expect } from 'vitest'
import type { BoardObject, StrokeData } from '../src/lib/types'

describe('BoardObject', () => {
  it('survives JSON round-trip', () => {
    const o: BoardObject = {
      id: 'a', board_id: 'b', owner_id: 'u', type: 'stroke',
      data: { points: [0, 0, 10, 10], color: '#fff', size: 4 } as StrokeData,
      updated_at: '2026-01-01T00:00:00Z', deleted: false,
    }
    expect(JSON.parse(JSON.stringify(o))).toEqual(o)
  })
})
