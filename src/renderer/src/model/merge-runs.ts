import type { Chart, Point, Shape, Fixture } from './types'

// 「1本に結合」: selected painted runs are chained into ONE shape (= one fixture).
// Runs are connected greedily by nearest endpoints; gaps are bridged with straight
// dot runs — so two pieces cut by the eraser can be reunited, and separate bars can
// be joined into a single chain on purpose (no more accidental auto-grouping).

const cellOf = (p: Point): Point => ({ x: Math.floor(p.x), y: Math.floor(p.y) })
const isRun = (s: Shape): boolean =>
  s.type === 'freehand' &&
  s.points.length >= 1 &&
  (s.repeat?.count ?? 1) <= 1 && // 本物の配列(count>1)だけ除外。count=1 repeat は配列でない
  s.points.every((p) => Math.abs((p.x % 1) - 0.5) < 1e-6 && Math.abs((p.y % 1) - 0.5) < 1e-6)

/** Corner cells of a run (its verts, or just both ends), optionally reversed. */
function vertCellsOf(s: Shape, reversed: boolean): Point[] {
  const idx = s.verts && s.verts.length >= 2 ? s.verts : [0, s.points.length - 1]
  const cells = idx.map((i) => cellOf(s.points[i]))
  const dedup = cells.filter(
    (c, i) => i === 0 || c.x !== cells[i - 1].x || c.y !== cells[i - 1].y
  )
  return reversed ? dedup.slice().reverse() : dedup
}

/** Greedy nearest-endpoint ordering: which run next, and flipped or not. */
export function orderRuns(shapes: Shape[]): { shape: Shape; reversed: boolean }[] {
  const rest = shapes.slice()
  // start from the run with the left-most (then top-most) endpoint
  rest.sort((a, b) => {
    const pa = a.points[0]
    const pb = b.points[0]
    return pa.x - pb.x || pa.y - pb.y
  })
  const first = rest.shift()!
  const ordered: { shape: Shape; reversed: boolean }[] = [{ shape: first, reversed: false }]
  let tail = first.points[first.points.length - 1]
  while (rest.length) {
    let bi = 0
    let bRev = false
    let bd = Infinity
    rest.forEach((s, i) => {
      const head = s.points[0]
      const end = s.points[s.points.length - 1]
      const dHead = Math.hypot(head.x - tail.x, head.y - tail.y)
      const dEnd = Math.hypot(end.x - tail.x, end.y - tail.y)
      if (dHead < bd) {
        bd = dHead
        bi = i
        bRev = false
      }
      if (dEnd < bd) {
        bd = dEnd
        bi = i
        bRev = true
      }
    })
    const next = rest.splice(bi, 1)[0]
    ordered.push({ shape: next, reversed: bRev })
    tail = bRev ? next.points[0] : next.points[next.points.length - 1]
  }
  return ordered
}

/** Merges the painted runs among `ids` into one chain. Keeps the first run's identity
 *  and fixture; the other runs (and their fixtures) disappear. Returns null when there
 *  is nothing to merge (fewer than 2 painted runs). The caller regenerates the dots
 *  from the returned corner cells. */
export function mergeRunCells(chart: Chart, ids: string[]): {
  keepId: string
  vertCells: Point[]
  dropIds: string[]
} | null {
  const runs = chart.shapes.filter((s) => ids.includes(s.id) && isRun(s))
  if (runs.length < 2) return null
  const ordered = orderRuns(runs)
  const vertCells: Point[] = []
  for (const o of ordered) {
    for (const c of vertCellsOf(o.shape, o.reversed)) {
      const prev = vertCells[vertCells.length - 1]
      if (!prev || prev.x !== c.x || prev.y !== c.y) vertCells.push(c)
    }
  }
  return {
    keepId: ordered[0].shape.id,
    vertCells,
    dropIds: ordered.slice(1).map((o) => o.shape.id)
  }
}

/** Applies a merge to the chart: keep shape gets the new geometry, dropped shapes and
 *  their fixtures are removed. */
export function applyMerge(
  chart: Chart,
  keepId: string,
  points: Point[],
  verts: number[],
  dropIds: string[]
): Chart {
  const drop = new Set(dropIds)
  const shapes = chart.shapes
    .filter((s) => !drop.has(s.id))
    .map((s) => (s.id === keepId ? { ...s, points, verts } : s))
  // 統合で消すのは drop(=統合された run)の灯体だけ。shape が見つからない孤児灯体は
  // 巻き込まずそのまま残す（旧 ': false' は無関係な灯体まで消していた）。
  const fixtures: Fixture[] = chart.fixtures.filter((f) => !drop.has(f.shapeId))
  return { ...chart, shapes, fixtures }
}
