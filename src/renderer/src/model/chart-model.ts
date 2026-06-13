import type { Chart, Shape, ShapeType, Point } from './types'

let counter = 0
export const newId = (prefix = 'id'): string =>
  `${prefix}_${Date.now().toString(36)}_${(counter++).toString(36)}`

export function createChart(canvas: { w: number; h: number }): Chart {
  return {
    version: 1,
    id: newId('chart'),
    name: 'Untitled',
    canvas,
    underlay: null,
    shapes: [],
    fixtures: [],
    syphon: { name: 'LED STAGE IMAGER' },
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
    ...init
  } as Shape
  return { ...chart, shapes: [...chart.shapes, shape] }
}
