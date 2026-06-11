import type { Shape } from '../model/types'
import { bulbHueIntensity, type RGB } from './bulb'

export const NEON_DEFAULT_TEXT = 'OPEN'
export const NEON_DEFAULT_FONT = 'neonderthaw'
export const NEON_DEFAULT_SIZE = 32
export const NEON_DEFAULT_GLOW = 55

export interface NeonFontDef {
  id: string
  /** Short name shown on the font button (rendered in the font itself). */
  label: string
  family: string
  weight: number
  /** true = stroke-only tube look (縁だけの管 — MOTEL/BEACH style); false = filled
   *  glyph with a hot white core (script signs). */
  tube: boolean
  /** Sample string for the Inspector font button. */
  sample: string
}

/** The PARTS shelf line-up (decided with のむさん 2026-06-11). All bundled via
 *  @fontsource — works offline. Adding a font = add a row here + its import in main.tsx. */
export const NEON_FONTS: NeonFontDef[] = [
  { id: 'neonderthaw', label: 'Neonderthaw', family: 'Neonderthaw', weight: 400, tube: false, sample: 'Welcome' },
  { id: 'pacifico', label: 'Pacifico', family: 'Pacifico', weight: 400, tube: false, sample: 'Coffee' },
  { id: 'mr-dafoe', label: 'Mr Dafoe', family: 'Mr Dafoe', weight: 400, tube: false, sample: 'Open' },
  { id: 'sacramento', label: 'Sacramento', family: 'Sacramento', weight: 400, tube: false, sample: 'Cocktails' },
  { id: 'monoton', label: 'Monoton', family: 'Monoton', weight: 400, tube: false, sample: 'SUNSET' },
  { id: 'tilt-neon', label: 'Tilt Neon', family: 'Tilt Neon', weight: 400, tube: false, sample: 'Music' },
  { id: 'bebas-tube', label: 'Bebas 管', family: 'Bebas Neue', weight: 400, tube: true, sample: 'MOTEL' },
  { id: 'noto-jp', label: '日本語', family: 'Noto Sans JP', weight: 500, tube: false, sample: '営業中' }
]

export const neonFont = (shape: Pick<Shape, 'fontId'>): NeonFontDef =>
  NEON_FONTS.find((f) => f.id === shape.fontId) ?? NEON_FONTS[0]
export const neonSize = (shape: Pick<Shape, 'fontSize'>): number =>
  shape.fontSize && shape.fontSize > 0 ? shape.fontSize : NEON_DEFAULT_SIZE
export const neonGlowAmount = (shape: Pick<Shape, 'neonGlow'>): number => {
  const g = shape.neonGlow ?? NEON_DEFAULT_GLOW
  return g < 0 ? 0 : g > 100 ? 100 : g
}

/** Lightable characters: every non-whitespace code point is one tube (= one DMX
 *  instance). Spaces keep their width in the layout but get no address. */
export function neonChars(text: string): string[] {
  const out: string[] = []
  for (const ch of text ?? '') if (!/\s/u.test(ch)) out.push(ch)
  return out
}

/** Instance count for addressing — never 0 so the patch maths stay sane. */
export const neonCharCount = (text: string): number => Math.max(1, neonChars(text).length)

export interface NeonGlyph {
  ch: string
  /** Left edge, relative to the text's left edge (kerning-aware via prefix widths). */
  x: number
  w: number
}

export interface NeonLayout {
  glyphs: NeonGlyph[]
  width: number
  ascent: number
  descent: number
  /** CSS font string, ready for ctx.font. */
  font: string
}

let measureCtx: CanvasRenderingContext2D | null | undefined
function getMeasureCtx(): CanvasRenderingContext2D | null {
  if (measureCtx !== undefined) return measureCtx
  measureCtx = null
  if (typeof document !== 'undefined') {
    const cv = document.createElement('canvas')
    cv.width = 8
    cv.height = 8
    measureCtx = cv.getContext('2d')
  }
  return measureCtx
}

const layoutCache = new Map<string, NeonLayout>()

