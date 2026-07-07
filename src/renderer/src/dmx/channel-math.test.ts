import { describe, it, expect } from 'vitest'
import { fixtureColor, channelCount, beamPose } from './channel-math'
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
    expect(channelCount('rgbw4')).toBe(4)
    expect(channelCount('beam6')).toBe(6)
    expect(channelCount('beam8')).toBe(8)
  })
})

describe('fixtureColor', () => {
  it('rgbw4: W が白として全色に足される（4ch・調光chなし・現場の照明チーム向け 2026-07-07）', () => {
    // R=100 G=0 B=0 W=50 → [150, 50, 50]（Wは全色に加算・255でクランプ）
    const data = uni({ 0: 100, 1: 0, 2: 0, 3: 50 })
    const fx = { id: 'f', shapeId: 's', universe: 0, start: 1, mode: 'rgbw4' as const }
    expect(fixtureColor(fx, data, false)).toEqual([150, 50, 50])
    // W 全開のみ → 真っ白
    const w = uni({ 0: 0, 1: 0, 2: 0, 3: 255 })
    expect(fixtureColor(fx, w, false)).toEqual([255, 255, 255])
  })

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
  it('beam6 は先頭3ch=RGB素通し（既存仕様を固定＝壊していないこと）', () => {
    const data = uni({ 0: 10, 1: 20, 2: 30 })
    expect(fixtureColor(fx('beam6', 1), data, false)).toEqual([10, 20, 30])
  })
  it('beam8 は Dimmer(+2)×RGB(+4..+6)', () => {
    const data = uni({ 2: 128, 4: 200, 5: 100, 6: 0 }) // Dim128, R200 G100 B0
    const [r, g, b] = fixtureColor(fx('beam8', 1), data, false)
    expect(r).toBe(Math.round((200 * 128) / 255))
    expect(g).toBe(Math.round((100 * 128) / 255))
    expect(b).toBe(0)
  })
})

describe('beamPose (DMX128=中心)', () => {
  it('beam6: Pan=i+3 / Tilt=i+4 / Zoom=i+5', () => {
    const data = uni({ 3: 255, 4: 128, 5: 255 })
    expect(beamPose(fx('beam6', 1), data)).toEqual({ pan: 1, tilt: 0, zoom: 1 })
  })
  it('beam8: Pan=i+0 / Tilt=i+1 / Zoom=i+7', () => {
    const data = uni({ 0: 255, 1: 128, 7: 255 })
    expect(beamPose(fx('beam8', 1), data)).toEqual({ pan: 1, tilt: 0, zoom: 1 })
  })
  it('ビーム以外は中心姿勢', () => {
    expect(beamPose(fx('rgb', 1), uni({ 0: 255 }))).toEqual({ pan: 0, tilt: 0, zoom: 0 })
  })
})
