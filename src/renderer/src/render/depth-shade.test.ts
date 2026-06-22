import { describe, it, expect } from 'vitest'
import { reliefHighpassData } from './depth-shade'

const px = (...vals: number[]): Uint8ClampedArray => new Uint8ClampedArray(vals)

describe('reliefHighpassData (深度 → 立体感レリーフ・128中立)', () => {
  it('平ら(深度=ぼかし)は 128(無変化)', () => {
    const out = new Uint8ClampedArray(4)
    reliefHighpassData(px(100, 100, 100, 255), px(100, 100, 100, 255), out, 2.5)
    expect(out[0]).toBe(128)
    expect(out[3]).toBe(255)
  })

  it('出っぱり(深度>ぼかし)は明(>128)、凹み(深度<ぼかし)は暗(<128)', () => {
    const out = new Uint8ClampedArray(8)
    reliefHighpassData(
      px(180, 0, 0, 255, 60, 0, 0, 255),
      px(120, 0, 0, 255, 120, 0, 0, 255),
      out,
      2.5
    )
    expect(out[0]).toBeGreaterThan(128) // 出っぱり=明
    expect(out[4]).toBeLessThan(128) // 凹み=暗
  })

  it('highlightScale=1 なら明暗は 128 対称', () => {
    const out = new Uint8ClampedArray(8)
    reliefHighpassData(
      px(150, 0, 0, 255, 90, 0, 0, 255),
      px(120, 0, 0, 255, 120, 0, 0, 255),
      out,
      1,
      false,
      1
    )
    expect(out[0] - 128).toBe(128 - out[4])
  })

  it('既定は明側(出っ張り)を控えめにして白飛びを防ぐ（明側の振れ < 暗側の振れ）', () => {
    const out = new Uint8ClampedArray(8)
    reliefHighpassData(
      px(180, 0, 0, 255, 60, 0, 0, 255),
      px(120, 0, 0, 255, 120, 0, 0, 255),
      out,
      2
    ) // 既定 highlightScale=0.55
    expect(out[0] - 128).toBeLessThan(128 - out[4])
  })

  it('invert で出っぱり/凹みが反転', () => {
    const out = new Uint8ClampedArray(4)
    reliefHighpassData(px(180, 0, 0, 255), px(120, 0, 0, 255), out, 2.5, true)
    expect(out[0]).toBeLessThan(128) // 反転で出っぱりが暗に
  })
})
