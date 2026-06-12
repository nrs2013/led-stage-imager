import type { BulbStyle } from '../model/types'
import { reflectGain } from './fixtures'

export const BULB_DEFAULT_DIAMETER = 7
export const BULB_DEFAULT_STYLE: BulbStyle = 'clear'

export type RGB = [number, number, number]

/** Splits a console RGB into the bulb's hue (full-saturation colour) and its gauge.
 *  The console owns both: (128,0,0) = red bulb at half power. */
export function bulbHueIntensity(rgb: RGB): { hue: RGB; intensity: number } {
  const mx = Math.max(rgb[0], rgb[1], rgb[2])
  if (mx <= 0) return { hue: [255, 255, 255], intensity: 0 }
  const k = 255 / mx
  return { hue: [rgb[0] * k, rgb[1] * k, rgb[2] * k], intensity: mx / 255 }
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

/** How far the glow reaches beyond the glass, in glass-radius units, at intensity I.
 *  Used by the editor to pad dirty rects / bounds if ever needed. */
export function bulbHaloRadius(r: number, I: number): number {
  return r * (1.6 + 4.2 * Math.pow(I, 1.4))
}

/** 家訓 white clip: past 55% the inside of the glass and the filament's surroundings
 *  burn progressively toward white — "明るく" is overexposure, not extra alpha. */
export function bulbClip(I: number): number {
  return I > 0.55 ? (I - 0.55) / 0.45 : 0
}

/** 家訓 blast: past 88% the face blows out white and light spills past the glass. */
export function bulbBlast(I: number): number {
  return I > 0.88 ? (I - 0.88) / 0.12 : 0
}

/** Frosted-glass filament show-through: dimmed low, the coil glows faintly through
 *  the frosting just below centre (Pixel PAT のすりガラス電球の流儀); from mid-gauge
 *  it melts into the ball's own gradient and is gone. */
export function frostFilamentGlow(I: number): number {
  if (I <= 0.004) return 0
  const rise = Math.min(1, I / 0.12) // ぽっと現れる
  const fade = I <= 0.3 ? 0 : Math.min(1, (I - 0.3) / 0.35) // 球全体のグラデに溶ける
  return rise * (1 - fade)
}

function filamentPath(
  ctx: CanvasRenderingContext2D,
  cx: number,
  fy: number,
  fw: number,
  r: number
): void {
  ctx.beginPath()
  ctx.moveTo(cx - fw / 2, fy)
  for (let i = 1; i <= 7; i++) {
    ctx.lineTo(cx - fw / 2 + (fw * i) / 7, fy + (i % 2 ? -1 : 1) * r * 0.045)
  }
}

/** Internals of a clear bulb (stem, lead wires, cold coil) — visible glass anatomy.
 *  Editor-only dressing: the live output draws nothing for an unpowered bulb. */
export function drawBulbGlass(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  d: number,
  style: BulbStyle
): void {
  const r = d / 2
  if (style === 'frost') {
    const g0 = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.08, cx, cy, r)
    g0.addColorStop(0, '#4a4a46')
    g0.addColorStop(0.65, '#343431')
    g0.addColorStop(1, '#222220')
    ctx.fillStyle = g0
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.fill()
  } else {
    const gf = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.05, cx, cy, r)
    gf.addColorStop(0, 'rgba(255,255,255,0.07)')
    gf.addColorStop(0.55, 'rgba(255,255,255,0.022)')
    gf.addColorStop(1, 'rgba(255,255,255,0.05)')
    ctx.fillStyle = gf
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.fill()
    if (r >= 14) {
      const fy = cy + r * 0.04
      const fw = r * 0.32
      ctx.save()
      ctx.strokeStyle = 'rgba(200,205,210,0.10)'
      ctx.lineWidth = r * 0.1
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(cx, cy + r * 0.95)
      ctx.lineTo(cx, cy + r * 0.42)
      ctx.stroke()
      ctx.strokeStyle = 'rgba(170,170,165,0.22)'
      ctx.lineWidth = Math.max(0.8, r * 0.018)
      ctx.beginPath()
      ctx.moveTo(cx - fw / 2, fy)
      ctx.lineTo(cx - r * 0.1, cy + r * 0.46)
      ctx.moveTo(cx + fw / 2, fy)
      ctx.lineTo(cx + r * 0.1, cy + r * 0.46)
      ctx.stroke()
      ctx.strokeStyle = 'rgba(150,140,130,0.30)'
      ctx.lineWidth = Math.max(0.8, r * 0.03)
      ctx.lineJoin = 'round'
      filamentPath(ctx, cx, fy, fw, r)
      ctx.stroke()
      ctx.restore()
    }
  }
  // photographic glass cues: window reflection (upper-left), counter spec, partial rims
  ctx.save()
  ctx.translate(cx - r * 0.38, cy - r * 0.42)
  ctx.rotate(-0.5)
  const gw = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 0.3)
  gw.addColorStop(0, 'rgba(255,255,255,0.14)')
  gw.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = gw
  ctx.beginPath()
  ctx.ellipse(0, 0, r * 0.3, r * 0.16, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
  ctx.save()
  ctx.lineCap = 'round'
  ctx.strokeStyle = 'rgba(255,255,255,0.10)'
  ctx.lineWidth = Math.max(0.7, r * 0.025)
  ctx.beginPath()
  ctx.arc(cx, cy, r * 0.97, -2.8, -0.9)
  ctx.stroke()
  ctx.strokeStyle = 'rgba(255,255,255,0.05)'
  ctx.beginPath()
  ctx.arc(cx, cy, r * 0.97, 0.4, 2.2)
  ctx.stroke()
  ctx.restore()
}

