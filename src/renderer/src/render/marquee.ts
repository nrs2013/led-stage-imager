import type { Shape } from '../model/types'
import { bulbHueIntensity, type RGB } from './bulb'

/* ============================== マーキーライト ==============================
 * 電球サイン（のむさん 2026-06-15・Massa のような看板）。★本物の構造に忠実に：
 * 文字は「凹んだチャンネル文字（金属の溝）」で、電球はその溝の中に沈んでいる。
 * → 電球の光は文字の形の中に閉じ込められ、外側へは一切漏れない（金属の壁が遮る）。
 *   各ストロークの中心線に沿って電球が一列。溝の床（金属面）は薄く灯り、外周は完全な闇。
 * Inspector で文字＋書体＋文字サイズ＋電球間隔。1文字 = 1 DMX 番地。
 * 中心線・電球径は文字マスクの距離変換（medial axis）で1回求めてキャッシュ。
 * points[0] = サインの中心。色とゲージは卓の RGB。
 */

export const MARQUEE_DEFAULT_TEXT = 'STAGE'
export const MARQUEE_DEFAULT_SIZE = 120
export const MARQUEE_DEFAULT_PITCH = 18
export const MARQUEE_DEFAULT_FONT = 'bebas'

export interface MarqueeFontDef {
  id: string
  label: string
  family: string
  weight: number
  sample: string
}
export const MARQUEE_FONTS: MarqueeFontDef[] = [
  { id: 'bebas', label: 'Bebas', family: 'Bebas Neue', weight: 400, sample: 'STAGE' },
  { id: 'monoton', label: 'Monoton', family: 'Monoton', weight: 400, sample: 'STAGE' },
  { id: 'tilt', label: 'Tilt', family: 'Tilt Neon', weight: 400, sample: 'Stage' },
  { id: 'pacifico', label: 'Pacifico', family: 'Pacifico', weight: 400, sample: 'Stage' },
  { id: 'dafoe', label: 'Mr Dafoe', family: 'Mr Dafoe', weight: 400, sample: 'Stage' },
  { id: 'sacramento', label: 'Sacramento', family: 'Sacramento', weight: 400, sample: 'Stage' },
  { id: 'inter', label: 'Inter', family: 'Inter', weight: 600, sample: 'Stage' },
  { id: 'noto', label: '日本語', family: 'Noto Sans JP', weight: 500, sample: '舞台' }
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

/* ---- pluggable canvas (document in the app; injected @napi-rs in headless tests) ---- */
interface MaskCv {
  width: number
  height: number
  getContext(t: '2d'): CanvasRenderingContext2D | null
}
let maskFactory: ((w: number, h: number) => MaskCv | null) | null = null
export function _setMarqueeMaskFactory(fn: ((w: number, h: number) => MaskCv | null) | null): void {
  maskFactory = fn
  measureCtx = undefined
  scratch = null
  sctx = null
  glyphCache.clear()
  layoutCache.clear()
}
function makeCanvas(w: number, h: number): MaskCv | null {
  if (maskFactory) return maskFactory(w, h)
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    return c as unknown as MaskCv
  }
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h) as unknown as MaskCv
  return null
}
let measureCtx: CanvasRenderingContext2D | null | undefined
function getMeasureCtx(): CanvasRenderingContext2D | null {
  if (measureCtx !== undefined) return measureCtx
  const cv = makeCanvas(8, 8)
  measureCtx = cv ? cv.getContext('2d') : null
  return measureCtx
}
/** reusable offscreen used to contain each letter's light to its own shape */
let scratch: MaskCv | null = null
let sctx: CanvasRenderingContext2D | null = null
function getScratch(w: number, h: number): { cv: MaskCv; ctx: CanvasRenderingContext2D } | null {
  if (!scratch || scratch.width < w || scratch.height < h) {
    scratch = makeCanvas(Math.max(w, scratch?.width ?? 0), Math.max(h, scratch?.height ?? 0))
    sctx = scratch ? scratch.getContext('2d') : null
  }
  return scratch && sctx ? { cv: scratch, ctx: sctx } : null
}

export const marqueeFontStr = (fontId: string | undefined, size: number): string => {
  const f = marqueeFontDef({ fontId })
  return `${f.weight} ${size}px "${f.family}", "Arial Black", sans-serif`
}

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
  glyphCache.clear()
}

