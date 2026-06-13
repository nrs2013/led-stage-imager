import type { Point, Shape } from '../model/types'
import { bulbHueIntensity, type RGB } from './bulb'

// 実寸基準（のむさん 2026-06-13）: 画面1px = 実物1mm。各部品は実寸の横幅(mm)＝px。
// LEDドットは中心〜中心12mm(=12px・光る3mm＋すき間9mm)。背景チャートの実寸合わせは次段階。
export const PAR_DEFAULT_DIAMETER = 300 // パー(PAR) 30cm
export const BLINDER_DEFAULT_WIDTH = 300 // 8灯ミニブル 30cm（housing width＝横幅・高さは2倍）
export const PATT_DEFAULT_DIAMETER = 500 // PAT「ただのパット」50cm
export const PIXELPATT_DEFAULT_DIAMETER = 700 // Pixel PAT「パッド」70cm

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

/** Reflected-detail gain — the visibility of metal/glass structure lit by its own
 *  fixture. Rises with the gauge to full visibility by ~55%, then GLARE swallows it
 *  (のむさん 2026-06-11: フルでは灯体のまぶしさで躯体は見えなくなる): from 70% the
 *  blinding source washes the detail out, leaving ~15% at full. */
export function reflectGain(I: number): number {
  if (I <= 0.004) return 0
  const rise = Math.min(1, I / 0.55)
  const glare = I <= 0.7 ? 0 : Math.min(1, (I - 0.7) / 0.3)
  return rise * (1 - 0.85 * glare)
}

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

/** Lit PAR (v7・2026-06-11): the lens floods from a hot core to a near-white face —
 *  NO drawn rings, no streaks. Fading up starts with a warm filament glow; past 88%
 *  the blast spills WHITE past the can. The front-rim ring and filter-frame clips
 *  appear only as reflection, swallowed by the glare near full (reflectGain). */
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
  const det = reflectGain(I)
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
  // fading up: the filament pops warm amber first, then the flood takes over
  if (I < 0.5) {
    const warm = 1 - I / 0.5
    steep(ctx, cx, cy, R * 0.28, mix(hue, [255, 150, 60] as RGB, 0.55 * warm), 0.6 * I * (1 + warm))
  }
  steep(ctx, cx, cy, R * 0.5, mix(hue, W, 0.85), (0.5 + 0.5 * blast) * I)
  ctx.restore()
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  // past 88% the light bursts out of the can — the over-exposure spill
  if (blast > 0) {
    steep(ctx, cx, cy, R * 1.5, W, 0.5 * blast)
    steep(ctx, cx, cy, R * 2.4, mix(hue, W, 0.6), 0.25 * blast)
  }
  // the lens edge stays crisp; the housing rim catches the spill
  ctx.strokeStyle = rgba(mix(hue, W, 0.2), (0.3 + 0.4 * blast) * I)
  ctx.lineWidth = R * 0.05
  ctx.beginPath()
  ctx.arc(cx, cy, R * 0.99, 0, Math.PI * 2)
  ctx.stroke()
  // glass glint on the lens face (upper-left arc)
  ctx.strokeStyle = rgba(mix(hue, W, 0.6), 0.16 * det)
  ctx.lineWidth = Math.max(0.8, R * 0.022)
  ctx.beginPath()
  ctx.arc(cx, cy, R * 0.8, -2.6, -1.0)
  ctx.stroke()
  // the can's front rim — a full reflected ring + its top-left glint
  ctx.strokeStyle = rgba(mix(PP_STEEL, hue, 0.28), 0.4 * det)
  ctx.lineWidth = Math.max(1, R * 0.05)
  ctx.beginPath()
  ctx.arc(cx, cy, R * 1.14, 0, Math.PI * 2)
  ctx.stroke()
  ctx.strokeStyle = rgba(mix(hue, W, 0.6), 0.18 * det)
  ctx.lineWidth = Math.max(0.6, R * 0.025)
  ctx.beginPath()
  ctx.arc(cx, cy, R * 1.14, -2.6, -0.7)
  ctx.stroke()
  // filter-frame clips on the rim
  for (const ang of [-Math.PI / 2, Math.PI * 0.8, Math.PI * 0.2]) {
    ppBolt(
      ctx,
      cx + Math.cos(ang) * R * 1.14,
      cy + Math.sin(ang) * R * 1.14,
      Math.max(0.8, R * 0.04),
      hue,
      0.5 * det
    )
  }
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

/** Cell pitch of the 2×4 unit (horizontal = vertical = half the housing width). */
const blinderPitch = (s: Pick<Shape, 'diameter'>): number => blinderWidth(s) / 2
/** Lens aperture = 55% of the pitch — のむさん fixed on the mock (2026-06-11):
 *  the chrome rings must NOT overlap. */