/** Lit bulb, additive-only (every stroke ADDS light): safe for the transparent-black
 *  Syphon output where an off bulb must stay invisible. `rgb` is the raw console
 *  colour — hue and gauge are derived here. 家訓 top end: past 55% the glass interior
 *  clips toward white, past ~88% the core blows out and the bloom surges
 *  (のむさん「最後はもっと光った感じ」). Glass/metal cues (window reflection, rim
 *  sheen, filament supports) ride reflectGain — strongest mid-gauge, swallowed at full. */
export function drawBulbLit(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  d: number,
  rgb: RGB,
  style: BulbStyle,
  glowScale = 1 // halo-reach multiplier (1 = the ball bulb's standard; festoon's dial)
): void {
  const { hue, intensity: I } = bulbHueIntensity(rgb)
  if (I <= 0.004) return
  const r = d / 2
  const gs = glowScale < 0.05 ? 0.05 : glowScale > 2.5 ? 2.5 : glowScale
  const vis = Math.pow(I, 1.5) // perceptual bloom curve: low = ぽっ, high = ジュワッ
  const clip = bulbClip(I) // 55%+: the glass interior burns toward white
  const blast = bulbBlast(I) // 88%+: top-end white surge, light leaks past the glass
  const det = reflectGain(I) // glass/metal detail: peaks mid-gauge, glare eats it at full
  const hot = mixc(hue, [255, 255, 255], 0.85)
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  if (style === 'frost') {
    const core = mixc(hue, [255, 255, 255], Math.min(1, 0.6 * I + 0.3 * clip + 0.4 * blast))
    const g1 = ctx.createRadialGradient(cx - r * 0.12, cy - r * 0.16, r * 0.05, cx, cy, r)
    g1.addColorStop(0, rgba(core, I))
    g1.addColorStop(0.55, rgba(mixc(hue, [255, 255, 255], 0.45 * clip), 0.85 * I))
    g1.addColorStop(1, rgba(hue, 0.3 * I))
    ctx.fillStyle = g1
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.fill()
    // dimmed low, the coil shows through the frosting just below centre; from
    // mid-gauge it melts into the ball's own gradient (frostFilamentGlow curve)
    const ff = frostFilamentGlow(I)
    if (ff > 0.01) {
      const ffy = cy + r * 0.12
      const gf = ctx.createRadialGradient(cx, ffy, 0, cx, ffy, r * 0.45)
      gf.addColorStop(0, rgba(mixc(hue, [255, 255, 255], 0.55), 0.32 * ff))
      gf.addColorStop(0.5, rgba(hue, 0.1 * ff))
      gf.addColorStop(1, rgba(hue, 0))
      ctx.fillStyle = gf
      ctx.beginPath()
      ctx.arc(cx, ffy, r * 0.45, 0, Math.PI * 2)
      ctx.fill()
    }
  } else {
    // filament: real coil when big enough, hot point when tiny (LED-actual size)
    const fy = cy + r * 0.04
    if (r >= 14) {
      const fw = r * 0.32
      ctx.shadowColor = rgba(hue, Math.min(1, 0.9 * I))
      ctx.shadowBlur = r * 0.55 * I + r * 0.08
      ctx.strokeStyle = rgba(mixc(hue, hot, clip), 0.85 * I) // 55%+: 周りが白へ焼ける
      ctx.lineWidth = r * 0.05
      filamentPath(ctx, cx, fy, fw, r)
      ctx.stroke()
      ctx.shadowBlur = r * 0.25
      ctx.strokeStyle = rgba(hot, 0.9 * I)
      ctx.lineWidth = r * 0.032
      filamentPath(ctx, cx, fy, fw, r)
      ctx.stroke()
      if (I > 0.25) {
        ctx.shadowBlur = r * 0.1
        ctx.strokeStyle = rgba([255, 255, 255], Math.min(1, (I - 0.25) * 1.6))
        ctx.lineWidth = r * (0.018 + 0.012 * clip) // the white core burns wider past 55%
        filamentPath(ctx, cx, fy, fw, r)
        ctx.stroke()
      }
      ctx.shadowBlur = 0
      // stem + lead wires survive as the filament's own light reflecting off them —
      // most visible mid-gauge, swallowed by the glare at full (reflectGain の流儀)
      if (det > 0.01) {
        const steel = mixc(hue, [225, 228, 232], 0.6)
        ctx.strokeStyle = rgba(steel, 0.1 * det)
        ctx.lineWidth = r * 0.1
        ctx.beginPath()
        ctx.moveTo(cx, cy + r * 0.95)
        ctx.lineTo(cx, cy + r * 0.42)
        ctx.stroke()
        ctx.strokeStyle = rgba(steel, 0.26 * det)
        ctx.lineWidth = Math.max(0.8, r * 0.018)
        ctx.beginPath()
        ctx.moveTo(cx - fw / 2, fy)
        ctx.lineTo(cx - r * 0.1, cy + r * 0.46)
        ctx.moveTo(cx + fw / 2, fy)
        ctx.lineTo(cx + r * 0.1, cy + r * 0.46)
        ctx.stroke()
      }
    } else {
      const fr = r * 0.55
      const g1 = ctx.createRadialGradient(cx, fy, 0, cx, fy, fr)
      g1.addColorStop(0, rgba([255, 255, 255], I))
      g1.addColorStop(0.4, rgba(mixc(hot, [255, 255, 255], clip), 0.9 * I))
      g1.addColorStop(1, rgba(hue, 0))
      ctx.fillStyle = g1
      ctx.beginPath()
      ctx.arc(cx, fy, fr, 0, Math.PI * 2)
      ctx.fill()
    }
    // light scattering inside the glass; the rim catches the colour. Past 55% the
    // inside of the glass burns toward white (家訓 clip), the rim keeps the hue
    const gi = ctx.createRadialGradient(cx, fy, r * 0.05, cx, cy, r)
    gi.addColorStop(0, rgba(mixc(hue, [255, 255, 255], 0.55 * clip), (0.34 + 0.2 * clip) * I))
    gi.addColorStop(0.7, rgba(mixc(hue, [255, 255, 255], 0.3 * clip), 0.1 * I))
    gi.addColorStop(1, rgba(hue, 0.1 * I))
    ctx.fillStyle = gi
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.fill()
    // lit rim arcs (replace the editor's neutral ones with coloured light)
    ctx.strokeStyle = rgba(mixc(hue, [255, 255, 255], 0.5), 0.1 + 0.22 * I)
    ctx.lineWidth = Math.max(0.7, r * 0.03)
    ctx.beginPath()
    ctx.arc(cx, cy, r * 0.97, 0.4, 2.2)
    ctx.stroke()
  }
  // photographic glass cues stay alive while lit (clear AND frost): the window
  // reflection and the upper rim sheen as reflected light — reflectGain makes them
  // strongest mid-gauge and lets the full-power glare swallow them
  if (det > 0.01) {
    const sheen = mixc(hue, [255, 255, 255], 0.65)
    ctx.save()
    ctx.translate(cx - r * 0.38, cy - r * 0.42)
    ctx.rotate(-0.5)
    const gw = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 0.3)
    gw.addColorStop(0, rgba(sheen, 0.16 * det))
    gw.addColorStop(1, rgba(sheen, 0))
    ctx.fillStyle = gw
    ctx.beginPath()
    ctx.ellipse(0, 0, r * 0.3, r * 0.16, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
    ctx.strokeStyle = rgba(sheen, 0.12 * det)
    ctx.lineWidth = Math.max(0.7, r * 0.025)
    ctx.beginPath()
    ctx.arc(cx, cy, r * 0.97, -2.8, -0.9)
    ctx.stroke()
  }
  // tight saturated bloom + wide soft bloom (ジュワッ) — v6: trimmed ~20% so the
  // core stays the star (のむさん「にじみすぎ・カッコよく」)
  const hr1 = Math.max(r * 1.05, r * (1.15 + 1.0 * vis) * gs * 0.8)
  const gh1 = ctx.createRadialGradient(cx, cy, r * 0.4, cx, cy, hr1)
  gh1.addColorStop(0, rgba(hue, 0.4 * I))
  gh1.addColorStop(1, rgba(hue, 0))
  ctx.fillStyle = gh1
  ctx.beginPath()
  ctx.arc(cx, cy, hr1, 0, Math.PI * 2)
  ctx.fill()
  const hr2 = Math.max(r * 1.2, bulbHaloRadius(r, I) * gs * 0.72)
  const soft = mixc(hue, [255, 255, 255], 0.25 + 0.35 * blast)
  const gh2 = ctx.createRadialGradient(cx, cy, r * 0.5, cx, cy, hr2)
  gh2.addColorStop(0, rgba(soft, (0.22 + 0.3 * blast) * I * 0.85))
  gh2.addColorStop(0.45, rgba(soft, 0.08 * I))
  gh2.addColorStop(1, rgba(soft, 0))
  ctx.fillStyle = gh2
  ctx.beginPath()
  ctx.arc(cx, cy, hr2, 0, Math.PI * 2)
  ctx.fill()
  // white-out core surge at the top of the fader — the WHOLE bulb floods brighter
  // (のむさん: フルは線じゃなく全体的に明るく。旧・横方向の光条は廃止)
  if (blast > 0) {
    const br = r * (1.25 + 0.9 * blast)
    const gb = ctx.createRadialGradient(cx, cy, 0, cx, cy, br)
    gb.addColorStop(0, rgba([255, 255, 255], 0.95 * blast))
    gb.addColorStop(0.45, rgba(mixc(hue, [255, 255, 255], 0.75), 0.5 * blast))
    gb.addColorStop(1, rgba(hue, 0))
    ctx.fillStyle = gb
    ctx.beginPath()
    ctx.arc(cx, cy, br, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}
