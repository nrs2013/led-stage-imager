import type { Shape } from '../model/types'
import { bulbHueIntensity, type RGB } from './bulb'

/* ============================== 外灯（ダブル） ==============================
 * 「光を見せる」より「光とともに装飾のディテールの美しさを見せる」ためのアイテム
 * （のむさん方針 2026-06-15）。鋳鉄ヴィクトリアン二灯外灯を、作品として作り込む：
 * フルートの柱＋段重ねの末広がり台座 → 段飾りの頂飾り → 唐草スクロールの腕 →
 * 鉄枠の六角ランタン（オジー屋根＋段重ね頂飾り＋面取りガラス＋唐草トレサリー＋
 * ビーズの帯＋飾り籠＋頂点の雫）。ランタンが内側から灯る。下方向の光は出さない。
 * 中心 = points[0]（腕が分岐する高さ）。径 = 全体スケール（実寸mm・§7-4）。
 * 色とゲージは卓のRGBが持つ。
 */

export const STREETLAMP_DEFAULT_DIAMETER = 600

export const streetLampDiameter = (s: Pick<Shape, 'diameter'>): number =>
  s.diameter ?? STREETLAMP_DEFAULT_DIAMETER

const IRON: RGB = [78, 70, 62]
const W: RGB = [255, 255, 255]

