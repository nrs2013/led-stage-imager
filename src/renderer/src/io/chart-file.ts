import type { Chart, Layer, Shape, Underlay } from '../model/types'
import { familyOfType } from '../model/part-family'

export function serializeChart(chart: Chart): string {
  return JSON.stringify(chart, null, 2)
}

/** 古いshow(family無し)を開いたとき、種別を type から補完する。安全側=「迷ったら decor」。
 *  これを入れ忘れると、表示フィルタを「電飾だけ」にした瞬間に旧データが消えて見え＝事故。 */
function coerceFamilies(shapes: Shape[]): Shape[] {
  return shapes.map((s) => (s.family ? s : { ...s, family: familyOfType(s.type) }))
}

/** v1 charts had a single top-level underlay and no layers — wrap everything
 *  into one layer so old show files keep opening forever. */
function migrateV1(c: Record<string, unknown>): Chart {
  const lid = 'layer_1'
  const layer: Layer = {
    id: lid,
    name: 'CHART 1',
    underlay: (c.underlay as Underlay | null) ?? null,
    visible: true
  }
  const shapes = coerceFamilies(((c.shapes as Shape[]) ?? []).map((s) => ({ ...s, layerId: lid })))
  const out = { ...c, version: 2, layers: [layer], activeLayerId: lid, shapes } as Chart &
    Record<string, unknown>
  delete out.underlay
  return out as Chart
}

export function parseChart(json: string): Chart {
  let obj: unknown
  try {
    obj = JSON.parse(json)
  } catch {
    throw new Error('Invalid chart file: not valid JSON')
  }
  if (obj === null || typeof obj !== 'object') throw new Error('Invalid chart file: not a chart')
  const c = obj as Record<string, unknown>
  if (c.version === 1) return migrateV1(c)
  if (c.version !== 2) throw new Error(`Unsupported chart version: ${c.version}`)
  const chart = c as unknown as Chart
  // layers / activeLayerId の不変条件を復元時に保証する（壊れた/旧/手編集 show.json で
  // activeLayerOf が落ちて白画面になるのを防ぐ）。shapes は従来どおり family 補完。
  const layers: Layer[] =
    Array.isArray(chart.layers) && chart.layers.length
      ? chart.layers
      : [{ id: 'layer_1', name: 'CHART 1', underlay: null, visible: true }]
  const activeLayerId = layers.some((l) => l.id === chart.activeLayerId)
    ? chart.activeLayerId
    : layers[0].id
  return { ...chart, layers, activeLayerId, shapes: coerceFamilies(chart.shapes ?? []) }
}