export const blinderLensR = (s: Pick<Shape, 'diameter'>): number => (blinderPitch(s) * 0.55) / 2
export const blinderRingR = (s: Pick<Shape, 'diameter'>): number => blinderLensR(s) * 1.26
const BL_CHROME: RGB = [168, 171, 179]

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
  const R = blinderRingR(shape)
  ctx.save()
  ctx.lineWidth = Math.max(1, boost) * 0.6
  ctx.strokeStyle = stroke
  ctx.strokeRect(c.x - w / 2, c.y - h / 2, w, h)
  // the centre divider between the two columns, like the real molefay
  ctx.beginPath()
  ctx.moveTo(c.x, c.y - h / 2)
  ctx.lineTo(c.x, c.y + h / 2)
  ctx.stroke()
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

/** One lit blinder cell (ミニブルモック判定 2026-06-11): a PAR36 waffle lens of fine
 *  prism dots, the filament clipping to pure white from 55%, the chrome retaining
 *  ring + 3 tabs lit by their own reflection (glare swallows them near full), and
 *  each cell still adding its 1/8 share of the unit-wide molefay flood. */
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
  const c = shape.points[0] ?? p
  const w = blinderWidth(shape)
  const R = blinderLensR(shape)
  const ringR = blinderRingR(shape)
  const clip = I > 0.55 ? (I - 0.55) / 0.45 : 0
  const blast = I > 0.88 ? (I - 0.88) / 0.12 : 0
  const det = reflectGain(I)
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.lineCap = 'butt'
  const face = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, R)
  face.addColorStop(0, rgba(hue, (0.16 + 0.2 * blast) * I))
  face.addColorStop(1, rgba(hue, (0.08 + 0.15 * blast) * I))
  ctx.fillStyle = face
  ctx.beginPath()
  ctx.arc(p.x, p.y, R, 0, Math.PI * 2)
  ctx.fill()
  // the fine prism-dot grid of the PAR36 waffle glass
  const g = Math.max(1.1, R / 5.5)
  const n = Math.ceil((R * 0.95) / g)
  for (let gy = -n; gy <= n; gy++) {
    for (let gx = -n; gx <= n; gx++) {
      const dx = gx * g
      const dy = gy * g
      const d = Math.hypot(dx, dy)
      if (d > R * 0.95) continue
      const t = Math.max(0, 1 - d / R)
      let k = 0.42 + 0.62 * Math.pow(t, 1.2)
      k += blast * (1.05 - k) * 0.92
      const a = Math.min(1, I * k)
      if (a < 0.012) continue
      ctx.fillStyle = rgba(mix(hue, W, Math.min(1, 0.1 + 0.45 * a + 0.5 * blast)), a)
      const sz = g * 0.74 * (0.88 + 0.18 * a)
      ctx.fillRect(p.x + dx - sz / 2, p.y + dy - sz / 2, sz, sz)
    }
  }
  // filament core — white-clips from 55%, blasts past 88%
  steep(ctx, p.x, p.y, R * 0.5, mix(hue, W, 0.8), (0.45 + 0.4 * clip) * I)
  if (clip > 0) steep(ctx, p.x, p.y, R * (0.32 + 0.3 * clip), W, Math.min(1, 0.9 * clip))
  if (blast > 0) {
    steep(ctx, p.x, p.y, R * 1.3, W, 0.6 * blast)
    steep(ctx, p.x, p.y, R * 2.3, mix(hue, W, 0.6), 0.28 * blast)
  }
  // chrome retaining ring + top-left glint + 3 tabs — reflection only
  const ringW = Math.max(1, ringR - R * 1.05)
  ctx.strokeStyle = rgba(mix(BL_CHROME, hue, 0.22), 0.5 * det)
  ctx.lineWidth = ringW
  ctx.beginPath()
  ctx.arc(p.x, p.y, (R * 1.05 + ringR) / 2, 0, Math.PI * 2)
  ctx.stroke()
  ctx.strokeStyle = rgba(mix(BL_CHROME, W, 0.55), 0.22 * det)
  ctx.lineWidth = Math.max(0.5, R * 0.06)
  ctx.beginPath()
  ctx.arc(p.x, p.y, (R * 1.05 + ringR) / 2, -2.7, -0.5)
  ctx.stroke()
  ctx.strokeStyle = rgba(mix(hue, W, 0.3), (0.2 + 0.3 * blast) * I)
  ctx.lineWidth = Math.max(0.5, R * 0.06)
  ctx.beginPath()
  ctx.arc(p.x, p.y, R * 1.02, 0, Math.PI * 2)
  ctx.stroke()
  for (const ang of [-Math.PI / 2, Math.PI * 0.78, Math.PI * 0.22]) {
    ppBolt(
      ctx,
      p.x + Math.cos(ang) * ringR,
      p.y + Math.sin(ang) * ringR,
      Math.max(0.7, R * 0.16),
      hue,
      0.55 * det
    )
  }
  // spill + this cell's 1/8 share of the unit flood (all 8 lit ≈ the wall of light)
  const spill = ctx.createRadialGradient(p.x, p.y, ringR, p.x, p.y, ringR * 1.6)
  spill.addColorStop(0, rgba(hue, (0.06 + 0.06 * blast) * I))
  spill.addColorStop(1, rgba(hue, 0))
  ctx.fillStyle = spill
  ctx.beginPath()
  ctx.arc(p.x, p.y, ringR * 1.6, 0, Math.PI * 2)
  ctx.fill()
  steep(ctx, c.x, c.y, w * 1.7, hue, 0.05 * I)
  if (I > 0.75) steep(ctx, c.x, c.y, w * 1.35, mix(hue, W, 0.7), 0.07 * ((I - 0.75) / 0.25))
  ctx.restore()
}

