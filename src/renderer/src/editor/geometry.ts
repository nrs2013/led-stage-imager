import type { Point, Shape } from '../model/types'

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

/** Overall bounding box of a shape, accounting for its derived geometry. */
export function shapeBounds(shape: Shape): Bounds {
  if (shape.points.length < 2) return boundsOfPoints(shape.points)
  switch (shape.type) {
    case 'rect':
    case 'ellipse':
    case 'triangle':
    case 'star':
    case 'polygon':
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
    case 'rect': {
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
