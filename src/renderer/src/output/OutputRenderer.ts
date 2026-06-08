import type { Chart, Shape, Fixture } from '../model/types'
import type { RGB } from '../dmx/channel-math'
import { resolveColor } from '../dmx/resolve'
import { cornerBounds, trianglePoints, starPoints, regularPolygonPoints } from '../editor/geometry'

/**
 * Draws the live output frame: every patched shape on a pure-black background, in its
 * resolved DMX colour, with an additive glow (shadowBlur + 'lighter' compositing). This is
 * exactly what gets published to Syphon — black stays invisible on a Resolume Add layer.
 *
 * Implementation note: Canvas 2D (shadowBlur) is used instead of a WebGL glow shader — far
 * simpler and visually equivalent for soft glow. Can be upgraded to WebGL later if needed.
 */
export class OutputRenderer {
  private ctx: CanvasRenderingContext2D

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
    const ctx = this.ctx

    // black background (opaque)
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, w, h)

    // map shape -> fixture for colour resolution
    const fxByShape = new Map<string, Fixture>()
    for (const f of chart.fixtures) fxByShape.set(f.shapeId, f)

    ctx.globalCompositeOperation = 'lighter' // additive: overlapping glows add up
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'

    for (const shape of chart.shapes) {
      const fx = fxByShape.get(shape.id)
      if (!fx) continue
      const rgb = resolveColor(fx, dmxByUniverse, gamma, manual)
      if (rgb[0] === 0 && rgb[1] === 0 && rgb[2] === 0) continue // off -> stays black
      this.drawShape(shape, rgb)
    }
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
  }

  /** RGBA pixels of the current frame (tightly packed w*h*4). */
  readRGBA(): Uint8ClampedArray {
    return this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height).data
  }

  private drawShape(shape: Shape, rgb: RGB): void {
    const ctx = this.ctx
    const col = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`
    const open = shape.type === 'line' || shape.type === 'polyline' || shape.type === 'freehand'
    const doStroke = open || shape.display !== 'fill'
    const doFill = !open && shape.display !== 'stroke'
    ctx.strokeStyle = col
    ctx.fillStyle = col
    ctx.lineWidth = shape.strokeWidth || 4

    const glowPasses = 1 + Math.round((shape.glowIntensity ?? 0) * 2)
    const paint = (): void => {
      this.buildPath(shape)
      if (doFill) ctx.fill()
      if (doStroke) ctx.stroke()
    }

    if (shape.glowRadius > 0) {
      ctx.shadowColor = col
      ctx.shadowBlur = shape.glowRadius
      for (let i = 0; i < glowPasses; i++) paint()
    }
    // crisp core, no shadow
    ctx.shadowBlur = 0
    ctx.shadowColor = 'transparent'
    paint()
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
