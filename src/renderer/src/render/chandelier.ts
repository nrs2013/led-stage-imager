import type { Shape } from '../model/types'
import { bulbHueIntensity, type RGB } from './bulb'

/* ============================== シャンデリア ==============================
 * 電飾屋が物理で吊れない豪華アイテム。本物のクリスタルシャンデリア像に寄せ、
 * 「美しさ」優先でクリスタルを敷き詰める：噴き上がるクラウン → 柱まわりに垂れる
 * クリスタルの滝 → 2段の金の腕に縦長のロウソク球（炎付き）→ 腕ごとに長い雫の房 →
 * 多段のスワッグ → 底のクリスタルのバスケット（籠）→ センターの飾り。
 * 中心 = points[0]。径 = 全体幅（実寸mm・§7-4で校正）。1アドレスで一斉点灯。
 * 色とゲージは卓のRGBが持つ。
 */

export const CHANDELIER_DEFAULT_DIAMETER = 1000 // 全体幅 1m
const ARMS_LOWER = 12
const ARMS_UPPER = 7
const CROWN = 15 // クラウンのクリスタル束
const CASCADE = 12 // 柱まわりに垂れる滝の束
const BASKET = 15 // 底のバスケットの束
const ARM_DROPS = 8 // 1腕あたりの雫の本数

export const chandelierDiameter = (s: Pick<Shape, 'diameter'>): number =>
  s.diameter ?? CHANDELIER_DEFAULT_DIAMETER

const GOLD: RGB = [224, 180, 108]
const IVORY: RGB = [255, 244, 224]
const ICE: RGB = [226, 238, 255]
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

interface Tier {
  hubY: number
  bases: { x: number; y: number }[]
}
interface Frame {
  topY: number
  crownY: number
  colTopY: number
  colBotY: number
  colW: number
  cw: number
  ch: number
  upper: Tier
  lower: Tier
}

function frame(cx: number, cy: number, d: number): Frame {
  const ring = (n: number, r: number, ringCy: number, phase: number): { x: number; y: number }[] => {
    const out: { x: number; y: number }[] = []
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + phase + (i * Math.PI * 2) / n
      out.push({ x: cx + Math.cos(a) * r, y: ringCy + Math.sin(a) * r * 0.34 })
    }
    return out
  }
  return {
    topY: cy - d * 0.66,
    crownY: cy - d * 0.52,
    colTopY: cy - d * 0.4,
    colBotY: cy + d * 0.16,
    colW: d * 0.08,
    cw: d * 0.046,
    ch: d * 0.155,
    upper: { hubY: cy - d * 0.14, bases: ring(ARMS_UPPER, d * 0.25, cy - d * 0.08, Math.PI / ARMS_UPPER) },
    lower: { hubY: cy, bases: ring(ARMS_LOWER, d * 0.44, cy + d * 0.08, 0) }
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
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

function sparkle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, a: number): void {
  ctx.strokeStyle = rgba(W, a)
  ctx.lineWidth = Math.max(0.4, r * 0.16)
  ctx.beginPath()
  ctx.moveTo(x - r, y)
  ctx.lineTo(x + r, y)
  ctx.moveTo(x, y - r)
  ctx.lineTo(x, y + r)
  ctx.stroke()
}

const qpt = (a: number, c: number, b: number, t: number): number =>
  (1 - t) * (1 - t) * a + 2 * (1 - t) * t * c + t * t * b

/** ガラスのクリスタル1粒を一度だけ offscreen に焼く。毎フレームは drawImage で安く撒けて、
 *  単なる円塗りより「中心が冴え→ICE→透明＋上左のスペキュラ光沢」のガラス質感が出る。 */
let crystalSprite: HTMLCanvasElement | null = null
function crystal(): HTMLCanvasElement {
  if (crystalSprite) return crystalSprite
  const s = 48
  const cv = document.createElement('canvas')
  cv.width = s
  cv.height = s
  const c = cv.getContext('2d')!
  const m = s / 2
  const body = c.createRadialGradient(m, m, 0, m, m, m)
  body.addColorStop(0, 'rgba(255,255,255,1)')
  body.addColorStop(0.22, 'rgba(236,245,255,0.92)')
  body.addColorStop(0.55, 'rgba(208,226,255,0.36)')
  body.addColorStop(1, 'rgba(198,218,255,0)')
  c.fillStyle = body
  c.beginPath()
  c.arc(m, m, m, 0, Math.PI * 2)
  c.fill()
  const hx = m - m * 0.3
  const hy = m - m * 0.3
  const hi = c.createRadialGradient(hx, hy, 0, hx, hy, m * 0.42)
  hi.addColorStop(0, 'rgba(255,255,255,0.95)')
  hi.addColorStop(1, 'rgba(255,255,255,0)')
  c.fillStyle = hi
  c.beginPath()
  c.arc(hx, hy, m * 0.42, 0, Math.PI * 2)
  c.fill()
  crystalSprite = cv
  return cv
}

