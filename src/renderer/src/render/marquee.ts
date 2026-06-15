import type { Shape } from '../model/types'
import { bulbHueIntensity, drawBulbLit, type RGB } from './bulb'
import { BUDMO } from './marquee-budmo-data'

/* ============================== マーキーライト ==============================
 * 電球サイン（のむさん 2026-06-15 確定方式）。プロの定番＝「電球が組み込まれた
 * マーキー電球フォント」を使う。Budmo Jiggler を build 時に焼き込んだ
 * marquee-budmo-data.ts（各文字＝シルエットSVG path＋電球[x,y,r]）から描く。実行時
 * フォント/opentype 不要。
 *   ・各電球＝1 DMX ch（明るさのみ）。色はつねに暖色（電球色）固定。
 *   ・球は文字シルエット（暗い金属フチ）の上に丸ごと描かれ、光は外へはみ出してよい（光源）。
 *   ・点いた電球の所だけ文字本体（チャンネル面）が暖色に“染まる”＝反射光。染まりは
 *     シルエットにクリップ（文字の中だけ）。チェイスで点く球が移ると染まりも流れる。
 * points[0] = サインの中心。卓の RGB は明るさゲージとして使う（色は固定電球色）。
 * 座標系：em 単位・baseline y=0・文字は上（-y）へ伸びる。
 */

export const MARQUEE_DEFAULT_TEXT = 'STAGE'
export const MARQUEE_DEFAULT_SIZE = 120
export const MARQUEE_DEFAULT_PITCH = 18
export const MARQUEE_DEFAULT_FONT = 'budmo'

export interface MarqueeFontDef {
  id: string
  label: string
  family: string
  weight: number
  sample: string
}
// Budmo only for now; Casino (western) is a later 2nd face (project-marquee-bulb-font).
export const MARQUEE_FONTS: MarqueeFontDef[] = [
  { id: 'budmo', label: 'Budmo', family: 'Budmo Jiggler', weight: 400, sample: 'STAGE' }
]
export const marqueeFontDef = (s: Pick<Shape, 'fontId'>): MarqueeFontDef =>
  MARQUEE_FONTS.find((f) => f.id === s.fontId) ?? MARQUEE_FONTS[0]

export const marqueeText = (s: Pick<Shape, 'text'>): string => s.text ?? MARQUEE_DEFAULT_TEXT
export const marqueeSize = (s: Pick<Shape, 'fontSize'>): number =>
  s.fontSize && s.fontSize > 0 ? s.fontSize : MARQUEE_DEFAULT_SIZE
export const marqueePitch = (s: Pick<Shape, 'bulbPitch'>): number => {
  const p = s.bulbPitch ?? MARQUEE_DEFAULT_PITCH
  return p < 6 ? 6 : p
}

export function marqueeChars(text: string): string[] {
  const out: string[] = []
  for (const ch of text ?? '') if (!/\s/u.test(ch)) out.push(ch)
  return out
}
export const marqueeCharCount = (text: string): number => Math.max(1, marqueeChars(text).length)

/* ---- geometry from the baked Budmo data (em units, baseline y=0, glyph → -y) ---- */
const ASCENT_EM = 0.66 // cap height in em (Budmo caps reach ≈ -0.64)
const GAP_EM = 0.06 // inter-letter gap in em
const SPACE_EM = 0.3
const BULB_SCALE = 1.18 // drawn bulb diameter vs the baked dot — a touch larger, still separated

const glyphOf = (ch: string): { adv: number; sil: string; bulbs: [number, number, number][] } =>
  BUDMO[ch] ?? BUDMO[ch.toUpperCase()] ?? BUDMO[' ']

export interface MarqueeGlyph {
  ch: string
  x: number
  w: number
}
export interface MarqueeLayout {
  glyphs: MarqueeGlyph[]
  width: number
  height: number
  ascent: number
}
const layoutCache = new Map<string, MarqueeLayout>()

export function clearMarqueeCache(): void {
  layoutCache.clear()
  bulbsCache.clear()
}

export function layoutMarquee(
  shape: Pick<Shape, 'text' | 'fontId' | 'fontSize' | 'bulbPitch'>
): MarqueeLayout {
  const text = marqueeText(shape)
  const F = marqueeSize(shape)
  const key = `${F}|${text}`
  const hit = layoutCache.get(key)
  if (hit) return hit
  const ascent = ASCENT_EM * F
  const gap = GAP_EM * F
  const glyphs: MarqueeGlyph[] = []
  let x = 0
  for (const ch of [...text]) {
    if (/\s/u.test(ch)) {
      x += (BUDMO[' ']?.adv ?? SPACE_EM) * F
      continue
    }
    const w = glyphOf(ch).adv * F
    glyphs.push({ ch, x, w })
    x += w + gap
  }
  const width = glyphs.length ? x - gap : 0
  const out: MarqueeLayout = { glyphs, width: Math.max(width, 1), height: ascent, ascent }
  if (layoutCache.size > 200) layoutCache.clear()
  layoutCache.set(key, out)
  return out
}

