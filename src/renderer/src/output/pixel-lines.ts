import type { Chart, Point, Shape } from '../model/types'
import { resolveGlowPx } from './glow'

/** Opt-in only: other fixtures, repeated fixtures and glow retain their existing renderer. */
export function isPixelLine(shape: Shape, chart: Chart): boolean {
  return (
    chart.settings.outputPixelLines === true &&
    !chart.settings.glow &&
    resolveGlowPx(shape, chart.settings) === 0 &&
    (shape.repeat?.count ?? 1) <= 1 &&
    ['line', 'polyline', 'freehand'].includes(shape.type)
  )
}

// Clip before walking: off-canvas endpoints must not allocate millions of cells.
function clip(a: Point, b: Point, w: number, h: number): [Point, Point] | null {
  const dx = b.x - a.x,
    dy = b.y - a.y
  let lo = 0,
    hi = 1
  for (const [p, q] of [
    [-dx, a.x],
    [dx, w - 1 - a.x],
    [-dy, a.y],
    [dy, h - 1 - a.y]
  ]) {
    if (p === 0) {
      if (q < 0) return null
      continue
    }
    const t = q / p
    if (p < 0) lo = Math.max(lo, t)
    else hi = Math.min(hi, t)
    if (lo > hi) return null
  }
  return [
    { x: a.x + lo * dx, y: a.y + lo * dy },
    { x: a.x + hi * dx, y: a.y + hi * dy }
  ]
}

/** Rasterize the vector directly into opaque transmission pixels, not a reduced bitmap.
 *  Original chart coordinates stay untouched. Quantization is <1 transmission pixel.
 *  Deduplicate the whole path so corners / a closed circle don't add RGB twice. */
export function pixelLine(shape: Shape, source: Chart['canvas'], out: Chart['canvas']): Shape {
  const sx = out.w / source.w,
    sy = out.h / source.h
  const points = (shape.type === 'line' ? shape.points.slice(0, 2) : shape.points).map((p) => ({
    x: Math.floor(p.x * sx),
    y: Math.floor(p.y * sy)
  }))
  const cells = new Map<number, Point>()
  const add = (x: number, y: number): void => {
    if (x >= 0 && x < out.w && y >= 0 && y < out.h)
      cells.set(y * out.w + x, { x: x + 0.5, y: y + 0.5 })
  }
  if (points.length === 1 && Number.isFinite(points[0].x) && Number.isFinite(points[0].y))
    add(points[0].x, points[0].y)
  for (let i = 1; i < points.length; i++) {
    if (![points[i - 1].x, points[i - 1].y, points[i].x, points[i].y].every(Number.isFinite))
      continue
    const segment = clip(points[i - 1], points[i], out.w, out.h)
    if (!segment) continue
    let x = Math.round(segment[0].x),
      y = Math.round(segment[0].y)
    const bx = Math.round(segment[1].x),
      by = Math.round(segment[1].y)
    const dx = Math.abs(bx - x),
      dy = -Math.abs(by - y),
      stepx = x < bx ? 1 : -1,
      stepy = y < by ? 1 : -1
    let error = dx + dy
    for (;;) {
      add(x, y)
      if (x === bx && y === by) break
      const twice = 2 * error
      if (twice >= dy) {
        error += dy
        x += stepx
      }
      if (twice <= dx) {
        error += dx
        y += stepy
      }
    }
  }
  return {
    ...shape,
    type: 'freehand',
    points: [...cells.values()],
    strokeWidth: 1,
    repeat: undefined,
    verts: undefined
  }
}