/* ----------------------------- editor schematic ----------------------------- */

/** A bead strand drawn as a thin curve for the cold editor view. */
function strandCold(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  cx0: number,
  cy0: number,
  x1: number,
  y1: number
): void {
  ctx.beginPath()
  ctx.moveTo(x0, y0)
  ctx.quadraticCurveTo(cx0, cy0, x1, y1)
  ctx.stroke()
}

export function drawChandelierSchematic(
  ctx: CanvasRenderingContext2D,
  shape: Shape,
  stroke: string,
  fill: string,
  boost = 1
): void {
  const c = shape.points[0]
  if (!c) return
  const d = chandelierDiameter(shape)
  const f = frame(c.x, c.y, d)
  const cx = c.x
  ctx.save()
  ctx.lineWidth = Math.max(1, boost) * 0.6
  ctx.strokeStyle = stroke
  ctx.fillStyle = fill
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  // chain (no canopy circle)
  ctx.beginPath()
  ctx.moveTo(cx, f.topY)
  ctx.lineTo(cx, f.crownY)
  ctx.stroke()
  // crown sprays + drops
  for (let k = 0; k < CROWN; k++) {
    const t = (k / (CROWN - 1)) * 2 - 1
    const tipX = cx + t * d * 0.24
    const tipY = f.crownY - Math.cos(t * 1.2) * d * 0.05
    strandCold(ctx, cx, f.colTopY, cx + t * d * 0.07, f.crownY, tipX, tipY)
    ctx.beginPath()
    ctx.moveTo(tipX, tipY)
    ctx.lineTo(tipX, tipY + d * 0.06)
    ctx.stroke()
  }
  // central column
  ctx.beginPath()
  ctx.moveTo(cx - f.colW / 2, f.colTopY)
  ctx.quadraticCurveTo(cx - f.colW * 0.3, c.y, cx - f.colW * 0.5, f.colBotY)
  ctx.lineTo(cx + f.colW * 0.5, f.colBotY)
  ctx.quadraticCurveTo(cx + f.colW * 0.3, c.y, cx + f.colW / 2, f.colTopY)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  // column cascade
  for (let k = 0; k < CASCADE; k++) {
    const t = (k / (CASCADE - 1)) * 2 - 1
    const sx = cx + t * f.colW * 1.4
    const len = d * (0.16 + 0.16 * (1 - Math.abs(t)))
    strandCold(ctx, sx, f.colTopY + d * 0.03, sx, (f.colTopY + f.colBotY) / 2, sx, f.colTopY + len)
  }
  // arms + candles + per-arm drop fans
  for (const tier of [f.lower, f.upper]) {
    for (const b of tier.bases) {
      strandCold(ctx, cx, tier.hubY, (cx + b.x) / 2, b.y + d * 0.07, b.x, b.y)
      ctx.beginPath()
      ctx.ellipse(b.x, b.y, f.cw * 1.0, f.cw * 0.36, 0, 0, Math.PI * 2)
      ctx.stroke()
      drawCandleSchematic(ctx, b.x, b.y, f.cw, f.ch)
      for (let j = 0; j < ARM_DROPS; j++) {
        const t = (j / (ARM_DROPS - 1)) * 2 - 1
        const dx = t * f.cw * 1.4
        const len = d * (0.05 + 0.04 * (1 - Math.abs(t)))
        ctx.beginPath()
        ctx.moveTo(b.x + dx, b.y + f.cw * 0.2)
        ctx.lineTo(b.x + dx, b.y + f.cw * 0.2 + len)
        ctx.stroke()
      }
    }
  }
  // swags: lower (3 layers) + upper (2 layers)
  swagsCold(ctx, f.lower.bases, f.cw, [0.05, 0.09, 0.13], d)
  swagsCold(ctx, f.upper.bases, f.cw, [0.04, 0.08], d)
  // bottom bowl + crystal basket + finial
  ctx.beginPath()
  ctx.ellipse(cx, f.colBotY, f.colW * 0.8, f.colW * 0.3, 0, 0, Math.PI * 2)
  ctx.stroke()
  const lowPt = f.colBotY + d * 0.22
  for (let k = 0; k < BASKET; k++) {
    const t = (k / (BASKET - 1)) * 2 - 1
    const sx = cx + t * d * 0.14
    const sy = f.colBotY + Math.abs(t) * d * 0.02
    strandCold(ctx, sx, sy, sx * 0.6 + cx * 0.4, f.colBotY + d * 0.13, cx, lowPt)
  }
  ctx.beginPath()
  ctx.moveTo(cx, lowPt)
  ctx.lineTo(cx, lowPt + d * 0.05)
  ctx.stroke()
  ctx.fillStyle = stroke
  ctx.fillRect(cx - 0.5, c.y - 0.5, 1, 1)
  ctx.restore()
}

