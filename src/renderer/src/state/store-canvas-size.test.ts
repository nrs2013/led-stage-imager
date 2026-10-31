import { beforeEach, describe, expect, it } from 'vitest'
import { activeLayerOf, useStore } from './store'
import { addShape, createChart } from '../model/chart-model'
import { parseChart, serializeChart } from '../io/chart-file'

describe('wide chart canvas', () => {
  beforeEach(() => {
    const chart = addShape(createChart({ w: 1920, h: 1080 }), {
      id: 'edge', type: 'rect', points: [{ x: 6200, y: 1600 }, { x: 6300, y: 1700 }]
    })
    chart.fixtures = [{ id: 'fixture', shapeId: 'edge', universe: 0, start: 1, mode: 'rgb' }]
    useStore.getState().setChart(chart)
  })

  it('imports and saves a 6400 × 1800 chart without scaling geometry or Patch', () => {
    const before = useStore.getState().chart
    useStore.getState().applyChartImage('data:image/png;base64,test', 6400, 1800)
    const restored = parseChart(serializeChart(useStore.getState().chart))
    expect(restored.canvas).toEqual({ w: 6400, h: 1800 })
    expect(restored.shapes).toEqual(before.shapes)
    expect(restored.fixtures).toEqual(before.fixtures)
    expect(activeLayerOf(restored).underlay?.dataUrl).toBe('data:image/png;base64,test')
  })

  it('restoring canvas size preserves content and can be undone', () => {
    useStore.getState().applyChartImage('data:image/png;base64,test', 6400, 1800)
    useStore.getState().setCanvasSize(3200, 900)
    const before = useStore.getState().chart
    useStore.setState({ history: [], future: [], histTag: null })
    useStore.getState().setCanvasSize(6400, 1800)
    const after = useStore.getState().chart
    expect(after.canvas).toEqual({ w: 6400, h: 1800 })
    expect(after.shapes).toBe(before.shapes)
    expect(after.fixtures).toBe(before.fixtures)
    expect(after.layers).toBe(before.layers)
    useStore.getState().undo()
    expect(useStore.getState().chart).toEqual(before)
  })
})