export function layoutMarquee(
  shape: Pick<Shape, 'text' | 'fontId' | 'fontSize' | 'bulbPitch'>
): MarqueeLayout {
  const text = marqueeText(shape)
  const size = marqueeSize(shape)
  const fontId = shape.fontId
  const gap = marqueePitch(shape) * 1.0
  const key = `${fontId}|${size}|${gap}|${text}`
  const hit = layoutCache.get(key)
  if (hit) return hit
  const ctx = getMeasureCtx()
  const ascent = size * 0.74
  const glyphs: MarqueeGlyph[] = []
  let x = 0
  for (const ch of [...text]) {
    if (/\s/u.test(ch)) {
      x += size * 0.4
      continue
    }
    let adv = size * 0.55
    if (ctx) {
      ctx.font = marqueeFontStr(fontId, size)
      adv = Math.max(size * 0.22, ctx.measureText(ch).width)
    }
    glyphs.push({ ch, x, w: adv })
    x += adv + gap
  }
  const width = glyphs.length ? x - gap : 0
  const out: MarqueeLayout = { glyphs, width: Math.max(width, 1), height: size, ascent }
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

function originOf(shape: Shape, L: MarqueeLayout): { x0: number; baseline: number } {
  const c = shape.points[0] ?? { x: 0, y: 0 }
  return { x0: c.x - L.width / 2, baseline: c.y - L.height / 2 + L.ascent }
}

export function marqueeGlyphCenter(shape: Shape, i: number): { x: number; y: number } {
  const L = layoutMarquee(shape)
  const g = L.glyphs[i]
  const c = shape.points[0] ?? { x: 0, y: 0 }
  if (!g) return { x: c.x, y: c.y }
  const { x0 } = originOf(shape, L)
  return { x: x0 + g.x + g.w / 2, y: c.y }
}

/* ---- a single row of bulbs down each stroke's centre line; r = local stroke
 *      half-width (so a bulb fits the channel). mask → distance transform →
 *      medial-axis ridge → greedy spacing. cached per glyph. ---- */
interface Bulb {
  x: number
  y: number
  r: number
}
const glyphCache = new Map<string, Bulb[]>()

export function glyphBulbs(ch: string, fontId: string | undefined, size: number, pitch: number): Bulb[] {
  const key = `${ch}|${fontId}|${size}|${pitch}`
  const hit = glyphCache.get(key)
  if (hit) return hit
  const out: Bulb[] = []
  const mctx = getMeasureCtx()
  const pad = Math.ceil(pitch)
  let adv = size * 0.55
  if (mctx) {
    mctx.font = marqueeFontStr(fontId, size)
    adv = Math.max(size * 0.22, mctx.measureText(ch).width)
  }
  const ascent = size * 0.74
  const descent = size * 0.1
  const w = Math.ceil(adv) + pad * 2
  const h = Math.ceil(ascent + descent) + pad * 2
  const cv = makeCanvas(w, h)
  const g = cv ? cv.getContext('2d') : null
  if (cv && g) {
    g.clearRect(0, 0, w, h)
    g.font = marqueeFontStr(fontId, size)
    g.textAlign = 'left'
    g.textBaseline = 'alphabetic'
    g.fillStyle = '#fff'
    g.fillText(ch, pad, pad + ascent)
    let data: Uint8ClampedArray | null = null
    try {
      data = g.getImageData(0, 0, w, h).data
    } catch {
      data = null
    }
    if (data) {
      const on = new Uint8Array(w * h)
      for (let i = 0; i < w * h; i++) on[i] = data[i * 4 + 3] > 110 ? 1 : 0
      const dt = distanceTransform(on, w, h)
      // thin the glyph to a 1px skeleton, then walk it and drop a bulb every `pitch`
      // of arc length → an even, straight row centred on each stroke (no jaggedness)
      const skel = thin(on, w, h)
      pruneSpurs(skel, w, h, Math.max(3, Math.round(pitch * 0.6)))
      placeBulbsOnSkeleton(skel, dt, w, h, pitch, pad, ascent, out)
      // collapse any leftover doubled / parallel rows into one even row
      const cleaned = dedupeBulbs(out, pitch * 0.86)
      out.length = 0
      for (const b of cleaned) out.push(b)
    }
  }
  if (glyphCache.size > 400) glyphCache.clear()
  glyphCache.set(key, out)
  return out
}

function distanceTransform(on: Uint8Array, w: number, h: number): Float32Array {
  const INF = 1e9
  const dt = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) dt[i] = on[i] ? INF : 0
  const D1 = 1
  const D2 = 1.41421
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (!on[i]) continue
      let m = dt[i]
      if (x > 0) m = Math.min(m, dt[i - 1] + D1)
      if (y > 0) m = Math.min(m, dt[i - w] + D1)
      if (x > 0 && y > 0) m = Math.min(m, dt[i - w - 1] + D2)
      if (x < w - 1 && y > 0) m = Math.min(m, dt[i - w + 1] + D2)
      dt[i] = m
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x
      if (!on[i]) continue
      let m = dt[i]
      if (x < w - 1) m = Math.min(m, dt[i + 1] + D1)
      if (y < h - 1) m = Math.min(m, dt[i + w] + D1)
      if (x < w - 1 && y < h - 1) m = Math.min(m, dt[i + w + 1] + D2)
      if (x > 0 && y < h - 1) m = Math.min(m, dt[i + w - 1] + D2)
      dt[i] = m
    }
  }
  return dt
}

