import type { Point, Shape } from '../model/types'
import { drawBulbLit, bulbHueIntensity, BULB_DEFAULT_STYLE, type RGB } from './bulb'
import { reflectGain } from './fixtures'

export const FESTOON_DEFAULT_SAG = 12 // % of the span length
export const FESTOON_DEFAULT_PITCH = 30 // px along the wire
export const FESTOON_DEFAULT_DIAMETER = 7
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

const WIRE_STEEL: RGB = [132, 134, 142]
const wireMix = (a: RGB, b: RGB, t: number): RGB => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t
]

/** Arc-distance falloff of one lit bulb's wash along the wire (0..1). Exported for
 *  tests: the wire must be brightest at the socket and gone past `reach`. */
export function wireWash(arcDist: number, reach: number): number {
  if (arcDist >= reach || reach <= 0) return 0
  const f = 1 - arcDist / reach
  return f * f
}

/** Lit wire (additive, drawn once per string): the cord is visible ONLY where a lit
 *  bulb washes it — brightest at the socket, fading along the wire with distance,
 *  melted into the dark beyond reach (のむさん 2026-06-11). Unlit stretches and
 *  all-off strings draw nothing at all. */
export function drawFestoonWireLit(
  ctx: CanvasRenderingContext2D,
  shape: Shape,
  rgbs: RGB[]
): void {
  const bulbs = festoonBulbs(shape)
  if (bulbs.length < 1) return
  const pts = festoonSamples(shape, 240)
  const cum: number[] = [0]
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y))
  }
  const L = cum[cum.length - 1]
  if (L <= 0) return
  const denom = Math.max(1, bulbs.length - 1)
  const lit: { arc: number; hue: RGB; I: number }[] = []
  for (let k = 0; k < bulbs.length; k++) {
    const { hue, intensity } = bulbHueIntensity(rgbs[k] ?? ([0, 0, 0] as RGB))
    if (intensity > 0.004) lit.push({ arc: (k / denom) * L, hue, I: intensity })
  }
  if (lit.length === 0) return
  const reach = Math.max(festoonPitch(shape) * 1.5, festoonDiameter(shape) * 6)
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.lineCap = 'round'
  ctx.lineWidth = 1
  for (let i = 0; i < pts.length - 1; i++) {
    const mid = (cum[i] + cum[i + 1]) / 2
    let a = 0
    let r = 0
    let g = 0
    let b = 0
    for (const lb of lit) {
      // a full-blast bulb GLARES its own cord away (reflectGain peaks mid-gauge)
      const w = reflectGain(lb.I) * wireWash(Math.abs(mid - lb.arc), reach)
      if (w <= 0) continue
      a += w
      r += lb.hue[0] * w
      g += lb.hue[1] * w
      b += lb.hue[2] * w
    }
    if (a <= 0.012) continue
    const hue: RGB = [r / a, g / a, b / a]
    const col = wireMix(WIRE_STEEL, hue, 0.45)
    ctx.strokeStyle = `rgba(${col[0] | 0},${col[1] | 0},${col[2] | 0},${Math.min(1, 0.34 * Math.min(1, a)).toFixed(3)})`
    ctx.beginPath()
    ctx.moveTo(pts[i].x, pts[i].y)
    ctx.lineTo(pts[i + 1].x, pts[i + 1].y)
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
