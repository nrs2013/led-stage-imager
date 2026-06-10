import type { Point, Shape } from '../model/types'
import { shapeArrayBounds } from './geometry'

/** Alignment candidates: other shapes' bbox edges and (for open shapes) endpoints. */
export interface SnapCand {
  xs: number[]
  ys: number[]
}

export function buildCandidates(shapes: Shape[], excludeId: string | null): SnapCand {
  const xs: number[] = []
  const ys: number[] = []
  for (const sh of shapes) {
    if (sh.id === excludeId) continue
    const b = shapeArrayBounds(sh)
    xs.push(b.x, b.x + b.w)
    ys.push(b.y, b.y + b.h)
    if (sh.type === 'line' || sh.type === 'polyline' || sh.type === 'freehand') {
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

/** Salient coordinates of the shape being moved (tested against the candidates). */
export function salientOf(sh: Shape): { xs: number[]; ys: number[] } {
  const b = shapeArrayBounds(sh)
  const xs = [b.x, b.x + b.w]
  const ys = [b.y, b.y + b.h]
  if (sh.type === 'line' || sh.type === 'polyline' || sh.type === 'freehand') {
    const a = sh.points[0]
    const z = sh.points[sh.points.length - 1]
    if (a && z) {
      xs.push(a.x, z.x)
      ys.push(a.y, z.y)
    }
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