const mix = (a: RGB, b: RGB, t: number): RGB => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t
]
const rgba = (c: RGB, a: number): string => {
  const al = a < 0 ? 0 : a > 1 ? 1 : a
  return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${al.toFixed(3)})`
}

interface Frame {
  armY: number
  finialY: number
  postTopY: number
  baseY: number
  lw: number
  lh: number
  lanternTopY: number
  lx: number
  rx: number
}
function frame(cx: number, cy: number, d: number): Frame {
  return {
    armY: cy,
    finialY: cy - d * 0.3,
    postTopY: cy + d * 0.05,
    baseY: cy + d * 2.3,
    lw: d * 0.36,
    lh: d * 0.74,
    lanternTopY: cy + d * 0.02,
    lx: cx - d * 0.54,
    rx: cx + d * 0.54
  }
}

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

/** A small wrought-iron C/S scroll curl (stroke only — caller sets the style). */
function curl(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, dir: number): void {
  ctx.beginPath()
  for (let i = 0; i <= 14; i++) {
    const t = i / 14
    const ang = dir * (t * Math.PI * 1.6 - Math.PI * 0.5)
    const rr = r * (1 - t * 0.7)
    const px = x + Math.cos(ang) * rr
    const py = y + Math.sin(ang) * rr
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.stroke()
}

function beadRow(
  ctx: CanvasRenderingContext2D,
  x0: number,
  x1: number,
  y: number,
  n: number,
  r: number
): void {
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }
}

/** Ogee (S-curve) roof silhouette with overhanging eaves. */
function ogeeRoof(ctx: CanvasRenderingContext2D, x: number, base: number, lw: number, rh: number): void {
  ctx.beginPath()
  ctx.moveTo(x - lw * 0.54, base)
  ctx.bezierCurveTo(x - lw * 0.34, base - rh * 0.08, x - lw * 0.17, base - rh * 0.5, x, base - rh)
  ctx.bezierCurveTo(x + lw * 0.17, base - rh * 0.5, x + lw * 0.34, base - rh * 0.08, x + lw * 0.54, base)
  ctx.closePath()
}

/** Elongated-hexagon glass body. */
function bodyPath(ctx: CanvasRenderingContext2D, x: number, top: number, lw: number, bh: number): void {
  ctx.beginPath()
  ctx.moveTo(x - lw * 0.42, top)
  ctx.lineTo(x + lw * 0.42, top)
  ctx.lineTo(x + lw * 0.5, top + bh * 0.42)
  ctx.lineTo(x + lw * 0.4, top + bh)
  ctx.lineTo(x - lw * 0.4, top + bh)
  ctx.lineTo(x - lw * 0.5, top + bh * 0.42)
  ctx.closePath()
}

/* layout shared by schematic & lit so the two always match */
function lanternParts(top: number, lh: number): { rh: number; collarH: number; bodyTop: number; bh: number; by: number } {
  const rh = lh * 0.3
  const collarH = lh * 0.05
  const bodyTop = top + rh + collarH
  const bh = lh * 0.42
  return { rh, collarH, bodyTop, bh, by: bodyTop + bh }
}

/** Fluted post + flared-foot silhouette (shared by schematic & lit so they match). */
function postPath(ctx: CanvasRenderingContext2D, cx: number, d: number, f: Frame): void {
  ctx.beginPath()
  ctx.moveTo(cx - d * 0.05, f.postTopY)
  ctx.lineTo(cx - d * 0.045, f.baseY - d * 0.4)
  ctx.quadraticCurveTo(cx - d * 0.17, f.baseY - d * 0.12, cx - d * 0.18, f.baseY)
  ctx.lineTo(cx + d * 0.18, f.baseY)
  ctx.quadraticCurveTo(cx + d * 0.17, f.baseY - d * 0.12, cx + d * 0.045, f.baseY - d * 0.4)
  ctx.lineTo(cx + d * 0.05, f.postTopY)
  ctx.closePath()
}

/** The three flared moulding rings of the base, top→bottom (y, radiusX). */
function baseRings(d: number, f: Frame): { y: number; rx: number }[] {
  return [f.baseY - d * 0.4, f.baseY - d * 0.3, f.baseY - d * 0.05].map((y) => ({
    y,
    rx: d * 0.06 + (f.baseY - y) * 0.18
  }))
}

/** Vertical flute ridges down the shaft (x + a 0..1 cylindrical-roundness weight,
 *  brightest facing centre) and the y-range they run. Shared by schematic & lit. */
function shaftFlutes(
  cx: number,
  d: number,
  f: Frame
): { xs: { x: number; cyl: number }[]; top: number; bot: number } {
  const N = 6
  const halfW = d * 0.05
  const xs = Array.from({ length: N }, (_, i) => {
    const xr = ((i + 0.5) / N - 0.5) * 2
    const cyl = Math.pow(Math.cos(xr * 1.4) * 0.5 + 0.5, 1.4)
    return { x: cx + xr * halfW, cyl }
  })
  return { xs, top: f.postTopY + d * 0.02, bot: f.baseY - d * 0.42 }
}

/* ----------------------------- editor schematic ----------------------------- */

export function drawStreetLampSchematic(
  ctx: CanvasRenderingContext2D,
  shape: Shape,
  stroke: string,
  fill: string,
  boost = 1
): void {
  const c = shape.points[0]
  if (!c) return
  const d = streetLampDiameter(shape)
  const f = frame(c.x, c.y, d)
  ctx.save()
  ctx.lineWidth = Math.max(1, boost) * 0.6
  ctx.strokeStyle = stroke
  ctx.fillStyle = fill
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  // fluted post + tiered flared base
  postPath(ctx, c.x, d, f)
  ctx.stroke()
  for (const { y: yy, rx } of baseRings(d, f)) {
    ctx.beginPath()
    ctx.ellipse(c.x, yy, rx, d * 0.014, 0, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.strokeRect(c.x - d * 0.2, f.baseY, d * 0.4, d * 0.05)
  // fluted shaft grooves (cast-iron texture)
  {
    const fl = shaftFlutes(c.x, d, f)
    ctx.save()
    ctx.globalAlpha = 0.5
    ctx.lineWidth = Math.max(0.4, boost) * 0.4
    for (const { x } of fl.xs) {
      ctx.beginPath()
      ctx.moveTo(x, fl.top)
      ctx.lineTo(x, fl.bot)
      ctx.stroke()
    }
    ctx.restore()
  }
  // central tiered finial
  ctx.beginPath()
  ctx.moveTo(c.x, f.armY - d * 0.02)
  ctx.lineTo(c.x, f.finialY + d * 0.08)
  ctx.stroke()
  ctx.beginPath()
  ctx.ellipse(c.x, f.finialY + d * 0.08, d * 0.03, d * 0.012, 0, 0, Math.PI * 2)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(c.x, f.finialY + d * 0.045, d * 0.022, 0, Math.PI * 2)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(c.x, f.finialY + d * 0.025)
  ctx.lineTo(c.x, f.finialY)
  ctx.stroke()
  // arms + lanterns
  for (const lx of [f.lx, f.rx]) {
    scrollArm(ctx, c.x, f.armY, lx, f.lanternTopY, d)
    lanternSchematic(ctx, lx, f.lanternTopY, f.lw, f.lh, d)
  }
  ctx.fillStyle = stroke
  ctx.fillRect(c.x - 0.5, c.y - 0.5, 1, 1)
  ctx.restore()
}

/** All the wrought-iron bracket strokes (two rails, a big volute, answering scrolls, a
 *  leaf collar, the hanger ring) using the CURRENT stroke style. Schematic strokes it
 *  once; the lit pass strokes it twice (thick warm iron + a fine bright edge). */
function armStrokes(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  lx: number,
  ly: number,
  d: number
): void {
  const dir = Math.sign(lx - px) || 1
  const mx = (px + lx) / 2
  // main top rail (ogee) — arches up out of the post and down to the lantern hanger
  ctx.beginPath()
  ctx.moveTo(px + dir * d * 0.02, py - d * 0.05)
  ctx.bezierCurveTo(px + dir * d * 0.26, py - d * 0.27, lx - dir * d * 0.08, ly - d * 0.3, lx, ly - d * 0.04)
  ctx.stroke()
  // lower rail — sweeps out of the post and runs under the top rail to the lantern
  ctx.beginPath()
  ctx.moveTo(px + dir * d * 0.03, py + d * 0.03)
  ctx.bezierCurveTo(px + dir * d * 0.3, py - d * 0.08, lx - dir * d * 0.12, ly - d * 0.14, lx, ly - d * 0.02)
  ctx.stroke()
  // big C-scroll volute under the arm at the post (the structural bracket support)
  curl(ctx, px + dir * d * 0.13, py + d * 0.03, d * 0.085, dir)
  // answering scroll mid-span, hung under the top rail
  curl(ctx, mx + dir * d * 0.02, py - d * 0.17, d * 0.055, -dir)
  // a smaller scroll near the lantern end
  curl(ctx, lx - dir * d * 0.12, ly - d * 0.16, d * 0.04, dir)
  // leaf collar where the bracket bolts to the post
  curl(ctx, px + dir * d * 0.05, py - d * 0.05, d * 0.03, dir)
  curl(ctx, px + dir * d * 0.06, py + d * 0.04, d * 0.026, -dir)
  // hanger drop + ring the lantern swings from
  ctx.beginPath()
  ctx.moveTo(lx, ly - d * 0.04)
  ctx.lineTo(lx, ly - d * 0.004)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(lx, ly + d * 0.012, d * 0.018, 0, Math.PI * 2)
  ctx.stroke()
}

function scrollArm(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  lx: number,
  ly: number,
  d: number
): void {
  armStrokes(ctx, px, py, lx, ly, d)
}

function lanternSchematic(
  ctx: CanvasRenderingContext2D,
  x: number,
  top: number,
  lw: number,
  lh: number,
  d: number
): void {
  const { rh, bodyTop, bh, by } = lanternParts(top, lh)
  // ogee roof + ridges + eave
  ogeeRoof(ctx, x, bodyTop - lh * 0.05, lw, rh)
  ctx.stroke()
  for (const rx of [-0.17, 0.17]) {
    ctx.beginPath()
    ctx.moveTo(x + lw * rx, bodyTop - lh * 0.05)
    ctx.quadraticCurveTo(x + lw * rx * 0.4, bodyTop - lh * 0.05 - rh * 0.55, x, bodyTop - lh * 0.05 - rh)
    ctx.stroke()
  }
  // tiered finial
  ctx.beginPath()
  ctx.arc(x, bodyTop - lh * 0.05 - rh - d * 0.016, d * 0.018, 0, Math.PI * 2)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(x, bodyTop - lh * 0.05 - rh - d * 0.034)
  ctx.lineTo(x, bodyTop - lh * 0.05 - rh - d * 0.06)
  ctx.stroke()
  // collar bead band
  ctx.fillStyle = ctx.strokeStyle
  beadRow(ctx, x - lw * 0.42, x + lw * 0.42, bodyTop - lh * 0.025, 9, Math.max(0.6, d * 0.006))
  // glass body + frame posts + mid rail
  bodyPath(ctx, x, bodyTop, lw, bh)
  ctx.stroke()
  for (const fx of [-0.17, 0.17]) {
    ctx.beginPath()
    ctx.moveTo(x + lw * fx, bodyTop)
    ctx.lineTo(x + lw * fx, by)
    ctx.stroke()
  }
  ctx.beginPath()
  ctx.moveTo(x - lw * 0.49, bodyTop + bh * 0.46)
  ctx.lineTo(x + lw * 0.49, bodyTop + bh * 0.46)
  ctx.stroke()
  // bevel insets + tracery scrolls
  lanternTracery(ctx, x, bodyTop, lw, bh)
  // base bead band
  beadRow(ctx, x - lw * 0.4, x + lw * 0.4, by + d * 0.006, 8, Math.max(0.6, d * 0.006))
  // ornate bottom cage: ribs + knop + finial
  for (const s of [-1, -0.5, 0.5, 1]) {
    ctx.beginPath()
    ctx.moveTo(x + lw * 0.4 * s, by)
    ctx.quadraticCurveTo(x + lw * 0.3 * s, by + lh * 0.12, x, by + lh * 0.2)
    ctx.stroke()
  }
  ctx.beginPath()
  ctx.arc(x, by + lh * 0.2, d * 0.02, 0, Math.PI * 2)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(x, by + lh * 0.22)
  ctx.quadraticCurveTo(x - d * 0.02, by + lh * 0.27, x, by + lh * 0.32)
  ctx.quadraticCurveTo(x + d * 0.02, by + lh * 0.27, x, by + lh * 0.22)
  ctx.stroke()
}

/** Bevelled panel insets + iron tracery scrollwork over the three front facets. */
function lanternTracery(
  ctx: CanvasRenderingContext2D,
  x: number,
  bodyTop: number,
  lw: number,
  bh: number
): void {
  const panels: [number, number][] = [
    [-0.49, -0.17],
    [-0.17, 0.17],
    [0.17, 0.49]
  ]
  for (const [a, b] of panels) {
    const px0 = x + lw * (a + 0.03)
    const px1 = x + lw * (b - 0.03)
    ctx.strokeRect(px0, bodyTop + bh * 0.08, px1 - px0, bh * 0.82)
  }
  // central facet: a lyre/heart scroll motif
  const cy0 = bodyTop + bh * 0.5
  curl(ctx, x - lw * 0.07, cy0, lw * 0.08, 1)
  curl(ctx, x + lw * 0.07, cy0, lw * 0.08, -1)
  ctx.beginPath()
  ctx.arc(x, cy0 - bh * 0.16, lw * 0.05, 0, Math.PI * 2)
  ctx.stroke()
  // side facets: corner scrolls
  for (const s of [-1, 1]) {
    curl(ctx, x + s * lw * 0.33, bodyTop + bh * 0.2, lw * 0.05, s)
    curl(ctx, x + s * lw * 0.33, bodyTop + bh * 0.74, lw * 0.05, -s)
  }
}

/* -------------------------------- lit output -------------------------------- */

export function drawStreetLampLit(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  d: number,
  rgb: RGB
): void {
  const { hue, intensity: I } = bulbHueIntensity(rgb)
  if (I <= 0.004) return
  const f = frame(cx, cy, d)
  const blast = I > 0.85 ? (I - 0.85) / 0.15 : 0
  const warmIron = mix(IRON, hue, 0.8)
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  // ── default uplight from below: the cast-iron post + tiered base read as a
  //    solid 3-D object lit by a stage footlight — brightest at the floor,
  //    fading upward (のむさん 2026-06-15: 台座が下からの照明で見えるように).
  const up = mix(hue, W, 0.5)
  // (a) post shaft — fill the real silhouette with a bottom-bright vertical wash
  ctx.save()
  postPath(ctx, cx, d, f)
  ctx.clip()
  const wash = ctx.createLinearGradient(0, f.baseY, 0, f.armY - d * 0.15)
  wash.addColorStop(0, rgba(up, 0.2 * I))
  wash.addColorStop(0.4, rgba(up, 0.08 * I))
  wash.addColorStop(0.8, rgba(mix(up, IRON, 0.5), 0.02 * I))
  wash.addColorStop(1, rgba(up, 0))
  ctx.fillStyle = wash
  ctx.fillRect(cx - d * 0.3, f.armY - d * 0.2, d * 0.6, f.baseY - f.armY + d * 0.35)
  // fluted shaft: each cast-iron ridge catches the uplight (grooves stay dark);
  // the cylindrical weight makes centre ridges brighter than the edges = roundness
  const flu = shaftFlutes(cx, d, f)
  for (const { x, cyl } of flu.xs) {
    const fg = ctx.createLinearGradient(0, flu.bot, 0, flu.top)
    fg.addColorStop(0, rgba(mix(up, W, 0.45), 0.42 * I * cyl))
    fg.addColorStop(0.5, rgba(up, 0.1 * I * cyl))
    fg.addColorStop(1, rgba(up, 0.02 * I * cyl))
    ctx.strokeStyle = fg
    ctx.lineWidth = Math.max(0.8, d * 0.005)
    ctx.beginPath()
    ctx.moveTo(x, flu.top)
    ctx.lineTo(x, flu.bot)
    ctx.stroke()
  }
  ctx.restore()
  // (b) tiered flared base — closest to the floor, brightest
  ctx.save()
  postPath(ctx, cx, d, f)
  ctx.clip()
  const foot = ctx.createLinearGradient(0, f.baseY, 0, f.baseY - d * 0.32)
  foot.addColorStop(0, rgba(up, 0.24 * I))
  foot.addColorStop(0.45, rgba(up, 0.06 * I))
  foot.addColorStop(1, rgba(up, 0))
  ctx.fillStyle = foot
  ctx.fillRect(cx - d * 0.3, f.baseY - d * 0.32, d * 0.6, d * 0.32)
  ctx.restore()
  // plinth block (solid lit) + its top edge
  ctx.fillStyle = rgba(up, 0.18 * I)
  ctx.fillRect(cx - d * 0.2, f.baseY, d * 0.4, d * 0.05)
  ctx.strokeStyle = rgba(mix(up, W, 0.45), 0.5 * I)
  ctx.lineWidth = Math.max(0.8, d * 0.006)
  ctx.strokeRect(cx - d * 0.2, f.baseY, d * 0.4, d * 0.05)
  // moulding-ring undersides catch the uplight (stacked tiers read)
  ctx.strokeStyle = rgba(mix(up, W, 0.55), 0.5 * I)
  ctx.lineWidth = Math.max(0.8, d * 0.007)
  for (const { y: yy, rx } of baseRings(d, f)) {
    ctx.beginPath()
    ctx.ellipse(cx, yy, rx, d * 0.014, 0, 0, Math.PI)
    ctx.stroke()
  }
  // central finial, warm-lit
  ctx.strokeStyle = rgba(mix(warmIron, W, 0.4), 0.32 * I)
  ctx.lineWidth = Math.max(1, d * 0.008)
  ctx.beginPath()
  ctx.moveTo(cx, f.armY)
  ctx.lineTo(cx, f.finialY)
  ctx.stroke()
  ctx.fillStyle = rgba(mix(hue, W, 0.5), 0.5 * I)
  ctx.beginPath()
  ctx.arc(cx, f.finialY + d * 0.045, d * 0.02, 0, Math.PI * 2)
  ctx.fill()
  for (const lx of [f.lx, f.rx]) {
    litArm(ctx, cx, f.armY, lx, f.lanternTopY, d, warmIron, I)
    lanternLit(ctx, lx, f.lanternTopY, f.lw, f.lh, d, hue, I, blast, warmIron)
  }
  ctx.restore()
}

function litArm(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  lx: number,
  ly: number,
  d: number,
  warmIron: RGB,
  I: number
): void {
  // thick warm cast-iron body
  ctx.strokeStyle = rgba(warmIron, 0.4 * I)
  ctx.lineWidth = Math.max(1, d * 0.013)
  armStrokes(ctx, px, py, lx, ly, d)
  // fine bright edge so the bracket catches the lantern's light
  ctx.strokeStyle = rgba(mix(warmIron, W, 0.55), 0.28 * I)
  ctx.lineWidth = Math.max(0.5, d * 0.004)
  armStrokes(ctx, px, py, lx, ly, d)
}

function lanternLit(
  ctx: CanvasRenderingContext2D,
  x: number,
  top: number,
  lw: number,
  lh: number,
  d: number,
  hue: RGB,
  I: number,
  blast: number,
  warmIron: RGB
): void {
  const { rh, bodyTop, bh, by } = lanternParts(top, lh)
  const cyB = bodyTop + bh * 0.5
  glow(ctx, x, cyB, lw * 1.5, hue, 0.11 * I)
  // glass glow (clipped to the body)
  ctx.save()
  bodyPath(ctx, x, bodyTop, lw, bh)
  ctx.clip()
  const g = ctx.createRadialGradient(x, cyB, 0, x, cyB, bh * 0.9)
  g.addColorStop(0, rgba(mix(hue, W, 0.5 + 0.3 * blast), (0.72 + 0.2 * blast) * I))
  g.addColorStop(0.5, rgba(mix(hue, W, 0.18), 0.42 * I))
  g.addColorStop(1, rgba(hue, 0.2 * I))
  ctx.fillStyle = g
  ctx.fillRect(x - lw, bodyTop - lh, lw * 2, lh * 2)
  ctx.restore()
  glow(ctx, x, cyB, bh * 0.5, mix(hue, W, 0.68 + 0.3 * blast), (0.45 + 0.3 * blast) * I)
  // a tall mantle core (the burning element) — vertical, flame-like, not a round blob
  ctx.save()
  bodyPath(ctx, x, bodyTop, lw, bh)
  ctx.clip()
  ctx.translate(x, cyB)
  ctx.scale(0.4, 1)
  ctx.translate(-x, -cyB)
  const core = ctx.createRadialGradient(x, cyB, 0, x, cyB, bh * 0.66)
  core.addColorStop(0, rgba(mix(hue, W, 0.82), (0.7 + 0.2 * blast) * I))
  core.addColorStop(0.45, rgba(mix(hue, W, 0.4), 0.32 * I))
  core.addColorStop(1, rgba(hue, 0))
  ctx.fillStyle = core
  ctx.beginPath()
  ctx.arc(x, cyB, bh * 0.66, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  const frameCol = rgba(mix(hue, W, 0.5), 0.42 * I)
  const fine = rgba(mix(hue, W, 0.6), 0.3 * I)
  // frame: body outline + posts + mid rail
  ctx.strokeStyle = frameCol
  ctx.lineWidth = Math.max(0.8, d * 0.007)
  bodyPath(ctx, x, bodyTop, lw, bh)
  ctx.stroke()
  for (const fx of [-0.17, 0.17]) {
    ctx.beginPath()
    ctx.moveTo(x + lw * fx, bodyTop)
    ctx.lineTo(x + lw * fx, by)
    ctx.stroke()
  }
  ctx.beginPath()
  ctx.moveTo(x - lw * 0.49, bodyTop + bh * 0.46)
  ctx.lineTo(x + lw * 0.49, bodyTop + bh * 0.46)
  ctx.stroke()
  // bevel insets + tracery (fine warm filigree)
  ctx.strokeStyle = fine
  ctx.lineWidth = Math.max(0.5, d * 0.004)
  lanternTracery(ctx, x, bodyTop, lw, bh)

  // collar + base bead bands (warm dots)
  ctx.fillStyle = rgba(mix(hue, W, 0.55), 0.42 * I)
  beadRow(ctx, x - lw * 0.42, x + lw * 0.42, bodyTop - lh * 0.025, 9, Math.max(0.6, d * 0.006))
  beadRow(ctx, x - lw * 0.4, x + lw * 0.4, by + d * 0.006, 8, Math.max(0.6, d * 0.006))

  // ogee roof: a solid dark-metal face whose eaves catch the warm light, then the rim
  ctx.save()
  ogeeRoof(ctx, x, bodyTop - lh * 0.05, lw, rh)
  ctx.clip()
  const roofTop = bodyTop - lh * 0.05 - rh
  const roofG = ctx.createLinearGradient(0, roofTop, 0, bodyTop - lh * 0.05)
  roofG.addColorStop(0, rgba(mix(warmIron, [0, 0, 0], 0.35), 0.14 * I))
  roofG.addColorStop(0.65, rgba(warmIron, 0.12 * I))
  roofG.addColorStop(1, rgba(mix(hue, W, 0.45), 0.4 * I))
  ctx.fillStyle = roofG
  ctx.fillRect(x - lw, roofTop - 2, lw * 2, rh + 4)
  ctx.restore()
  ctx.strokeStyle = rgba(mix(hue, W, 0.5), 0.34 * I)
  ctx.lineWidth = Math.max(0.8, d * 0.008)
  ogeeRoof(ctx, x, bodyTop - lh * 0.05, lw, rh)
  ctx.stroke()
  ctx.strokeStyle = fine
  ctx.lineWidth = Math.max(0.5, d * 0.004)
  for (const rx of [-0.17, 0.17]) {
    ctx.beginPath()
    ctx.moveTo(x + lw * rx, bodyTop - lh * 0.05)
    ctx.quadraticCurveTo(x + lw * rx * 0.4, bodyTop - lh * 0.05 - rh * 0.55, x, bodyTop - lh * 0.05 - rh)
    ctx.stroke()
  }
  glow(ctx, x, bodyTop - lh * 0.05 - rh - d * 0.016, d * 0.03, mix(hue, W, 0.7), 0.5 * I)

  // ornate bottom cage + knop + finial, warm-lit
  ctx.strokeStyle = rgba(mix(hue, W, 0.45), 0.3 * I)
  ctx.lineWidth = Math.max(0.6, d * 0.005)
  for (const s of [-1, -0.5, 0.5, 1]) {
    ctx.beginPath()
    ctx.moveTo(x + lw * 0.4 * s, by)
    ctx.quadraticCurveTo(x + lw * 0.3 * s, by + lh * 0.12, x, by + lh * 0.2)
    ctx.stroke()
  }
  glow(ctx, x, by + lh * 0.22, d * 0.03, mix(hue, W, 0.6), 0.45 * I)
  void warmIron
}
