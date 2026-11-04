import type { Chart, Fixture, Point, Shape } from './types'

export interface CubeSegment {
  sourceAddress: number
  from: Point
  to: Point
}
export interface CubeTemplate {
  id: string
  segments: CubeSegment[]
}
export interface CubePatch {
  templateId: string
  universe: number
  start: number
}
export interface CubePlacement {
  id: string
  templateId: string
  rect: { x: number; y: number; w: number; h: number }
  /** Explicit front-facing LED strips. Fractions describe the measured projected
   * X interval of each physical panel and its unfolded chart U interval. Gaps in
   * the physical surface remain dark instead of joining unrelated panel edges. */
  surface?: {
    width: number
    height: number
    panels: { from: number; to: number; u0: number; u1: number }[]
  }
}

/** Build a chart proposal from explicitly supplied front projections and LED rectangles.
 * Repeated placements of a template intentionally share its NEW patch. This does
 * not infer physical calibration or a mapping from scenery names. Measured
 * unfolded LED strips can be supplied explicitly via placement.surface.
 * Existing fixtures and source templates are never modified.
 */
export function appendProjectedCubes(
  chart: Chart,
  templates: CubeTemplate[],
  patches: CubePatch[],
  placements: CubePlacement[],
  margin = 6
): Chart {
  const integer = (n: number, lo: number, hi: number): boolean =>
    Number.isInteger(n) && n >= lo && n <= hi
  if (!Number.isFinite(margin) || margin < 1) throw new Error('Invalid cube margin')
  if (new Set(templates.map((t) => t.id)).size !== templates.length ||
      new Set(patches.map((p) => p.templateId)).size !== patches.length ||
      new Set(placements.map((p) => p.id)).size !== placements.length) {
    throw new Error('Duplicate cube identifiers')
  }
  // Reserve entire existing universes, including page-control and all song pages.
  // Reusing gaps would require inspecting repeated fixtures and other equipment.
  const occupied = new Set(chart.fixtures.map((f) => f.universe))
  if (chart.settings.pageSwitch?.enabled) occupied.add(chart.settings.pageSwitch.universe)
  const allocated = new Set<string>()
  const byId = new Map<string, { template: CubeTemplate; patch: CubePatch }>()
  for (const template of templates) {
    const patch = patches.find((p) => p.templateId === template.id)
    if (!patch || !integer(patch.universe, 0, 32767) || !integer(patch.start, 1, 512) ||
        occupied.has(patch.universe)) throw new Error('Missing, invalid or occupied cube patch')
    const segments = [...template.segments].sort((a, b) => a.sourceAddress - b.sourceAddress)
    if (!segments.length || patch.start + segments.length * 3 - 1 > 512) {
      throw new Error('Cube patch exceeds one universe')
    }
    for (let i = 0; i < segments.length; i++) {
      const s = segments[i]
      if (!integer(s.sourceAddress, 1, 510) || (i > 0 && s.sourceAddress < segments[i - 1].sourceAddress + 3) ||
          ![s.from.x, s.from.y, s.to.x, s.to.y].every(Number.isFinite)) {
        throw new Error('Invalid source cube segment')
      }
      for (let ch = patch.start + i * 3; ch < patch.start + i * 3 + 3; ch++) {
        const key = `${patch.universe}:${ch}`
        if (allocated.has(key)) throw new Error('Overlapping cube patches')
        allocated.add(key)
      }
    }
    byId.set(template.id, { template: { ...template, segments }, patch })
  }
  if (patches.length !== templates.length || new Set(patches.map((p) => p.universe)).size !== 2) {
    throw new Error('Cube drawing requires exactly two new universes')
  }
  const shapes: Shape[] = []
  const fixtures: Fixture[] = []
  const ids = new Set([...chart.shapes, ...chart.fixtures].map((item) => item.id))
  for (const placement of placements) {
    const input = byId.get(placement.templateId)
    if (!input) throw new Error('Unknown cube template')
    const { template, patch } = input
    const r = placement.rect
    if (![r.x, r.y, r.w, r.h].every(Number.isFinite) || r.x < 0 || r.y < 0 ||
        r.w <= margin * 2 || r.h <= margin * 2 || r.x + r.w > chart.canvas.w ||
        r.y + r.h > chart.canvas.h) throw new Error('Cube LED rectangle is outside the canvas')
    const points = template.segments.flatMap((s) => [s.from, s.to])
    const x0 = Math.min(...points.map((p) => p.x)), x1 = Math.max(...points.map((p) => p.x))
    const y0 = Math.min(...points.map((p) => p.y)), y1 = Math.max(...points.map((p) => p.y))
    if (![x1 - x0, y1 - y0].every((n) => Number.isFinite(n) && n > 0)) throw new Error('Degenerate cube projection')
    const surface = placement.surface ?? { width: r.w, height: r.h, panels: [{ from: 0, to: 1, u0: 0, u1: 1 }] }
    if (![surface.width, surface.height].every((n) => Number.isFinite(n) && n > 0) || !surface.panels.length) {
      throw new Error('Invalid LED surface')
    }
    let previousFront = 0, previousU = 0
    for (const panel of surface.panels) {
      if (![panel.from, panel.to, panel.u0, panel.u1].every(Number.isFinite) ||
          panel.from < previousFront || panel.to <= panel.from || panel.to > 1 ||
          panel.u0 < previousU || panel.u1 <= panel.u0 || panel.u1 > 1) throw new Error('Invalid LED panel intervals')
      previousFront = panel.to; previousU = panel.u1
    }
    const scale = Math.min(surface.width * (1 - margin * 2 / r.w) / (x1 - x0),
      surface.height * (1 - margin * 2 / r.h) / (y1 - y0))
    const transform = (p: Point): Point => ({
      x: ((surface.width - (x1 - x0) * scale) / 2 + (p.x - x0) * scale) / surface.width,
      y: ((surface.height - (y1 - y0) * scale) / 2 + (p.y - y0) * scale) / surface.height
    })
    template.segments.forEach((segment, i) => {
      const a = transform(segment.from), b = transform(segment.to), dx = b.x - a.x
      surface.panels.forEach((panel, j) => {
        let low = 0, high = 1
        if (Math.abs(dx) < 1e-12) {
          if (a.x < panel.from || a.x > panel.to) return
        } else {
          const t0 = (panel.from - a.x) / dx, t1 = (panel.to - a.x) / dx
          low = Math.max(0, Math.min(t0, t1)); high = Math.min(1, Math.max(t0, t1))
          if (high <= low) return
        }
        const project = (t: number): Point => ({
          x: r.x + (panel.u0 + (a.x + dx * t - panel.from) / (panel.to - panel.from) * (panel.u1 - panel.u0)) * r.w,
          y: r.y + (a.y + (b.y - a.y) * t) * r.h
        })
        const shapeId = `cube:${placement.id}:${i}:${j}:shape`, fixtureId = `cube:${placement.id}:${i}:${j}:fixture`
        if (ids.has(shapeId) || ids.has(fixtureId)) throw new Error('Cube placement already exists')
        ids.add(shapeId); ids.add(fixtureId)
        shapes.push({ id: shapeId, layerId: chart.activeLayerId, family: 'decor', type: 'line',
          display: 'stroke', strokeWidth: 2, glowPx: 0, points: [project(low), project(high)] })
        fixtures.push({ id: fixtureId, shapeId, universe: patch.universe, start: patch.start + i * 3, mode: 'rgb' })
      })
    })
  }
  return { ...chart, shapes: [...chart.shapes, ...shapes], fixtures: [...chart.fixtures, ...fixtures] }
}