function swagsCold(
  ctx: CanvasRenderingContext2D,
  bases: { x: number; y: number }[],
  cw: number,
  dips: number[],
  d: number
): void {
  for (let i = 0; i < bases.length; i++) {
    const a = bases[i]
    const b = bases[(i + 1) % bases.length]
    for (const dip of dips) {
      ctx.beginPath()
      ctx.moveTo(a.x, a.y + cw * 0.3)
      ctx.quadraticCurveTo((a.x + b.x) / 2, (a.y + b.y) / 2 + d * dip, b.x, b.y + cw * 0.3)
      ctx.stroke()
    }
  }
}

function drawCandleSchematic(
  ctx: CanvasRenderingContext2D,
  x: number,
  yBase: number,
  cw: number,
  ch: number
): void {
  roundRect(ctx, x - cw / 2, yBase - ch, cw, ch, cw * 0.32)
  ctx.stroke()
  const fy = yBase - ch
  const fh = cw * 1.7
  ctx.beginPath()
  ctx.moveTo(x, fy)
  ctx.quadraticCurveTo(x - cw * 0.5, fy - fh * 0.55, x, fy - fh)
  ctx.quadraticCurveTo(x + cw * 0.5, fy - fh * 0.55, x, fy)
  ctx.closePath()
  ctx.stroke()
}

/* -------------------------------- lit output -------------------------------- */

function drawCandleLit(
  ctx: CanvasRenderingContext2D,
  x: number,
  yBase: number,
  cw: number,
  ch: number,
  hue: RGB,
  I: number,
  blast: number
): void {
  const yTop = yBase - ch
  const body = ctx.createLinearGradient(0, yBase, 0, yTop)
  body.addColorStop(0, rgba(mix(hue, IVORY, 0.72), 0.45 * I))
  body.addColorStop(1, rgba(mix(hue, W, 0.4 + 0.4 * blast), (0.75 + 0.2 * blast) * I))
  ctx.fillStyle = body
  roundRect(ctx, x - cw / 2, yTop, cw, ch, cw * 0.32)
  ctx.fill()
  glow(ctx, x, yBase - ch * 0.55, cw * 1.6, hue, 0.09 * I)
  const fy = yTop + cw * 0.1
  const fh = cw * 1.95
  glow(ctx, x, fy - fh * 0.5, fh * 1.6, mix(hue, [255, 200, 120], 0.5), (0.45 + 0.4 * blast) * I)
  const flame = ctx.createRadialGradient(x, fy - fh * 0.5, 0, x, fy - fh * 0.5, fh * 0.62)
  flame.addColorStop(0, rgba(W, I))
  flame.addColorStop(0.45, rgba(mix(hue, W, 0.7), 0.9 * I))
  flame.addColorStop(1, rgba(hue, 0))
  ctx.fillStyle = flame
  ctx.beginPath()
  ctx.moveTo(x, fy)
  ctx.quadraticCurveTo(x - cw * 0.5, fy - fh * 0.55, x, fy - fh)
  ctx.quadraticCurveTo(x + cw * 0.5, fy - fh * 0.55, x, fy)
  ctx.closePath()
  ctx.fill()
}

