import { expect, it } from 'vitest'
import { useStore, activeLayerOf } from './store'
import { createChart } from '../model/chart-model'
import { parseChart, serializeChart } from '../io/chart-file'
it('adds a detected page at original size as one undo step and keeps source and mask polarity on disk', () => {
  const initial = createChart({ w: 1920, h: 1080 })
  useStore.getState().setChart(initial)
  useStore
    .getState()
    .addLayer({
      canvas: { w: 6400, h: 1800 },
      underlay: {
        dataUrl: 'processed',
        sourceDataUrl: 'original',
        opacity: 1,
        visible: true,
        mask: { enabled: true, invert: true },
        ledLayout: { width: 6400, height: 1800, regions: [{ x: 0, y: 0, w: 1152, h: 1728 }] }
      }
    })
  useStore.getState().setLedGrid({ spacing: 20 })
  const restored = parseChart(serializeChart(useStore.getState().chart))
  expect(restored.canvas).toEqual({ w: 6400, h: 1800 })
  expect(restored.settings.ledGrid?.spacing).toBe(20)
  expect(activeLayerOf(restored).underlay?.sourceDataUrl).toBe('original')
  expect(activeLayerOf(restored).underlay?.mask?.invert).toBe(true)
  useStore.getState().undo()
  useStore.getState().undo()
  expect(useStore.getState().chart).toEqual(initial)
})
it('imports editable vectors without changing existing geometry/Patch, and undoes as one operation', () => {
  const initial = createChart({ w: 6400, h: 1800 })
  useStore.getState().setChart(initial)
  useStore.getState().importVectorShapes([
    {
      type: 'line',
      points: [
        { x: 10, y: 20 },
        { x: 30, y: 40 }
      ],
      display: 'stroke',
      strokeWidth: 1
    }
  ])
  const state = useStore.getState()
  expect(state.chart.shapes).toHaveLength(1)
  expect(state.chart.fixtures).toEqual(initial.fixtures)
  expect(state.selectedIds).toEqual([state.chart.shapes[0].id])
  state.undo()
  expect(useStore.getState().chart).toEqual(initial)
})
