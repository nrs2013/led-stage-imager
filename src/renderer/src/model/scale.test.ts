import { describe, it, expect } from 'vitest'
import {
  mmPerPx,
  mmToCanvasPx,
  stageWidthMeters,
  rescaleFixturesToScale,
  countFittableFixtures,
  DEFAULT_STAGE_WIDTH_MM
} from './scale'
import { createChart } from './chart-model'
import type { Chart, Shape } from './types'

// テスト用の最小 Shape
function fx(type: Shape['type'], extra: Partial<Shape> = {}): Shape {
  return {
    id: type,
    type,
    points: [{ x: 100, y: 100 }],
    display: 'fill',
    strokeWidth: 1,
    ...extra
  } as Shape
}

// 校正なし／横◯m だけ変えたチャートを作るヘルパ
function chart(stageWidthMm?: number, canvas = { w: 1500, h: 800 }): Chart {
  return {
    version: 2,
    id: 'c',
    name: 'n',
    canvas,
    layers: [{ id: 'L', name: 'L', underlay: null, visible: true }],
    activeLayerId: 'L',
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

describe('rescaleFixturesToScale（既にある部品を実寸に合わせる）', () => {
  const mmpp = 40000 / 3840 // 40m / 3840px ≈ 10.4167 mm/px

  it('校正前の灯体(生700px)を実寸へ → 67.2px・位置は不変', () => {
    const out = rescaleFixturesToScale([fx('pixelpatt', { diameter: 700 })], mmpp)
    expect(out[0].diameter).toBeCloseTo(67.2, 1)
    expect(out[0].points).toEqual([{ x: 100, y: 100 }]) // 位置はそのまま
  })

  it('PAR300/PAT500/8灯300/ボール球150 も換算', () => {
    const out = rescaleFixturesToScale(
      [
        fx('parlight', { diameter: 300 }),
        fx('patt', { diameter: 500 }),
        fx('blinder', { diameter: 300 }),
        fx('bulb', { diameter: 150 })
      ],
      mmpp
    )
    expect(out[0].diameter).toBeCloseTo(28.8, 1)
    expect(out[1].diameter).toBeCloseTo(48, 1)
    expect(out[2].diameter).toBeCloseTo(28.8, 1)
    expect(out[3].diameter).toBeCloseTo(14.4, 1)
  })

  it('uplight はビーム幅/伸びを換算', () => {
    const out = rescaleFixturesToScale(
      [fx('uplight', { beamW0: 200, beamW1: 600, beamLen: 1000 })],
      mmpp
    )
    expect(out[0].beamW0).toBeCloseTo(19.2, 1)
    expect(out[0].beamW1).toBeCloseTo(57.6, 1)
    expect(out[0].beamLen).toBeCloseTo(96, 1)
  })

  it('手描き系(neon/festoon)は触らない', () => {
    const neon = fx('neon', { diameter: 700, fontSize: 80 })
    const fest = fx('festoon', { diameter: 40 })
    const out = rescaleFixturesToScale([neon, fest], mmpp)
    expect(out[0]).toEqual(neon) // 不変
    expect(out[1]).toEqual(fest)
  })

  it('mmPerPx が不正なら無変更', () => {
    const arr = [fx('pixelpatt', { diameter: 700 })]
    expect(rescaleFixturesToScale(arr, 0)).toEqual(arr)
  })
})

describe('countFittableFixtures', () => {
  it('灯体(diameter系)+uplight だけ数える', () => {
    const shapes = [
      fx('pixelpatt', { diameter: 700 }),
      fx('parlight', { diameter: 300 }),
      fx('uplight'),
      fx('neon'),
      fx('festoon'),
      fx('line')
    ]
    expect(countFittableFixtures(shapes)).toBe(3)
  })
})

describe('新規チャートの既定スケール（部品がやたら大きい問題の解消）', () => {
  it('createChart は横40mに校正済み＝未校正ではない', () => {
    const c = createChart({ w: 1920, h: 1080 })
    expect(c.settings.stageWidthMm).toBe(DEFAULT_STAGE_WIDTH_MM)
    expect(c.settings.stageWidthMm).toBe(40000)
    expect(mmPerPx(c)).not.toBeNull()
  })

  it('パッド700mm はチャート幅の約1.75%で入る（昔は幅700px＝巨大だった）', () => {
    const c = createChart({ w: 1920, h: 1080 })
    const padPx = mmToCanvasPx(c, 700)
    expect(padPx / c.canvas.w).toBeCloseTo(700 / 40000, 6) // = 1.75%
    expect(padPx).toBeLessThan(40) // 700px だった頃の 1/20 以下
  })

  it('canvas解像度が変わっても見かけの比は一定（3840pxでも1.75%）', () => {
    const c = createChart({ w: 3840, h: 1080 })
    expect(mmToCanvasPx(c, 700) / c.canvas.w).toBeCloseTo(700 / 40000, 6)
    expect(mmToCanvasPx(c, 700)).toBeCloseTo(67.2, 1) // 実機で確認した値
  })
})
