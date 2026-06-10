import { describe, it, expect } from 'vitest'
import { snap1D, snapMoveDelta, softAxis } from './snapping'

describe('snap1D', () => {
  it('alignment wins inside its radius, with a guide', () => {
    expect(snap1D(102.4, [103], 3, 10, 2, true)).toEqual({ v: 103, guide: 103 })
  })
  it('soft 10px grid catches nearby, no guide', () => {
    expect(snap1D(101.2, [], 3, 10, 2, true)).toEqual({ v: 100, guide: null })
  })
  it('falls back to whole pixels (grid not forced)', () => {
    expect(snap1D(104.6, [], 3, 10, 2, true)).toEqual({ v: 105, guide: null })
  })
})

describe('snapMoveDelta', () => {
  it('aligns a moved edge onto another shape edge', () => {
    const r = snapMoveDelta(9.7, 0.2, { xs: [100], ys: [50] }, { xs: [110], ys: [] }, 3)
    expect(r.dx).toBe(10) // 100 + 10 = 110 exactly
    expect(r.gx).toBe(110)
    expect(r.dy).toBe(0) // plain pixel rounding
  })
  it('rounds to pixels when nothing is close', () => {
    const r = snapMoveDelta(9.7, 4.4, { xs: [100], ys: [50] }, { xs: [500], ys: [500] }, 3)
    expect(r).toEqual({ dx: 10, dy: 4, gx: null, gy: null })
  })
})

describe('softAxis', () => {
  it('locks near-horizontal to horizontal', () => {
    expect(softAxis({ x: 0, y: 0 }, { x: 40, y: 2 }, 3)).toEqual({ x: 40, y: 0 })
  })
  it('locks near-45° to exact 45°', () => {
    const p = softAxis({ x: 0, y: 0 }, { x: 20, y: 18 }, 3)
    expect(Math.abs(p.x)).toBe(Math.abs(p.y))
  })
  it('leaves clearly-angled drags alone', () => {
    expect(softAxis({ x: 0, y: 0 }, { x: 40, y: 17 }, 3)).toEqual({ x: 40, y: 17 })
  })
})