/** Zhang-Suen thinning → a 1-pixel-wide skeleton (the clean centre line of every stroke). */
function thin(src: Uint8Array, w: number, h: number): Uint8Array {
  const img = src.slice()
  const at = (x: number, y: number): number =>
    x < 0 || y < 0 || x >= w || y >= h ? 0 : img[y * w + x]
  const rm: number[] = []
  let changed = true
  while (changed) {
    changed = false
    for (let step = 0; step < 2; step++) {
      rm.length = 0
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          if (!img[y * w + x]) continue
          const p2 = at(x, y - 1)
          const p3 = at(x + 1, y - 1)
          const p4 = at(x + 1, y)
          const p5 = at(x + 1, y + 1)
          const p6 = at(x, y + 1)
          const p7 = at(x - 1, y + 1)
          const p8 = at(x - 1, y)
          const p9 = at(x - 1, y - 1)
          const b = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9
          if (b < 2 || b > 6) continue
          const seq = [p2, p3, p4, p5, p6, p7, p8, p9, p2]
          let a = 0
          for (let k = 0; k < 8; k++) if (seq[k] === 0 && seq[k + 1] === 1) a++
          if (a !== 1) continue
          if (step === 0) {
            if (p2 * p4 * p6 !== 0) continue
            if (p4 * p6 * p8 !== 0) continue
          } else {
            if (p2 * p4 * p8 !== 0) continue
            if (p2 * p6 * p8 !== 0) continue
          }
          rm.push(y * w + x)
        }
      }
      if (rm.length) {
        changed = true
        for (const i of rm) img[i] = 0
      }
    }
  }
  return img
}

/** Skeleton neighbour list (8-connected). */
function skelNeighbors(skel: Uint8Array, w: number, h: number, i: number): number[] {
  const x = i % w
  const y = (i / w) | 0
  const r: number[] = []
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue
      const nx = x + dx
      const ny = y + dy
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
      if (skel[ny * w + nx]) r.push(ny * w + nx)
    }
  }
  return r
}

/** Remove tiny hairs: a short branch that runs from a free endpoint into a junction. These
 *  are thinning artefacts (and the stubs ornate serifs sprout) that otherwise get a stray or
 *  doubled bulb. `maxLen` is kept small so real strokes/serif bars survive — only noise hairs
 *  (a few px) are clipped. */
function pruneSpurs(skel: Uint8Array, w: number, h: number, maxLen: number): void {
  for (let iter = 0; iter < 6; iter++) {
    let changed = false
    const ends: number[] = []
    for (let i = 0; i < w * h; i++) if (skel[i] && skelNeighbors(skel, w, h, i).length === 1) ends.push(i)
    for (const s of ends) {
      if (!skel[s]) continue
      const path = [s]
      let cur = s
      let prev = -1
      let junction = false
      for (let k = 0; k < maxLen; k++) {
        const ns = skelNeighbors(skel, w, h, cur).filter((j) => j !== prev)
        if (ns.length === 0) break // free short stroke — keep it
        if (ns.length > 1) {
          junction = true // cur sits next to a junction
          break
        }
        prev = cur
        cur = ns[0]
        if (skelNeighbors(skel, w, h, cur).length > 2) {
          junction = true
          break
        }
        path.push(cur)
      }
      if (junction) {
        for (const p of path) skel[p] = 0 // drop the hair, leave the junction pixel
        changed = true
      }
    }
    if (!changed) break
  }
}

