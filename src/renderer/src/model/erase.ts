import type { Chart, Shape, Fixture, Point } from './types'
import { newId } from './chart-model'

/** The 1px cell a point lives in, as a map key. */
export const cellKey = (p: Point): string => `${Math.floor(p.x)},${Math.floor(p.y)}`

/**
 * Removes the given cells from every freehand stroke (the painted dot runs).
 * A stroke erased in the middle splits into separate runs; each extra run gets a
 * clone of the original fixture (same address — split halves keep lighting together,
 * like cutting a lit rope). A fully-erased stroke disappears with its fixture.
 * Other shape types (line/rect/...) are left alone — delete/redraw those instead.
 */
export function eraseCellsFromChart(
  chart: Chart,
  cells: Set<string>,
  /** When given, only this layer's strokes are erasable (ghost layers stay safe). */
  layerId?: string
): { chart: Chart; changed: boolean } {
  let changed = false
  const shapes: Shape[] = []
  const fixtures: Fixture[] = [...chart.fixtures]

  // a shape without layerId belongs to the first layer (same rule as the v1 migration)
  const homeLayer = chart.layers[0]?.id
  for (const sh of chart.shapes) {
    if (
      sh.type !== 'freehand' ||
      (sh.repeat?.count ?? 1) > 1 || // 本物の配列(count>1)だけセル消し対象外。count=1 repeat は対象
      (layerId !== undefined && (sh.layerId ?? homeLayer) !== layerId)
    ) {
      shapes.push(sh)
      continue
    }
    // runs keep their original index ranges so chain corners (verts) can be remapped
    const runs: { pts: Point[]; start: number }[] = []
    let cur: Point[] = []
    let curStart = 0
    let hit = false
    sh.points.forEach((p, pi) => {
      if (cells.has(cellKey(p))) {
        hit = true
        if (cur.length) {
          runs.push({ pts: cur, start: curStart })
          cur = []
        }
      } else {
        if (cur.length === 0) curStart = pi
        cur.push(p)
      }
    })
    if (cur.length) runs.push({ pts: cur, start: curStart })
    if (!hit) {
      shapes.push(sh)
      continue
    }
    changed = true
    const fx = chart.fixtures.find((f) => f.shapeId === sh.id)
    if (runs.length === 0) {
      // nothing left: drop the shape and its fixture
      const i = fixtures.findIndex((f) => f.shapeId === sh.id)
      if (i >= 0) fixtures.splice(i, 1)
      continue
    }
    runs.forEach((run, i) => {
      const pts = run.pts.length === 1 ? [run.pts[0], run.pts[0]] : run.pts // single dot stays renderable
      // remap surviving chain corners into this run (always keep both ends)
      let verts: number[] | undefined
      if (sh.verts && sh.verts.length >= 2 && run.pts.length >= 2) {
        const end = run.start + run.pts.length - 1
        const inner = sh.verts
          .filter((v) => v > run.start && v < end)
          .map((v) => v - run.start)
        verts = [0, ...inner, run.pts.length - 1]
      }
      if (i === 0) {
        shapes.push({ ...sh, points: pts, verts })
        return
      }
      const nid = newId('shape')
      let fid: string | undefined
      if (fx) {
        const nf: Fixture = { ...fx, id: newId('fx'), shapeId: nid }
        fixtures.push(nf)
        fid = nf.id
      }
      shapes.push({ ...sh, id: nid, points: pts, verts, fixtureId: fid })
    })
  }

  return { chart: changed ? { ...chart, shapes, fixtures } : chart, changed }
}
