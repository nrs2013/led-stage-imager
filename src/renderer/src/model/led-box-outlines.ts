import type { Chart, Fixture, Point, Shape } from './types'

export interface OutlinePatch {
  /** Equal keys intentionally link the same logical run on different LED faces. */
  key: string
  universe: number
  start: number
  count: number
}
export interface LedBoxOutline {
  id: string
  rect: { x: number; y: number; w: number; h: number }
  /** Actual folds of the LED strip, as fractions of its unfolded width. */
  folds: number[]
  /** Optional DMX divisions of a straight edge; these do NOT add vertical lines. */
  splits?: number[]
  /** Used for an existing box whose hardware already provides some edges. */
  parts?: ('top' | 'bottom' | 'vertical')[]
  patch: Record<string, OutlinePatch>
}

/** Outline the actual LED envelope. Do not draw a tilted cube inside the face.
 * All geometry is horizontal/vertical in the chart. The physical LED fold creates
 * the depth when installed. Keys are top:N, bottom:N and vertical:N (left to right).
 * Horizontal runs go left to right; vertical runs go from the bottom upwards.
 */
export function appendLedBoxOutlines(chart: Chart, boxes: LedBoxOutline[]): Chart {
  const integer = (n: number, lo: number, hi: number): boolean =>
    Number.isInteger(n) && n >= lo && n <= hi
  const oldUniverses = new Set(chart.fixtures.map((f) => f.universe))
  if (chart.settings.pageSwitch?.enabled) oldUniverses.add(chart.settings.pageSwitch.universe)
  const universes = new Set<number>(), bindingSignatures = new Map<string, string>()
  const channels = new Map<string, string>()
  const ids = new Set([...chart.shapes, ...chart.fixtures].map((s) => s.id))
  const boxIds = new Set<string>()
  const shapes: Shape[] = [], fixtures: Fixture[] = []
  for (const box of boxes) {
    if (!box.id || boxIds.has(box.id)) throw new Error('Duplicate LED outline identifier')
    boxIds.add(box.id)
    const r = box.rect
    if (![r.x, r.y, r.w, r.h].every(Number.isFinite) || r.x < 0 || r.y < 0 || r.w <= 2 || r.h <= 2 ||
        r.x + r.w > chart.canvas.w || r.y + r.h > chart.canvas.h) throw new Error('Invalid LED rectangle')
    const fractions = [...box.folds, ...(box.splits ?? [])]
    if (fractions.some((n) => !Number.isFinite(n) || n * r.w <= 1 || n * r.w >= r.w - 1) ||
        new Set(box.folds).size !== box.folds.length) throw new Error('Invalid LED fold')
    const cuts = [0, ...new Set(fractions), 1].sort((a, b) => a - b)
    const verticals = [0, ...box.folds, 1].sort((a, b) => a - b)
    const parts = box.parts ?? ['top', 'bottom', 'vertical']
    if (!parts.length || new Set(parts).size !== parts.length || parts.some((p) => !['top','bottom','vertical'].includes(p))) {
      throw new Error('Invalid outline parts')
    }
    // Keep the complete 2px stroke inside the LED face, including its outermost row.
    const x = (f: number): number => f === 0 ? r.x + 1 : f === 1 ? r.x + r.w - 1 : r.x + r.w * f
    const runs: { name: string; from: Point; to: Point }[] = []
    for (const part of parts) {
      if (part === 'vertical') verticals.forEach((v, i) => runs.push({ name: `vertical:${i}`,
        from: { x: x(v), y: r.y + r.h - 1 }, to: { x: x(v), y: r.y + 1 } }))
      else for (let i = 0; i < cuts.length - 1; i++) {
        const y = part === 'top' ? r.y + 1 : r.y + r.h - 1
        runs.push({ name: `${part}:${i}`, from: { x: x(cuts[i]), y }, to: { x: x(cuts[i + 1]), y } })
      }
    }
    if (Object.keys(box.patch).length !== runs.length) throw new Error('Unexpected or missing outline patch')
    for (const run of runs) {
      const patch = box.patch[run.name]
      if (!patch || !patch.key || !integer(patch.universe, 0, 32767) || !integer(patch.start, 1, 512) ||
          !integer(patch.count, 1, 170) || patch.start + patch.count * 3 - 1 > 512 || oldUniverses.has(patch.universe)) {
        throw new Error('Invalid, overflowing or occupied outline patch')
      }
      universes.add(patch.universe)
      const signature = `${patch.universe}:${patch.start}:${patch.count}`
      const previous = bindingSignatures.get(patch.key)
      if (previous && previous !== signature) throw new Error('Inconsistent linked outline patch')
      bindingSignatures.set(patch.key, signature)
      for (let c = patch.start; c < patch.start + patch.count * 3; c++) {
        const key = `${patch.universe}:${c}`, owner = channels.get(key)
        if (owner && owner !== patch.key) throw new Error('Overlapping outline patches')
        channels.set(key, patch.key)
      }
      for (let i = 0; i < patch.count; i++) {
        const point = (t: number): Point => ({ x: run.from.x + (run.to.x - run.from.x) * t,
          y: run.from.y + (run.to.y - run.from.y) * t })
        const shapeId = `outline:${box.id}:${run.name}:${i}:shape`, fixtureId = `outline:${box.id}:${run.name}:${i}:fixture`
        if (ids.has(shapeId) || ids.has(fixtureId)) throw new Error('LED outline already exists')
        ids.add(shapeId); ids.add(fixtureId)
        shapes.push({ id: shapeId, layerId: chart.activeLayerId, family: 'decor', type: 'line', display: 'stroke',
          strokeWidth: 2, glowPx: 0, points: [point(i / patch.count), point((i + 1) / patch.count)] })
        fixtures.push({ id: fixtureId, shapeId, universe: patch.universe, start: patch.start + i * 3, mode: 'rgb' })
      }
    }
  }
  if (universes.size !== 2) throw new Error('LED outlines require exactly two new universes')
  return { ...chart, shapes: [...chart.shapes, ...shapes], fixtures: [...chart.fixtures, ...fixtures] }
}
