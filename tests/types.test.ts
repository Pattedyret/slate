import { describe, it, expect } from 'vitest'
import type { BoardObject, StrokeData, SegData, TextData } from '../src/lib/types'
import { dashArray, fontStack, FONT_STACKS } from '../src/lib/style'

describe('BoardObject', () => {
  it('survives JSON round-trip', () => {
    const o: BoardObject = {
      id: 'a', board_id: 'b', owner_id: 'u', type: 'stroke',
      data: { points: [0, 0, 10, 10], color: '#fff', size: 4 } as StrokeData,
      updated_at: '2026-01-01T00:00:00Z', deleted: false,
    }
    expect(JSON.parse(JSON.stringify(o))).toEqual(o)
  })

  // (C) C4 additions: dash on segments, fontFamily on text — both optional + JSONB-safe.
  it('round-trips a dashed line (SegData.dash)', () => {
    const o: BoardObject = {
      id: 'l', board_id: 'b', owner_id: 'u', type: 'line',
      data: { x1: 0, y1: 0, x2: 50, y2: 30, color: '#5ad19a', size: 4, dash: 'dashed' } as SegData,
      updated_at: '2026-01-01T00:00:00Z', deleted: false,
    }
    const back = JSON.parse(JSON.stringify(o)) as BoardObject
    expect(back).toEqual(o)
    expect((back.data as SegData).dash).toBe('dashed')
  })

  it('round-trips marker text (TextData.fontFamily)', () => {
    const o: BoardObject = {
      id: 't', board_id: 'b', owner_id: 'u', type: 'text',
      data: { x: 10, y: 20, text: 'hi', color: '#fff', fontSize: 32, fontFamily: 'marker' } as TextData,
      updated_at: '2026-01-01T00:00:00Z', deleted: false,
    }
    const back = JSON.parse(JSON.stringify(o)) as BoardObject
    expect(back).toEqual(o)
    expect((back.data as TextData).fontFamily).toBe('marker')
  })

  // (C) Backward-compat: a legacy object with neither dash nor fontFamily round-trips
  // unchanged and renders with defaults via the helpers.
  it('round-trips a legacy object lacking dash/fontFamily and renders with defaults', () => {
    const legacyLine: BoardObject = {
      id: 'll', board_id: 'b', owner_id: 'u', type: 'line',
      data: { x1: 0, y1: 0, x2: 10, y2: 10, color: '#fff', size: 4 } as SegData,
      updated_at: '2026-01-01T00:00:00Z', deleted: false,
    }
    const legacyText: BoardObject = {
      id: 'lt', board_id: 'b', owner_id: 'u', type: 'text',
      data: { x: 0, y: 0, text: 'x', color: '#fff', fontSize: 20 } as TextData,
      updated_at: '2026-01-01T00:00:00Z', deleted: false,
    }
    // round-trip is lossless (no field added)
    expect(JSON.parse(JSON.stringify(legacyLine))).toEqual(legacyLine)
    expect(JSON.parse(JSON.stringify(legacyText))).toEqual(legacyText)
    // legacy dash absent → solid stroke → Konva dash undefined (NOT [])
    expect(dashArray((legacyLine.data as SegData).dash, 4)).toBeUndefined()
    // legacy fontFamily absent → 'sans' stack
    expect(fontStack((legacyText.data as TextData).fontFamily)).toBe(FONT_STACKS.sans)
  })
})

// (C) Style-helper unit coverage (used by Canvas + the text overlay).
describe('style helpers', () => {
  it('dashArray maps enums to width-scaled Konva arrays; solid → undefined', () => {
    expect(dashArray('solid', 4)).toBeUndefined()
    expect(dashArray(undefined, 4)).toBeUndefined()
    expect(dashArray('dashed', 4)).toEqual([12, 8])
    expect(dashArray('dotted', 4)).toEqual([0.4, 10])
  })

  it('fontStack resolves every key and defaults to sans', () => {
    expect(fontStack('serif')).toBe(FONT_STACKS.serif)
    expect(fontStack('mono')).toBe(FONT_STACKS.mono)
    expect(fontStack('marker')).toBe(FONT_STACKS.marker)
    expect(fontStack(undefined)).toBe(FONT_STACKS.sans)
  })
})
