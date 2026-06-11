import type { Point, Shape } from '../model/types'
import { BULB_DEFAULT_DIAMETER } from '../render/bulb'
import { neonBounds } from '../render/neon'
import { festoonSamples } from '../render/festoon'

export interface Bounds {
  x: number
  y: number
  w: number
  h: number
}

export function boundsOfPoints(points: Point[]): Bounds {
  if (points.length === 0) return { x: 0, y: 0, w: 0, h: 0 }
  let minX = points[0].x
  let minY = points[0].y
  let maxX = points[0].x
  let maxY = points[0].y
  for (const p of points) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

/** Two-corner bounds (for drag-sized shapes: rect/ellipse/triangle/star). */
export function cornerBounds(a: Point, b: Point): Bounds {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y)
  }
}

export const pointsAttr = (points: Point[]): string => points.map((p) => `${p.x},${p.y}`).join(' ')

/** Triangle inscribed in a two-corner box: apex top-center, base along the bottom. */
export function trianglePoints(a: Point, b: Point): Point[] {
  const { x, y, w, h } = cornerBounds(a, b)
  return [
    { x: x + w / 2, y },
    { x: x + w, y: y + h },
    { x, y: y + h }
  ]
}

/** Star inscribed in a two-corner box. */
export function starPoints(a: Point, b: Point, spikes = 5): Point[] {
  const { x, y, w, h } = cornerBounds(a, b)
  const cx = x + w / 2
  const cy = y + h / 2
  const outerX = w / 2
  const outerY = h / 2
  const inner = 0.42
  const pts: Point[] = []
  const start = -Math.PI / 2
  for (let i = 0; i < spikes * 2; i++) {
    const ang = start + (i * Math.PI) / spikes
    const r = i % 2 === 0 ? 1 : inner
    pts.push({ x: cx + Math.cos(ang) * outerX * r, y: cy + Math.sin(ang) * outerY * r })
  }
  return pts
}

/** Regular polygon (default hexagon) inscribed in a two-corner box. */
export function regularPolygonPoints(a: Point, b: Point, sides = 6): Point[] {
  const { x, y, w, h } = cornerBounds(a, b)
  const cx = x + w / 2
  const cy = y + h / 2
  const pts: Point[] = []
  const start = -Math.PI / 2
  for (let i = 0; i < sides; i++) {
    const ang = start + (i * 2 * Math.PI) / sides
    pts.push({ x: cx + (Math.cos(ang) * w) / 2, y: cy + (Math.sin(ang) * h) / 2 })
  }
  return pts
}

/** Bulb glass diameter with the shared default applied. */
export const bulbDiameter = (shape: Shape): number => shape.diameter ?? BULB_DEFAULT_DIAMETER

/** Overall bounding box of a shape, accounting for its derived geometry. */
export function shapeBounds(shape: Shape): Bounds {
  if (shape.type === 'bulb' && shape.points.length >= 1) {
    const c = shape.points[0]
    const d = bulbDiameter(shape)
    return { x: c.x - d / 2, y: c.y - d / 2, w: d, h: d }
  }
  if (shape.type === 'neon' && shape.points.length >= 1) {
    return neonBounds(shape)
  }
  if (shape.type === 'festoon' && shape.points.length >= 2) {
    return boundsOfPoints(festoonSamples(shape, 48)) // the belly hangs below the chord
  }
  if (shape.points.length < 2) return boundsOfPoints(shape.points)
  switch (shape.type) {
    case 'rect':
    case 'ellipse':
    case 'triangle':
    case 'star':
    case 'polygon':
    case 'stars':
      // 'polygon' from the tool uses two-corner box; explicit polylines use their points.
      return cornerBounds(shape.points[0], shape.points[shape.points.length - 1])
    default:
      return boundsOfPoints(shape.points)
  }
}

function polyTrace(ctx: CanvasRenderingContext2D, pts: Point[]): void {
  if (pts.length === 0) return
  ctx.moveTo(pts[0].x, pts[0].y)
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
  ctx.closePath()
}

/** Traces a shape's path into a 2D canvas context (no fill/stroke). Shared by the
 *  Canvas-based editor renderer. */
export function traceShape(ctx: CanvasRenderingContext2D, shape: Shape): void {
  const p = shape.points
  if (shape.type === 'bulb' && p.length >= 1) {
    const d = bulbDiameter(shape)
    ctx.beginPath()
    ctx.arc(p[0].x, p[0].y, d / 2, 0, Math.PI * 2)
    return
  }
  if (shape.type === 'neon' && p.length >= 1) {
    const b = neonBounds(shape)
    ctx.beginPath()
    ctx.rect(b.x, b.y, b.w, b.h)
    return
  }
  if (shape.type === 'festoon' && p.length >= 2) {
    const pts = festoonSamples(shape, 48)
    ctx.beginPath()
    ctx.moveTo(pts[0].x, pts[0].y)
    for (const q of pts) ctx.lineTo(q.x, q.y)
    return
  }
  if (p.length < 2) return
  ctx.beginPath()
  switch (shape.type) {
    case 'line':
      ctx.moveTo(p[0].x, p[0].y)
      ctx.lineTo(p[1].x, p[1].y)
      break
    case 'polyline':
    case 'freehand':
      ctx.moveTo(p[0].x, p[0].y)
      for (let i = 1; i < p.length; i++) ctx.lineTo(p[i].x, p[i].y)
      break
    case 'rect':
    case 'stars': {
      const b = cornerBounds(p[0], p[p.length - 1])
      ctx.rect(b.x, b.y, b.w, b.h)
      break
    }
    case 'ellipse': {
      const b = cornerBounds(p[0], p[p.length - 1])
      ctx.ellipse(b.x + b.w / 2, b.y + b.h / 2, b.w / 2, b.h / 2, 0, 0, Math.PI * 2)
      break
    }
    case 'triangle':
      polyTrace(ctx, trianglePoints(p[0], p[p.length - 1]))
      break
    case 'star':
      polyTrace(ctx, starPoints(p[0], p[p.length - 1]))
      break
    case 'polygon':
      polyTrace(ctx, regularPolygonPoints(p[0], p[p.length - 1]))
      break
  }
}

