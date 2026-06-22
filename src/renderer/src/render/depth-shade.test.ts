import { describe, it, expect } from 'vitest'
import { reliefHighpassData, directionalReliefData } from './depth-shade'

const px = (...vals: number[]): Uint8ClampedArray => new Uint8ClampedArray(vals)

describe('reliefHighpassData (深度 → 対称レリーフ・128中立)', () => {
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
    reliefHighpassData(px(180, 0, 0, 255, 60, 0, 0, 255), px(120, 0, 0, 255, 120, 0, 0, 255), out, 2)
    expect(out[0] - 128).toBeLessThan(128 - out[4])
  })

  it('invert で出っぱり/凹みが反転', () => {
    const out = new Uint8ClampedArray(4)
    reliefHighpassData(px(180, 0, 0, 255), px(120, 0, 0, 255), out, 2.5, true)
    expect(out[0]).toBeLessThan(128) // 反転で出っぱりが暗に
  })
})

describe('directionalReliefData (対称彫り＋出っ張りの上の影)', () => {
  it('全て中立(128)なら 128(無変化)', () => {
    const out = new Uint8ClampedArray(4)
    directionalReliefData(px(128, 128, 128, 255), px(128, 128, 128, 255), out)
    expect(out[0]).toBe(128)
    expect(out[3]).toBe(255)
  })

  it('光源側が出っ張り(bpToward>bp)なら、ここは影で暗くなる', () => {
    const out = new Uint8ClampedArray(4)
    // ここは平ら(128) / 光源側は出っ張り(180) → 落ち影
    directionalReliefData(px(128, 0, 0, 255), px(180, 0, 0, 255), out, 8, 5)
    expect(out[0]).toBeLessThan(128)
  })

  it('shadowGain=0 なら影は無く、対称の彫りだけ（出っ張りは明）', () => {
    const out = new Uint8ClampedArray(4)
    // ここが出っ張り(180)・光源側は平ら(128) → 影occ=0、彫りで明
    directionalReliefData(px(180, 0, 0, 255), px(128, 0, 0, 255), out, 8, 0)
    expect(out[0]).toBeGreaterThan(128)
  })

  it('影は darken のみ＝白飛びを増やさない（光源側出っ張りで 128 未満に振れる）', () => {
    const noShadow = new Uint8ClampedArray(4)
    const withShadow = new Uint8ClampedArray(4)
    directionalReliefData(px(128, 0, 0, 255), px(170, 0, 0, 255), noShadow, 8, 0)
    directionalReliefData(px(128, 0, 0, 255), px(170, 0, 0, 255), withShadow, 8, 5)
    expect(withShadow[0]).toBeLessThan(noShadow[0]) // 影を足すと暗くなる方向
  })
})
