import { describe, it, expect } from 'vitest'
import { mmPerPx, mmToCanvasPx, stageWidthMeters } from './scale'
import type { Chart } from './types'

// 校正なし／横◯m だけ変えたチャートを作るヘルパ
function chart(stageWidthMm?: number, canvas = { w: 1500, h: 800 }): Chart {
  return {
    version: 1,
    id: 'c',
    name: 'n',
    canvas,
    underlay: null,
    shapes: [],
    fixtures: [],
    syphon: { name: 'X' },
    settings: {
      holdOnTimeout: true,
      gamma: false,
      glow: false,
      glowAmount: 14,
      ...(stageWidthMm ? { stageWidthMm } : {})
    }
  }
}

describe('mmPerPx（1pxあたりの実寸mm）', () => {
  it('未校正（stageWidthMm 無し）は null', () => {
    expect(mmPerPx(chart())).toBeNull()
  })
  it('横12m を 1500px に割り当て → 8mm/px', () => {
    expect(mmPerPx(chart(12000))).toBe(8)
  })
  it('canvas.w が 0 なら null（ゼロ割回避）', () => {
    expect(mmPerPx(chart(12000, { w: 0, h: 0 }))).toBeNull()
  })
  it('stageWidthMm が 0/負なら null', () => {
    expect(mmPerPx(chart(0))).toBeNull()
  })
})

describe('mmToCanvasPx（実寸mm→canvas px）', () => {
  it('未校正は mm をそのまま px（従来動作・既存チャート不変）', () => {
    expect(mmToCanvasPx(chart(), 700)).toBe(700)
    expect(mmToCanvasPx(chart(), 150)).toBe(150)
  })
  it('横12m/1500px のとき パッド700mm→87.5px・パー300mm→37.5px', () => {
    const c = chart(12000)
    expect(mmToCanvasPx(c, 700)).toBe(87.5)
    expect(mmToCanvasPx(c, 300)).toBe(37.5)
    expect(mmToCanvasPx(c, 150)).toBe(18.75)
  })
  it('1px=1mm の校正（横=canvas.w mm）なら mm と px が一致', () => {
    const c = chart(1500) // 1500px に 1500mm = 1.5m
    expect(mmToCanvasPx(c, 700)).toBe(700)
  })
})

describe('stageWidthMeters（表示用）', () => {
  it('未校正は null', () => {
    expect(stageWidthMeters(chart())).toBeNull()
  })
  it('12000mm → 12m', () => {
    expect(stageWidthMeters(chart(12000))).toBe(12)
  })
})