/** The molefay housing — outer box, centre divider, corner bolts — lit purely by
 *  the reflection of its own cells (distance falloff; glare swallows it near full).
 *  Drawn once per unit; all cells off → nothing at all. */
export function drawBlinderHousing(
  ctx: CanvasRenderingContext2D,
  shape: Pick<Shape, 'points' | 'diameter'>,
  rgbs: RGB[]
): void {
  const c = shape.points[0]
  if (!c) return
  const cells = blinderCells(shape)
  const lit: { x: number; y: number; hue: RGB; I: number }[] = []
  for (let i = 0; i < cells.length; i++) {
    const { hue, intensity } = bulbHueIntensity(rgbs[i] ?? ([0, 0, 0] as RGB))
    if (intensity > 0.004) lit.push({ x: cells[i].x, y: cells[i].y, hue, I: intensity })
  }
  if (lit.length === 0) return
  const w = blinderWidth(shape)
  const h = w * 2
  const reach = blinderPitch(shape) * 2.2
  const illum = (x: number, y: number): { a: number; hue: RGB } => ppIllum(lit, reach, x, y)
  const left = c.x - w / 2
  const right = c.x + w / 2
  const top = c.y - h / 2
  const bottom = c.y + h / 2
  const bw = Math.max(1.2, w * 0.045)
  const m = Math.max(2, w * 0.06)
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.lineCap = 'butt'
  ppSegBand(ctx, left, top, right, top, bw, illum, 0.3, 0.22)
  ppSegBand(ctx, right, top, right, bottom, bw, illum, 0.3, 0.22)
  ppSegBand(ctx, right, bottom, left, bottom, bw, illum, 0.3, 0.22)
  ppSegBand(ctx, left, bottom, left, top, bw, illum, 0.3, 0.22)
  ppSegBand(ctx, c.x, top + 1, c.x, bottom - 1, bw * 0.8, illum, 0.26, 0.18)
  for (const [bx, by] of [
    [left + m, top + m],
    [right - m, top + m],
    [left + m, bottom - m],
    [right - m, bottom - m]
  ]) {
    const q = illum(bx, by)
    ppBolt(ctx, bx, by, Math.max(0.7, w * 0.02), q.hue, 0.5 * q.a)
  }
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

/** Lit PAT (v7・2026-06-11): the whole golden mesh glows evenly (floor 0.82), the
 *  bare bulb burns upper-left and white-clips from 55%, FULL blasts the face white
 *  and spills past the rim. The bezel tube, brass flange, 8 bolts, spoke bars, hub
 *  and dome glint appear only as the PAT's own light reflecting off them — and the
 *  glare swallows them again near full (reflectGain). */
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
  const clip = I > 0.55 ? (I - 0.55) / 0.45 : 0
  const det = reflectGain(I)
  const s = Math.max(2.4, R / 12)
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  const face = ctx.createRadialGradient(cx, cy, 0, cx, cy, R)
  face.addColorStop(0, rgba(hue, (0.18 + 0.18 * blast) * I))
  face.addColorStop(1, rgba(hue, (0.1 + 0.14 * blast) * I))
  ctx.fillStyle = face
  ctx.beginPath()
  ctx.arc(cx, cy, R, 0, Math.PI * 2)
  ctx.fill()
  for (const h of pattHoles(R)) {
    const k2 = h.k + (1.05 - h.k) * blast * 0.9
    const a = Math.min(1, I * k2)
    if (a < 0.012) continue
    ctx.fillStyle = rgba(mix(hue, W, Math.min(1, 0.15 + 0.45 * a + 0.4 * blast)), a)
    ctx.beginPath()
    ctx.arc(cx + h.x, cy + h.y, s * 0.36 * (0.85 + 0.35 * a + 0.2 * blast), 0, Math.PI * 2)
    ctx.fill()
  }
  // the bare bulb upper-left — white-clips progressively from 55%
  const bx = cx - R * 0.3
  const by = cy - R * 0.32
  steep(ctx, bx, by, R * 0.55, mix(hue, W, 0.6 + 0.4 * clip), (0.55 + 0.25 * clip) * I)
  if (clip > 0) steep(ctx, bx, by, R * (0.3 + 0.3 * clip), W, Math.min(1, 0.8 * clip))
  if (blast > 0) {
    steep(ctx, bx, by, R * 0.7, W, 0.55 * blast)
    steep(ctx, cx, cy, R * 1.3, W, 0.5 * blast)
    steep(ctx, cx, cy, R * 2.1, mix(hue, W, 0.6), 0.26 * blast)
  }
  // mesh dome glint (upper-left arc — the basket bulges)
  ctx.strokeStyle = rgba(mix(hue, W, 0.55), 0.14 * I)
  ctx.lineWidth = Math.max(0.8, R * 0.03)
  ctx.beginPath()
  ctx.arc(cx, cy, R * 0.93, -2.6, -0.9)
  ctx.stroke()
  // spoke bars as lit metal (one down, two up — the big PAT's own orientation),
  // hub disc + centre bolt
  ctx.lineCap = 'butt'
  const hubR = R * 0.07
  for (const [ux, uy] of SPOKE_U) {
    ctx.strokeStyle = rgba(mix(PP_STEEL, hue, 0.32), 0.35 * det)
    ctx.lineWidth = Math.max(0.8, R * 0.02)
    ctx.beginPath()
    ctx.moveTo(cx + ux * hubR, cy + uy * hubR)
    ctx.lineTo(cx + ux * R * 0.98, cy + uy * R * 0.98)
    ctx.stroke()
  }
  ctx.fillStyle = rgba(mix(PP_STEEL, hue, 0.32), 0.4 * det)
  ctx.beginPath()
  ctx.arc(cx, cy, hubR, 0, Math.PI * 2)
  ctx.fill()
  ppBolt(ctx, cx, cy, Math.max(0.8, hubR * 0.45), hue, 0.55 * det)
  // rim catching the light + bezel tube + brass flange + 8 bolts
  ctx.strokeStyle = rgba(mix(hue, W, 0.3), (0.18 + 0.3 * blast) * I)
  ctx.lineWidth = R * 0.035
  ctx.beginPath()
  ctx.arc(cx, cy, R, 0, Math.PI * 2)
  ctx.stroke()
  ctx.strokeStyle = rgba(mix(PP_STEEL, hue, 0.26), 0.4 * det)
  ctx.lineWidth = Math.max(1.2, R * 0.05)
  ctx.beginPath()
  ctx.arc(cx, cy, R * 1.045, 0, Math.PI * 2)
  ctx.stroke()
  ctx.strokeStyle = rgba(mix(PP_BRASS, hue, 0.18), 0.5 * det)
  ctx.lineWidth = Math.max(1, R * 0.035)
  ctx.beginPath()
  ctx.arc(cx, cy, R * 1.09, 0, Math.PI * 2)
  ctx.stroke()
  ctx.strokeStyle = rgba(mix(PP_BRASS, W, 0.5), 0.2 * det)
  ctx.lineWidth = Math.max(0.6, R * 0.012)
  ctx.beginPath()
  ctx.arc(cx, cy, R * 1.1, -2.7, -0.4)
  ctx.stroke()
  for (let b = 0; b < 8; b++) {
    const a = (b * Math.PI) / 4 + Math.PI / 8
    ppBolt(
      ctx,
      cx + Math.cos(a) * R * 1.09,
      cy + Math.sin(a) * R * 1.09,
      Math.max(0.7, R * 0.02),
      hue,
      0.5 * det
    )
  }
  ctx.restore()
}

