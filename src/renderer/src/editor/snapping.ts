import type { Point, Shape } from '../model/types'
import { shapeArrayBounds } from './geometry'

/** Alignment candidates, split into two families that never cross-match:
 *  xs/ys = bbox EDGES, cxs/cys = CENTRES & points (shape centres, line endpoints,
 *  island middles). A bulb is centre-anchored — letting its centre snap onto some
 *  box's edge produced off-by-half-a-bulb "almost" alignments, so edges only ever
 *  match edges and centres only ever match centres. */
export interface SnapCand {
  xs: number[]
  ys: number[]
  cxs?: number[]
  cys?: number[]
}

/** What the moving shape offers for matching — same two families as SnapCand. */
export interface Salient {
  xs: number[]
  ys: number[]
  cxs?: number[]
  cys?: number[]
}

export function buildCandidates(shapes: Shape[], exclude: string | null | Set<string>): SnapCand {
  const xs: number[] = []
  const ys: number[] = []
  const cxs: number[] = []
  const cys: number[] = []
  const skip = (id: string): boolean =>
    typeof exclude === 'string' ? id === exclude : exclude ? exclude.has(id) : false
  for (const sh of shapes) {
    if (skip(sh.id)) continue
    const b = shapeArrayBounds(sh)
    xs.push(b.x, b.x + b.w)
    ys.push(b.y, b.y + b.h)
    cxs.push(b.x + b.w / 2) // centre-to-centre row/column alignment
    cys.push(b.y + b.h / 2)
    if (
      sh.type === 'line' ||
      sh.type === 'polyline' ||
      sh.type === 'freehand' ||
      sh.type === 'festoon'
    ) {
      const a = sh.points[0]
      const z = sh.points[sh.points.length - 1]
      if (a && z) {
        cxs.push(a.x, z.x) // endpoints are points: centre family
        cys.push(a.y, z.y)
      }
    }
  }
  return { xs, ys, cxs, cys }
}

/** Salient coordinates of the shape being moved (tested against the candidates). */
export function salientOf(sh: Shape): Salient {
  const b = shapeArrayBounds(sh)
  // parts (bulb / neon / stage fixtures) are anchored bodies: the CENTRE is their only
  // salient — an edge must not out-compete the centre for island snaps
  if (
    sh.type === 'bulb' ||
    sh.type === 'neon' ||
    sh.type === 'parlight' ||
    sh.type === 'blinder' ||
    sh.type === 'patt' ||
    sh.type === 'pixelpatt'
  ) {
    return { xs: [], ys: [], cxs: [b.x + b.w / 2], cys: [b.y + b.h / 2] }
  }
  const xs = [b.x, b.x + b.w]
  const ys = [b.y, b.y + b.h]
  const cxs = [b.x + b.w / 2]
  const cys = [b.y + b.h / 2]
  if (
    sh.type === 'line' ||
    sh.type === 'polyline' ||
    sh.type === 'freehand' ||
    sh.type === 'festoon'
  ) {
    const a = sh.points[0]
    const z = sh.points[sh.points.length - 1]
    if (a && z) {
      cxs.push(a.x, z.x)
      cys.push(a.y, z.y)
    }
  }
  return { xs, ys, cxs, cys }
}

/** Salient coordinates of a multi-selection: the GROUP's union bbox edges + centre
 *  (a flock of bulbs centres onto an island as one body). */
export function salientOfGroup(shapes: Shape[]): Salient {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const sh of shapes) {
    const b = shapeArrayBounds(sh)
    minX = Math.min(minX, b.x)
    minY = Math.min(minY, b.y)
    maxX = Math.max(maxX, b.x + b.w)
    maxY = Math.max(maxY, b.y + b.h)
  }
  if (!Number.isFinite(minX)) return { xs: [], ys: [], cxs: [], cys: [] }
  return {
    xs: [minX, maxX],
    ys: [minY, maxY],
    cxs: [(minX + maxX) / 2],
    cys: [(minY + maxY) / 2]
  }
}

/** Snap candidates at the CENTRE of every chart cutout island + the canvas centre —
 *  のむさん: a neon sign (or a flock of bulbs) should click onto the middle of the
 *  LED panel it lives in. */
export function centerCandidates(
  regions: { x: number; y: number; w: number; h: number }[],
  canvas: { w: number; h: number }
): SnapCand {
  const cxs = [canvas.w / 2]
  const cys = [canvas.h / 2]
  for (const r of regions) {
    cxs.push(r.x + r.w / 2)
    cys.push(r.y + r.h / 2)
  }
  return { xs: [], ys: [], cxs, cys }
}

/** Equal-spacing candidates (PowerPoint smart-guide style): for every same-row pair
 *  A|B (their y-ranges overlap), the mover can sit right of B or left of A with the
 *  SAME gap. Edge-to-edge gaps land in the edge family; centre-to-centre pitches land
 *  in the centre family, so a string of bulbs clicks into an even run by its centres. */
