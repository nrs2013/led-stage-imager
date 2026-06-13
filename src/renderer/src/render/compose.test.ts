import { describe, it, expect } from 'vitest'
import { composeColorRatio, toneRatioPixel } from './compose'

describe('toneRatioPixel — 色比保持トーン', () => {
  it('白アルベドに強いアンバー光 → 白へ飛ばず色比（彩度）が残る', () => {
    const out: [number, number, number] = [0, 0, 0]
    // white albedo (1,1,1) × full amber light (1, 0.66, 0.28)
    toneRatioPixel(1, 1, 1, 1, 0.66, 0.28, 2.2, out)
    // R はほぼ飽和、G/B は段違いに低い＝アンバーのまま（チャンネル独立clipなら全部255で白）
    expect(out[0]).toBeGreaterThan(0.9)
    expect(out[1]).toBeLessThan(out[0] * 0.85)
    expect(out[2]).toBeLessThan(out[1])
  })

  it('白光は白のまま（色比1:1:1を保つ）', () => {
    const out: [number, number, number] = [0, 0, 0]
    toneRatioPixel(1, 1, 1, 1, 1, 1, 2.2, out)
    expect(out[0]).toBeCloseTo(out[1], 6)
    expect(out[1]).toBeCloseTo(out[2], 6)
  })

  it('光ゼロ → 完全な闇（0,0,0）', () => {
    const out: [number, number, number] = [9, 9, 9]
    toneRatioPixel(0.85, 0.85, 0.85, 0, 0, 0, 2.2, out)
    expect(out).toEqual([0, 0, 0])
  })

  it('強くするほど明るい（単調増加）。頂点はReinhard漸近線1/0.45で頭打ち→255でクリップ', () => {
    const a: [number, number, number] = [0, 0, 0]
    const b: [number, number, number] = [0, 0, 0]
    toneRatioPixel(1, 1, 1, 0.5, 0.5, 0.5, 2.2, a)
    toneRatioPixel(1, 1, 1, 1, 1, 1, 2.2, b)
    expect(b[0]).toBeGreaterThan(a[0]) // 強い方が明るい
    expect(b[0]).toBeLessThanOrEqual(1 / 0.45 + 1e-6) // 漸近線で有界（暴れない）
    // 画素配列では 255 にクランプ（白光×白アルベド＝白）
    const out = new Uint8ClampedArray([0, 0, 0, 0])
    composeColorRatio(
      new Uint8ClampedArray([255, 255, 255, 255]),
      new Uint8ClampedArray([255, 255, 255, 255]),
      out
    )
    expect(out[0]).toBe(255)
  })
})

describe('composeColorRatio — 写真ボックス合成', () => {
  const px = (r: number, g: number, b: number, a: number): Uint8ClampedArray =>
    new Uint8ClampedArray([r, g, b, a])

  it('写真の外（albedo A=0）は透明な闇のまま', () => {
    const out = px(5, 5, 5, 5)
    composeColorRatio(px(200, 200, 200, 0), px(255, 255, 255, 255), out)
    expect([...out]).toEqual([0, 0, 0, 0])
  })

  it('写真の中ではアルベドのアルファを引き継ぐ', () => {
    const out = px(0, 0, 0, 0)
    composeColorRatio(px(217, 217, 217, 255), px(255, 128, 40, 255), out)
    expect(out[3]).toBe(255)
    expect(out[0]).toBeGreaterThan(out[1]) // amber ratio preserved
    expect(out[1]).toBeGreaterThan(out[2])
  })

  it('暗部トー（tone大）は全体を暗く沈める', () => {
    const bright = px(0, 0, 0, 0)
    const dark = px(0, 0, 0, 0)
    composeColorRatio(px(217, 217, 217, 255), px(120, 120, 120, 255), bright, 0)
    composeColorRatio(px(217, 217, 217, 255), px(120, 120, 120, 255), dark, 0.85)
    expect(dark[0]).toBeLessThan(bright[0])
  })
})
