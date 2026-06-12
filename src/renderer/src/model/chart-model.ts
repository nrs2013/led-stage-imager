import type { Chart, Shape, ShapeType, Point } from './types'

let counter = 0
export const newId = (prefix = 'id'): string =>
  `${prefix}_${Date.now().toString(36)}_${(counter++).toString(36)}`

export function createChart(canvas: { w: number; h: number }): Chart {
  const layerId = newId('layer')
  return {
    version: 2,
    id: newId('chart'),
    name: 'Untitled',
    canvas,
    layers: [{ id: layerId, name: 'CHART 1', underlay: null, visible: true }],
    activeLayerId: layerId,
    shapes: [],
    fixtures: [],
    syphon: { name: 'DECOR STUDIO' },
    settings: { holdOnTimeout: true, gamma: false, glow: false, glowAmount: 14 }
  }
}

export function addShape(
  chart: Chart,
  init: { type: ShapeType; points: Point[] } & Partial<Shape>
): Chart {
  const shape: Shape = {
    id: newId('shape'),
    display: 'stroke',
    strokeWidth: 1,
    layerId: chart.activeLayerId,
    ...init
  } as Shape
  return { ...chart, shapes: [...chart.shapes, shape] }
}
