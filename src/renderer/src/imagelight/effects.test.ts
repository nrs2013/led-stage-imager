import { describe, it, expect } from 'vitest'
import {
  chaseK,
  strobeAllK,
  breathK,
  fireK,
  waveK,
  boltK,
  zoomPulseK,
  rainbowColor,
  colorChaseColor,
  searchTilt,
  defaultFxp
} from './effects'
import { COLORS } from './colors'

const P = defaultFxp()

describe('effects — 明るさ系Kは有界', () => {
  it('chaseK は 0..1', () => {
    for (let ms = 0; ms < 4000; ms += 137) {
      const k = chaseK(P.chase, ms, 2)
      expect(k).toBeGreaterThanOrEqual(0)
      expect(k).toBeLessThanOrEqual(1.0001)
    }
  })

  it('strobeAll は 0 か 1 のみ', () => {
    const seen = new Set<number>()
    for (let ms = 0; ms < 2000; ms += 11) seen.add(strobeAllK(P.strobe, ms))
    expect([...seen].sort()).toEqual([0, 1])
  })

  it('breathK は深さの範囲内（(1-d)..1）', () => {
    const d = P.breath.depth / 100
    for (let ms = 0; ms < 10000; ms += 97) {
      const k = breathK(P.breath, ms)
      expect(k).toBeGreaterThanOrEqual(1 - d - 1e-6)
      expect(k).toBeLessThanOrEqual(1 + 1e-6)
    }
  })

  it('fireK は 0.05..1 にクランプ', () => {
    for (let ms = 0; ms < 5000; ms += 53) {
      const k = fireK(P.fire, ms, 3)
      expect(k).toBeGreaterThanOrEqual(0.05)
      expect(k).toBeLessThanOrEqual(1)
    }
  })

  it('waveK は 0.25..1', () => {
    for (let ms = 0; ms < 8000; ms += 71) {
      const k = waveK(P.wave, ms, 1)
      expect(k).toBeGreaterThanOrEqual(0.25 - 1e-6)
      expect(k).toBeLessThanOrEqual(1 + 1e-6)
    }
  })

  it('boltK は雷の瞬間だけ 1 を超える（残りは 1）', () => {
    let maxK = 0
    for (let ms = 0; ms < 20000; ms += 31) maxK = Math.max(maxK, boltK(P.bolt, ms))
    expect(maxK).toBeGreaterThan(1) // どこかで必ず光る
  })

  it('zoomPulseK は 0.3 以上', () => {
    for (let ms = 0; ms < 8000; ms += 67) {
      expect(zoomPulseK(P.zoompulse, ms)).toBeGreaterThanOrEqual(0.3 - 1e-6)
    }
  })
})

describe('effects — 色系', () => {
  it('rainbowColor は 0..255 の RGB を返す', () => {
    const c = rainbowColor(P.rainbow, 1234, 0)
    expect(c).toHaveLength(3)
    for (const v of c) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(255)
    }
  })

  it('colorChaseColor blend=0 は固定パレットの1色を返す', () => {
    const palette = COLORS.map((c) => c.rgb)
    const c = colorChaseColor({ speed: 1, blend: 0 }, palette, 0, 0)
    expect(c).toEqual(palette[0])
  })
})

describe('searchTilt', () => {
  it('search OFF 相当（width 0）なら基準tiltのまま', () => {
    const t = searchTilt(
      10,
      { speed: 0.3, width: 0 },
      { vari: 0 },
      false,
      { phase: 0, speedK: 1, widthK: 1 },
      500
    )
    expect(t).toBeCloseTo(10, 6)
  })

  it('±width の範囲で振れる', () => {
    let lo = Infinity
    let hi = -Infinity
    for (let ms = 0; ms < 10000; ms += 50) {
      const t = searchTilt(
        0,
        { speed: 0.3, width: 12 },
        { vari: 0 },
        false,
        { phase: 0, speedK: 1, widthK: 1 },
        ms
      )
      lo = Math.min(lo, t)
      hi = Math.max(hi, t)
    }
    expect(hi).toBeLessThanOrEqual(12 + 1e-6)
    expect(lo).toBeGreaterThanOrEqual(-12 - 1e-6)
  })
})
