import { describe, it, expect } from 'vitest'
import { isPixelLine, pixelLine } from './pixel-lines'
import { createChart } from '../model/chart-model'
import { parseChart, serializeChart } from '../io/chart-file'
import type { Shape } from '../model/types'
const line = (
  points = [
    { x: 30, y: 0 },
    { x: 30, y: 1799 }
  ]
): Shape => ({ id: 's', type: 'polyline', display: 'stroke', strokeWidth: 3, points })
const source = { w: 6400, h: 1800 },
  out = { w: 2133, h: 600 }
describe('direct 1px transmission lines', () => {
  it('keeps a top-to-bottom line opaque-cell-ready, inside the first/last row', () => {
    const s = line(),
      before = structuredClone(s),
      result = pixelLine(s, source, out)
    expect(s).toEqual(before)
    expect(result.points).toHaveLength(600)
    expect(new Set(result.points.map((p) => p.x)).size).toBe(1)
    expect(result.points[0].y).toBe(0.5)
    expect(result.points.at(-1)!.y).toBe(599.5)
    expect(result.strokeWidth).toBe(1)
  })
  it('deduplicates closed paths so vertices do not brighten', () => {
    const r = pixelLine(
      line([
        { x: 30, y: 30 },
        { x: 300, y: 30 },
        { x: 30, y: 30 }
      ]),
      source,
      out
    )
    expect(new Set(r.points.map((p) => `${p.x},${p.y}`)).size).toBe(r.points.length)
  })
  it('clips huge off-canvas paths and rejects invalid coordinates', () => {
    expect(
      pixelLine(
        line([
          { x: -1e9, y: 30 },
          { x: 1e9, y: 30 }
        ]),
        source,
        out
      ).points.length
    ).toBe(2133)
    expect(
      pixelLine(
        line([
          { x: -1e9, y: -30 },
          { x: 1e9, y: -30 }
        ]),
        source,
        out
      ).points
    ).toEqual([])
    expect(
      pixelLine(
        line([
          { x: NaN, y: 30 },
          { x: 1, y: 30 }
        ]),
        source,
        out
      ).points
    ).toEqual([])
  })
  it('adapts to changed output size without changing original coordinates', () => {
    const s = line()
    expect(pixelLine(s, source, { w: 1920, h: 1080 }).points).toHaveLength(1080)
    expect(pixelLine(s, source, out).points).toHaveLength(600)
  })
  it('is opt-in and leaves glow and repeated fixtures on the legacy path', () => {
    const chart = createChart(source)
    expect(isPixelLine(line(), chart)).toBe(false)
    chart.settings.outputPixelLines = true
    expect(isPixelLine(line(), chart)).toBe(true)
    expect(isPixelLine({ ...line(), glowPx: 2 }, chart)).toBe(false)
    expect(isPixelLine({ ...line(), repeat: { count: 2, dx: 50, dy: 0 } }, chart)).toBe(false)
    chart.settings.glow = true
    expect(isPixelLine(line(), chart)).toBe(false)
  })
  it('persists mode and output dimensions without changing patch', () => {
    const chart = createChart(source)
    chart.settings.outputPixelLines = true
    chart.settings.outputSize = out
    const back = parseChart(serializeChart(chart))
    expect(back.settings.outputPixelLines).toBe(true)
    expect(back.settings.outputSize).toEqual(out)
    expect(back.fixtures).toEqual(chart.fixtures)
  })
})