/** A painted dot run: freehand whose points all sit on cell centres (x.5/y.5) —
 *  these render as crisp filled cells, never as anti-aliased strokes. */
export function isCellRun(shape: Shape): boolean {
  return (
    shape.type === 'freehand' &&
    shape.points.length >= 1 &&
    shape.points.every(
      (p) => Math.abs((p.x % 1) - 0.5) < 1e-6 && Math.abs((p.y % 1) - 0.5) < 1e-6
    )
  )
}

/** Distance from point p to segment ab. */
export function segDist(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y)
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2
  t = t < 0 ? 0 : t > 1 ? 1 : t
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/** 4-connected cell path from a to b (integer cells, Bresenham stairs — one axis per
 *  step, no diagonal jumps), excluding a, including b. The pixel painter runs every
 *  pointer sample through this so a fast drag still fills every dot on the way. */
export function cellsBetween(a: Point, b: Point): Point[] {
  const out: Point[] = []
  const dx = Math.abs(b.x - a.x)
  const dy = Math.abs(b.y - a.y)
  const sx = b.x > a.x ? 1 : -1
  const sy = b.y > a.y ? 1 : -1
  let x = a.x
  let y = a.y
  let err = dx - dy
  while (x !== b.x || y !== b.y) {
    if (x !== b.x && (y === b.y || 2 * err > -dy)) {
      err -= dy
      x += sx
    } else {
      err += dx
      y += sy
    }
    out.push({ x, y })
  }
  return out
}

function segsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const o = (p: Point, q: Point, r: Point): number =>
    Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x))
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b)
}

function segIntersectsRect(
  a: Point,
  b: Point,
  x0: number,
  y0: number,
  x1: number,
  y1: number
): boolean {
  const inside = (p: Point): boolean => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1
  if (inside(a) || inside(b)) return true
  const c1 = { x: x0, y: y0 }
  const c2 = { x: x1, y: y0 }
  const c3 = { x: x1, y: y1 }
  const c4 = { x: x0, y: y1 }
  return (
    segsCross(a, b, c1, c2) || segsCross(a, b, c2, c3) || segsCross(a, b, c3, c4) || segsCross(a, b, c4, c1)
  )
}

/** True when the shape's ACTUAL geometry touches the rect — not just its bounding box.
 *  (An L-shaped chain has a huge, mostly-empty bbox; rubber-band selection must not
 *  grab it through that empty interior.) */
export function shapeIntersectsRect(
  shape: Shape,
  x0: number,
  y0: number,
  x1: number,
  y1: number
): boolean {
  const b = shapeArrayBounds(shape)
  if (b.x >= x1 || b.x + b.w <= x0 || b.y >= y1 || b.y + b.h <= y0) return false
  if (shape.repeat && shape.repeat.count > 1) return true // arrays: bbox is close enough
  if (shape.type === 'freehand') {
    return shape.points.some((p) => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1)
  }
  if (shape.type === 'line' || shape.type === 'polyline') {
    for (let i = 1; i < shape.points.length; i++) {
      if (segIntersectsRect(shape.points[i - 1], shape.points[i], x0, y0, x1, y1)) return true
    }
    return false
  }
  return true // closed box shapes fill their bbox closely enough
}

/** Where pasted clipboard content lands relative to the clicked spot: PARTS (bulbs,
 *  neon signs) anchor by their CENTRE (the clicked dot becomes the centre — のむさん指定),
 *  everything else keeps the original top-left anchor. Whole-cell deltas keep .5 centres crisp. */
export function pasteDelta(shapes: Shape[], at: Point): Point {
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
  const allBulbs =
    shapes.length > 0 &&
    shapes.every(
      (sh) =>
        sh.type === 'bulb' || sh.type === 'neon' || sh.type === 'stars' || sh.type === 'festoon'
    )
  if (allBulbs) {
    return {
      x: Math.round(at.x - (minX + maxX) / 2),
      y: Math.round(at.y - (minY + maxY) / 2)
    }
  }
  return { x: Math.round(at.x - minX), y: Math.round(at.y - minY) }
}

/** Bounds of a shape including its repeat-array extent. */
export function shapeArrayBounds(shape: Shape): Bounds {
  const b = shapeBounds(shape)
  if (!shape.repeat || shape.repeat.count <= 1) return b
  const c = shape.repeat.count - 1
  const ex = shape.repeat.dx * c
  const ey = shape.repeat.dy * c
  return {
    x: Math.min(b.x, b.x + ex),
    y: Math.min(b.y, b.y + ey),
    w: b.w + Math.abs(ex),
    h: b.h + Math.abs(ey)
  }
}
