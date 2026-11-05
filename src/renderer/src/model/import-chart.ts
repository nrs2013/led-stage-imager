import type { Chart, Shape } from './types'
import { newId } from './chart-model'
import { channelCount } from '../dmx/channel-math'

const DRAFT_LAYER_NAME = /下書き|ドラフト|デザイン案|試案|draft|proposal/i

/** Keep all drawn content from fixture-chart pages, excluding drafts and source backgrounds. */
export function prepareChartImport(current: Chart, source: Chart): Chart {
  if (!source.layers.length) throw new Error('取り込み元にフィックスチャーチャートがありません')
  if (![source.canvas.w, source.canvas.h].every((n) => Number.isFinite(n) && n > 0))
    throw new Error('取り込み元のキャンバス寸法が不正です')
  const uniqueIds = (items: { id: string }[]): boolean =>
    items.every((item) => typeof item.id === 'string' && !!item.id) &&
    new Set(items.map((item) => item.id)).size === items.length

  const sourceLayerIds = new Set(source.layers.map((layer) => layer.id))
  const layersToImport = source.layers.filter((layer) =>
    !DRAFT_LAYER_NAME.test(layer.name) && source.shapes.some((shape) =>
      (shape.layerId ?? source.layers[0]?.id) === layer.id
    )
  )
  const importLayerIds = new Set(layersToImport.map((layer) => layer.id))
  const shapesToImport = source.shapes.filter((shape) =>
    importLayerIds.has(shape.layerId ?? source.layers[0]?.id)
  )
  const importedShapeIds = new Set(shapesToImport.map((shape) => shape.id))
  const fixturesToImport = source.fixtures.filter((fixture) => importedShapeIds.has(fixture.shapeId))

  if (!layersToImport.length || !shapesToImport.length)
    throw new Error('取り込み対象のフィックスチャーチャートがありません（下書き以外の図形が必要です）')
  if (current.layers.length + layersToImport.length > 256)
    throw new Error('取り込み後のフィックスチャーチャートは256枚以内にしてください')
  if (
    !uniqueIds(layersToImport) || !uniqueIds(shapesToImport) || !uniqueIds(fixturesToImport) ||
    layersToImport.some((layer) => !sourceLayerIds.has(layer.id))
  ) throw new Error('取り込み元のIDが重複または欠落しています')

  const validLayers = new Set(layersToImport.map((l) => l.id))
  const validShapes = new Set(shapesToImport.map((s) => s.id))
  if (
    shapesToImport.some(
      (s) =>
        !s.points.length ||
        !s.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)) ||
        !Number.isFinite(s.strokeWidth) ||
        s.strokeWidth < 0 ||
        (s.layerId != null && !validLayers.has(s.layerId))
    )
  )
    throw new Error('取り込み元の図形・ページ指定が不正です')
  if (
    fixturesToImport.some(
      (f) =>
        !validShapes.has(f.shapeId) ||
        !Number.isInteger(f.universe) ||
        f.universe < 0 ||
        f.universe > 32767 ||
        !Number.isInteger(f.start) ||
        f.start < 1 ||
        !channelCount(f.mode) ||
        f.start + channelCount(f.mode) - 1 > 512
    )
  )
    throw new Error('取り込み元のPatchが不正です')
  const scale = Math.min(current.canvas.w / source.canvas.w, current.canvas.h / source.canvas.h)
  const dx = (current.canvas.w - source.canvas.w * scale) / 2
  const dy = (current.canvas.h - source.canvas.h * scale) / 2
  const base = current.layers.find((l) => l.id === current.activeLayerId)?.underlay ?? null
  const layers = layersToImport.map((l) => ({
    ...l,
    id: newId('layer'),
    name: `${l.name}（取込）`,
    underlay: base
  }))
  const layerIds = new Map(layersToImport.map((l, i) => [l.id, layers[i].id]))
  const shapeIds = new Map(shapesToImport.map((s) => [s.id, newId('shape')]))
  const fixtureIds = new Map(fixturesToImport.map((f) => [f.id, newId('fx')]))
  const sizes = [
    'diameter',
    'fontSize',
    'glowPx',
    'bulbPitch',
    'starSize',
    'beamW0',
    'beamW1',
    'beamLen'
  ] as const
  const shapes = shapesToImport.map((shape): Shape => {
    const out = {
      ...shape,
      id: shapeIds.get(shape.id)!,
      layerId: layerIds.get(shape.layerId ?? source.layers[0].id) ?? layers[0].id,
      fixtureId: shape.fixtureId ? fixtureIds.get(shape.fixtureId) : undefined,
      points: shape.points.map((p) => ({ x: p.x * scale + dx, y: p.y * scale + dy })),
      strokeWidth: shape.strokeWidth * scale
    }
    for (const key of sizes) if (shape[key] != null) out[key] = shape[key] * scale
    if (shape.repeat)
      out.repeat = { ...shape.repeat, dx: shape.repeat.dx * scale, dy: shape.repeat.dy * scale }
    return out
  })
  const fixtures = fixturesToImport.flatMap((f) => {
    const shapeId = shapeIds.get(f.shapeId)
    return shapeId ? [{ ...f, id: fixtureIds.get(f.id)!, shapeId }] : []
  })
  return {
    ...current,
    layers: [...current.layers, ...layers],
    activeLayerId: layers[0].id,
    shapes: [...current.shapes, ...shapes],
    fixtures: [...current.fixtures, ...fixtures]
  }
}
