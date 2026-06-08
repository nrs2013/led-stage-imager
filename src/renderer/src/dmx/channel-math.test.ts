import { describe, it, expect } from 'vitest'
import { fixtureColor, channelCount } from './channel-math'
import type { Fixture } from '../model/types'

const uni = (over: Record<number, number>): Uint8Array => {
  const a = new Uint8Array(512)
  for (const k in over) a[+k] = over[k]
  return a
}
const fx = (mode: Fixture['mode'], start: number, extra: Partial<Fixture> = {}): Fixture => ({
  id: 'f',
  shapeId: 's',
  universe: 0,
  start,
  mode,
  ...extra
})

describe('channelCount', () => {
  it('maps modes to channel counts', () => {
    expect(channelCount('rgb')).toBe(3)
    expect(channelCount('rgbdim')).toBe(4)
    expect(channelCount('dim')).toBe(1)
    expect(channelCount('rgbw')).toBe(5)
  })
})

describe('fixtureColor', () => {
  it('rgb mode passes channels straight through (start is 1-based)', () => {
    const data = uni({ 0: 10, 1: 20, 2: 30 }) // addresses 1,2,3 -> indices 0,1,2
    expect(fixtureColor(fx('rgb', 1), data, false)).toEqual([10, 20, 30])
  })
  it('rgbdim multiplies rgb by dim/255', () => {
    const data = uni({ 0: 200, 1: 100, 2: 0, 3: 128 }) // R200 G100 B0 Dim128
    const [r, g, b] = fixtureColor(fx('rgbdim', 1), data, false)
    expect(r).toBe(Math.round((200 * 128) / 255))
    expect(g).toBe(Math.round((100 * 128) / 255))
    expect(b).toBe(0)
  })
  it('dim mode scales the fixed color', () => {
    const data = uni({ 0: 255 }) // dim full
    const f = fx('dim', 1, { fixedColor: [0, 255, 0] } as Partial<Fixture>)
    expect(fixtureColor(f, data, false)).toEqual([0, 255, 0])
  })
})
