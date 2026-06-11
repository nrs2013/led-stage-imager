import { describe, expect, it } from 'vitest'
import type { Shape } from '../model/types'
import {
  blinderCells,
  blinderWidth,
  parDiameter,
  pattDiameter,
  PAR_DEFAULT_DIAMETER,
  BLINDER_DEFAULT_WIDTH,
  PATT_DEFAULT_DIAMETER
} from './fixtures'
import { repeatCount } from '../dmx/address'

const blinder = (over: Partial<Shape> = {}): Shape =>
  ({
    id: 'bl1',
    type: 'blinder',
    points: [{ x: 100, y: 200 }],
    display: 'fill',
    strokeWidth: 1,
    diameter: 40,
    ...over
  }) as Shape

describe('blinderCells: the 2×4 unit', () => {
  it('always 8 cells, row-major from the top-left', () => {
    const cells = blinderCells(blinder())
    expect(cells).toHaveLength(8)
    expect(cells[0].x).toBeLessThan(cells[1].x)
    expect(cells[0].y).toBeCloseTo(cells[1].y)
    expect(cells[0].y).toBeLessThan(cells[2].y)
  })
  it('every cell sits inside the housing (w × 2w, centred on the anchor)', () => {
    const cells = blinderCells(blinder())
    for (const c of cells) {
      expect(c.x).toBeGreaterThan(100 - 20)
      expect(c.x).toBeLessThan(100 + 20)
      expect(c.y).toBeGreaterThan(200 - 40)
      expect(c.y).toBeLessThan(200 + 40)
    }
  })
  it('scales with the width dial', () => {
    const small = blinderCells(blinder({ diameter: 20 }))
    const big = blinderCells(blinder({ diameter: 80 }))
    expect(big[0].x).toBeLessThan(small[0].x)
    expect(big[7].y).toBeGreaterThan(small[7].y)
  })
})

describe('stage fixture addressing & defaults', () => {
  it('a blinder is its own 8-instance array', () => {
    expect(repeatCount(blinder())).toBe(8)
  })
  it('PAR and PAT stay single instances', () => {
    expect(repeatCount({ type: 'parlight', points: [{ x: 0, y: 0 }] } as Shape)).toBe(1)
    expect(repeatCount({ type: 'patt', points: [{ x: 0, y: 0 }] } as Shape)).toBe(1)
  })
  it('size getters fall back to the agreed defaults', () => {
    expect(parDiameter({} as Shape)).toBe(PAR_DEFAULT_DIAMETER)
    expect(blinderWidth({} as Shape)).toBe(BLINDER_DEFAULT_WIDTH)
    expect(pattDiameter({} as Shape)).toBe(PATT_DEFAULT_DIAMETER)
  })
})