export interface Bounds {
  x: number
  y: number
  w: number
  h: number
}
export function marqueeBounds(
  shape: Pick<Shape, 'points' | 'text' | 'fontId' | 'fontSize' | 'bulbPitch'>
): Bounds {
  const c = shape.points[0] ?? { x: 0, y: 0 }
  const L = layoutMarquee(shape)
  return { x: c.x - L.width / 2, y: c.y - L.height / 2, w: L.width, h: L.height }
}

/** baseline so the cap block is vertically centred on points[0] (glyph extends up to -ascent). */
function originOf(shape: Shape, L: MarqueeLayout): { x0: number; baseline: number } {
  const c = shape.points[0] ?? { x: 0, y: 0 }
  return { x0: c.x - L.width / 2, baseline: c.y + L.height / 2 }
}

export function marqueeGlyphCenter(shape: Shape, i: number): { x: number; y: number } {
  const L = layoutMarquee(shape)
  const g = L.glyphs[i]
  const c = shape.points[0] ?? { x: 0, y: 0 }
  if (!g) return { x: c.x, y: c.y }
  const { x0 } = originOf(shape, L)
  return { x: x0 + g.x + g.w / 2, y: c.y }
}

/* ---- every bulb in world coordinates, in order — the single source of truth for
 *      addressing (1 bulb = 1 ch) and for rendering. ---- */
export interface MarqueeBulb {
  x: number // world centre
  y: number
  d: number // drawn diameter
  letter: number
  index: number // channel index — canonical left→right (then top→bottom) order
  ox: number // its letter's world origin x
  baseline: number
  F: number // em→px scale
  bx: number // bulb centre in the glyph's em space (for the dye)
  by: number
  br: number
  sil: string // its letter's silhouette path (clips the dye)
}
const bulbsCache = new Map<string, MarqueeBulb[]>()
/** Every bulb, ordered left→right then top→bottom. This order IS the channel order
 *  (1 bulb = 1 ch), so a desk chase ramping channels ascending sweeps the sign L→R. */
export function marqueeBulbs(shape: Shape): MarqueeBulb[] {
  const c = shape.points[0] ?? { x: 0, y: 0 }
  const F = marqueeSize(shape)
  const key = `${F}|${marqueeText(shape)}|${c.x}|${c.y}`
  const hit = bulbsCache.get(key)
  if (hit) return hit
  const L = layoutMarquee(shape)
  const { x0, baseline } = originOf(shape, L)
  const raw: MarqueeBulb[] = []
  L.glyphs.forEach((gph, li) => {
    const glyph = glyphOf(gph.ch)
    const ox = x0 + gph.x
    for (const [bx, by, br] of glyph.bulbs) {
      raw.push({
        x: ox + bx * F,
        y: baseline + by * F,
        d: br * 2 * F * BULB_SCALE,
        letter: li,
        index: 0,
        ox,
        baseline,
        F,
        bx,
        by,
        br,
        sil: glyph.sil
      })
    }
  })
  raw.sort((a, b) => a.x - b.x || a.y - b.y)
  raw.forEach((b, i) => (b.index = i))
  if (bulbsCache.size > 100) bulbsCache.clear()
  bulbsCache.set(key, raw)
  return raw
}
/** Channel count = total bulbs (1 bulb = 1 DMX ch). Depends only on the text. */
export function marqueeBulbCount(shape: Pick<Shape, 'text'>): number {
  let n = 0
  for (const ch of marqueeChars(marqueeText(shape))) n += glyphOf(ch).bulbs.length
  return n
}