/* ============================== Pixel PAT ============================== */

/** Cell centres of the 7-cell hex unit: instance 0 = centre, 1..6 = the ring,
 *  starting at the TOP and going clockwise. diameter = overall unit width. */
export function pixelPattCells(shape: Pick<Shape, 'points' | 'diameter'>): Point[] {
  const c = shape.points[0] ?? { x: 0, y: 0 }
  const D = pixelPattDiameter(shape)
  const ring = D / 3 // cell spacing — the skeleton shows between the bezels
  const out: Point[] = [{ x: c.x, y: c.y }]
  for (let k = 0; k < 6; k++) {
    const ang = -Math.PI / 2 + (k * Math.PI) / 3
    out.push({ x: c.x + Math.cos(ang) * ring, y: c.y + Math.sin(ang) * ring })
  }
  return out
}

/** Cell aperture = 55% of the cell spacing — のむさん fixed this on the v10 mock
 *  (2026-06-11): the real unit's cells sit apart with the frame showing between. */
export const pixelPattCellDiameter = (shape: Pick<Shape, 'points' | 'diameter'>): number =>
  (pixelPattDiameter(shape) / 3) * 0.55

/** Bezel outer radius: the brass-lipped flange around one cell aperture. */
const ppBezel = (cellR: number): number => cellR * 1.24

