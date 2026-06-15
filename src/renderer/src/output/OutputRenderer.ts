import type { Chart, Shape, Fixture } from '../model/types'
import { fixtureColor, beamPose, type RGB, type BeamPose } from '../dmx/channel-math'
import { addressAt, repeatCount } from '../dmx/address'
import { bulbHueIntensity } from '../render/bulb'
import {
  drawWallBeamInto,
  drawAirBeamInto,
  imageAlbedo,
  imageBox,
  darkTone
} from '../render/uplight'
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
import { drawMarqueeGlyphLit } from '../render/marquee'
import { drawStarsLit } from '../render/stars'
import { drawFestoonBulbLit, drawFestoonWireLit } from '../render/festoon'
import {
  drawParLit,
  drawBlinderCellLit,
  drawBlinderHousing,
  drawPattLit,
  drawPixelPattCellLit,
  drawPixelPattFrame,
  parDiameter,
  pattDiameter
} from '../render/fixtures'
import { drawRoomLampLit, roomLampDiameter } from '../render/roomlamp'
import { drawStreetLampLit, streetLampDiameter } from '../render/streetlamp'
import { drawChandelierLit, chandelierDiameter } from '../render/chandelier'

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
  /** Uplight pipeline buffers (写真×光マップの乗算合成用). */
  private lightMap?: HTMLCanvasElement
  private smoothMap?: HTMLCanvasElement
  private workMap?: HTMLCanvasElement
  private airMap?: HTMLCanvasElement
  private noiseMap?: HTMLCanvasElement
  private noiseTile?: HTMLCanvasElement
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
      const resolve = (i: number): RGB => {
        if (man) return man
        const a =
          reps > 1
            ? addressAt(fx.universe, fx.start, fx.mode, fx.addressStep, i)
            : { universe: fx.universe, start: fx.start }
        return fixtureColor(
          { ...fx, universe: a.universe, start: a.start },
          dmxByUniverse[a.universe] ?? ZEROS,
          gamma
        )
      }
      // unit-level pass: the Pixel PAT skeleton and the festoon wire are lit by the
      // REFLECTION of all their cells at once, so they draw once per unit with every
      // colour known (all-off units draw nothing — the dark stays dark)
      let unitRgbs: RGB[] | null = null
      if (shape.type === 'pixelpatt' || shape.type === 'festoon' || shape.type === 'blinder') {
        unitRgbs = []
        for (let i = 0; i < reps; i++) unitRgbs.push(resolve(i))
        if (shape.type === 'pixelpatt') drawPixelPattFrame(this.ctx, shape, unitRgbs)
        else if (shape.type === 'festoon') drawFestoonWireLit(this.ctx, shape, unitRgbs)
        else drawBlinderHousing(this.ctx, shape, unitRgbs)
      }
      for (let i = 0; i < reps; i++) {
        const rgb = unitRgbs ? unitRgbs[i] : resolve(i)
        if (rgb[0] === 0 && rgb[1] === 0 && rgb[2] === 0) continue // off -> stays transparent
        this.drawShape(shape, rgb, dx * i, dy * i, i)
      }
    }

    // Photo materials lit by uplight beams (light map → multiply → additive)
    this.renderUplights(chart, fxByShape, dmxByUniverse, gamma, manual)

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

  /** Photo materials + uplights: every lit beam pours into ONE light map (linear
   *  additive mixing — red+green meets as yellow), the photo (albedo) shows only
   *  where the map washes it (multiply + dark tone), and the air beam is visible
   *  only through smoke and is cut where a photo stands in front of it.
   *  All-off → draws nothing at all (完全な闇). */
  private renderUplights(
    chart: Chart,
    fxByShape: Map<string, Fixture>,
    dmxByUniverse: Record<number, Uint8Array>,
    gamma: boolean,
    manual: Record<string, RGB> | null
  ): void {
    const images = chart.shapes.filter((s) => s.type === 'image' && s.imageData)
    const lights: { shape: Shape; hue: RGB; I: number; pose: BeamPose }[] = []
    for (const s of chart.shapes) {
      if (s.type !== 'uplight') continue
      const fx = fxByShape.get(s.id)
      if (!fx) continue
      const data = dmxByUniverse[fx.universe] ?? ZEROS
      const man = manual?.[fx.id]
      const rgb = man ?? fixtureColor(fx, data, gamma)
      const { hue, intensity } = bulbHueIntensity(rgb)
      if (intensity <= 0.004) continue
      const pose = man ? { pan: 0, tilt: 0, zoom: 0 } : beamPose(fx, data)
      lights.push({ shape: s, hue, I: intensity, pose })
    }
    if (lights.length === 0) return
    const w = this.canvas.width
    const h = this.canvas.height
    const get = (
      key: 'lightMap' | 'smoothMap' | 'workMap' | 'airMap' | 'noiseMap'
    ): HTMLCanvasElement => {
      let cvs = this[key]
      if (!cvs) {
        cvs = document.createElement('canvas')
        this[key] = cvs
      }
      if (cvs.width !== w) cvs.width = w
      if (cvs.height !== h) cvs.height = h
      return cvs
    }
    // ---- the light map: all beams summed once (additive colour mixing)
    const lm = get('lightMap')
    const lmc = lm.getContext('2d')
    if (!lmc) return
    lmc.globalCompositeOperation = 'source-over'
    lmc.fillStyle = '#000'
    lmc.fillRect(0, 0, w, h)
    for (const L of lights) drawWallBeamInto(lmc, L.shape, L.hue, L.I, L.pose)
    // melt the 8-bit contour bands with a fine blur write-back…
    const sm = get('smoothMap')
    const smc = sm.getContext('2d')
    if (smc) {
      smc.clearRect(0, 0, w, h)
      smc.filter = 'blur(1.6px)'
      smc.drawImage(lm, 0, 0)
      smc.filter = 'none'
      lmc.fillStyle = '#000'
      lmc.fillRect(0, 0, w, h)
      lmc.drawImage(sm, 0, 0)
    }
    // …then stir what remains with a static noise dither
    if (!this.noiseTile) {
      const n = document.createElement('canvas')
      n.width = 64
      n.height = 64
      const nc = n.getContext('2d')
      if (nc) {
        const id = nc.createImageData(64, 64)
        let seed = 12345
        for (let i = 0; i < id.data.length; i += 4) {
          seed = (seed * 1103515245 + 12345) & 0x7fffffff
          const v = (seed >> 16) & 255
          id.data[i] = v
          id.data[i + 1] = v
          id.data[i + 2] = v
          id.data[i + 3] = 255
        }
        nc.putImageData(id, 0, 0)
      }
      this.noiseTile = n
    }
    // ノイズは「光があるところだけ」に撒く: タイルを別キャンバスに敷いて光マップと multiply
    // してから lighter で加算する。光ゼロの場所は ノイズ×0=0 で底上げされない（無灯部は
    // 完全な闇のまま・のむさん判定 2026-06-13 ノイズ床退治）。
    const nm = get('noiseMap')
    const nmc = nm.getContext('2d')
    const pat = nmc?.createPattern(this.noiseTile, 'repeat')
    if (nmc && pat) {
      nmc.globalCompositeOperation = 'source-over'
      nmc.fillStyle = pat
      nmc.fillRect(0, 0, w, h)
      nmc.globalCompositeOperation = 'multiply'
      nmc.drawImage(lm, 0, 0)
      lmc.save()
      lmc.globalCompositeOperation = 'lighter'
      lmc.globalAlpha = 0.07 // 乗算で振幅が下がるぶん持ち上げ（撹拌力は維持）
      lmc.drawImage(nm, 0, 0)
      lmc.restore()
    }
    // ---- each photo: albedo × light (+ dark tone at low gauge), added to the frame
    let maxI = 0
    for (const L of lights) if (L.I > maxI) maxI = L.I
    const tone = darkTone(maxI)
    const wk = get('workMap')
    const wkc = wk.getContext('2d')
    if (!wkc) return
    for (const img of images) {
      const alb = imageAlbedo(img)
      if (!alb) continue
      const b = imageBox(img)
      wkc.globalCompositeOperation = 'source-over'
      wkc.clearRect(0, 0, w, h)
      wkc.drawImage(alb, b.x, b.y, b.w, b.h)
      wkc.globalCompositeOperation = 'multiply'
      wkc.drawImage(lm, 0, 0)
      if (tone > 0.01) {
        wkc.globalAlpha = tone
        wkc.drawImage(lm, 0, 0)
        wkc.globalAlpha = 1
      }
      wkc.globalCompositeOperation = 'destination-in'
      wkc.drawImage(alb, b.x, b.y, b.w, b.h)
      wkc.globalCompositeOperation = 'source-over'
      this.ctx.drawImage(wk, 0, 0)
    }
    // ---- the air beam: visible only through smoke, cut where a photo stands
    const smoke = chart.settings.glow ? Math.max(1, chart.settings.glowAmount || 12) : 0
    const airA = (Math.min(30, smoke) / 30) * 0.42
    if (airA > 0.01) {
      const am = get('airMap')
      const amc = am.getContext('2d')
      if (!amc) return
      amc.globalCompositeOperation = 'source-over'
      amc.clearRect(0, 0, w, h)
      for (const L of lights) drawAirBeamInto(amc, L.shape, L.hue, L.I, L.pose)
      amc.globalCompositeOperation = 'destination-out'
      for (const img of images) {
        const alb = imageAlbedo(img)
        if (!alb) continue
        const b = imageBox(img)
        amc.drawImage(alb, b.x, b.y, b.w, b.h)
      }
      amc.globalCompositeOperation = 'source-over'
      this.ctx.globalAlpha = airA
      this.ctx.drawImage(am, 0, 0)
      this.ctx.globalAlpha = 1
    }
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
    // photos & uplights are composited in the dedicated light-map pass
    if (shape.type === 'image' || shape.type === 'uplight') return
    ctx.save()
    if (ox || oy) ctx.translate(ox, oy)
    // neon signs: instance i lights ONLY tube #i (its own console colour) — the
    // per-character chase falls out of the ordinary repeat addressing
    if (shape.type === 'neon') {
      drawNeonGlyphLit(ctx, shape, rgb, rep)
      ctx.restore()
      return
    }
    // marquee lights: instance i lights ONLY letter #i (its bulbs in the console
    // colour) — per-letter chase, same addressing as neon
    if (shape.type === 'marquee') {
      drawMarqueeGlyphLit(ctx, shape, rgb, rep)
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
    // stage fixtures: PAR / PAT light as one face, the blinder per cell (8 instances)
    if (shape.type === 'parlight' || shape.type === 'patt') {
      const c = shape.points[0]
      if (c) {
        if (shape.type === 'parlight') drawParLit(ctx, c.x, c.y, parDiameter(shape), rgb)
        else drawPattLit(ctx, c.x, c.y, pattDiameter(shape), rgb)
      }
      ctx.restore()
      return
    }
    if (shape.type === 'blinder') {
      drawBlinderCellLit(ctx, shape, rgb, rep)
      ctx.restore()
      return
    }
    // Pixel PAT: instance i lights ONLY cell #i (centre=1, ring 2..7) — pixel control
    if (shape.type === 'pixelpatt') {
      drawPixelPattCellLit(ctx, shape, rgb, rep)
      ctx.restore()
      return
    }
    // virtual set-dressing lights (電飾屋が物理で用意できないアイテム): single-address
    // warm fixtures — the console RGB owns both hue and gauge, like the ball bulb.
    if (shape.type === 'roomlamp' || shape.type === 'streetlamp' || shape.type === 'chandelier') {
      const c = shape.points[0]
      if (c) {
        if (shape.type === 'roomlamp') drawRoomLampLit(ctx, c.x, c.y, roomLampDiameter(shape), rgb)
        else if (shape.type === 'streetlamp')
          drawStreetLampLit(ctx, c.x, c.y, streetLampDiameter(shape), rgb)
        else drawChandelierLit(ctx, c.x, c.y, chandelierDiameter(shape), rgb)
      }
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