/** Greedy spatial thinning of the placed bulbs: keep a bulb only if no already-kept bulb is
 *  within `minDist`. Order is preserved (first = endpoints first), so each stroke keeps its
 *  even row and any second/parallel row collapses onto the first. Kills "doubled" rows. */
function dedupeBulbs(bulbs: Bulb[], minDist: number): Bulb[] {
  const min2 = minDist * minDist
  const kept: Bulb[] = []
  for (const b of bulbs) {
    let ok = true
    for (const k of kept) {
      const dx = k.x - b.x
      const dy = k.y - b.y
      if (dx * dx + dy * dy < min2) {
        ok = false
        break
      }
    }
    if (ok) kept.push(b)
  }
  return kept
}

/** Walk the skeleton end-to-end and drop a bulb every `pitch` of arc length, preferring
 *  the straight-ahead neighbour so the row stays even. r = local stroke half-width. */
function placeBulbsOnSkeleton(
  skel: Uint8Array,
  dt: Float32Array,
  w: number,
  h: number,
  pitch: number,
  pad: number,
  ascent: number,
  out: Bulb[]
): void {
  const visited = new Uint8Array(w * h)
  const neighbors = (i: number): number[] => {
    const x = i % w
    const y = (i / w) | 0
    const res: number[] = []
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
        const j = ny * w + nx
        if (skel[j]) res.push(j)
      }
    }
    return res
  }
  const pts: number[] = []
  for (let i = 0; i < w * h; i++) if (skel[i]) pts.push(i)
  // walk open strokes from their endpoints (1 neighbour) first
  pts.sort((a, b) => neighbors(a).length - neighbors(b).length)
  const placed: { x: number; y: number }[] = []
  const min2 = pitch * 0.7 * (pitch * 0.7)
  const drop = (i: number): void => {
    const x = i % w
    const y = (i / w) | 0
    for (const p of placed) {
      const dx = p.x - x
      const dy = p.y - y
      if (dx * dx + dy * dy < min2) return
    }
    placed.push({ x, y })
    out.push({ x: x - pad, y: y - pad - ascent, r: Math.max(1.5, Math.min(dt[i], pitch)) })
  }
  for (const start of pts) {
    if (visited[start]) continue
    let cur = start
    let prev = -1
    let acc = 0
    visited[cur] = 1
    drop(cur)
    for (;;) {
      const ns = neighbors(cur).filter((j) => j !== prev && !visited[j])
      if (!ns.length) break
      let best = ns[0]
      if (ns.length > 1 && prev >= 0) {
        const dirx = (cur % w) - (prev % w)
        const diry = ((cur / w) | 0) - ((prev / w) | 0)
        let bd = -Infinity
        for (const j of ns) {
          const dx = (j % w) - (cur % w)
          const dy = ((j / w) | 0) - ((cur / w) | 0)
          const dot = dx * dirx + dy * diry
          if (dot > bd) {
            bd = dot
            best = j
          }
        }
      }
      acc += Math.hypot((best % w) - (cur % w), ((best / w) | 0) - ((cur / w) | 0))
      visited[best] = 1
      prev = cur
      cur = best
      if (acc >= pitch) {
        drop(cur)
        acc = 0
      }
    }
  }
}

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
  const size = marqueeSize(shape)
  const pitch = marqueePitch(shape)
  ctx.save()
  ctx.font = marqueeFontStr(shape.fontId, size)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.lineWidth = Math.max(1, boost) * 0.6
  for (const gph of L.glyphs) {
    // the channel-letter body (filled metal face) + its outline
    ctx.fillStyle = fill
    ctx.fillText(gph.ch, x0 + gph.x, baseline)
    ctx.strokeStyle = stroke
    ctx.strokeText(gph.ch, x0 + gph.x, baseline)
    // recessed bulb holes down the centre
    for (const b of glyphBulbs(gph.ch, shape.fontId, size, pitch)) {
      const r = Math.min(b.r, pitch * 0.5) * 0.85
      ctx.fillStyle = '#0b0b0b'
      ctx.strokeStyle = stroke
      ctx.beginPath()
      ctx.arc(x0 + gph.x + b.x, baseline + b.y, r, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
    }
  }
  ctx.fillStyle = stroke
  ctx.fillRect(c.x - 0.5, c.y - 0.5, 1, 1)
  ctx.restore()
}

