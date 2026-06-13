import { describe, it, expect } from 'vitest'
import { cellsBetween, shapeIntersectsRect, shapeBounds, pasteDelta } from './geometry'
import { BULB_DEFAULT_DIAMETER } from '../render/bulb'

describe('cellsBetween (paint path)', () => {
  it('horizontal / vertical runs hit every cell', () => {
    expect(cellsBetween({ x: 0, y: 0 }, { x: 3, y: 0 })).toEqual([
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 }
    ])
    expect(cellsBetween({ x: 5, y: 5 }, { x: 5, y: 2 })).toEqual([
      { x: 5, y: 4 },
      { x: 5, y: 3 },
      { x: 5, y: 2 }
    ])
  })

  it('diagonal becomes 4-connected stairs (no diagonal jumps)', () => {
    const path = cellsBetween({ x: 0, y: 0 }, { x: 3, y: 3 })
    expect(path[path.length - 1]).toEqual({ x: 3, y: 3 })
    let prev = { x: 0, y: 0 }
    for (const c of path) {
      expect(Math.abs(c.x - prev.x) + Math.abs(c.y - prev.y)).toBe(1) // one axis per step
      prev = c
    }
    expect(path.length).toBe(6) // dx + dy
  })

  it('same cell -> empty path', () => {
    expect(cellsBetween({ x: 2, y: 2 }, { x: 2, y: 2 })).toEqual([])
  })
})

describe('shapeIntersectsRect (囲み選択の実体判定)', () => {
  const chain = {
    id: 'g',
    type: 'freehand' as const,
    points: [
      { x: 0.5, y: 0.5 },
      { x: 10.5, y: 0.5 },
      { x: 10.5, y: 10.5 }
    ],
    display: 'stroke' as const,
    strokeWidth: 1
  }
  it('L字チェーンの「空っぽの内側」を囲んでも選ばれない', () => {
    // bbox(0..10, 0..10)とは交差するが、点は(2..8, 2..8)に存在しない
    expect(shapeIntersectsRect(chain, 2, 2, 8, 8)).toBe(false)
  })
  it('実体に枠が触れれば選ばれる', () => {
    expect(shapeIntersectsRect(chain, 8, -1, 12, 2)).toBe(true)
  })
  it('両端が枠の外でも、横切るLineは選ばれる', () => {
    const line = {
      id: 'l',
      type: 'line' as const,
      points: [
        { x: -5, y: 5 },
        { x: 20, y: 5 }
      ],
      display: 'stroke' as const,
      strokeWidth: 1
    }
    expect(shapeIntersectsRect(line, 0, 0, 10, 10)).toBe(true)
  })
})

describe('bulb geometry', () => {
  const bulb = (over = {}): import('../model/types').Shape => ({
    id: 'b1',
    type: 'bulb',
    points: [{ x: 100.5, y: 50.5 }],
    display: 'fill',
    strokeWidth: 1,
    ...over
  })

  it('shapeBounds: glass box centred on the point, default diameter', () => {
    const b = shapeBounds(bulb())
    const D = BULB_DEFAULT_DIAMETER
    expect(b.w).toBeCloseTo(D)
    expect(b.h).toBeCloseTo(D)
    expect(b.x).toBeCloseTo(100.5 - D / 2)
    expect(b.y).toBeCloseTo(50.5 - D / 2)
  })

  it('shapeBounds: honours a custom diameter', () => {
    const b = shapeBounds(bulb({ diameter: 12 }))
    expect(b.w).toBe(12)
    expect(b.x).toBeCloseTo(100.5 - 6)
  })

  it('pasteDelta: bulbs land CENTRED on the clicked dot', () => {
    const at = { x: 30.5, y: 40.5 }
    const d = pasteDelta([bulb()], at)
    expect(d).toEqual({ x: 30 - 100, y: 40 - 50 }) // centre -> centre, whole cells
  })

  it('pasteDelta: non-bulb clipboard keeps the top-left anchor', () => {
    const line: import('../model/types').Shape = {
      id: 'l1',
      type: 'line',
      points: [
        { x: 10, y: 20 },
        { x: 30, y: 25 }
      ],
      display: 'stroke',
      strokeWidth: 1
    }
    const d = pasteDelta([line], { x: 100, y: 200 })
    expect(d).toEqual({ x: 90, y: 180 })
  })
})
