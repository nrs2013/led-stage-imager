import { describe, expect, it } from 'vitest'
import { createChart, addShape } from '../model/chart-model'
import { outputLayerIndex, outputShapes } from './page-switch'

function chartWithPages() {
  let chart = createChart({ w: 100, h: 100 })
  const first = chart.layers[0].id
  const second = 'layer-2'
  chart = {
    ...chart,
    layers: [...chart.layers, { id: second, name: 'CHART 2', underlay: null, visible: true }]
  }
  chart = addShape(chart, {
    type: 'line',
    points: [{ x: 0, y: 0 }, { x: 10, y: 0 }],
    strokeWidth: 1,
    layerId: first
  })
  chart = addShape(chart, {
    type: 'line',
    points: [{ x: 0, y: 10 }, { x: 10, y: 10 }],
    strokeWidth: 1,
    layerId: second
  })
  return chart
}

describe('DMXチャート切り替え', () => {
  it('切替OFFなら従来どおり全ページを出す', () => {
    const chart = chartWithPages()
    expect(outputLayerIndex(chart, {})).toBeNull()
    expect(outputShapes(chart, {})).toHaveLength(2)
  })

  it('値0でCHART 1、値1でCHART 2を出す', () => {
    const chart = chartWithPages()
    chart.settings.pageSwitch = { enabled: true, universe: 0, address: 511 }
    const dmx = new Uint8Array(512)
    expect(outputShapes(chart, { 0: dmx })[0].layerId).toBe(chart.layers[0].id)
    dmx[510] = 1
    expect(outputLayerIndex(chart, { 0: dmx })).toBe(1)
    expect(outputShapes(chart, { 0: dmx })[0].layerId).toBe(chart.layers[1].id)
  })

  it('まだ存在しない番号は何も出さない', () => {
    const chart = chartWithPages()
    chart.settings.pageSwitch = { enabled: true, universe: 2, address: 512 }
    const dmx = new Uint8Array(512)
    dmx[511] = 255
    expect(outputShapes(chart, { 2: dmx })).toEqual([])
  })

  it('手動選択中はDMX値より手動番号を優先する', () => {
    const chart = chartWithPages()
    chart.settings.pageSwitch = { enabled: true, universe: 0, address: 1 }
    expect(outputLayerIndex(chart, { 0: new Uint8Array(512) }, 1)).toBe(1)
    expect(outputShapes(chart, {}, 1)[0].layerId).toBe(chart.layers[1].id)
  })
})