/* -------------------------------- lit output -------------------------------- */

const BRASS: RGB = [212, 168, 116]
const TAU = Math.PI * 2

/** The soft, spreading light a bulb throws — a warm pool on the surrounding metal plus the
 *  glass envelope's outer halo. This is the にじみ that must stay inside the letter, so the
 *  caller clips it to the glyph. Drawn additively. (Paired with drawBulbGlobe.) */
export function drawBulbGlow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rb: number,
  hue: RGB,
  I: number
): void {
  if (rb < 1) rb = 1
  // a tight warm halo only — kept small so the dark gaps BETWEEN bulbs survive and each
  // bulb still reads as a separate dot (too much spread merges the row into a 団子 smear)
  const glow = ctx.createRadialGradient(x, y, rb * 0.5, x, y, rb * 1.55)
  glow.addColorStop(0, rgba(mix(hue, W, 0.4), 0.34 * I))
  glow.addColorStop(0.6, rgba(mix(hue, [255, 150, 70], 0.4), 0.16 * I))
  glow.addColorStop(1, rgba(hue, 0))
  ctx.fillStyle = glow
  ctx.beginPath()
  ctx.arc(x, y, rb * 1.55, 0, TAU)
  ctx.fill()
}

/** The solid, ROUND glass bulb itself: a brass socket, the shaded glass globe, the hot
 *  filament and a specular glint. The user wants the 球 fully round, so this is drawn ON
 *  TOP and never clipped to the letter — a real marquee bulb sits proud of the channel.
 *  Drawn additively on black. (Paired with drawBulbGlow.) */
export function drawBulbGlobe(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rb: number,
  hue: RGB,
  I: number,
  blast: number
): void {
  if (rb < 1) rb = 1
  const hot = mix(hue, W, 0.7 + 0.3 * blast)
  // brass socket the bulb screws into (just below the globe); its top rim catches light
  ctx.lineWidth = rb * 0.34
  ctx.strokeStyle = rgba(mix(BRASS, hue, 0.4), 0.5 * I)
  ctx.beginPath()
  ctx.arc(x, y + rb * 0.16, rb * 1.06, 0.2, Math.PI - 0.2)
  ctx.stroke()
  // the glass globe body — hot white upper-left, warm amber lower-right (round, 3D)
  const disc = ctx.createRadialGradient(x - rb * 0.32, y - rb * 0.34, rb * 0.08, x, y, rb)
  disc.addColorStop(0, rgba(W, 0.98 * I))
  disc.addColorStop(0.42, rgba(hot, 0.94 * I))
  disc.addColorStop(0.8, rgba(mix(hue, [255, 150, 70], 0.35), 0.8 * I))
  disc.addColorStop(1, rgba(mix(hue, [200, 110, 45], 0.5), 0.5 * I))
  ctx.fillStyle = disc
  ctx.beginPath()
  ctx.arc(x, y, rb, 0, TAU)
  ctx.fill()
  // a thin bright rim on the upper-left edge so the glass reads as a sphere
  ctx.lineWidth = Math.max(0.6, rb * 0.1)
  ctx.strokeStyle = rgba(W, 0.5 * I)
  ctx.beginPath()
  ctx.arc(x, y, rb * 0.94, Math.PI * 0.9, Math.PI * 1.7)
  ctx.stroke()
  // the filament burning hottest at the core
  const fil = ctx.createRadialGradient(x, y, 0, x, y, rb * 0.42)
  fil.addColorStop(0, rgba(W, I))
  fil.addColorStop(1, rgba(hot, 0))
  ctx.fillStyle = fil
  ctx.beginPath()
  ctx.arc(x, y, rb * 0.42, 0, TAU)
  ctx.fill()
  // specular glint on the glass (upper-left)
  ctx.fillStyle = rgba(W, 0.88 * I)
  ctx.beginPath()
  ctx.arc(x - rb * 0.35, y - rb * 0.36, rb * 0.18, 0, TAU)
  ctx.fill()
}

