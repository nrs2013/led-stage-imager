import type { Point, Shape } from '../model/types'
import { bulbHueIntensity, type RGB } from './bulb'

export const PAR_DEFAULT_DIAMETER = 44
export const BLINDER_DEFAULT_WIDTH = 40 // housing width; the unit is 2 cells wide × 4 tall
export const PATT_DEFAULT_DIAMETER = 80 // のむさん: 8連の外形と同じくらいの大物

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

export const parDiameter = (s: Pick<Shape, 'diameter'>): number =>
  s.diameter ?? PAR_DEFAULT_DIAMETER
export const blinderWidth = (s: Pick<Shape, 'diameter'>): number =>
  s.diameter ?? BLINDER_DEFAULT_WIDTH
export const pattDiameter = (s: Pick<Shape, 'diameter'>): number =>
  s.diameter ?? PATT_DEFAULT_DIAMETER

/* ============================== PAR（大型・正面） ============================== */

/** Editor schematic: the cold fixture — housing ring, lens disc, faint fresnel rings. */
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
  for (const fr of [0.35, 0.68]) {
    ctx.beginPath()
    ctx.arc(c.x, c.y, R * fr, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.fillStyle = stroke
  ctx.fillRect(c.x - 0.5, c.y - 0.5, 1, 1)
  ctx.restore()
}

/** Lit PAR, additive-only. No anamorphic streak (のむさん: 線はいらない) — instead the
 *  whole lens floods and the corona swells, so FULL reads as「全体的に明るい」. */
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
  const vis = Math.pow(I, 1.4)
  const blast = I > 0.9 ? (I - 0.9) / 0.1 : 0
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  // lens flood: hot centre growing to a near-white full face
  const lens = ctx.createRadialGradient(cx, cy, 0, cx, cy, R)
  lens.addColorStop(0, rgba(mix(hue, W, 0.55 + 0.45 * I), 0.5 + 0.5 * I))
  lens.addColorStop(0.55, rgba(mix(hue, W, 0.25 * I + 0.55 * blast), (0.45 + 0.5 * I) * I))
  lens.addColorStop(1, rgba(hue, 0.22 * I))
  ctx.fillStyle = lens
  ctx.beginPath()
  ctx.arc(cx, cy, R, 0, Math.PI * 2)
  ctx.fill()
  // fresnel rings: visible structure at low/mid, washed out by the flood at full
  const ringA = (0.08 + 0.3 * I) * (1 - 0.8 * blast)
  for (const fr of [0.3, 0.52, 0.74, 0.92]) {
    ctx.strokeStyle = rgba(mix(hue, W, 0.5), ringA * (1 - fr * 0.35))
    ctx.lineWidth = R * 0.025
    ctx.beginPath()
    ctx.arc(cx, cy, R * fr, 0, Math.PI * 2)
    ctx.stroke()
  }
  // filament core
  const fil = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.32)
  fil.addColorStop(0, rgba(W, 0.6 * I + 0.4 * blast))
  fil.addColorStop(0.5, rgba(mix(hue, W, 0.8), 0.5 * I))
  fil.addColorStop(1, rgba(hue, 0))
  ctx.fillStyle = fil
  ctx.beginPath()
  ctx.arc(cx, cy, R * 0.32, 0, Math.PI * 2)
  ctx.fill()
  // corona: wide, and at the top of the fader it surges instead of streaking
  const cr = R * (1.4 + 2.6 * vis + 1.2 * blast)
  const cor = ctx.createRadialGradient(cx, cy, R * 0.5, cx, cy, cr)
  cor.addColorStop(0, rgba(hue, 0.32 * I + 0.1 * blast))
  cor.addColorStop(0.45, rgba(mix(hue, W, 0.3), (0.12 + 0.12 * blast) * I))
  cor.addColorStop(1, rgba(hue, 0))
  ctx.fillStyle = cor
  ctx.beginPath()
  ctx.arc(cx, cy, cr, 0, Math.PI * 2)
  ctx.fill()
  // full-on white wash across the whole face
  if (blast > 0) {
    const wash = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * (1.15 + 0.5 * blast))
    wash.addColorStop(0, rgba(W, 0.85 * blast))
    wash.addColorStop(0.6, rgba(mix(hue, W, 0.7), 0.4 * blast))
    wash.addColorStop(1, rgba(hue, 0))
    ctx.fillStyle = wash
    ctx.beginPath()
    ctx.arc(cx, cy, R * (1.15 + 0.5 * blast), 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

/* ============================ 8連ブラインダー ============================ */

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
  const R = (w / 2) * 0.36
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

/** One lit blinder cell (instance i) — per-bulb DMX exactly like the festoon, so
 *  間隔0=一斉（既定）/ 間隔3=8球バラバラ both fall out of the addressing. */
export function drawBlinderCellLit(
  ctx: CanvasRenderingContext2D,
  shape: Shape,
  rgb: RGB,
  instance: number
): void {
  const p = blinderCells(shape)[instance]
  if (!p) return
  const { hue, intensity: I } = bulbHueIntensity(rgb)
  if (I <= 0.004) return
  const R = (blinderWidth(shape) / 2) * 0.36
  const blast = I > 0.9 ? (I - 0.9) / 0.1 : 0
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, R)
  g.addColorStop(0, rgba(mix(hue, W, 0.6 + 0.4 * blast), 0.85 * I))
  g.addColorStop(0.55, rgba(hue, 0.6 * I))
  g.addColorStop(1, rgba(hue, 0.12 * I))
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(p.x, p.y, R, 0, Math.PI * 2)
  ctx.fill()
  const hr = R * (1.7 + 2.0 * Math.pow(I, 1.4) + 0.8 * blast)
  const halo = ctx.createRadialGradient(p.x, p.y, R * 0.4, p.x, p.y, hr)
  halo.addColorStop(0, rgba(hue, 0.3 * I))
  halo.addColorStop(1, rgba(hue, 0))
  ctx.fillStyle = halo
  ctx.beginPath()
  ctx.arc(p.x, p.y, hr, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = rgba(W, 0.55 * I * I + 0.45 * blast)
  ctx.beginPath()
  ctx.arc(p.x, p.y, R * 0.36, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

/* ================================= PAT ================================= */

/** The mesh holes (hex-packed) with the 3 spoke bars and the hub left dark — light
 *  comes through the golden grid, never as lines (のむさん: 線にしない). */
function pattHoles(R: number): { x: number; y: number; k: number }[] {
  const out: { x: number; y: number; k: number }[] = []
  const s = Math.max(2.4, R / 13)
  const rowH = s * 0.866
  // bulb sits upper-left behind the mesh, like the photo
  const bx = -R * 0.3
  const by = -R * 0.32
  const spokes = [Math.PI / 2, Math.PI / 2 + (2 * Math.PI) / 3, Math.PI / 2 - (2 * Math.PI) / 3]
  let row = 0
  for (let y = -R; y <= R; y += rowH, row++) {
    const off = row % 2 ? s / 2 : 0
    for (let x = -R + off; x <= R; x += s) {
      const r = Math.hypot(x, y)
      if (r > R * 0.97) continue
      if (r < R * 0.07) continue // hub plate
      const ang = Math.atan2(y, x)
      let nearSpoke = false
      for (const sa of spokes) {
        let da = Math.abs(ang - sa)
        if (da > Math.PI) da = 2 * Math.PI - da
        if (r * Math.sin(Math.min(da, Math.PI / 2)) < s * 0.55) nearSpoke = true
      }
      if (nearSpoke) continue
      // brightness: hot near the bulb, falling off across the face, dimmer at the rim
      const k = Math.max(0.12, 1.15 - Math.hypot(x - bx, y - by) / (R * 1.7)) * (1 - (r / R) * 0.25)
      out.push({ x, y, k })
    }
  }
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
  const R = pattDiameter(shape) / 2
  ctx.save()
  ctx.lineWidth = Math.max(1, boost) * 0.6
  ctx.strokeStyle = stroke
  ctx.beginPath()
  ctx.arc(c.x, c.y, R * 1.1, 0, Math.PI * 2)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(c.x, c.y, R, 0, Math.PI * 2)
  ctx.stroke()
  for (const sa of [Math.PI / 2, Math.PI / 2 + (2 * Math.PI) / 3, Math.PI / 2 - (2 * Math.PI) / 3]) {
    ctx.beginPath()
    ctx.moveTo(c.x, c.y)
    ctx.lineTo(c.x + Math.cos(sa) * R, c.y + Math.sin(sa) * R)
    ctx.stroke()
  }
  ctx.fillStyle = fill
  for (const hδ of pattHoles(R)) {
    ctx.fillRect(c.x + hδ.x - 0.5, c.y + hδ.y - 0.5, 1, 1)
  }
  ctx.fillStyle = stroke
  ctx.fillRect(c.x - 0.5, c.y - 0.5, 1, 1)
  ctx.restore()
}

/** Lit PAT, additive-only: hundreds of mesh holes glowing (each its own dot of
 *  light), the bare bulb burning upper-left behind the grid, a soft face bloom and
 *  corona — at FULL the whole golden face floods white. No streaks. */
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
  const vis = Math.pow(I, 1.4)
  const blast = I > 0.9 ? (I - 0.9) / 0.1 : 0
  const s = Math.max(2.4, R / 13)
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  // faint base wash so the face reads as one object even at low fader
  const base = ctx.createRadialGradient(cx, cy, 0, cx, cy, R)
  base.addColorStop(0, rgba(hue, 0.10 * I))
  base.addColorStop(1, rgba(hue, 0.03 * I))
  ctx.fillStyle = base
  ctx.beginPath()
  ctx.arc(cx, cy, R, 0, Math.PI * 2)
  ctx.fill()
  // the mesh: every hole is a grain of light
  const dotR = s * 0.34
  for (const hδ of pattHoles(R)) {
    const a = I * hδ.k
    if (a < 0.01) continue
    ctx.fillStyle = rgba(mix(hue, W, 0.18 + 0.45 * a + 0.35 * blast), Math.min(1, a))
    ctx.beginPath()
    ctx.arc(cx + hδ.x, cy + hδ.y, dotR * (0.85 + 0.3 * a), 0, Math.PI * 2)
    ctx.fill()
  }
  // the bare bulb behind the grid (upper-left, like the photo)
  const bx = cx - R * 0.3
  const by = cy - R * 0.32
  const bulb = ctx.createRadialGradient(bx, by, 0, bx, by, R * 0.34)
  bulb.addColorStop(0, rgba(W, 0.8 * I + 0.2 * blast))
  bulb.addColorStop(0.35, rgba(mix(hue, W, 0.75), 0.55 * I))
  bulb.addColorStop(1, rgba(hue, 0))
  ctx.fillStyle = bulb
  ctx.beginPath()
  ctx.arc(bx, by, R * 0.34, 0, Math.PI * 2)
  ctx.fill()
  // soft bloom over the whole face + rim catch
  const bloom = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, R * 1.05)
  bloom.addColorStop(0, rgba(hue, (0.18 + 0.25 * blast) * I))
  bloom.addColorStop(1, rgba(hue, 0))
  ctx.fillStyle = bloom
  ctx.beginPath()
  ctx.arc(cx, cy, R * 1.05, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = rgba(mix(hue, W, 0.4), 0.12 + 0.3 * I)
  ctx.lineWidth = R * 0.035
  ctx.beginPath()
  ctx.arc(cx, cy, R, 0, Math.PI * 2)
  ctx.stroke()
  // corona + full-on flood (no streak)
  const cr = R * (1.3 + 1.9 * vis + 0.9 * blast)
  const cor = ctx.createRadialGradient(cx, cy, R * 0.6, cx, cy, cr)
  cor.addColorStop(0, rgba(hue, 0.26 * I))
  cor.addColorStop(1, rgba(hue, 0))
  ctx.fillStyle = cor
  ctx.beginPath()
  ctx.arc(cx, cy, cr, 0, Math.PI * 2)
  ctx.fill()
  if (blast > 0) {
    const wash = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * (1.1 + 0.5 * blast))
    wash.addColorStop(0, rgba(W, 0.7 * blast))
    wash.addColorStop(0.6, rgba(mix(hue, W, 0.65), 0.35 * blast))
    wash.addColorStop(1, rgba(hue, 0))
    ctx.fillStyle = wash
    ctx.beginPath()
    ctx.arc(cx, cy, R * (1.1 + 0.5 * blast), 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}
