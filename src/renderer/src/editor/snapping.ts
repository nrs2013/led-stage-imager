import type { Point, Shape } from '../model/types'
import { shapeArrayBounds } from './geometry'

/** Alignment candidates: other shapes' bbox edges and (for open shapes) endpoints. */
export interface SnapCand {
  xs: number[]
  ys: number[]
}

export function buildCandidates(shapes: Shape[], exclude: string | null | Set<string>): SnapCand {
  const xs: number[] = []
  const ys: number[] = []
  const skip = (id: string): boolean =>
    typeof exclude === 'string' ? id === exclude : exclude ? exclude.has(id) : false
  for (const sh of shapes) {
    if (skip(sh.id)) continue
    const b = shapeArrayBounds(sh)
    xs.push(b.x, b.x + b.w)
    ys.push(b.y, b.y + b.h)
    if (
      sh.type === 'line' ||
      sh.type === 'polyline' ||
      sh.type === 'freehand' ||
      sh.type === 'festoon'
    ) {
      const a = sh.points[0]
      const z = sh.points[sh.points.length - 1]
      if (a && z) {
        xs.push(a.x, z.x)
        ys.push(a.y, z.y)
      }
    }
  }
  return { xs, ys }
}

/** Salient coordinates of the shape being moved (tested against the candidates).
 *  Includes the bbox CENTRE so a part can land dead-centre on a cutout island. */
export function salientOf(sh: Shape): { xs: number[]; ys: number[] } {
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
    return { xs: [b.x + b.w / 2], ys: [b.y + b.h / 2] }
  }
  const xs = [b.x, b.x + b.w, b.x + b.w / 2]
  const ys = [b.y, b.y + b.h, b.y + b.h / 2]
  if (
    sh.type === 'line' ||
    sh.type === 'polyline' ||
    sh.type === 'freehand' ||
    sh.type === 'festoon'
  ) {
    const a = sh.points[0]
    const z = sh.points[sh.points.length - 1]
    if (a && z) {
      xs.push(a.x, z.x)
      ys.push(a.y, z.y)
    }
  }
  return { xs, ys }
}

/** Salient coordinates of a multi-selection: the GROUP's union bbox edges + centre
 *  (a flock of bulbs centres onto an island as one body). */
export function salientOfGroup(shapes: Shape[]): { xs: number[]; ys: number[] } {
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
  if (!Number.isFinite(minX)) return { xs: [], ys: [] }
  return {
    xs: [minX, maxX, (minX + maxX) / 2],
    ys: [minY, maxY, (minY + maxY) / 2]
  }
}

/** Snap candidates at the CENTRE of every chart cutout island + the canvas centre —
 *  のむさん: a neon sign (or a flock of bulbs) should click onto the middle of the
 *  LED panel it lives in. */
export function centerCandidates(
  regions: { x: number; y: number; w: number; h: number }[],
  canvas: { w: number; h: number }
): SnapCand {
  const xs = [canvas.w / 2]
  const ys = [canvas.h / 2]
  for (const r of regions) {
    xs.push(r.x + r.w / 2)
    ys.push(r.y + r.h / 2)
  }
  return { xs, ys }
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
 *  candidate when close; otherwise whole-pixel. Returns guide coords when aligned. */
export function snapMoveDelta(
  dxRaw: number,
  dyRaw: number,
  sal: { xs: number[]; ys: number[] },
  cand: SnapCand,
  tolAlign: number
): { dx: number; dy: number; gx: number | null; gy: number | null } {
  const one = (
    delta: number,
    vals: number[],
    cands: number[]
  ): { d: number; g: number | null } => {
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
    return bestC !== null ? { d: bestDelta, g: bestC } : { d: Math.round(delta), g: null }
  }
  const rx = one(dxRaw, sal.xs, cand.xs)
  const ry = one(dyRaw, sal.ys, cand.ys)
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