/** One lit letter (instance i): the channel-letter's metal face glows faintly, a row
 *  of bulbs burns down each stroke's centre, and ALL of it is clipped to the letter
 *  shape — the light never leaks outside the recessed channel. */
export function drawMarqueeGlyphLit(
  ctx: CanvasRenderingContext2D,
  shape: Shape,
  rgb: RGB,
  instance: number
): void {
  const L = layoutMarquee(shape)
  const g = L.glyphs[instance]
  if (!g || !shape.points[0]) return
  const { hue, intensity: I } = bulbHueIntensity(rgb)
  if (I <= 0.004) return
  const { x0, baseline } = originOf(shape, L)
  const size = marqueeSize(shape)
  const pitch = marqueePitch(shape)
  const fontId = shape.fontId
  const ascent = L.ascent
  const gx = x0 + g.x
  const blast = I > 0.85 ? (I - 0.85) / 0.15 : 0
  const bulbs = glyphBulbs(g.ch, fontId, size, pitch)
  // bulb radius: deliberately well UNDER half the pitch (~0.34×) so a clear dark gap survives
  // between neighbours — bulbs must read as separate dots, never a merged 団子. Thin strokes
  // shrink the bulb further (b.r = local stroke half-width).
  const bulbR = (b: Bulb): number => Math.max(1.5, Math.min(b.r * 0.82, pitch * 0.34))

  const pad = Math.ceil(pitch * 2.4)
  const sw = Math.ceil(g.w) + pad * 2
  const sh = Math.ceil(ascent + size * 0.32) + pad * 2
  const sc = getScratch(sw, sh)
  if (sc) {
    // ---- layer 1: the soft glow / にじみ, clipped to the letter so nothing bleeds out ----
    const o = sc.ctx
    o.setTransform(1, 0, 0, 1, 0, 0)
    o.clearRect(0, 0, sc.cv.width, sc.cv.height)
    o.globalCompositeOperation = 'lighter'
    const bx = pad
    const by = pad + ascent
    o.font = marqueeFontStr(fontId, size)
    o.textAlign = 'left'
    o.textBaseline = 'alphabetic'
    // recessed metal face with a vertical brass sheen (the top of the channel
    // catches more light than the shaded bottom — gives the面 a material feel)
    const top = by - ascent * 0.96
    const bot = by + size * 0.12
    const face = o.createLinearGradient(0, top, 0, bot)
    face.addColorStop(0, rgba(mix(hue, [205, 135, 72], 0.5), 0.26 * I))
    face.addColorStop(0.5, rgba(mix(hue, [150, 92, 46], 0.5), 0.15 * I))
    face.addColorStop(1, rgba(mix(hue, [92, 56, 28], 0.5), 0.09 * I))
    o.fillStyle = face
    o.fillText(g.ch, bx, by)
    // only the spreading glow goes in the clipped layer
    for (const b of bulbs) drawBulbGlow(o, bx + b.x, by + b.y, bulbR(b), hue, I)
    // the front bezel / lip of the channel catches a thin line of light
    o.lineWidth = Math.max(1, size * 0.012)
    o.strokeStyle = rgba(mix(hue, W, 0.4), 0.28 * I)
    o.strokeText(g.ch, bx, by)
    // clip the glow to the glyph shape → no light bleeds outside the letter
    o.globalCompositeOperation = 'destination-in'
    o.fillStyle = '#fff'
    o.fillText(g.ch, bx, by)
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.drawImage(sc.cv as unknown as CanvasImageSource, gx - bx, baseline - by)
    ctx.restore()
  } else {
    // fallback without an offscreen: draw the glow directly (unclipped)
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    for (const b of bulbs) drawBulbGlow(ctx, gx + b.x, baseline + b.y, bulbR(b), hue, I)
    ctx.restore()
  }

  // ---- layer 2: the round glass globes, ON TOP and never clipped — proud of the channel
  //       like real marquee bulbs (球は丸ごと丸く、フチからはみ出てよい) ----
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  for (const b of bulbs) drawBulbGlobe(ctx, gx + b.x, baseline + b.y, bulbR(b), hue, I, blast)
  ctx.restore()
}
