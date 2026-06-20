import type { Chart, Shape, ShapeType, Point } from './types'
import { familyOfType } from './part-family'
import { DEFAULT_STAGE_WIDTH_MM } from './scale'

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
    syphon: { name: 'LED STAGE IMAGER' },
    // 既定で「横40m」に校正済み＝部品が最初から実物大の小さいドットで入る（未校正だと
    // mm=px で巨大になる問題の解消・Setup で公演ごとに変更可）。model/scale.DEFAULT_STAGE_WIDTH_MM。
    settings: {
      holdOnTimeout: true,
      gamma: false,
      glow: false,
      glowAmount: 14,
      stageWidthMm: DEFAULT_STAGE_WIDTH_MM
    }
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
    ...init,
    // 種別は init 指定が最優先、無ければ type から既定（電飾/照明）を付与。
    family: init.family ?? familyOfType(init.type)
  } as Shape
  return { ...chart, shapes: [...chart.shapes, shape] }
}
