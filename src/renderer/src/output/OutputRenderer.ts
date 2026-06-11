import type { Chart, Shape, Fixture } from '../model/types'
import { fixtureColor, type RGB } from '../dmx/channel-math'
import { addressAt, repeatCount } from '../dmx/address'
import {
  cornerBounds,
  trianglePoints,
  starPoints,
  regularPolygonPoints,
  isCellRun,
  bulbDiameter
} from '../editor/geometry'
import { drawBulbLit, BULB_DEFAULT_STYLE } from '../render/bulb'
import { drawNeonGlyphLit } from '../render/neon'
import { drawStarsLit } from '../render/stars'
import { drawFestoonBulbLit } from '../render/festoon'

const ZEROS = new Uint8Array(512)

/**
 * Draws the live output frame: every patched shape on a transparent-black background
 * (RGBA 0,0,0,0), in its resolved DMX colour, with additive 'lighter' compositing. This is
 * exactly what gets published to Syphon — on a Resolume Add layer the background adds
 * nothing (as before), and on a normal Alpha layer it is fully transparent, so both
 * blend workflows work.
 *
 * Implementation note: Canvas 2D (shadowBlur) is used instead of a WebGL glow shader — far
 * simpler and visually equivalent for soft glow. Can be upgraded to WebGL later if needed.
 */
