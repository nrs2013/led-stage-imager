import type { Chart, Shape } from './types'
import { newId } from './chart-model'
import { channelCount } from '../dmx/channel-math'

/** Keep source pages separate and fit their whole canvas without distorting geometry. */
export function prepareChartImport(current: Chart, source: Chart): Chart {
  if (!source.layers.length || current.layers.length + source.layers.length > 256)
    throw new Error('取り込み後のチャートは256枚以内にしてください')
  if (![source.canvas.w, source.canvas.h].every((n) => Number.isFinite(n) && n > 0))
    throw new Error('取り込み元のキャンバス寸法が不正です')
  const uniqueIds = (items: { id: string }[]): boolean =>
    items.every((item) => typeof item.id === 'string' && !!item.id) &&
    new Set(items.map((item) => item.id)).size === items.length
  if (!uniqueIds(source.layers) || !uniqueIds(source.shapes) || !uniqueIds(source.fixtures))
    throw new Error('取り込み元のIDが重複または欠落しています')
  const validLayers = new Set(source.layers.map((l) => l.id))
  const validShapes = new Set(source.shapes.map((s) => s.id))
  if (
    source.shapes.some(
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
    source.fixtures.some(
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
  const layers = source.layers.map((l) => ({
    ...l,
    id: newId('layer'),
    name: `${l.name}（取込）`,
    underlay: base
  }))
  const layerIds = new Map(source.layers.map((l, i) => [l.id, layers[i].id]))
  const shapeIds = new Map(source.shapes.map((s) => [s.id, newId('shape')]))
  const fixtureIds = new Map(source.fixtures.map((f) => [f.id, newId('fx')]))
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
  const shapes = source.shapes.map((shape): Shape => {
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
  const fixtures = source.fixtures.flatMap((f) => {
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
