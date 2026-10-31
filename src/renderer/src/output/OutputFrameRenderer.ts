import type { Chart } from '../model/types'
import type { RGB } from '../dmx/channel-math'
import { OutputRenderer } from './OutputRenderer'
import { outputSizeOf } from './out-scale'
import { isPixelLine, pixelLine } from './pixel-lines'

/** Same output drawing path for GPU Syphon and CPU/Windows NDI. */
export class OutputFrameRenderer {
  private direct: OutputRenderer
  private legacyCanvas: HTMLCanvasElement | null = null
  private legacy: OutputRenderer | null = null
  private cachedChart: Chart | null = null
  private directChart: Chart | null = null
  private legacyChart: Chart | null = null
  constructor(private canvas: HTMLCanvasElement) {
    this.direct = new OutputRenderer(canvas)
  }

  render(
    chart: Chart,
    dmx: Record<number, Uint8Array>,
    gamma: boolean,
    manual: Record<string, RGB> | null = null,
    page: number | null = null
  ): void {
    const out = outputSizeOf(chart)
    if (!chart.settings.outputPixelLines && out.w === chart.canvas.w && out.h === chart.canvas.h) {
      this.direct.render(chart, dmx, gamma, manual, page)
      return
    }
    if (this.cachedChart !== chart) {
      const sharp = chart.shapes.filter((s) => isPixelLine(s, chart))
      const sharpIds = new Set(sharp.map((s) => s.id))
      this.directChart = {
        ...chart,
        canvas: out,
        shapes: sharp.map((s) => pixelLine(s, chart.canvas, out))
      }
      this.legacyChart = { ...chart, shapes: chart.shapes.filter((s) => !sharpIds.has(s.id)) }
      this.cachedChart = chart
    }
    this.direct.render(this.directChart!, dmx, gamma, manual, page)
    if (!this.legacyChart!.shapes.length) return
    if (!this.legacyCanvas) this.legacyCanvas = document.createElement('canvas')
    if (!this.legacy) this.legacy = new OutputRenderer(this.legacyCanvas)
    this.legacy.render(this.legacyChart!, dmx, gamma, manual, page)
    const ctx = this.canvas.getContext('2d')!
    ctx.globalCompositeOperation = 'lighter'
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(this.legacyCanvas, 0, 0, out.w, out.h)
    ctx.globalCompositeOperation = 'source-over'
  }

  readRGBA(): Uint8ClampedArray {
    return this.direct.readRGBA()
  }
}
