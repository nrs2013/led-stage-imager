import type { Shape } from '../model/types'
import { bulbHueIntensity, type RGB } from './bulb'

/* ============================== 室内ランプ ==============================
 * 電飾屋が物理で吊れない「セットの灯り」アイテム第1弾。テーブル/フロアランプ：
 * シェードが暖色に灯り、開口から下へ光がこぼれ、床に淡い光だまりを落とす。
 * 中心 = points[0]（シェードの中心）。径 = シェード横幅（実寸mm・§7-4で校正）。
 * 色とゲージは卓のRGBが持つ（他の灯体と同じ＝console owns colour）。
 */

export const ROOMLAMP_DEFAULT_DIAMETER = 500 // シェード横幅 50cm

export const roomLampDiameter = (s: Pick<Shape, 'diameter'>): number =>
  s.diameter ?? ROOMLAMP_DEFAULT_DIAMETER

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

/** Steep-falloff warm blob (the bulb's escaped light). */
function glow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  col: RGB,
  a: number
): void {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r)
  g.addColorStop(0, rgba(col, a))
  g.addColorStop(0.4, rgba(col, a * 0.4))
  g.addColorStop(1, rgba(col, 0))
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
}

/** Shade trapezoid geometry around the placed centre (widths + vertical span). */
function shadeGeom(cy: number, d: number): { tw: number; bw: number; topY: number; botY: number } {
  return { tw: d * 0.58, bw: d, topY: cy - d * 0.34, botY: cy + d * 0.16 }
}

/** Editor schematic: cold lampshade + stem + base (no light — the lit render lives
 *  in Live / Syphon output, like the bulb). */
export function drawRoomLampSchematic(
  ctx: CanvasRenderingContext2D,
  shape: Shape,
  stroke: string,
  fill: string,
  boost = 1
): void {
  const c = shape.points[0]
  if (!c) return
  const d = roomLampDiameter(shape)
  const { tw, bw, topY, botY } = shadeGeom(c.y, d)
  ctx.save()
  ctx.lineWidth = Math.max(1, boost) * 0.6
  ctx.strokeStyle = stroke
  ctx.fillStyle = fill
  ctx.beginPath()
  ctx.moveTo(c.x - tw / 2, topY)
  ctx.lineTo(c.x + tw / 2, topY)
  ctx.lineTo(c.x + bw / 2, botY)
  ctx.lineTo(c.x - bw / 2, botY)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  const baseY = botY + d * 0.74
  ctx.beginPath()
  ctx.moveTo(c.x, botY)
  ctx.lineTo(c.x, baseY)
  ctx.stroke()
  ctx.beginPath()
  ctx.ellipse(c.x, baseY, d * 0.22, d * 0.06, 0, 0, Math.PI * 2)
  ctx.stroke()
  ctx.fillStyle = stroke
  ctx.fillRect(c.x - 0.5, c.y - 0.5, 1, 1)
  ctx.restore()
}

/** Lit room lamp (additive-only — an off lamp stays invisible in the Syphon output).
 *  The shade glows warm (dim at the crown, hot at the opening), light spills down in
 *  a soft cone, and a pool gathers on the floor. hue + gauge come from the console. */
export function drawRoomLampLit(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  d: number,
  rgb: RGB
): void {
  const { hue, intensity: I } = bulbHueIntensity(rgb)
  if (I <= 0.004) return
  const { tw, bw, topY, botY } = shadeGeom(cy, d)
  const blast = I > 0.85 ? (I - 0.85) / 0.15 : 0
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  // downward spill cone — from the shade opening widening toward the floor
  const reach = d * 1.5
  const tipY = botY + reach
  const spreadBot = d * 1.05
  const cone = ctx.createLinearGradient(0, botY, 0, tipY)
  cone.addColorStop(0, rgba(hue, 0.3 * I))
  cone.addColorStop(0.5, rgba(hue, 0.09 * I))
  cone.addColorStop(1, rgba(hue, 0))
  ctx.fillStyle = cone
  ctx.beginPath()
  ctx.moveTo(cx - bw / 2, botY)
  ctx.lineTo(cx + bw / 2, botY)
  ctx.lineTo(cx + spreadBot, tipY)
  ctx.lineTo(cx - spreadBot, tipY)
  ctx.closePath()
  ctx.fill()
  // shade body — crown dim, opening hot (light pours out the bottom)
  const sg = ctx.createLinearGradient(0, topY, 0, botY)
  sg.addColorStop(0, rgba(mix(hue, W, 0.1), 0.22 * I))
  sg.addColorStop(1, rgba(mix(hue, W, 0.35 + 0.4 * blast), (0.6 + 0.3 * blast) * I))
  ctx.fillStyle = sg
  ctx.beginPath()
  ctx.moveTo(cx - tw / 2, topY)
  ctx.lineTo(cx + tw / 2, topY)
  ctx.lineTo(cx + bw / 2, botY)
  ctx.lineTo(cx - bw / 2, botY)
  ctx.closePath()
  ctx.fill()
  // the bulb's escaped light at the opening
  glow(ctx, cx, botY, bw * 0.5, mix(hue, W, 0.6 + 0.3 * blast), (0.7 + 0.3 * blast) * I)
  glow(ctx, cx, botY, bw * 0.95, hue, 0.18 * I)
  if (blast > 0) glow(ctx, cx, botY, bw * 1.5, mix(hue, W, 0.5), 0.22 * blast)
  // floor pool
  const poolY = botY + reach * 0.92
  const pool = ctx.createRadialGradient(cx, poolY, 0, cx, poolY, d * 0.95)
  pool.addColorStop(0, rgba(hue, 0.12 * I))
  pool.addColorStop(1, rgba(hue, 0))
  ctx.fillStyle = pool
  ctx.save()
  ctx.translate(cx, poolY)
  ctx.scale(1, 0.26)
  ctx.beginPath()
  ctx.arc(0, 0, d * 0.95, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
  ctx.restore()
}
