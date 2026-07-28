import { describe, it, expect } from 'vitest'
import { outDivOf, sendSize, dividesEvenly } from './out-scale'
import type { Chart } from '../model/types'

const chartWith = (outDiv?: number): Chart =>
  ({ settings: { outDiv } }) as unknown as Chart

describe('送出の縮小率（DECORの解像度）', () => {
  it('未設定・古いチャートは原寸（従来どおり）', () => {
    expect(outDivOf(chartWith(undefined))).toBe(1)
    expect(outDivOf(chartWith(NaN))).toBe(1)
    expect(outDivOf(chartWith(0))).toBe(1)
    expect(outDivOf(chartWith(-2))).toBe(1)
    expect(outDivOf(chartWith(99))).toBe(1) // 極端な値は原寸へ落とす
  })

  it('原寸のときは寸法をまったく触らない', () => {
    expect(sendSize(3840, 1080, 1)).toEqual({ w: 3840, h: 1080 })
    expect(sendSize(3840, 1080, 0)).toEqual({ w: 3840, h: 1080 })
  })

  it('のむさんのチャート 3840×1080 は 1/2・1/3 とも割り切れる', () => {
    expect(sendSize(3840, 1080, 2)).toEqual({ w: 1920, h: 540 })
    expect(sendSize(3840, 1080, 3)).toEqual({ w: 1280, h: 360 })
    expect(dividesEvenly(3840, 1080, 2)).toBe(true)
    expect(dividesEvenly(3840, 1080, 3)).toBe(true)
  })

  it('割り切れないサイズは端数が出ることを見分けられる', () => {
    expect(dividesEvenly(4500, 1080, 2)).toBe(true)
    expect(dividesEvenly(4110, 2380, 3)).toBe(false)
    expect(sendSize(4110, 2380, 3)).toEqual({ w: 1370, h: 793 })
  })

  it('どんな値でも 1px 未満にはしない（退化フレームで出力が死ぬのを防ぐ）', () => {
    expect(sendSize(2, 2, 8)).toEqual({ w: 1, h: 1 })
  })
})
