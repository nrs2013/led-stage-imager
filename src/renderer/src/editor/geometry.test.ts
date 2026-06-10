import { describe, it, expect } from 'vitest'
import { cellsBetween } from './geometry'

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