/** Measurements taken before the webfont arrived are wrong — the editor clears this
 *  on document.fonts 'loadingdone' and redraws. */
export function clearNeonLayoutCache(): void {
  layoutCache.clear()
}

/** Lays the sign out around points[0] (= the sign's CENTRE, like the bulb's anchor).
 *  Falls back to a deterministic monospace estimate when no canvas exists (tests). */
export function layoutNeon(shape: Pick<Shape, 'text' | 'fontId' | 'fontSize'>): NeonLayout {
  const text = shape.text ?? ''
  const fd = neonFont(shape as Pick<Shape, 'fontId'>)
  const size = neonSize(shape)
  const font = `${fd.weight} ${size}px "${fd.family}"`
  const key = `${font}|${text}`
  const hit = layoutCache.get(key)
  if (hit) return hit

  const glyphs: NeonGlyph[] = []
  let width = 0
  let ascent = size * 0.78
  let descent = size * 0.24
  const ctx = getMeasureCtx()
  if (ctx) {
    ctx.font = font
    const cps = [...text]
    let prefix = ''
    let x0 = 0
    for (const ch of cps) {
      const x1 = ctx.measureText(prefix + ch).width
      if (!/\s/u.test(ch)) glyphs.push({ ch, x: x0, w: Math.max(0.1, x1 - x0) })
      prefix += ch
      x0 = x1
    }
    width = x0
    const m = ctx.measureText(text)
    if (m.actualBoundingBoxAscent > 0) ascent = m.actualBoundingBoxAscent
    if (m.actualBoundingBoxDescent > 0) descent = m.actualBoundingBoxDescent
  } else {
    let x = 0
    for (const ch of [...text]) {
      const w = (/\s/u.test(ch) ? 0.3 : 0.6) * size
      if (!/\s/u.test(ch)) glyphs.push({ ch, x, w })
      x += w
    }
    width = x
  }
  const out: NeonLayout = {
    glyphs,
    width,
    ascent: Math.max(ascent, size * 0.3),
    descent: Math.max(descent, size * 0.02),
    font
  }
  if (layoutCache.size > 300) layoutCache.clear()
  layoutCache.set(key, out)
  return out
}

export interface Bounds {
  x: number
  y: number
  w: number
  h: number
}

/** Overall sign box, centred on points[0]. */
export function neonBounds(shape: Pick<Shape, 'points' | 'text' | 'fontId' | 'fontSize'>): Bounds {
  const c = shape.points[0] ?? { x: 0, y: 0 }
  const L = layoutNeon(shape)
  const h = L.ascent + L.descent
  return { x: c.x - L.width / 2, y: c.y - h / 2, w: Math.max(L.width, 1), h: Math.max(h, 1) }
}

function originOf(shape: Shape, L: NeonLayout): { x0: number; baseline: number } {
  const c = shape.points[0] ?? { x: 0, y: 0 }
  return { x0: c.x - L.width / 2, baseline: c.y - (L.ascent + L.descent) / 2 + L.ascent }
}

/** Centre of tube #i in canvas px — used by the MVR export so each character lands
 *  at its real position in grandMA3. */
export function neonGlyphCenter(shape: Shape, i: number): { x: number; y: number } {
  const L = layoutNeon(shape)
  const g = L.glyphs[i]
  const c = shape.points[0] ?? { x: 0, y: 0 }
  if (!g) return { x: c.x, y: c.y }
  const { x0 } = originOf(shape, L)
  return { x: x0 + g.x + g.w / 2, y: c.y }
}

