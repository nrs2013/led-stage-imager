import type { Chart, Layer, Shape, Underlay } from '../model/types'

export function serializeChart(chart: Chart): string {
  return JSON.stringify(chart, null, 2)
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
  const shapes = ((c.shapes as Shape[]) ?? []).map((s) => ({ ...s, layerId: lid }))
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
  const c = obj as Record<string, unknown>
  if (c.version === 1) return migrateV1(c)
  if (c.version !== 2) throw new Error(`Unsupported chart version: ${c.version}`)
  return c as unknown as Chart
}
