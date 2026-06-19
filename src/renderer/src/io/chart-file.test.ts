import { describe, it, expect } from 'vitest'
import { serializeChart, parseChart } from './chart-file'
import { createChart, addShape } from '../model/chart-model'

describe('chart-file', () => {
  it('round-trips a chart through serialize/parse', () => {
    let c = createChart({ w: 1920, h: 1080 })
    c = addShape(c, { type: 'ellipse', points: [{ x: 5, y: 5 }, { x: 15, y: 15 }] })
    c.layers[0].underlay = { dataUrl: 'data:image/png;base64,AAAA', opacity: 0.5, visible: true }
    const parsed = parseChart(serializeChart(c))
    expect(parsed).toEqual(c)
  })
  it('throws a clear error on malformed json', () => {
    expect(() => parseChart('{not json')).toThrow(/invalid chart file/i)
  })
  it('rejects an unsupported version', () => {
    expect(() => parseChart(JSON.stringify({ version: 99 }))).toThrow(/version/i)
  })
  it('migrates a v1 chart: underlay and shapes wrapped into one layer', () => {
    const v1 = {
      version: 1,
      id: 'chart_x',
      name: 'Old Show',
      canvas: { w: 100, h: 50 },
      underlay: { dataUrl: 'data:image/png;base64,BBBB', opacity: 0.7, visible: true },
      shapes: [
        { id: 's1', type: 'bulb', points: [{ x: 1, y: 2 }], display: 'fill', strokeWidth: 1 }
      ],
      fixtures: [],
      syphon: { name: 'DECOR STUDIO' },
      settings: { holdOnTimeout: true, gamma: false, glow: false, glowAmount: 14 }
    }
    const c = parseChart(JSON.stringify(v1))
    expect(c.version).toBe(2)
    expect(c.layers).toHaveLength(1)
    expect(c.layers[0].underlay?.dataUrl).toBe('data:image/png;base64,BBBB')
    expect(c.layers[0].visible).toBe(true)
    expect(c.activeLayerId).toBe(c.layers[0].id)
    expect(c.shapes[0].layerId).toBe(c.layers[0].id)
    expect('underlay' in c).toBe(false)
  })
  it('migrates a v1 chart with no underlay', () => {
    const c = parseChart(
      JSON.stringify({
        version: 1,
        id: 'c',
        name: 'n',
        canvas: { w: 1, h: 1 },
        underlay: null,
        shapes: [],
        fixtures: [],
        syphon: { name: 's' },
        settings: { holdOnTimeout: true, gamma: false, glow: false, glowAmount: 14 }
      })
    )
    expect(c.layers[0].underlay).toBeNull()
    expect(c.layers[0].name).toBe('CHART 1')
  })
  it('fills missing family on load: old parts→decor, stage fixtures→light', () => {
    const v2 = {
      version: 2,
      id: 'c',
      name: 'n',
      canvas: { w: 10, h: 10 },
      layers: [{ id: 'l1', name: 'CHART 1', underlay: null, visible: true }],
      activeLayerId: 'l1',
      shapes: [
        { id: 'a', type: 'bulb', layerId: 'l1', points: [{ x: 0, y: 0 }], display: 'fill', strokeWidth: 1 },
        { id: 'b', type: 'uplight', layerId: 'l1', points: [{ x: 0, y: 0 }], display: 'fill', strokeWidth: 1 },
        { id: 'c', type: 'movinghead', layerId: 'l1', points: [{ x: 0, y: 0 }], display: 'fill', strokeWidth: 1 }
      ],
      fixtures: [],
      syphon: { name: 's' },
      settings: { holdOnTimeout: true, gamma: false, glow: false, glowAmount: 14 }
    }
    const c = parseChart(JSON.stringify(v2))
    expect(c.shapes[0].family).toBe('decor') // bulb = 電飾
    expect(c.shapes[1].family).toBe('light') // uplight = 照明
    expect(c.shapes[2].family).toBe('light') // movinghead = 照明
  })
  it('keeps family through serialize/parse round-trip', () => {
    let c = createChart({ w: 100, h: 100 })
    c = addShape(c, { type: 'uplight', points: [{ x: 1, y: 1 }] })
    expect(c.shapes[0].family).toBe('light')
    const parsed = parseChart(serializeChart(c))
    expect(parsed.shapes[0].family).toBe('light')
  })
})
