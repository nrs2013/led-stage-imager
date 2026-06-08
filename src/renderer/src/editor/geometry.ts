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
