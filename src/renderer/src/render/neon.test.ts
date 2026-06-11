import { describe, expect, it } from 'vitest'
import type { Shape } from '../model/types'
import {
  neonChars,
  neonCharCount,
  layoutNeon,
  neonBounds,
  neonGlyphCenter,
  neonGlowAmount,
  NEON_FONTS
} from './neon'
import { repeatCount, addressAt } from '../dmx/address'

const neonShape = (over: Partial<Shape> = {}): Shape =>
  ({
    id: 'n1',
    type: 'neon',
    points: [{ x: 100, y: 50 }],
    display: 'fill',
    strokeWidth: 1,
    text: 'CAFE BAR',
    fontId: 'bebas-tube',
    fontSize: 20,
    ...over
  }) as Shape

describe('neonChars / neonCharCount', () => {
  it('skips whitespace — a space is a gap, not a tube', () => {
    expect(neonChars('CAFE BAR')).toEqual(['C', 'A', 'F', 'E', 'B', 'A', 'R'])
    expect(neonChars(' A\tB ')).toEqual(['A', 'B'])
  })
  it('counts astral code points (emoji etc.) as one tube', () => {
    expect(neonChars('🍺B')).toEqual(['🍺', 'B'])
  })
  it('never reports 0 (keeps the address maths sane)', () => {
    expect(neonCharCount('')).toBe(1)
    expect(neonCharCount('   ')).toBe(1)
    expect(neonCharCount('OPEN')).toBe(4)
  })
})

describe('layoutNeon (deterministic fallback metrics in node)', () => {
  it('lays one glyph per non-space char with monotonic x', () => {
    const L = layoutNeon(neonShape())
    expect(L.glyphs.map((g) => g.ch)).toEqual(['C', 'A', 'F', 'E', 'B', 'A', 'R'])
    for (let i = 1; i < L.glyphs.length; i++) {
      expect(L.glyphs[i].x).toBeGreaterThan(L.glyphs[i - 1].x)
    }
  })
  it('spaces advance the pen without becoming glyphs', () => {
    const L = layoutNeon(neonShape())
    // fallback: letter = 0.6*size, space = 0.3*size → 'B' starts after 4 letters + 1 space
    expect(L.glyphs[4].ch).toBe('B')
    expect(L.glyphs[4].x).toBeCloseTo(4 * 12 + 6)
    expect(L.width).toBeCloseTo(7 * 12 + 6)
  })
})

describe('neonBounds / neonGlyphCenter', () => {
  it('centres the sign box on points[0] (the anchor is the sign centre)', () => {
    const b = neonBounds(neonShape())
    expect(b.x + b.w / 2).toBeCloseTo(100)
    expect(b.y + b.h / 2).toBeCloseTo(50)
  })
  it('tube #i sits at its glyph centre on the anchor row', () => {
    const c0 = neonGlyphCenter(neonShape(), 0)
    expect(c0.x).toBeCloseTo(100 - (7 * 12 + 6) / 2 + 6)
    expect(c0.y).toBeCloseTo(50)
  })
  it('out-of-range instance falls back to the anchor', () => {
    expect(neonGlyphCenter(neonShape(), 99)).toEqual({ x: 100, y: 50 })
  })
})

describe('repeatCount: a neon sign is its own array (1 tube = 1 instance)', () => {
  it('counts non-space characters', () => {
    expect(repeatCount(neonShape())).toBe(7)
    expect(repeatCount(neonShape({ text: 'OPEN' }))).toBe(4)
  })
  it('keeps ordinary repeat arrays untouched', () => {
    expect(repeatCount({ type: 'rect', repeat: { count: 5, dx: 10, dy: 0 } } as Shape)).toBe(5)
    expect(repeatCount({ type: 'rect' } as Shape)).toBe(1)
  })
})

describe('addressAt: 文字間隔 (step) semantics', () => {
  it('default step = channel width → per-character addresses', () => {
    expect(addressAt(0, 1, 'rgb', undefined, 2)).toEqual({ universe: 0, start: 7 })
  })
  it('explicit step 0 = whole sign on one fader (一斉)', () => {
    expect(addressAt(0, 10, 'rgb', 0, 0)).toEqual({ universe: 0, start: 10 })
    expect(addressAt(0, 10, 'rgb', 0, 6)).toEqual({ universe: 0, start: 10 })
  })
  it('still rolls over the 512 boundary', () => {
    expect(addressAt(0, 511, 'rgb', 3, 1)).toEqual({ universe: 1, start: 2 })
  })
})

describe('font registry & glow dial', () => {
  it('has the agreed 8-font line-up with unique ids', () => {
    expect(NEON_FONTS).toHaveLength(8)
    expect(new Set(NEON_FONTS.map((f) => f.id)).size).toBe(8)
  })
  it('clamps the glow dial to 0–100 with a sensible default', () => {
    expect(neonGlowAmount({} as Shape)).toBe(55)
    expect(neonGlowAmount({ neonGlow: -5 } as Shape)).toBe(0)
    expect(neonGlowAmount({ neonGlow: 250 } as Shape)).toBe(100)
  })
})
