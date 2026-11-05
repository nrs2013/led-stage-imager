import { describe, expect, it } from 'vitest'
import { extractChartPage, moveChartPage } from './chart-pages'
import { parseChart, serializeChart } from '../io/chart-file'
import type { Chart, Shape } from './types'

const shape = (id: string, layerId?: string): Shape =>
  ({ id, type: 'line', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }], strokeWidth: 2, layerId, fixtureId: `fx_${id}` }) as Shape

const chart = (): Chart =>
  ({
    version: 2,
    id: 'c',
    name: 'show',
    canvas: { w: 100, h: 50 },
    layers: [
      { id: 'a', name: 'A', underlay: null, visible: true },
      { id: 'b', name: 'B', underlay: { dataUrl: 'data:x', opacity: 1, visible: true } as never, visible: true },
      { id: 'c', name: 'C', underlay: null, visible: true }
    ],
    activeLayerId: 'a',
    shapes: [shape('s1'), shape('s2', 'b'), shape('s3', 'c')],
    fixtures: [
      { id: 'fx_s1', shapeId: 's1', universe: 0, start: 1, mode: 'rgb' },
      { id: 'fx_s2', shapeId: 's2', universe: 1, start: 4, mode: 'rgb' },
      { id: 'fx_s3', shapeId: 's3', universe: 2, start: 7, mode: 'rgb' }
    ],
    syphon: { name: 'x' },
    settings: { holdOnTimeout: true, gamma: false, glow: false, glowAmount: 0, pageSwitch: { enabled: true, universe: 0, address: 1 } }
  }) as unknown as Chart

describe('moveChartPage', () => {
  it('順番を入れ替え、図形とPatchはそのまま', () => {
    const out = moveChartPage(chart(), 'c', 0)
    expect(out.layers.map((l) => l.id)).toEqual(['c', 'a', 'b'])
    expect(out.fixtures).toEqual(chart().fixtures)
    expect(out.shapes).toHaveLength(3)
  })
  it('先頭ページを動かしても、layerId無しの古い図形は元のページに残る', () => {
    const out = moveChartPage(chart(), 'a', 2)
    expect(out.layers.map((l) => l.id)).toEqual(['b', 'c', 'a'])
    expect(out.shapes.find((s) => s.id === 's1')?.layerId).toBe('a')
  })
  it('範囲外・同じ位置・存在しないidは変えない', () => {
    const c = chart()
    expect(moveChartPage(c, 'a', 0)).toBe(c)
    expect(moveChartPage(c, 'zz', 1)).toBe(c)
    expect(moveChartPage(c, 'a', 99).layers.map((l) => l.id)).toEqual(['b', 'c', 'a'])
  })
})

describe('extractChartPage', () => {
  it('1枚だけを背景・図形・Patchごと持ち出し、元は変えない', () => {
    const c = chart()
    const out = extractChartPage(c, 'b')
    expect(out.layers).toHaveLength(1)
    expect(out.layers[0].underlay).toEqual(c.layers[1].underlay)
    expect(out.shapes.map((s) => s.id)).toEqual(['s2'])
    expect(out.fixtures.map((f) => f.id)).toEqual(['fx_s2'])
    expect(out.activeLayerId).toBe('b')
    expect(out.name).toBe('B')
    expect(out.settings.pageSwitch?.enabled).toBe(false)
    expect(c.layers).toHaveLength(3)
    expect(c.settings.pageSwitch?.enabled).toBe(true)
  })
  it('先頭ページの layerId 無し図形も含める', () => {
    const out = extractChartPage(chart(), 'a')
    expect(out.shapes.map((s) => s.id)).toEqual(['s1'])
    expect(out.shapes[0].layerId).toBe('a')
  })
  it('書き出したファイルはそのまま開ける', () => {
    const back = parseChart(serializeChart(extractChartPage(chart(), 'c')))
    expect(back.layers.map((l) => l.id)).toEqual(['c'])
    expect(back.fixtures).toHaveLength(1)
  })
  it('存在しないページはエラー', () => {
    expect(() => extractChartPage(chart(), 'zz')).toThrow()
  })
})