/** A bead strand (quadratic) of crystals catching the candlelight, optional teardrop. */
function strandLit(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  cx0: number,
  cy0: number,
  x1: number,
  y1: number,
  r: number,
  I: number,
  pendant = true
): void {
  const len = Math.hypot(x1 - x0, y1 - y0) + Math.hypot(cx0 - x0, cy0 - y0)
  const n = Math.max(3, Math.round(len / (r * 2.2)))
  const sp = crystal()
  const sz = r * 3.0
  const prevA = ctx.globalAlpha
  ctx.globalAlpha = 0.5 * I
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const bx = qpt(x0, cx0, x1, t)
    const by = qpt(y0, cy0, y1, t)
    ctx.drawImage(sp, bx - sz / 2, by - sz / 2, sz, sz)
  }
  ctx.globalAlpha = prevA
  if (pendant) {
    // 涙型クリスタル：本体＋ガラスのスペキュラ＋きらめき
    ctx.fillStyle = rgba(mix(ICE, W, 0.35), 0.5 * I)
    ctx.beginPath()
    ctx.moveTo(x1, y1 - r * 1.7)
    ctx.quadraticCurveTo(x1 - r * 1.8, y1 + r, x1, y1 + r * 2.8)
    ctx.quadraticCurveTo(x1 + r * 1.8, y1 + r, x1, y1 - r * 1.7)
    ctx.closePath()
    ctx.fill()
    ctx.globalAlpha = 0.6 * I
    ctx.drawImage(sp, x1 - r * 1.4, y1 - r * 0.5, r * 2.8, r * 2.8)
    ctx.globalAlpha = prevA
    sparkle(ctx, x1, y1 + r * 0.7, r * 2.2, 0.45 * I)
  }
}

function swagsLit(
  ctx: CanvasRenderingContext2D,
  bases: { x: number; y: number }[],
  cw: number,
  dips: number[],
  d: number,
  I: number
): void {
  for (let i = 0; i < bases.length; i++) {
    const a = bases[i]
    const b = bases[(i + 1) % bases.length]
    for (const dip of dips) {
      strandLit(
        ctx,
        a.x,
        a.y + cw * 0.3,
        (a.x + b.x) / 2,
        (a.y + b.y) / 2 + d * dip,
        b.x,
        b.y + cw * 0.3,
        d * 0.0075,
        I,
        false
      )
    }
  }
}

