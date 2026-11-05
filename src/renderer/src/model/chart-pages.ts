import type { Chart } from './types'

/** フィックスチャーチャートの順番を入れ替える。
 *  layerId の無い古い図形は「先頭ページ所属」というルールなので、並べ替えの前に
 *  元の先頭ページの id を明示して、先頭が入れ替わっても別ページへ移らないようにする。 */
export function moveChartPage(chart: Chart, id: string, toIndex: number): Chart {
  const from = chart.layers.findIndex((layer) => layer.id === id)
  if (from < 0) return chart
  const to = Math.max(0, Math.min(chart.layers.length - 1, Math.floor(toIndex)))
  if (from === to) return chart
  const homeId = chart.layers[0].id
  const layers = [...chart.layers]
  const [moved] = layers.splice(from, 1)
  layers.splice(to, 0, moved)
  const shapes = chart.shapes.some((shape) => shape.layerId == null)
    ? chart.shapes.map((shape) => (shape.layerId == null ? { ...shape, layerId: homeId } : shape))
    : chart.shapes
  return { ...chart, layers, shapes }
}

/** 1枚のフィックスチャーチャートだけを、単独で開ける .ledimager 用のチャートにする。
 *  背景画像・図形・Patch・キャンバス寸法・設定をそのまま持ち出す（元のチャートは変えない）。 */
export function extractChartPage(chart: Chart, id: string): Chart {
  const layer = chart.layers.find((l) => l.id === id)
  if (!layer) throw new Error('書き出すフィックスチャーチャートが見つかりません')
  const homeId = chart.layers[0].id
  const shapes = chart.shapes
    .filter((shape) => (shape.layerId ?? homeId) === id)
    .map((shape) => ({ ...shape, layerId: id }))
  const shapeIds = new Set(shapes.map((shape) => shape.id))
  const fixtures = chart.fixtures.filter((fixture) => shapeIds.has(fixture.shapeId))
  return {
    ...chart,
    name: layer.name,
    layers: [{ ...layer, visible: true }],
    activeLayerId: id,
    shapes,
    fixtures,
    settings: {
      ...chart.settings,
      // 1枚だけのファイルなので、DMX切替は持ち出さない（開いた先で誤って切り替わらないように）
      ...(chart.settings.pageSwitch ? { pageSwitch: { ...chart.settings.pageSwitch, enabled: false } } : {})
    }
  }
}