export function buildGapCandidates(
  shapes: Shape[],
  exclude: string | null | Set<string>
): SnapCand {
  const skip = (id: string): boolean =>
    typeof exclude === 'string' ? id === exclude : exclude ? exclude.has(id) : false
  const boxes = shapes.filter((s) => !skip(s.id)).map((s) => shapeArrayBounds(s))
  const xs: number[] = []
  const ys: number[] = []
  const cxs: number[] = []
  const cys: number[] = []
  const MAX_GAP = 1200 // ignore far-apart pairs: they are not a visual rhythm
  for (let i = 0; i < boxes.length; i++) {
    for (let j = 0; j < boxes.length; j++) {
      if (i === j) continue
      const a = boxes[i]
      const b = boxes[j]
      // same row, a strictly left of b
      const yOv = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
      if (yOv > 0 && a.x + a.w <= b.x) {
        const gap = b.x - (a.x + a.w)
        if (gap <= MAX_GAP) {
          xs.push(b.x + b.w + gap) // mover's LEFT edge, continuing the row rightward
          xs.push(a.x - gap) // mover's RIGHT edge, continuing leftward
        }
        const pitch = b.x + b.w / 2 - (a.x + a.w / 2)
        if (pitch <= MAX_GAP * 2) {
          cxs.push(b.x + b.w / 2 + pitch) // mover's CENTRE (bulbs snap by centre)
          cxs.push(a.x + a.w / 2 - pitch)
        }
      }
      // same column, a strictly above b
      const xOv = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
      if (xOv > 0 && a.y + a.h <= b.y) {
        const gap = b.y - (a.y + a.h)
        if (gap <= MAX_GAP) {
          ys.push(b.y + b.h + gap)
          ys.push(a.y - gap)
        }
        const pitch = b.y + b.h / 2 - (a.y + a.h / 2)
        if (pitch <= MAX_GAP * 2) {
          cys.push(b.y + b.h / 2 + pitch)
          cys.push(a.y + a.h / 2 - pitch)
        }
      }
    }
  }
  return { xs, ys, cxs, cys }
}

/** Merge several candidate sets into one. */
export function mergeCand(...cands: SnapCand[]): SnapCand {
  const out: Required<SnapCand> = { xs: [], ys: [], cxs: [], cys: [] }
  for (const c of cands) {
    out.xs.push(...c.xs)
    out.ys.push(...c.ys)
    out.cxs.push(...(c.cxs ?? []))
    out.cys.push(...(c.cys ?? []))
  }
  return out
}

/** 1D snap: alignment candidate (within tolAlign) > soft grid (within tolGrid) > 1px. */
export function snap1D(
  raw: number,
  cand: number[],
  tolAlign: number,
  grid: number,
  tolGrid: number,
  pixel: boolean
): { v: number; guide: number | null } {
  let best: number | null = null
  let bd = Infinity
  for (const c of cand) {
    const d = Math.abs(c - raw)
    if (d <= tolAlign && d < bd) {
      bd = d
      best = c
    }
  }
  if (best !== null) return { v: best, guide: best }
  if (grid > 0) {
    const g = Math.round(raw / grid) * grid
    if (Math.abs(g - raw) <= tolGrid) return { v: g, guide: null }
  }
  return { v: pixel ? Math.round(raw) : raw, guide: null }
}

/** Move delta with alignment: shifts (dx,dy) so a salient coordinate lands exactly on a
 *  candidate when close; otherwise whole-pixel. Edge salients only test edge candidates
 *  and centre salients only test centre candidates — the closer family wins. */
export function snapMoveDelta(
  dxRaw: number,
  dyRaw: number,
  sal: Salient,
  cand: SnapCand,
  tolAlign: number
): { dx: number; dy: number; gx: number | null; gy: number | null } {
  const one = (
    delta: number,
    vals: number[],
    cands: number[]
  ): { d: number; g: number | null; bd: number } => {
    let bestDelta = 0
    let bestC: number | null = null
    let bd = Infinity
    for (const v of vals) {
      const moved = v + delta
      for (const c of cands) {
        const d = Math.abs(c - moved)
        if (d <= tolAlign && d < bd) {
          bd = d
          bestDelta = c - v // land exactly on the candidate (no float dust)
          bestC = c
        }
      }
    }
    return bestC !== null
      ? { d: bestDelta, g: bestC, bd }
      : { d: Math.round(delta), g: null, bd: Infinity }
  }
  const axis = (
    delta: number,
    edgeVals: number[],
    centreVals: number[],
    c: SnapCand,
    isX: boolean
  ): { d: number; g: number | null } => {
    const e = one(delta, edgeVals, isX ? c.xs : c.ys)
    const m = one(delta, centreVals, (isX ? c.cxs : c.cys) ?? [])
    return m.bd < e.bd ? m : e
  }
  const rx = axis(dxRaw, sal.xs, sal.cxs ?? [], cand, true)
  const ry = axis(dyRaw, sal.ys, sal.cys ?? [], cand, false)
  return { dx: rx.d, dy: ry.d, gx: rx.g, gy: ry.g }
}

/** Soft axis lock towards H / V / 45° around an anchor (no Shift needed; small radius). */
export function softAxis(anchor: Point, p: Point, tol: number): Point {
  const dx = p.x - anchor.x
  const dy = p.y - anchor.y
  if (Math.abs(dy) <= tol && Math.abs(dx) > Math.abs(dy)) return { x: p.x, y: anchor.y }
  if (Math.abs(dx) <= tol && Math.abs(dy) > Math.abs(dx)) return { x: anchor.x, y: p.y }
  if (Math.abs(Math.abs(dx) - Math.abs(dy)) <= tol) {
    const m = Math.round((Math.abs(dx) + Math.abs(dy)) / 2)
    return { x: anchor.x + Math.sign(dx) * m, y: anchor.y + Math.sign(dy) * m }
  }
  return p
}
