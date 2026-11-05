import { expect, it } from 'vitest'
import { createChart } from './chart-model'
import { prepareChartImport } from './import-chart'
import { useStore } from '../state/store'

it('imports every drawing and patch from non-draft pages, and preserves the destination background', () => {
  const current = createChart({ w: 400, h: 200 })
  current.layers[0].underlay = { dataUrl: 'base', visible: true, opacity: 1 }
  const source = createChart({ w: 100, h: 100 })
  source.layers.push({ id: 'second', name: 'Second', underlay: { dataUrl: 'source', visible: true, opacity: 1 }, visible: true })
  source.layers.push({ id: 'draft', name: 'リボン帯 デザイン案', underlay: null, visible: true })
  source.shapes = [
    {
      id: 's',
      fixtureId: 'f',
      type: 'bulb',
      points: [{ x: 10, y: 20 }, { x: 20, y: 30 }],
      display: 'stroke',
      strokeWidth: 2,
      diameter: 10,
      fontSize: 12,
      glowPx: 3,
      bulbPitch: 5,
      starSize: 2,
      beamW0: 4,
      beamW1: 8,
      beamLen: 20,
      repeat: { count: 2, dx: 3, dy: 4 },
      layerId: 'second'
    },
    {
      id: 'extra-drawing',
      type: 'rect',
      points: [{ x: 30, y: 30 }, { x: 40, y: 40 }],
      display: 'stroke',
      strokeWidth: 1,
      layerId: 'second'
    },
    {
      id: 'draft-line',
      type: 'line',
      points: [{ x: 0, y: 0 }, { x: 5, y: 5 }],
      display: 'stroke',
      strokeWidth: 1,
      layerId: 'draft'
    }
  ]
  source.fixtures = [
    { id: 'f', shapeId: 's', universe: 10, start: 123, mode: 'rgb' },
    { id: 'draft-f', shapeId: 'draft-line', universe: 10, start: 126, mode: 'rgb' }
  ]
  const before = JSON.stringify(source)
  const result = prepareChartImport(current, source)
  expect(result.layers).toHaveLength(2)
  expect(result.layers[1]).toMatchObject({ name: 'Second（取込）', underlay: current.layers[0].underlay })
  expect(result.shapes).toHaveLength(2)
  expect(result.shapes[0]).toMatchObject({
    points: [{ x: 120, y: 40 }, { x: 140, y: 60 }],
    diameter: 20,
    strokeWidth: 4,
    fontSize: 24,
    glowPx: 6,
    bulbPitch: 10,
    starSize: 4,
    beamW0: 8,
    beamW1: 16,
    beamLen: 40,
    repeat: { count: 2, dx: 6, dy: 8 },
    layerId: result.layers[1].id,
    fixtureId: result.fixtures[0].id
  })
  expect(result.fixtures[0]).toMatchObject({
    shapeId: result.shapes[0].id,
    universe: 10,
    start: 123,
    mode: 'rgb'
  })
  expect(result.shapes[0].id).not.toBe('s')
  expect(result.shapes[1]).toMatchObject({ type: 'rect', layerId: result.layers[1].id })
  expect(JSON.stringify(source)).toBe(before)
  expect(result.settings).toEqual(current.settings)
  useStore.getState().setChart(current)
  useStore.getState().appendImportedChart(source)
  useStore.getState().undo()
  expect(useStore.getState().chart).toEqual(current)
  useStore.getState().redo()
  expect(useStore.getState().chart.layers).toHaveLength(2)
})

it('rejects excessive page count before creating history', () => {
  const current = createChart({ w: 100, h: 100 })
  const source = createChart({ w: 100, h: 100 })
  source.layers = Array.from({ length: 256 }, (_, i) => ({ ...source.layers[0], id: String(i) }))
  source.shapes = source.layers.map((layer, i) => ({
    id: `s${i}`, type: 'line', points: [{ x: 0, y: 0 }, { x: 10, y: 10 }],
    display: 'stroke', strokeWidth: 2, layerId: layer.id
  }))
  source.fixtures = source.shapes.map((shape, i) => ({ id: `f${i}`, shapeId: shape.id, universe: 0, start: 1, mode: 'rgb' }))
  useStore.getState().setChart(current)
  const count = useStore.getState().history.length
  expect(() => useStore.getState().appendImportedChart(source)).toThrow('256')
  expect(useStore.getState().history.length).toBe(count)
  expect(useStore.getState().chart).toEqual(current)
})

it('rejects duplicate IDs, non-finite coordinates and invalid patch without changing the current work', () => {
  const current = createChart({ w: 100, h: 100 })
  const source = createChart({ w: 100, h: 100 })
  source.shapes = [
    {
      id: 's',
      type: 'line',
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 10 }
      ],
      display: 'stroke',
      strokeWidth: 2
    }
  ]
  source.fixtures = [{ id: 'f', shapeId: 's', universe: 0, start: 1, mode: 'rgb' }]
  const duplicate = structuredClone(source)
  duplicate.shapes.push(duplicate.shapes[0])
  expect(() => prepareChartImport(current, duplicate)).toThrow('ID')
  const invalid = structuredClone(source)
  invalid.shapes[0].points[0].x = NaN
  expect(() => prepareChartImport(current, invalid)).toThrow('図形')
  const badPatch = structuredClone(source)
  badPatch.fixtures[0].start = 511
  expect(() => prepareChartImport(current, badPatch)).toThrow('Patch')
  expect(current.shapes).toEqual([])
})

it('keeps the manually selected output page while importing and undoing', () => {
  const current = createChart({w:100,h:100})
  const source = createChart({w:100,h:100})
  source.shapes = [{ id: 'line', type: 'line', points: [{x:0,y:0},{x:10,y:10}], display: 'stroke', strokeWidth: 2 }]
  source.fixtures = [{ id: 'fixture', shapeId: 'line', universe: 0, start: 1, mode: 'rgb' }]
  useStore.getState().setChart(current)
  useStore.getState().setPageSwitchManual(0)
  useStore.getState().appendImportedChart(source)
  expect(useStore.getState().pageSwitchManual).toBe(0)
  useStore.getState().undo()
  expect(useStore.getState().pageSwitchManual).toBe(0)
})
