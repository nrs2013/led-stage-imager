import { describe, it, expect } from 'vitest'
import { buildCandidates, buildGapCandidates, centerCandidates, salientOf, salientOfGroup, snap1D, snapMoveDelta, softAxis } from './snapping'
import type { Shape } from '../model/types'

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

describe('centerCandidates: island centres + canvas centre', () => {
  it('lists the canvas centre and every island centre', () => {
    const c = centerCandidates(
      [
        { x: 10, y: 20, w: 100, h: 40 },
        { x: 200, y: 0, w: 50, h: 51 }
      ],
      { w: 1920, h: 1080 }
    )
    expect(c.cxs).toEqual([960, 60, 225])
    expect(c.cys).toEqual([540, 40, 25.5])
    expect(c.xs).toEqual([])
  })
})

describe('salient centres', () => {
  it('salientOf includes the bbox centre', () => {
    const sh = {
      id: 'a',
      type: 'rect',
      points: [
        { x: 10, y: 10 },
        { x: 30, y: 50 }
      ],
      display: 'stroke',
      strokeWidth: 1
    } as Shape
    const s = salientOf(sh)
    expect(s.cxs).toContain(20)
    expect(s.cys).toContain(30)
    expect(s.xs).toEqual([10, 30])
  })
  it('salientOfGroup spans the union bbox with its centre', () => {
    const mk = (x: number, y: number): Shape =>
      ({
        id: `b${x}`,
        type: 'bulb',
        points: [{ x, y }],
        display: 'fill',
        strokeWidth: 1,
        diameter: 10
      }) as Shape
    const g = salientOfGroup([mk(100, 100), mk(200, 100)])
    expect(g.xs).toEqual([95, 205])
    expect(g.cxs).toEqual([150])
    expect(g.ys).toEqual([95, 105])
    expect(g.cys).toEqual([100])
  })
  it('a group centre lands exactly on an island centre via snapMoveDelta', () => {
    const sal = { xs: [], ys: [], cxs: [150], cys: [100] }
    const cand = centerCandidates([{ x: 130, y: 80, w: 60, h: 50 }], { w: 1000, h: 1000 })
    const r = snapMoveDelta(8.6, 4.2, sal, cand, 12)
    expect(150 + r.dx).toBe(160)
    expect(100 + r.dy).toBe(105)
    expect(r.gx).toBe(160)
    expect(r.gy).toBe(105)
  })
})

describe('buildCandidates with a Set exclusion (multi-select move)', () => {
  it('skips every selected shape', () => {
    const mk = (id: string, x: number): Shape =>
      ({
        id,
        type: 'rect',
        points: [
          { x, y: 0 },
          { x: x + 10, y: 10 }
        ],
        display: 'stroke',
        strokeWidth: 1
      }) as Shape
    const c = buildCandidates([mk('a', 0), mk('b', 100), mk('c', 200)], new Set(['a', 'b']))
    expect(c.xs).toEqual([200, 210])
  })
})

describe('parts snap by their centre only', () => {
  it('a bulb edge never out-competes its centre for an island snap', () => {
    const bulb = {
      id: 'bb',
      type: 'bulb',
      points: [{ x: 100, y: 100 }],
      display: 'fill',
      strokeWidth: 1,
      diameter: 5.5
    } as Shape
    const s = salientOf(bulb)
    expect(s.xs).toEqual([])
    expect(s.cxs).toEqual([100])
    expect(s.cys).toEqual([100])
  })
})

describe('buildGapCandidates: equal-spacing rhythm', () => {
  const rect = (id: string, x: number, y: number, w: number, h: number): Shape => ({
    id,
    type: 'rect',
    points: [
      { x, y },
      { x: x + w, y: y + h }
    ],
    display: 'fill',
    strokeWidth: 1
  })
  it('offers the next slot continuing a row (edges and centre pitch)', () => {
    // A: 0..10, B: 20..30 → gap 10, centre pitch 20 (same y row)
    const cands = buildGapCandidates([rect('a', 0, 0, 10, 10), rect('b', 20, 0, 10, 10)], null)
    expect(cands.xs).toContain(40) // mover's left edge right of B with gap 10
    expect(cands.xs).toContain(-10) // mover's right edge left of A with gap 10
    expect(cands.cxs).toContain(45) // mover's centre at B.cx + pitch (25 + 20)
    expect(cands.cxs).toContain(-15) // mover's centre at A.cx - pitch (5 - 20)
  })
  it('column pairs feed the y axis', () => {
    const cands = buildGapCandidates([rect('a', 0, 0, 10, 10), rect('b', 0, 25, 10, 10)], null)
    expect(cands.ys).toContain(50) // below B with the same 15px gap
  })
  it('different rows produce no x rhythm', () => {
    const cands = buildGapCandidates([rect('a', 0, 0, 10, 10), rect('b', 20, 100, 10, 10)], null)
    expect(cands.xs).toHaveLength(0)
  })
  it('excluded (moving) shapes are not part of the rhythm', () => {
    const cands = buildGapCandidates(
      [rect('a', 0, 0, 10, 10), rect('b', 20, 0, 10, 10), rect('m', 40, 0, 10, 10)],
      'm'
    )
    expect(cands.xs).toContain(40)
  })
})
