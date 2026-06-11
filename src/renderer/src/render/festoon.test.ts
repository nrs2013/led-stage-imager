import { describe, expect, it } from 'vitest'
import type { Shape } from '../model/types'
import {
  festoonPointAt,
  festoonBulbs,
  festoonCount,
  festoonLength,
  festoonSag,
  festoonGlowScale
} from './festoon'
import { repeatCount } from '../dmx/address'

const string = (over: Partial<Shape> = {}): Shape =>
  ({
    id: 'f1',
    type: 'festoon',
    points: [
      { x: 100, y: 100 },
      { x: 500, y: 120 }
    ],
    display: 'fill',
    strokeWidth: 1,
    sagPct: 12,
    bulbPitch: 30,
    diameter: 4,
    ...over
  }) as Shape

describe('festoon curve: the sag', () => {
  it('sag 0 = a dead-straight wire (every point on the chord)', () => {
    const sh = string({ sagPct: 0 })
    const m = festoonPointAt(sh, 0.5)
    expect(m.x).toBeCloseTo(300)
    expect(m.y).toBeCloseTo(110)
  })
  it('the belly hangs BELOW the chord, deepest at the middle', () => {
    const sh = string()
    const chordMidY = 110
    const mid = festoonPointAt(sh, 0.5)
    const quarter = festoonPointAt(sh, 0.25)
    expect(mid.y).toBeGreaterThan(chordMidY)
    expect(mid.y - chordMidY).toBeGreaterThan(quarter.y - (100 + 20 * 0.25))
  })
  it('sag scales with the span (a % feel, not absolute px)', () => {
    const short = festoonPointAt(string({ points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] }), 0.5)
    const long = festoonPointAt(string({ points: [{ x: 0, y: 0 }, { x: 400, y: 0 }] }), 0.5)
    expect(long.y).toBeCloseTo(short.y * 4)
  })
})

describe('festoon bulbs: pitch-driven count, equal arc spacing', () => {
  it('both ends always carry a bulb', () => {
    const sh = string()
    const bulbs = festoonBulbs(sh)
    expect(bulbs[0].x).toBeCloseTo(100, 0)
    expect(bulbs[bulbs.length - 1].x).toBeCloseTo(500, 0)
  })
  it('a tighter pitch packs more bulbs; a longer wire grows the count', () => {
    const base = festoonCount(string())
    expect(festoonCount(string({ bulbPitch: 15 }))).toBeGreaterThan(base)
    expect(
      festoonCount(string({ points: [{ x: 100, y: 100 }, { x: 900, y: 120 }] }))
    ).toBeGreaterThan(base)
  })
  it('neighbouring bulbs sit at near-equal distances along the wire', () => {
    const bulbs = festoonBulbs(string())
    const gaps: number[] = []
    for (let i = 1; i < bulbs.length; i++) {
      gaps.push(Math.hypot(bulbs[i].x - bulbs[i - 1].x, bulbs[i].y - bulbs[i - 1].y))
    }
    const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length
    for (const g of gaps) expect(Math.abs(g - avg)).toBeLessThan(avg * 0.15)
  })
  it('the wire is longer than the straight chord once it sags', () => {
    expect(festoonLength(string({ sagPct: 30 }))).toBeGreaterThan(
      Math.hypot(400, 20) + 1
    )
  })
})

describe('festoon addressing: one bulb = one fixture', () => {
  it('repeatCount equals the bulb count', () => {
    const sh = string()
    expect(repeatCount(sh)).toBe(festoonCount(sh))
    expect(repeatCount(sh)).toBeGreaterThan(2)
  })
})

describe('dials', () => {
  it('sag clamps to 0–60%', () => {
    expect(festoonSag({ sagPct: -5 } as Shape)).toBe(0)
    expect(festoonSag({ sagPct: 200 } as Shape)).toBe(60)
  })
  it('glow dial: 55 = the ball bulb standard (scale 1)', () => {
    expect(festoonGlowScale({} as Shape)).toBeCloseTo(1)
    expect(festoonGlowScale({ neonGlow: 110 } as Shape)).toBeCloseTo(100 / 55)
    expect(festoonGlowScale({ neonGlow: 0 } as Shape)).toBeCloseTo(0.05)
  })
})