const mix = (a: number, b: number, t: number): number => a + (b - a) * t
const mixc = (c1: RGB, c2: RGB, t: number): RGB => [
  mix(c1[0], c2[0], t),
  mix(c1[1], c2[1], t),
  mix(c1[2], c2[2], t)
]
const rgba = (c: RGB, a: number): string => {
  const al = a < 0 ? 0 : a > 1 ? 1 : a
  return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${al.toFixed(3)})`
}

function setupText(ctx: CanvasRenderingContext2D, font: string): void {
  ctx.font = font
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
}

/** Editor schematic: the cold glass tubes, drawn in the editor's per-shape colours
 *  (the photoreal lit render lives in Live / Syphon output, like the bulb). */
export function drawNeonSchematic(
  ctx: CanvasRenderingContext2D,
  shape: Shape,
  stroke: string,
  fill: string,
  boost = 1
): void {
  const L = layoutNeon(shape)
  const c = shape.points[0]
  if (!c) return
  const { x0, baseline } = originOf(shape, L)
  const fd = neonFont(shape)
  const size = neonSize(shape)
  ctx.save()
  setupText(ctx, L.font)
  for (const g of L.glyphs) {
    if (fd.tube) {
      ctx.strokeStyle = stroke
      ctx.lineWidth = Math.max(1, size / 14)
      ctx.strokeText(g.ch, x0 + g.x, baseline)
    } else {
      ctx.fillStyle = fill
      ctx.fillText(g.ch, x0 + g.x, baseline)
      ctx.strokeStyle = stroke
      ctx.lineWidth = Math.max(0.6, Math.max(1, boost) * (size / 44))
      ctx.strokeText(g.ch, x0 + g.x, baseline)
    }
  }
  // anchor dot: the exact centre cell (paste/drop reference, like the bulb)
  ctx.fillStyle = stroke
  ctx.fillRect(c.x - 0.5, c.y - 0.5, 1, 1)
  ctx.restore()
}

/** One lit tube (instance i = glyphs[i]), additive-only so an off sign stays fully
 *  transparent on the Syphon output. `rgb` is the raw console colour — hue and gauge
 *  derive from it exactly like the bulb. Glow reach is the per-sign neonGlow dial
 *  (のむさん「光りすぎ防止のツマミ」); past ~92% gauge the core blows out white. */
export function drawNeonGlyphLit(
  ctx: CanvasRenderingContext2D,
  shape: Shape,
  rgb: RGB,
  instance: number
): void {
  const L = layoutNeon(shape)
  const g = L.glyphs[instance]
  if (!g || !shape.points[0]) return
  const { hue, intensity: I } = bulbHueIntensity(rgb)
  if (I <= 0.004) return
  const { x0, baseline } = originOf(shape, L)
  const x = x0 + g.x
  const fd = neonFont(shape)
  const size = neonSize(shape)
  const glow = neonGlowAmount(shape) / 100
  const blast = I > 0.92 ? (I - 0.92) / 0.08 : 0
  // halo reach: scales with glyph size, the glow dial, and the gauge
  const B = size * (0.05 + 0.45 * glow) * (0.3 + 0.7 * I)

  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  setupText(ctx, L.font)
  const paint = (color: string, blur: number, lineWidth: number): void => {
    ctx.shadowColor = rgba(hue, 1)
    ctx.shadowBlur = blur
    if (fd.tube) {
      ctx.strokeStyle = color
      ctx.lineWidth = lineWidth
      ctx.strokeText(g.ch, x, baseline)
    } else {
      ctx.fillStyle = color
      ctx.fillText(g.ch, x, baseline)
    }
  }
  const tubeW = Math.max(1, size / 13)
  // 1) wide soft halo (the part the glow dial mostly controls)
  if (glow > 0.02) paint(rgba(hue, (0.1 + 0.22 * glow) * I), B * 2.6, tubeW)
  // 2) tube body: saturated colour, tight bloom
  paint(rgba(hue, 0.8 * I), B, tubeW)
  // 3) hot core: the near-white centre of a real tube
  const core = mixc(hue, [255, 255, 255], 0.7 + 0.3 * blast)
  paint(rgba(core, (0.35 + 0.6 * I) * I), B * 0.3, Math.max(0.8, tubeW * 0.45))
  // 4) top-of-fader white surge
  if (blast > 0) paint(rgba([255, 255, 255], 0.55 * blast), B * 0.6, Math.max(0.8, tubeW * 0.4))
  ctx.shadowBlur = 0
  ctx.restore()
}