export function drawChandelierLit(
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
  const goldCol = mix(GOLD, hue, 0.35)
  const cr = d * 0.0085 // crystal bead radius
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  // chain (no canopy circle)
  ctx.strokeStyle = rgba(goldCol, 0.18 * I)
  ctx.lineWidth = Math.max(1, d * 0.005)
  ctx.beginPath()
  ctx.moveTo(cx, f.topY)
  ctx.lineTo(cx, f.crownY)
  ctx.stroke()
  // crown crystal sprays + hanging drops
  for (let k = 0; k < CROWN; k++) {
    const t = (k / (CROWN - 1)) * 2 - 1
    const tipX = cx + t * d * 0.24
    const tipY = f.crownY - Math.cos(t * 1.2) * d * 0.05
    strandLit(ctx, cx, f.colTopY, cx + t * d * 0.07, f.crownY, tipX, tipY, cr * 0.8, I, false)
    strandLit(ctx, tipX, tipY, tipX, tipY + d * 0.03, tipX, tipY + d * 0.07, cr, I)
  }
  // central crystal column
  const col = ctx.createLinearGradient(cx - f.colW / 2, 0, cx + f.colW / 2, 0)
  col.addColorStop(0, rgba(mix(hue, W, 0.6), 0.3 * I))
  col.addColorStop(0.5, rgba(mix(hue, W, 0.3), 0.1 * I))
  col.addColorStop(1, rgba(mix(hue, W, 0.5), 0.2 * I))
  ctx.fillStyle = col
  ctx.beginPath()
  ctx.moveTo(cx - f.colW / 2, f.colTopY)
  ctx.quadraticCurveTo(cx - f.colW * 0.3, cy, cx - f.colW * 0.5, f.colBotY)
  ctx.lineTo(cx + f.colW * 0.5, f.colBotY)
  ctx.quadraticCurveTo(cx + f.colW * 0.3, cy, cx + f.colW / 2, f.colTopY)
  ctx.closePath()
  ctx.fill()
  // 柱のガラス光沢（左寄りの縦の明るい筋）
  ctx.strokeStyle = rgba(mix(hue, W, 0.85), 0.22 * I)
  ctx.lineWidth = Math.max(0.5, f.colW * 0.12)
  ctx.beginPath()
  ctx.moveTo(cx - f.colW * 0.14, f.colTopY + d * 0.01)
  ctx.quadraticCurveTo(cx - f.colW * 0.18, cy, cx - f.colW * 0.2, f.colBotY - d * 0.01)
  ctx.stroke()
  // column cascade of crystals
  for (let k = 0; k < CASCADE; k++) {
    const t = (k / (CASCADE - 1)) * 2 - 1
    const sx = cx + t * f.colW * 1.4
    const len = d * (0.16 + 0.16 * (1 - Math.abs(t)))
    strandLit(ctx, sx, f.colTopY + d * 0.03, sx, (f.colTopY + f.colBotY) / 2, sx, f.colTopY + len, cr, I)
  }
  // arms (gold)
  for (const tier of [f.lower, f.upper]) {
    for (const b of tier.bases) {
      ctx.strokeStyle = rgba(goldCol, 0.4 * I)
      ctx.lineWidth = Math.max(1, d * 0.01)
      ctx.beginPath()
      ctx.moveTo(cx, tier.hubY)
      ctx.quadraticCurveTo((cx + b.x) / 2, b.y + d * 0.07, b.x, b.y)
      ctx.stroke()
      ctx.strokeStyle = rgba(mix(goldCol, W, 0.5), 0.28 * I)
      ctx.lineWidth = Math.max(0.5, d * 0.0035)
      ctx.beginPath()
      ctx.moveTo(cx, tier.hubY)
      ctx.quadraticCurveTo((cx + b.x) / 2, b.y + d * 0.07, b.x, b.y)
      ctx.stroke()
      // メタリックなハイライト芯（細く明るい金＝光沢）
      ctx.strokeStyle = rgba(mix(goldCol, W, 0.82), 0.42 * I)
      ctx.lineWidth = Math.max(0.5, d * 0.0016)
      ctx.beginPath()
      ctx.moveTo(cx, tier.hubY)
      ctx.quadraticCurveTo((cx + b.x) / 2, b.y + d * 0.07, b.x, b.y)
      ctx.stroke()
    }
  }
  // crystal swags: lower 3 layers + upper 2 layers
  swagsLit(ctx, f.lower.bases, f.cw, [0.05, 0.09, 0.13], d, I)
  swagsLit(ctx, f.upper.bases, f.cw, [0.04, 0.08], d, I)
  // bobeches + long crystal drop fans + candles
  for (const tier of [f.lower, f.upper]) {
    for (const b of tier.bases) {
      glow(ctx, b.x, b.y, f.cw * 1.2, mix(goldCol, W, 0.4), 0.14 * I)
      for (let j = 0; j < ARM_DROPS; j++) {
        const t = (j / (ARM_DROPS - 1)) * 2 - 1
        const dx = t * f.cw * 1.4
        const len = d * (0.05 + 0.04 * (1 - Math.abs(t)))
        strandLit(ctx, b.x + dx, b.y + f.cw * 0.2, b.x + dx, b.y + f.cw * 0.2 + len * 0.6, b.x + dx, b.y + f.cw * 0.2 + len, cr, I)
      }
      drawCandleLit(ctx, b.x, b.y, f.cw, f.ch, hue, I, blast)
    }
  }
  // bottom crystal basket converging to the finial
  const lowPt = f.colBotY + d * 0.22
  for (let k = 0; k < BASKET; k++) {
    const t = (k / (BASKET - 1)) * 2 - 1
    const sx = cx + t * d * 0.14
    const sy = f.colBotY + Math.abs(t) * d * 0.02
    strandLit(ctx, sx, sy, sx * 0.6 + cx * 0.4, f.colBotY + d * 0.13, cx, lowPt, cr, I, false)
  }
  strandLit(ctx, cx, lowPt - d * 0.02, cx, lowPt, cx, lowPt + d * 0.05, cr * 1.3, I)
  // gentle bloom (modest — 美しさ優先)
  const halo = ctx.createRadialGradient(cx, cy, d * 0.12, cx, cy, d * 0.6)
  halo.addColorStop(0, rgba(hue, 0.06 * I))
  halo.addColorStop(1, rgba(hue, 0))
  ctx.fillStyle = halo
  ctx.beginPath()
  ctx.arc(cx, cy, d * 0.6, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}