/** Hex frame vertex radius — the band's corners sit AT the cells (pointy hex,
 *  the reference photo's orientation), tucked under the bezels. */
export const pixelPattFrameRadius = (shape: Pick<Shape, 'points' | 'diameter'>): number =>
  pixelPattDiameter(shape) / 3 + ppBezel(pixelPattCellDiameter(shape) / 2) * 0.81

/** Pixel PAT cell spokes: one bar UP, two down (the reference photo — the big PAT
 *  keeps its own one-down-two-up orientation). */
const PP_SPOKE_U: [number, number][] = [
  [Math.cos(-Math.PI / 2), Math.sin(-Math.PI / 2)],
  [Math.cos(Math.PI / 6), Math.sin(Math.PI / 6)],
  [Math.cos(Math.PI - Math.PI / 6), Math.sin(Math.PI - Math.PI / 6)]
]

const PP_BRASS: RGB = [238, 190, 120]
const PP_STEEL: RGB = [132, 134, 142]

interface PPHole {
  x: number
  y: number
  /** static brightness: hot around the frosted bulb, near-even out to the rim, a soft
   *  dome falloff at the very edge, hair-thin spoke shadows (vector test — no atan2) */
  k: number
  s: number
}

const ppHoleCache = new Map<number, PPHole[]>()

function pixelPattHoles(R: number): PPHole[] {
  const key = Math.round(R * 4)
  const hit = ppHoleCache.get(key)
  if (hit) return hit
  const out: PPHole[] = []
  const s = Math.max(1.2, R / 22)
  const rowH = s * 0.866
  const hubR = R * 0.1
  let row = 0
  for (let y = -R - rowH; y <= R + rowH; y += rowH, row++) {
    const off = row % 2 ? s / 2 : 0
    for (let x = -R + off; x <= R; x += s) {
      const rr = Math.hypot(x, y)
      if (rr > R * 0.975 || rr < hubR) continue
      let dim = 1
      for (const [ux, uy] of PP_SPOKE_U) {
        const along = x * ux + y * uy
        const perp = Math.abs(x * uy - y * ux)
        if (along > 0 && perp < R * 0.028) dim = 0.35
      }
      const hot = Math.max(0, 1 - rr / (R * 0.85))
      const edge = rr > R * 0.82 ? 1 - ((rr - R * 0.82) / (R * 0.18)) * 0.35 : 1
      out.push({ x, y, k: (0.42 + 0.68 * hot) * edge * dim, s })
    }
  }
  if (ppHoleCache.size > 40) ppHoleCache.clear()
  ppHoleCache.set(key, out)
  return out
}

/** A bolt head caught by the light. */
function ppBolt(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  hue: RGB,
  a: number
): void {
  if (a <= 0.01) return
  ctx.fillStyle = rgba(mix(PP_STEEL, hue, 0.3), 0.95 * a)
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = rgba(mix(hue, W, 0.75), 0.85 * a)
  ctx.beginPath()
  ctx.arc(x - r * 0.32, y - r * 0.32, r * 0.38, 0, Math.PI * 2)
  ctx.fill()
}

