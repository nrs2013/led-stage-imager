import { describe, it, expect } from 'vitest'
import { detectLedPanels, snapLedGrid, safeGridSpacing, scaledLedRegions } from './led-layout'

function chartPixels(): Uint8ClampedArray {
  const w = 800,
    h = 300,
    data = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i++) data[i * 4 + 3] = 255
  const line = (x0: number, y0: number, x1: number, y1: number): void => {
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const i = (y * w + x) * 4
        data[i] = 230
        data[i + 1] = 160
        data[i + 2] = 0
      }
  }
  for (const [x, y, r, b] of [
    [0, 0, 200, 240],
    [240, 20, 440, 220],
    [490, 0, 790, 240]
  ]) {
    for (let xx = x; xx <= r; xx += 20) line(xx, y, xx, b)
    for (let yy = y; yy <= b; yy += 20) line(x, yy, r, yy)
    line(r, y, r, b)
    line(x, b, r, b)
  }
  // Caption: isolated coloured strokes must not turn into a panel.
  line(300, 270, 380, 270)
  line(300, 280, 380, 280)
  return data
}

describe('LED grid chart recognition', () => {
  it('finds closed grids and excludes gutters/captions', () => {
    expect(detectLedPanels(chartPixels(), 800, 300)).toEqual([
      { x: 0, y: 0, w: 200, h: 240 },
      { x: 490, y: 0, w: 300, h: 240 },
      { x: 240, y: 20, w: 200, h: 200 }
    ])
  })
  it('does not reinterpret existing alpha artwork', () => {
    const data = chartPixels()
    data[3] = 0
    expect(detectLedPanels(data, 800, 300)).toEqual([])
  })
  it('rejects solid coloured photographs/rectangles without a grid', () => {
    const data = new Uint8ClampedArray(100 * 100 * 4)
    for (let i = 0; i < 10000; i++) data.set([230, 120, 10, 255], i * 4)
    expect(detectLedPanels(data, 100, 100)).toEqual([])
  })
})
describe('panel-local adjustable snap', () => {
  const panel = [{ x: 1182, y: 0, w: 336, h: 1440 }]
  it('uses each panel origin and a pixel-centred 10px lattice', () => {
    expect(snapLedGrid({ x: 1196, y: 17 }, 10, panel)).toEqual({ x: 1192.5, y: 20.5 })
    expect(snapLedGrid({ x: 1196, y: 17 }, 20, panel)).toEqual({ x: 1202.5, y: 20.5 })
  })
  it('never snaps to a grid point outside the right/bottom edge', () => {
    const p = snapLedGrid({ x: 1517, y: 1439 }, 10, panel)
    expect(p).toEqual({ x: 1512.5, y: 1430.5 })
    expect(snapLedGrid({ x: 1530, y: 17 }, 10, panel)).toEqual({ x: 1530, y: 17 })
  })
  it('scales panel geometry along with the canvas, and guards zero/nonfinite spacing', () => {
    expect(scaledLedRegions({ width: 6400, height: 1800, regions: panel }, 3200, 900)).toEqual([
      { x: 591, y: 0, w: 168, h: 720 }
    ])
    expect(safeGridSpacing(0)).toBe(1)
    expect(safeGridSpacing(NaN)).toBe(10)
    expect(safeGridSpacing(Infinity)).toBe(10)
  })
})
