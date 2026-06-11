import type { Point, Shape } from '../model/types'
import { bulbHueIntensity, type RGB } from './bulb'

export const PAR_DEFAULT_DIAMETER = 44
export const BLINDER_DEFAULT_WIDTH = 40 // housing width; the unit is 2 cells wide × 4 tall
export const PATT_DEFAULT_DIAMETER = 80 // のむさん: 8連の外形と同じくらいの大物
export const PIXELPATT_DEFAULT_DIAMETER = 100 // 7-cell hex unit's overall width

const mix = (a: RGB, b: RGB, t: number): RGB => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t
]
const rgba = (c: RGB, a: number): string => {
  const al = a < 0 ? 0 : a > 1 ? 1 : a
  return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${al.toFixed(3)})`
}
const W: RGB = [255, 255, 255]

/** Steep-falloff light blob: energy concentrated at the centre (the v6 realism rule —
 *  sources stay hard; wide washes are the smoke's job, not the fixture's). */
function steep(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  col: RGB,
  a: number
): void {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r)
  g.addColorStop(0, rgba(col, a))
  g.addColorStop(0.22, rgba(col, a * 0.5))
  g.addColorStop(0.45, rgba(col, a * 0.18))
  g.addColorStop(0.7, rgba(col, a * 0.05))
  g.addColorStop(1, rgba(col, 0))
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
}

export const parDiameter = (s: Pick<Shape, 'diameter'>): number =>
  s.diameter ?? PAR_DEFAULT_DIAMETER
export const blinderWidth = (s: Pick<Shape, 'diameter'>): number =>
  s.diameter ?? BLINDER_DEFAULT_WIDTH
export const pattDiameter = (s: Pick<Shape, 'diameter'>): number =>
  s.diameter ?? PATT_DEFAULT_DIAMETER
export const pixelPattDiameter = (s: Pick<Shape, 'diameter'>): number =>
  s.diameter ?? PIXELPATT_DEFAULT_DIAMETER

/* ============================== PAR（大型・正面） ============================== */

/** Editor schematic: the cold fixture — housing ring + lens disc (no rings when lit;
 *  the faint structure is an editor-only drawing aid). */
export function drawParSchematic(
  ctx: CanvasRenderingContext2D,
  shape: Shape,
  stroke: string,
  fill: string,
  boost = 1
): void {
  const c = shape.points[0]
  if (!c) return
  const R = parDiameter(shape) / 2
  ctx.save()
  ctx.lineWidth = Math.max(1, boost) * 0.6
  ctx.strokeStyle = stroke
  ctx.fillStyle = fill
  ctx.beginPath()
  ctx.arc(c.x, c.y, R * 1.14, 0, Math.PI * 2)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(c.x, c.y, R, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = stroke
  ctx.fillRect(c.x - 0.5, c.y - 0.5, 1, 1)
  ctx.restore()
}

/** Lit PAR (v6): the lens floods from a hot core to a near-white face — NO drawn
 *  rings (only a faint wide undulation while dim, which the flood swallows), no
 *  streaks. The metal rim catches the light as it climbs. */
export function drawParLit(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  d: number,
  rgb: RGB
): void {
  const { hue, intensity: I } = bulbHueIntensity(rgb)
  if (I <= 0.004) return
  const R = d / 2
  const blast = I > 0.88 ? (I - 0.88) / 0.12 : 0
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.beginPath()
  ctx.arc(cx, cy, R, 0, Math.PI * 2)
  ctx.clip()
  const lens = ctx.createRadialGradient(cx, cy, 0, cx, cy, R)
  lens.addColorStop(0, rgba(mix(hue, W, 0.5 + 0.5 * I), (0.55 + 0.45 * I) * I))
  lens.addColorStop(0.45, rgba(mix(hue, W, 0.55 * blast), (0.4 + 0.55 * I) * I))
  lens.addColorStop(0.85, rgba(hue, (0.3 + 0.5 * I) * I))
  lens.addColorStop(1, rgba(hue, 0.22 * I))
  ctx.fillStyle = lens
  ctx.fillRect(cx - R, cy - R, R * 2, R * 2)
  if (I < 0.55) {
    const f = 1 - I / 0.55
    for (const fr of [0.45, 0.8]) {
      const band = ctx.createRadialGradient(cx, cy, R * (fr - 0.13), cx, cy, R * (fr + 0.13))
      band.addColorStop(0, rgba(hue, 0))
      band.addColorStop(0.5, rgba(mix(hue, W, 0.3), 0.2 * f * I))
      band.addColorStop(1, rgba(hue, 0))
      ctx.fillStyle = band
      ctx.fillRect(cx - R, cy - R, R * 2, R * 2)
    }
  }
  steep(ctx, cx, cy, R * 0.5, mix(hue, W, 0.85), (0.5 + 0.5 * blast) * I)
  ctx.restore()
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  // the lens edge stays crisp; the housing rim catches the spill
  ctx.strokeStyle = rgba(mix(hue, W, 0.2), (0.3 + 0.4 * blast) * I)
  ctx.lineWidth = R * 0.05
  ctx.beginPath()
  ctx.arc(cx, cy, R * 0.99, 0, Math.PI * 2)
  ctx.stroke()
  ctx.strokeStyle = rgba(mix(hue, W, 0.6), 0.16 * I)
  ctx.lineWidth = R * 0.025
  ctx.beginPath()
  ctx.arc(cx, cy, R * 1.14, -2.6, -0.7)
  ctx.stroke()
  ctx.restore()
}

/* ============================ 8連ブラインダー（8灯ミニブル） ============================ */

/** Cell centres of the 2×4 unit (top-left → bottom-right, row-major) — shared by the
 *  renderer, the editor schematic and the MVR export. width = shape.diameter. */
export function blinderCells(shape: Pick<Shape, 'points' | 'diameter'>): Point[] {
  const c = shape.points[0] ?? { x: 0, y: 0 }
  const w = blinderWidth(shape)
  const h = w * 2
  const out: Point[] = []
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 2; col++) {
      out.push({
        x: c.x - w / 2 + (w * (col + 0.5)) / 2,
        y: c.y - h / 2 + (h * (row + 0.5)) / 4
      })
    }
  }
  return out
}

export function drawBlinderSchematic(
  ctx: CanvasRenderingContext2D,
  shape: Shape,
  stroke: string,
  fill: string,
  boost = 1
): void {
  const c = shape.points[0]
  if (!c) return
  const w = blinderWidth(shape)
  const h = w * 2
  const R = (w / 2) * 0.42
  ctx.save()
  ctx.lineWidth = Math.max(1, boost) * 0.6
  ctx.strokeStyle = stroke
  ctx.strokeRect(c.x - w / 2, c.y - h / 2, w, h)
  ctx.fillStyle = fill
  for (const p of blinderCells(shape)) {
    ctx.beginPath()
    ctx.arc(p.x, p.y, R, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
  }
  ctx.fillStyle = stroke
  ctx.fillRect(c.x - 0.5, c.y - 0.5, 1, 1)
  ctx.restore()
}

/** One lit blinder cell (v6「明るく見える」): the core CLIPS TO PURE WHITE from 55%
 *  (over-exposure cue), halos merge between neighbours, and each cell adds its share
 *  of the unit-wide flood — 8 lit cells sum to the molefay wall of light. */
export function drawBlinderCellLit(
  ctx: CanvasRenderingContext2D,
  shape: Shape,
  rgb: RGB,
  instance: number
): void {
  const p = blinderCells(shape)[instance]
  if (!p) return
  const { hue, intensity: a } = bulbHueIntensity(rgb)
  if (a <= 0.004) return
  const c = shape.points[0] ?? p
  const w = blinderWidth(shape)
  const R = w * 0.21
  const clip = a > 0.55 ? (a - 0.55) / 0.45 : 0
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  const refl = ctx.createRadialGradient(p.x, p.y, R * 0.25, p.x, p.y, R * 1.25)
  refl.addColorStop(0, rgba(hue, 0.45 * a))
  refl.addColorStop(1, rgba(hue, 0.08 * a))
  ctx.fillStyle = refl
  ctx.beginPath()
  ctx.arc(p.x, p.y, R * 1.25, 0, Math.PI * 2)
  ctx.fill()
  steep(ctx, p.x, p.y, R, mix(hue, W, 0.4 + 0.5 * a), Math.min(1, 1.3 * a))
  steep(ctx, p.x, p.y, R * 3.2, hue, 0.5 * a)
  if (clip > 0) steep(ctx, p.x, p.y, R * (0.65 + 0.55 * clip), W, Math.min(1, 1.1 * clip))
  // this cell's 1/8 share of the unit flood (all 8 lit ≈ the v6 wall of light)
  steep(ctx, c.x, c.y, w * 1.7, hue, 0.05 * a)
  if (a > 0.75) steep(ctx, c.x, c.y, w * 1.35, mix(hue, W, 0.7), 0.07 * ((a - 0.75) / 0.25))
  ctx.restore()
}

/* ================================= PAT ================================= */

/** Spoke unit vectors (one bar down, two up — matching のむさん's photo). */
const SPOKE_U: [number, number][] = [
  [Math.cos(Math.PI / 2), Math.sin(Math.PI / 2)],
  [Math.cos(Math.PI / 2 + 2.0944), Math.sin(Math.PI / 2 + 2.0944)],
  [Math.cos(Math.PI / 2 - 2.0944), Math.sin(Math.PI / 2 - 2.0944)]
]

interface PattHole {
  x: number
  y: number
  /** static brightness factor: even face + bulb hotspot − thin spoke bars − mild vignette */
  k: number
}

const holeCache = new Map<number, PattHole[]>()

/** Hex-packed mesh holes with brightness baked in. Spoke shadows use VECTOR maths
 *  (no atan2 — the angle-wrap bug that blacked out a whole sector is structurally
 *  impossible here). The face floor is 0.82: no part of the mesh ever goes dark. */
function pattHoles(R: number): PattHole[] {
  const key = Math.round(R * 4)
  const hit = holeCache.get(key)
  if (hit) return hit
  const out: PattHole[] = []
  const s = Math.max(2.4, R / 12)
  const rowH = s * 0.866
  const bx = -R * 0.3
  const by = -R * 0.32
  for (let y = -R - rowH, row = 0; y <= R + rowH; y += rowH, row++) {
    const off = row % 2 ? s / 2 : 0
    for (let x = -R + off; x <= R; x += s) {
      const rr = Math.hypot(x, y)
      if (rr > R * 0.985 || rr < R * 0.04) continue
      let spokeDim = 1
      for (const [ux, uy] of SPOKE_U) {
        const along = x * ux + y * uy
        const perp = Math.abs(x * uy - y * ux)
        if (along > 0 && perp < s * 0.28) spokeDim = 0.38
      }
      const hot = Math.max(0, 1 - Math.hypot(x - bx, y - by) / (R * 1.6))
      const k = (0.82 + 0.33 * hot) * (1 - 0.12 * (rr / R)) * spokeDim
      out.push({ x, y, k })
    }
  }
  if (holeCache.size > 40) holeCache.clear()
  holeCache.set(key, out)
  return out
}

export function drawPattSchematic(
  ctx: CanvasRenderingContext2D,
  shape: Shape,
  stroke: string,
  fill: string,
  boost = 1
): void {
  const c = shape.points[0]
  if (!c) return
  drawPattSchematicAt(ctx, c.x, c.y, pattDiameter(shape) / 2, stroke, fill, boost)
  ctx.save()
  ctx.fillStyle = stroke
  ctx.fillRect(c.x - 0.5, c.y - 0.5, 1, 1)
  ctx.restore()
}

function drawPattSchematicAt(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  R: number,
  stroke: string,
  fill: string,
  boost = 1
): void {
  ctx.save()
  ctx.lineWidth = Math.max(1, boost) * 0.6
  ctx.strokeStyle = stroke
  ctx.beginPath()
  ctx.arc(x, y, R * 1.1, 0, Math.PI * 2)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(x, y, R, 0, Math.PI * 2)
  ctx.stroke()
  for (const [ux, uy] of SPOKE_U) {
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + ux * R, y + uy * R)
    ctx.stroke()
  }
  if (R >= 18) {
    ctx.fillStyle = fill
    for (const h of pattHoles(R)) ctx.fillRect(x + h.x - 0.5, y + h.y - 0.5, 1, 1)
  }
  ctx.restore()
}

/** Lit PAT (v6): the whole golden mesh glows evenly (floor 0.82), the bare bulb
 *  burns upper-left, thin spoke bars shade their own line only, and FULL floods the
 *  face white. No streaks, no dead sectors. */
export function drawPattLit(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  d: number,
  rgb: RGB
): void {
  const { hue, intensity: I } = bulbHueIntensity(rgb)
  if (I <= 0.004) return
  const R = d / 2
  const blast = I > 0.88 ? (I - 0.88) / 0.12 : 0
  const s = Math.max(2.4, R / 12)
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  const face = ctx.createRadialGradient(cx, cy, 0, cx, cy, R)
  face.addColorStop(0, rgba(hue, 0.18 * I))
  face.addColorStop(1, rgba(hue, 0.1 * I))
  ctx.fillStyle = face
  ctx.beginPath()
  ctx.arc(cx, cy, R, 0, Math.PI * 2)
  ctx.fill()
  for (const h of pattHoles(R)) {
    const a = Math.min(1, I * h.k)
    if (a < 0.012) continue
    ctx.fillStyle = rgba(mix(hue, W, 0.15 + 0.45 * a + 0.3 * blast), a)
    ctx.beginPath()
    ctx.arc(cx + h.x, cy + h.y, s * 0.36 * (0.85 + 0.35 * a), 0, Math.PI * 2)
    ctx.fill()
  }
  const bx = cx - R * 0.3
  const by = cy - R * 0.32
  steep(ctx, bx, by, R * 0.55, mix(hue, W, 0.85), 0.55 * I)
  if (blast > 0) steep(ctx, bx, by, R * 0.7, W, 0.55 * blast)
  ctx.strokeStyle = rgba(mix(hue, W, 0.3), (0.18 + 0.3 * blast) * I)
  ctx.lineWidth = R * 0.035
  ctx.beginPath()
  ctx.arc(cx, cy, R, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()
}

/* ============================== Pixel PAT ============================== */

/** Cell centres of the 7-cell hex unit: instance 0 = centre, 1..6 = the ring,
 *  starting at the TOP and going clockwise. diameter = overall unit width. */
export function pixelPattCells(shape: Pick<Shape, 'points' | 'diameter'>): Point[] {
  const c = shape.points[0] ?? { x: 0, y: 0 }
  const D = pixelPattDiameter(shape)
  const ring = D / 3 // cell diameter ≈ ring radius: photo-true packing with frame gaps
  const out: Point[] = [{ x: c.x, y: c.y }]
  for (let k = 0; k < 6; k++) {
    const ang = -Math.PI / 2 + (k * Math.PI) / 3
    out.push({ x: c.x + Math.cos(ang) * ring, y: c.y + Math.sin(ang) * ring })
  }
  return out
}

export const pixelPattCellDiameter = (shape: Pick<Shape, 'points' | 'diameter'>): number =>
  (pixelPattDiameter(shape) / 3) * 0.92

export function drawPixelPattSchematic(
  ctx: CanvasRenderingContext2D,
  shape: Shape,
  stroke: string,
  fill: string,
  boost = 1
): void {
  const c = shape.points[0]
  if (!c) return
  const D = pixelPattDiameter(shape)
  ctx.save()
  ctx.lineWidth = Math.max(1, boost) * 0.6
  ctx.strokeStyle = stroke
  // the hex frame, flat-top like the photo
  ctx.beginPath()
  for (let k = 0; k < 6; k++) {
    const ang = -Math.PI / 2 + Math.PI / 6 + (k * Math.PI) / 3
    const px = c.x + Math.cos(ang) * D * 0.52
    const py = c.y + Math.sin(ang) * D * 0.52
    if (k === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.closePath()
  ctx.stroke()
  ctx.restore()
  const cd = pixelPattCellDiameter(shape)
  for (const p of pixelPattCells(shape)) {
    drawPattSchematicAt(ctx, p.x, p.y, cd / 2, stroke, fill, boost)
  }
  ctx.save()
  ctx.fillStyle = stroke
  ctx.fillRect(c.x - 0.5, c.y - 0.5, 1, 1)
  ctx.restore()
}

/** One lit Pixel PAT cell (instance i): a mini PAT — per-cell DMX is the whole
 *  point of the fixture (chase the 7 cells from the desk; 間隔0 for一斉). */
export function drawPixelPattCellLit(
  ctx: CanvasRenderingContext2D,
  shape: Shape,
  rgb: RGB,
  instance: number
): void {
  const p = pixelPattCells(shape)[instance]
  if (!p) return
  drawPattLit(ctx, p.x, p.y, pixelPattCellDiameter(shape), rgb)
}
