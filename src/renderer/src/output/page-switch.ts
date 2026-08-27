import type { Chart, Shape } from '../model/types'

/** DMX値0=CHART 1、255=CHART 256。未作成ページを選んだ時は黒を送出する。 */
export function outputLayerIndex(
  chart: Chart,
  dmxByUniverse: Record<number, Uint8Array>,
  manualValue: number | null = null
): number | null {
  const sw = chart.settings.pageSwitch
  if (!sw?.enabled) return null
  if (manualValue != null) return Math.max(0, Math.min(255, Math.floor(manualValue)))
  const universe = Math.max(0, Math.floor(sw.universe || 0))
  const address = Math.max(1, Math.min(512, Math.floor(sw.address || 1)))
  return dmxByUniverse[universe]?.[address - 1] ?? 0
}

/** 切替OFFは従来どおり全ページ。ONは選ばれた1ページだけ。 */
export function outputShapes(
  chart: Chart,
  dmxByUniverse: Record<number, Uint8Array>,
  manualValue: number | null = null
): Shape[] {
  const index = outputLayerIndex(chart, dmxByUniverse, manualValue)
  if (index == null) return chart.shapes
  const layer = chart.layers[index]
  if (!layer) return []
  const homeId = chart.layers[0]?.id
  return chart.shapes.filter((shape) => (shape.layerId ?? homeId) === layer.id)
}