export function drawPixelPattSchematic(
  ctx: CanvasRenderingContext2D,
  shape: Shape,
  stroke: string,
  fill: string,
  boost = 1
): void {
  const c = shape.points[0]
  if (!c) return
  const hexR = pixelPattFrameRadius(shape)
  const cells = pixelPattCells(shape)
  ctx.save()
  ctx.lineWidth = Math.max(1, boost) * 0.6
  ctx.strokeStyle = stroke
  // the hex band, vertices AT the cells (pointy), plus the 6 radial beams
  ctx.beginPath()
  for (let k = 0; k < 6; k++) {
    const ang = -Math.PI / 2 + (k * Math.PI) / 3
    const px = c.x + Math.cos(ang) * hexR
    const py = c.y + Math.sin(ang) * hexR
    if (k === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.closePath()
  ctx.stroke()
  for (let k = 1; k < cells.length; k++) {
    ctx.beginPath()
    ctx.moveTo(c.x, c.y)
    ctx.lineTo(cells[k].x, cells[k].y)
    ctx.stroke()
  }
  ctx.restore()
  const cd = pixelPattCellDiameter(shape)
  for (const p of cells) {
    drawPattSchematicAt(ctx, p.x, p.y, cd / 2, stroke, fill, boost)
  }
  ctx.save()
  ctx.fillStyle = stroke
  ctx.fillRect(c.x - 0.5, c.y - 0.5, 1, 1)
  ctx.restore()
}

/** One lit Pixel PAT cell (instance i) — per-cell DMX is the whole point of the
 *  fixture (chase the 7 cells from the desk; 間隔0 for一斉). The fine mesh glows
 *  hot around the frosted bulb; the bezel, brass flange, spokes and bolts appear
 *  only as the cell's own light reflecting off them (off → pure dark). */
export function drawPixelPattCellLit(
  ctx: CanvasRenderingContext2D,
  shape: Shape,
  rgb: RGB,
  instance: number
): void {
  const p = pixelPattCells(shape)[instance]
  if (!p) return
  const { hue, intensity: I } = bulbHueIntensity(rgb)
  if (I <= 0.004) return
  const R = pixelPattCellDiameter(shape) / 2
  if (R <= 1) return
  const x = p.x
  const y = p.y
  const blast = I > 0.88 ? (I - 0.88) / 0.12 : 0
  const clip = I > 0.55 ? (I - 0.55) / 0.45 : 0
  const det = reflectGain(I) // mid-gauge: structure visible; full: glare swallows it
  const bez = ppBezel(R)
  const hubR = R * 0.1
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.lineCap = 'butt'
  const face = ctx.createRadialGradient(x, y, 0, x, y, R)
  face.addColorStop(0, rgba(hue, (0.14 + 0.2 * blast) * I))
  face.addColorStop(1, rgba(hue, (0.07 + 0.15 * blast) * I))
  ctx.fillStyle = face
  ctx.beginPath()
  ctx.arc(x, y, R, 0, Math.PI * 2)
  ctx.fill()
  for (const h of pixelPattHoles(R)) {
    const k2 = h.k + (1.05 - h.k) * blast * 0.92
    const a = Math.min(1, I * k2)
    if (a < 0.012) continue
    ctx.fillStyle = rgba(mix(hue, W, Math.min(1, 0.08 + 0.45 * a + 0.5 * blast)), a)
    const sz = h.s * 0.58 * (0.85 + 0.22 * a + 0.22 * blast)
    ctx.fillRect(x + h.x - sz / 2, y + h.y - sz / 2, sz, sz)
  }
  // the frosted bulb burning through the mesh
  const bulb = ctx.createRadialGradient(x, y, 0, x, y, R * 0.55)
  bulb.addColorStop(0, rgba(mix(hue, W, 0.6 + 0.4 * clip), 0.85 * I))
  bulb.addColorStop(0.3, rgba(mix(hue, W, 0.5 + 0.35 * clip), 0.5 * I))
  bulb.addColorStop(0.62, rgba(mix(hue, W, 0.3 + 0.2 * clip), 0.18 * I))
  bulb.addColorStop(1, rgba(hue, 0.03 * I))
  ctx.fillStyle = bulb
  ctx.beginPath()
  ctx.arc(x, y, R * 0.55, 0, Math.PI * 2)
  ctx.fill()
  if (blast > 0) {
    steep(ctx, x, y, R * 1.1, W, 0.6 * blast)
    steep(ctx, x, y, R * 1.8, mix(hue, W, 0.6), 0.28 * blast)
  }
  // mesh dome glint (upper-left arc)
  ctx.strokeStyle = rgba(mix(hue, W, 0.55), 0.14 * I)
  ctx.lineWidth = Math.max(0.6, R * 0.042)
  ctx.beginPath()
  ctx.arc(x, y, R * 0.93, -2.6, -0.9)
  ctx.stroke()
  // hair-thin spokes + small hub disc + centre bolt
  for (const [ux, uy] of PP_SPOKE_U) {
    ctx.strokeStyle = rgba(mix(PP_STEEL, hue, 0.32), 0.4 * det)
    ctx.lineWidth = Math.max(0.5, R * 0.024)
    ctx.beginPath()
    ctx.moveTo(x + ux * hubR * 0.6, y + uy * hubR * 0.6)
    ctx.lineTo(x + ux * R * 0.99, y + uy * R * 0.99)
    ctx.stroke()
  }
  ctx.fillStyle = rgba(mix(PP_STEEL, hue, 0.32), 0.45 * det)
  ctx.beginPath()
  ctx.arc(x, y, hubR, 0, Math.PI * 2)
  ctx.fill()
  ppBolt(ctx, x, y, Math.max(0.6, hubR * 0.45), hue, 0.6 * det)
  // bezel tube
  const tubeW = Math.max(1, bez - R - R * 0.09)
  ctx.strokeStyle = rgba(mix(PP_STEEL, hue, 0.26), 0.42 * det)
  ctx.lineWidth = tubeW
  ctx.beginPath()
  ctx.arc(x, y, R + tubeW / 2 + R * 0.015, 0, Math.PI * 2)
  ctx.stroke()
  // aperture rim catching the light + the inner brass line
  ctx.strokeStyle = rgba(mix(PP_BRASS, hue, 0.2), 0.3 * det)
  ctx.lineWidth = Math.max(0.5, R * 0.033)
  ctx.beginPath()
  ctx.arc(x, y, R + R * 0.036, 0, Math.PI * 2)
  ctx.stroke()
  ctx.strokeStyle = rgba(mix(hue, W, 0.3), (0.2 + 0.3 * blast) * I)
  ctx.lineWidth = Math.max(0.5, R * 0.03)
  ctx.beginPath()
  ctx.arc(x, y, R + R * 0.006, 0, Math.PI * 2)
  ctx.stroke()
  // the outermost brass flange + its top-left glint + 8 bolts
  ctx.strokeStyle = rgba(mix(PP_BRASS, hue, 0.18), 0.55 * det)
  ctx.lineWidth = Math.max(0.8, R * 0.084)
  ctx.beginPath()
  ctx.arc(x, y, bez - R * 0.042, 0, Math.PI * 2)
  ctx.stroke()
  ctx.strokeStyle = rgba(mix(PP_BRASS, W, 0.5), 0.22 * det)
  ctx.lineWidth = Math.max(0.5, R * 0.027)
  ctx.beginPath()
  ctx.arc(x, y, bez - R * 0.012, -2.7, -0.4)
  ctx.stroke()
  for (let b = 0; b < 8; b++) {
    const a = (b * Math.PI) / 4 + Math.PI / 8
    ppBolt(
      ctx,
      x + Math.cos(a) * (bez - R * 0.042),
      y + Math.sin(a) * (bez - R * 0.042),
      Math.max(0.5, R * 0.039),
      hue,
      0.55 * det
    )
  }
  // spill onto the surrounding plate
  const spill = ctx.createRadialGradient(x, y, bez, x, y, bez * 1.7)
  spill.addColorStop(0, rgba(hue, (0.05 + 0.06 * blast) * I))
  spill.addColorStop(1, rgba(hue, 0))
  ctx.fillStyle = spill
  ctx.beginPath()
  ctx.arc(x, y, bez * 1.7, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

/** Local illumination on the frame: distance-falloff sum over the lit cells, so a
 *  chase lights only the metal NEAR the burning cell and the far side melts into
 *  the dark (のむさん 2026-06-11 — same idea as the festoon wire). */
function ppIllum(
  lit: { x: number; y: number; hue: RGB; I: number }[],
  reach: number,
  x: number,
  y: number
): { a: number; hue: RGB } {
  let a = 0
  let r = 0
  let g = 0
  let b = 0
  for (const L of lit) {
    const d = Math.hypot(x - L.x, y - L.y)
    if (d >= reach) continue
    const f = 1 - d / reach
    const w = reflectGain(L.I) * f * f // a full-blast cell GLARES its metal away
    if (w <= 0) continue
    a += w
    r += L.hue[0] * w
    g += L.hue[1] * w
    b += L.hue[2] * w
  }
  if (a <= 0) return { a: 0, hue: W }
  return { a: Math.min(1, a), hue: [r / a, g / a, b / a] }
}

/** A flat metal band drawn in short joined segments, each shaded by the local
 *  illumination — continuous (never cut), brightening near lit cells, fading out. */
function ppSegBand(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  w: number,
  illum: (x: number, y: number) => { a: number; hue: RGB },
  faceK: number,
  edgeK: number
): void {
  const L = Math.hypot(x2 - x1, y2 - y1)
  if (L < 1) return
  const segs = Math.max(4, Math.round(L / 9))
  const ox = -(y2 - y1) / L
  const oy = (x2 - x1) / L
  const ew = Math.max(0.5, w * 0.07)
  for (let i = 0; i < segs; i++) {
    const t0 = i / segs
    const t1 = (i + 1) / segs
    const sx = x1 + (x2 - x1) * t0
    const sy = y1 + (y2 - y1) * t0
    const ex = x1 + (x2 - x1) * t1
    const ey = y1 + (y2 - y1) * t1
    const m = illum((sx + ex) / 2, (sy + ey) / 2)
    if (m.a <= 0.012) continue
    ctx.strokeStyle = rgba(mix(PP_STEEL, m.hue, 0.26), faceK * m.a)
    ctx.lineWidth = w
    ctx.beginPath()
    ctx.moveTo(sx, sy)
    ctx.lineTo(ex, ey)
    ctx.stroke()
    ctx.strokeStyle = rgba(mix(PP_STEEL, m.hue, 0.34), faceK * 0.45 * m.a)
    ctx.lineWidth = w * 0.5
    ctx.beginPath()
    ctx.moveTo(sx, sy)
    ctx.lineTo(ex, ey)
    ctx.stroke()
    ctx.strokeStyle = rgba(mix(m.hue, W, 0.5), edgeK * m.a)
    ctx.lineWidth = ew
    ctx.beginPath()
    ctx.moveTo(sx + (ox * w) / 2, sy + (oy * w) / 2)
    ctx.lineTo(ex + (ox * w) / 2, ey + (oy * w) / 2)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(sx - (ox * w) / 2, sy - (oy * w) / 2)
    ctx.lineTo(ex - (ox * w) / 2, ey - (oy * w) / 2)
    ctx.stroke()
  }
}

/** The unit's skeleton — 6 thin radial beams + the through hex band (vertices AT
 *  the cells) + bolts — lit purely by reflection from its own cells. Drawn ONCE per
 *  unit (not per instance); all cells off → draws nothing at all. */
export function drawPixelPattFrame(
  ctx: CanvasRenderingContext2D,
  shape: Pick<Shape, 'points' | 'diameter'>,
  rgbs: RGB[]
): void {
  const c = shape.points[0]
  if (!c) return
  const cells = pixelPattCells(shape)
  const lit: { x: number; y: number; hue: RGB; I: number }[] = []
  let blastSum = 0
  for (let i = 0; i < cells.length; i++) {
    const { hue, intensity } = bulbHueIntensity(rgbs[i] ?? ([0, 0, 0] as RGB))
    if (intensity > 0.004) lit.push({ x: cells[i].x, y: cells[i].y, hue, I: intensity })
    blastSum += intensity > 0.88 ? (intensity - 0.88) / 0.12 : 0
  }
  if (lit.length === 0) return
  const ring = pixelPattDiameter(shape) / 3
  const bez = ppBezel(pixelPattCellDiameter(shape) / 2)
  const reach = ring * 1.45
  const illum = (x: number, y: number): { a: number; hue: RGB } => ppIllum(lit, reach, x, y)
  const boltR = Math.max(0.6, ring * 0.012)
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.lineCap = 'butt'
  for (let k = 1; k <= 6; k++) {
    ppSegBand(ctx, c.x, c.y, cells[k].x, cells[k].y, ring * 0.1, illum, 0.3, 0.2)
    const mx = (c.x + cells[k].x) / 2
    const my = (c.y + cells[k].y) / 2
    const m = illum(mx, my)
    ppBolt(ctx, mx, my, boltR, m.hue, 0.55 * m.a)
  }
  const hexR = ring + bez * 0.81
  for (let k = 0; k < 6; k++) {
    const a1 = -Math.PI / 2 + (k * Math.PI) / 3
    const a2 = -Math.PI / 2 + (((k + 1) % 6) * Math.PI) / 3
    const p1 = { x: c.x + Math.cos(a1) * hexR, y: c.y + Math.sin(a1) * hexR }
    const p2 = { x: c.x + Math.cos(a2) * hexR, y: c.y + Math.sin(a2) * hexR }
    ppSegBand(ctx, p1.x, p1.y, p2.x, p2.y, ring * 0.2, illum, 0.3, 0.24)
    for (const t of [0.28, 0.5, 0.72]) {
      const bx = p1.x + (p2.x - p1.x) * t
      const by = p1.y + (p2.y - p1.y) * t
      const m = illum(bx, by)
      ppBolt(ctx, bx, by, boltR, m.hue, 0.5 * m.a)
    }
  }
  // every cell over 88% → the whole unit blooms (the molefay wall)
  const ba = blastSum / cells.length
  if (ba > 0.01) {
    const m = illum(c.x, c.y)
    steep(ctx, c.x, c.y, hexR * 1.35, mix(m.hue, W, 0.72), 0.2 * ba)
  }
  ctx.restore()
}