export class OutputRenderer {
  private ctx: CanvasRenderingContext2D
  private bloom?: HTMLCanvasElement
  /** Frame timestamp (ms) — drives the star fields' subtle twinkle. */
  private frameTime = 0

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('2D canvas context unavailable')
    this.ctx = ctx
  }

  render(
    chart: Chart,
    dmxByUniverse: Record<number, Uint8Array>,
    gamma: boolean,
    manual: Record<string, RGB> | null = null
  ): void {
    const { w, h } = chart.canvas
    if (this.canvas.width !== w) this.canvas.width = w
    if (this.canvas.height !== h) this.canvas.height = h
    this.frameTime = Date.now()
    const ctx = this.ctx

    // transparent-black background (0,0,0,0): invisible on Add AND on Alpha layers
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
    ctx.clearRect(0, 0, w, h)

    // map shape -> fixture for colour resolution
    const fxByShape = new Map<string, Fixture>()
    for (const f of chart.fixtures) fxByShape.set(f.shapeId, f)

    ctx.globalCompositeOperation = 'lighter' // additive: overlapping glows add up
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'

    for (const shape of chart.shapes) {
      const fx = fxByShape.get(shape.id)
      if (!fx) continue
      const reps = repeatCount(shape)
      const dx = shape.repeat?.dx ?? 0
      const dy = shape.repeat?.dy ?? 0
      const man = manual?.[fx.id] // a manual override lights the whole array uniformly
      for (let i = 0; i < reps; i++) {
        let rgb: RGB
        if (man) {
          rgb = man
        } else {
          const a =
            reps > 1
              ? addressAt(fx.universe, fx.start, fx.mode, fx.addressStep, i)
              : { universe: fx.universe, start: fx.start }
          rgb = fixtureColor(
            { ...fx, universe: a.universe, start: a.start },
            dmxByUniverse[a.universe] ?? ZEROS,
            gamma
          )
        }
        if (rgb[0] === 0 && rgb[1] === 0 && rgb[2] === 0) continue // off -> stays transparent
        this.drawShape(shape, rgb, dx * i, dy * i, i)
      }
    }

    // Optional global "smoke" glow: a whole-output bloom. The LEDs themselves stay crisp;
    // this just mimics how stage haze spreads them. Off by default.
    if (chart.settings.glow) {
      const amt = Math.max(1, chart.settings.glowAmount || 12)
      if (!this.bloom) this.bloom = document.createElement('canvas')
      this.bloom.width = w
      this.bloom.height = h
      const bctx = this.bloom.getContext('2d')
      if (bctx) {
        bctx.clearRect(0, 0, w, h)
        bctx.filter = `blur(${amt}px)`
        bctx.drawImage(this.canvas, 0, 0)
        bctx.filter = 'none'
        ctx.globalCompositeOperation = 'lighter'
        ctx.drawImage(this.bloom, 0, 0)
      }
    }
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
  }

  /** RGBA pixels of the current frame (tightly packed w*h*4), premultiplied by alpha —
   *  the Syphon convention. Anti-aliased edges and bloom thus carry the same RGB an
   *  opaque-black background produced, so Resolume Add layers look exactly as before. */
  readRGBA(): Uint8ClampedArray {
    const d = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height).data
    for (let i = 0; i < d.length; i += 4) {
      const a = d[i + 3]
      if (a === 255 || a === 0) continue // opaque/empty: premultiply is a no-op
      d[i] = (d[i] * a) / 255
      d[i + 1] = (d[i + 1] * a) / 255
      d[i + 2] = (d[i + 2] * a) / 255
    }
    return d
  }

  private drawShape(shape: Shape, rgb: RGB, ox = 0, oy = 0, rep = 0): void {
    const ctx = this.ctx
    ctx.save()
    if (ox || oy) ctx.translate(ox, oy)
    // neon signs: instance i lights ONLY tube #i (its own console colour) — the
    // per-character chase falls out of the ordinary repeat addressing
    if (shape.type === 'neon') {
      drawNeonGlyphLit(ctx, shape, rgb, rep)
      ctx.restore()
      return
    }
    // star fields: instance 0 = the white sky, instance 1 = the blue sky — two desk
    // faders run the whole curtain; the channel level IS the population's gauge
    if (shape.type === 'stars') {
      drawStarsLit(ctx, shape, rgb, rep, this.frameTime)
      ctx.restore()
      return
    }
    // festoon strings: instance i lights ONLY bulb #i — per-bulb chase for free
    if (shape.type === 'festoon') {
      drawFestoonBulbLit(ctx, shape, rgb, rep)
      ctx.restore()
      return
    }
    // ball bulbs: photoreal lit render (hue + gauge both come from the console RGB)
    if (shape.type === 'bulb') {
      const c = shape.points[0]
      if (c) {
        drawBulbLit(ctx, c.x, c.y, bulbDiameter(shape), rgb, shape.bulbStyle ?? BULB_DEFAULT_STYLE)
      }
      ctx.restore()
      return
    }
    const col = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`
    // painted dot runs render as exact filled cells — pixel-solid to the very last
    // dot (no anti-aliased round caps fading the ends)
    if (isCellRun(shape)) {
      ctx.fillStyle = col
      const n = Math.max(1, Math.round(shape.strokeWidth || 1))
      const off = Math.floor((n - 1) / 2)
      let px = NaN
      let py = NaN
      for (const p of shape.points) {
        const cx = Math.floor(p.x)
        const cy = Math.floor(p.y)
        if (cx === px && cy === py) continue // duplicated dot: don't double-add
        px = cx
        py = cy
        ctx.fillRect(cx - off, cy - off, n, n)
      }
      ctx.restore()
      return
    }
    const open = shape.type === 'line' || shape.type === 'polyline' || shape.type === 'freehand'
    const doStroke = open || shape.display !== 'fill'
    const doFill = !open && shape.display !== 'stroke'
    ctx.strokeStyle = col
    ctx.fillStyle = col
    ctx.lineWidth = shape.strokeWidth || 1
    this.buildPath(shape)
    if (doFill) ctx.fill()
    if (doStroke) ctx.stroke()
    ctx.restore()
  }

  private buildPath(shape: Shape): void {
    const ctx = this.ctx
    const p = shape.points
    ctx.beginPath()
    if (p.length < 2) return
    switch (shape.type) {
      case 'line':
        ctx.moveTo(p[0].x, p[0].y)
        ctx.lineTo(p[1].x, p[1].y)
        break
      case 'polyline':
      case 'freehand':
        ctx.moveTo(p[0].x, p[0].y)
        for (let i = 1; i < p.length; i++) ctx.lineTo(p[i].x, p[i].y)
        break
      case 'rect': {
        const b = cornerBounds(p[0], p[p.length - 1])
        ctx.rect(b.x, b.y, b.w, b.h)
        break
      }
      case 'ellipse': {
        const b = cornerBounds(p[0], p[p.length - 1])
        ctx.ellipse(b.x + b.w / 2, b.y + b.h / 2, b.w / 2, b.h / 2, 0, 0, Math.PI * 2)
        break
      }
      case 'triangle':
        this.polyPath(trianglePoints(p[0], p[p.length - 1]))
        break
      case 'star':
        this.polyPath(starPoints(p[0], p[p.length - 1]))
        break
      case 'polygon':
        this.polyPath(regularPolygonPoints(p[0], p[p.length - 1]))
        break
    }
  }

  private polyPath(pts: { x: number; y: number }[]): void {
    const ctx = this.ctx
    if (pts.length === 0) return
    ctx.moveTo(pts[0].x, pts[0].y)
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
    ctx.closePath()
  }
}
