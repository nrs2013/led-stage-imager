import type { Point, Shape } from '../model/types'
import { drawBulbLit, BULB_DEFAULT_STYLE, type RGB } from './bulb'

export const FESTOON_DEFAULT_SAG = 12 // % of the span length
export const FESTOON_DEFAULT_PITCH = 30 // px along the wire
export const FESTOON_DEFAULT_DIAMETER = 4
export const FESTOON_DEFAULT_GLOW = 55
export const FESTOON_MAX_BULBS = 512

export const festoonSag = (s: Pick<Shape, 'sagPct'>): number => {
  const v = s.sagPct ?? FESTOON_DEFAULT_SAG
  return v < 0 ? 0 : v > 60 ? 60 : v
}
export const festoonPitch = (s: Pick<Shape, 'bulbPitch'>): number => {
  const v = s.bulbPitch ?? FESTOON_DEFAULT_PITCH
  return v < 4 ? 4 : v > 500 ? 500 : v
}
export const festoonDiameter = (s: Pick<Shape, 'diameter'>): number =>
  s.diameter ?? FESTOON_DEFAULT_DIAMETER
/** Glow dial 0–100 (shared `neonGlow` field): 55 = the ball bulb's standard halo. */
export const festoonGlowScale = (s: Pick<Shape, 'neonGlow'>): number => {
  const g = s.neonGlow ?? FESTOON_DEFAULT_GLOW
  const c = g < 0 ? 0 : g > 100 ? 100 : g
  return Math.max(0.05, c / FESTOON_DEFAULT_GLOW)
}

type FPick = Pick<Shape, 'points' | 'sagPct' | 'bulbPitch'>

/** The hanging wire: a quadratic sag curve between the two grabbed ends — visually a
 *  catenary for stage-realistic sags, and dead simple to keep deterministic. The sag
 *  depth is a % of the span, so stretching the string keeps its「らしさ」. */
export function festoonPointAt(shape: FPick, t: number): Point {
  const a = shape.points[0] ?? { x: 0, y: 0 }
  const b = shape.points[shape.points.length - 1] ?? a
  const span = Math.hypot(b.x - a.x, b.y - a.y)
  const sag = (festoonSag(shape) / 100) * span
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t + sag * 4 * t * (1 - t)
  }
}

export function festoonSamples(shape: FPick, n = 96): Point[] {
  const out: Point[] = []
  for (let i = 0; i <= n; i++) out.push(festoonPointAt(shape, i / n))
  return out
}

const layoutCache = new Map<string, Point[]>()

/** Bulb sockets, spaced EQUALLY ALONG THE WIRE (arc length, not the chord) — both
 *  ends always carry a bulb, like the real string. */
export function festoonBulbs(shape: FPick): Point[] {
  const a = shape.points[0] ?? { x: 0, y: 0 }
  const b = shape.points[shape.points.length - 1] ?? a
  const key = `${a.x},${a.y},${b.x},${b.y}|${festoonSag(shape)}|${festoonPitch(shape)}`
  const hit = layoutCache.get(key)
  if (hit) return hit
  const pts = festoonSamples(shape, 240)
  const cum = [0]
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y))
  }
  const L = cum[cum.length - 1]
  const n = Math.min(FESTOON_MAX_BULBS - 1, Math.max(1, Math.floor(L / festoonPitch(shape))))
  const out: Point[] = []
  let j = 0
  for (let k = 0; k <= n; k++) {
    const target = (k / n) * L
    while (j < cum.length - 2 && cum[j + 1] < target) j++
    const seg = cum[j + 1] - cum[j] || 1
    const f = (target - cum[j]) / seg
    out.push({
      x: pts[j].x + (pts[j + 1].x - pts[j].x) * f,
      y: pts[j].y + (pts[j + 1].y - pts[j].y) * f
    })
  }
  if (layoutCache.size > 200) layoutCache.clear()
  layoutCache.set(key, out)
  return out
}

export const festoonCount = (shape: FPick): number => festoonBulbs(shape).length

/** Wire length in px (for the Inspector readout). */
export function festoonLength(shape: FPick): number {
  const pts = festoonSamples(shape, 96)
  let L = 0
  for (let i = 1; i < pts.length; i++) {
    L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
  }
  return L
}

/** Editor schematic: the wire + cold sockets, in the editor's per-shape colours
 *  (the wire never reaches the Syphon output — only lit glass does). */
export function drawFestoonSchematic(
  ctx: CanvasRenderingContext2D,
  shape: Shape,
  stroke: string,
  fill: string,
  boost = 1
): void {
  const pts = festoonSamples(shape, 96)
  if (pts.length < 2) return
  ctx.save()
  ctx.strokeStyle = stroke
  ctx.lineWidth = Math.max(1, boost) * 0.6
  ctx.beginPath()
  ctx.moveTo(pts[0].x, pts[0].y)
  for (const p of pts) ctx.lineTo(p.x, p.y)
  ctx.stroke()
  const r = festoonDiameter(shape) / 2
  ctx.fillStyle = fill
  for (const p of festoonBulbs(shape)) {
    ctx.beginPath()
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
  }
  ctx.restore()
}

/** One lit bulb (instance i), additive-only — the ball bulb's photoreal renderer at
 *  string size, with the per-string glow dial scaling its halo. */
export function drawFestoonBulbLit(
  ctx: CanvasRenderingContext2D,
  shape: Shape,
  rgb: RGB,
  instance: number
): void {
  const p = festoonBulbs(shape)[instance]
  if (!p) return
  drawBulbLit(
    ctx,
    p.x,
    p.y,
    festoonDiameter(shape),
    rgb,
    shape.bulbStyle ?? BULB_DEFAULT_STYLE,
    festoonGlowScale(shape)
  )
}