/* -------------------------------- colours ----------------------------------- */
const mix = (a: RGB, b: RGB, t: number): RGB => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t
]
const rgba = (c: RGB, a: number): string => {
  const al = a < 0 ? 0 : a > 1 ? 1 : a
  return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${al.toFixed(3)})`
}
const WARM_BULB: RGB = [255, 176, 94] // fixed incandescent; console controls brightness only
const DYE: RGB = [255, 148, 70] // reflected warm light that stains the channel face
const FRAME: RGB = [70, 66, 60] // dark cast-metal channel

/* -------------------------------- schematic --------------------------------- */

export function drawMarqueeSchematic(
  ctx: CanvasRenderingContext2D,
  shape: Shape,
  stroke: string,
  fill: string,
  boost = 1
): void {
  const c = shape.points[0]
  if (!c) return
  const L = layoutMarquee(shape)
  const { x0, baseline } = originOf(shape, L)
  const F = marqueeSize(shape)
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const gph of L.glyphs) {
    const g = glyphOf(gph.ch)
    ctx.save()
    ctx.translate(x0 + gph.x, baseline)
    ctx.scale(F, F)
    if (g.sil) {
      const p = new Path2D(g.sil)
      ctx.fillStyle = fill
      ctx.fill(p, 'evenodd')
      ctx.strokeStyle = stroke
      ctx.lineWidth = (Math.max(1, boost) * 0.6) / F
      ctx.stroke(p)
    }
    // recessed bulb holes down each stroke
    ctx.strokeStyle = stroke
    ctx.lineWidth = (Math.max(1, boost) * 0.5) / F
    for (const [bx, by, br] of g.bulbs) {
      ctx.beginPath()
      ctx.arc(bx, by, br * 0.78, 0, Math.PI * 2)
      ctx.fillStyle = '#0b0b0b'
      ctx.fill()
      ctx.stroke()
    }
    ctx.restore()
  }
  ctx.fillStyle = stroke
  ctx.fillRect(c.x - 0.5, c.y - 0.5, 1, 1)
  ctx.restore()
}

/* -------------------------------- lit output -------------------------------- */

/** The dark channel-letter body (the metal フチ). Drawn ONCE per sign in the output's
 *  unit pass, BEFORE the per-bulb chase, so it never paints over the lit bulbs. */
function drawLetterFrame(
  ctx: CanvasRenderingContext2D,
  sil: string,
  ox: number,
  baseline: number,
  F: number
): void {
  if (!sil) return
  ctx.save()
  ctx.translate(ox, baseline)
  ctx.scale(F, F)
  const p = new Path2D(sil)
  ctx.fillStyle = rgba(FRAME, 0.92)
  ctx.fill(p, 'evenodd')
  ctx.strokeStyle = rgba(mix(FRAME, [0, 0, 0], 0.4), 1)
  ctx.lineWidth = 1.4 / F
  ctx.stroke(p)
  ctx.restore()
}

/** One bulb's light: a warm dye pool stained onto its letter (clipped to the silhouette
 *  so it stays inside the letter = 反射光) plus the round glass bulb on top (unclipped,
 *  blooms outward = 光源). gauge 0..1 = brightness; the bulb colour is fixed warm. */
function litBulb(ctx: CanvasRenderingContext2D, b: MarqueeBulb, gauge: number): void {
  if (gauge <= 0.004) return
  ctx.save()
  ctx.translate(b.ox, b.baseline)
  ctx.scale(b.F, b.F)
  if (b.sil) ctx.clip(new Path2D(b.sil), 'evenodd')
  ctx.globalCompositeOperation = 'lighter'
  const rr = b.br * 2.6
  const grd = ctx.createRadialGradient(b.bx, b.by, 0, b.bx, b.by, rr)
  grd.addColorStop(0, rgba(DYE, 0.55 * gauge))
  grd.addColorStop(0.55, rgba(DYE, 0.2 * gauge))
  grd.addColorStop(1, rgba(DYE, 0))
  ctx.fillStyle = grd
  ctx.beginPath()
  ctx.arc(b.bx, b.by, rr, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
  drawBulbLit(
    ctx,
    b.x,
    b.y,
    b.d,
    [WARM_BULB[0] * gauge, WARM_BULB[1] * gauge, WARM_BULB[2] * gauge],
    'clear',
    0.34
  )
}

/** The dark sign body (all letter frames). Output unit pass draws this once per sign. */
export function drawMarqueeFrame(ctx: CanvasRenderingContext2D, shape: Shape): void {
  if (!shape.points[0]) return
  const L = layoutMarquee(shape)
  const F = marqueeSize(shape)
  const { x0, baseline } = originOf(shape, L)
  for (const g of L.glyphs) drawLetterFrame(ctx, glyphOf(g.ch).sil, x0 + g.x, baseline, F)
}

/** Output: light ONLY bulb #globalBulbIndex (1 bulb = 1 ch). Brightness from the console
 *  gauge; colour is the fixed warm bulb. Frame comes separately from drawMarqueeFrame. */
export function drawMarqueeBulbLit(
  ctx: CanvasRenderingContext2D,
  shape: Shape,
  rgb: RGB,
  globalBulbIndex: number
): void {
  const { intensity: I } = bulbHueIntensity(rgb)
  if (I <= 0.004) return
  const b = marqueeBulbs(shape)[globalBulbIndex]
  if (b) litBulb(ctx, b, I)
}

/** Per-letter (palette thumbnail): every bulb of letter `instance` at the console gauge. */
export function drawMarqueeGlyphLit(
  ctx: CanvasRenderingContext2D,
  shape: Shape,
  rgb: RGB,
  instance: number
): void {
  const L = layoutMarquee(shape)
  const g = L.glyphs[instance]
  if (!g || !shape.points[0]) return
  const F = marqueeSize(shape)
  const { x0, baseline } = originOf(shape, L)
  drawLetterFrame(ctx, glyphOf(g.ch).sil, x0 + g.x, baseline, F)
  const { intensity: I } = bulbHueIntensity(rgb)
  if (I <= 0.004) return
  for (const b of marqueeBulbs(shape)) if (b.letter === instance) litBulb(ctx, b, I)
}

/** Whole sign from a per-bulb gauge (frame + every bulb). For previews/tools. */
export function drawMarqueeLit(
  ctx: CanvasRenderingContext2D,
  shape: Shape,
  gaugeAt: (globalBulbIndex: number) => number
): void {
  if (!shape.points[0]) return
  drawMarqueeFrame(ctx, shape)
  for (const b of marqueeBulbs(shape)) litBulb(ctx, b, gaugeAt(b.index))
}
