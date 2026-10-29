import type { Point } from './types'

export interface LedRect {
  x: number
  y: number
  w: number
  h: number
}
export interface LedLayout {
  width: number
  height: number
  regions: LedRect[]
}

/** Detect connected coloured rectangular grids. Never infer panels from black pixels:
 * black gutters and captions are not LED faces. Non-rectangular/photo content is rejected. */
export function detectLedPanels(rgba: Uint8ClampedArray, w: number, h: number): LedRect[] {
  if (w < 32 || h < 32 || w * h > 34_000_000) return []
  const pixels = new Uint8Array(w * h)
  let dark = 0
  for (let i = 0; i < pixels.length; i++) {
    const j = i * 4,
      r = rgba[j],
      g = rgba[j + 1],
      b = rgba[j + 2]
    if (rgba[j + 3] < 250) return [] // existing alpha artwork keeps its explicit mask semantics
    const max = Math.max(r, g, b),
      min = Math.min(r, g, b)
    if (max < 45) dark++
    pixels[i] = max > 65 && max - min > 40 ? 1 : 0
  }
  if (dark < pixels.length * 0.6) return []
  const seen = new Uint8Array(pixels.length)
  const queue = new Uint32Array(pixels.length)
  const result: LedRect[] = []
  for (let seed = 0; seed < pixels.length; seed++) {
    if (!pixels[seed] || seen[seed]) continue
    let head = 0,
      tail = 1
    queue[0] = seed
    seen[seed] = 1
    let left = w,
      right = 0,
      top = h,
      bottom = 0
    while (head < tail) {
      const p = queue[head++],
        x = p % w,
        y = Math.floor(p / w)
      left = Math.min(left, x)
      right = Math.max(right, x)
      top = Math.min(top, y)
      bottom = Math.max(bottom, y)
      for (let yy = Math.max(0, y - 1); yy <= Math.min(h - 1, y + 1); yy++) {
        for (let xx = Math.max(0, x - 1); xx <= Math.min(w - 1, x + 1); xx++) {
          const n = yy * w + xx
          if (pixels[n] && !seen[n]) {
            seen[n] = 1
            queue[tail++] = n
          }
        }
      }
    }
    const bw = right - left + 1,
      bh = bottom - top + 1
    if (bw < 48 || bh < 48 || bw * bh < w * h * 0.003 || tail > bw * bh * 0.45) continue
    const col = (x: number): number => {
      let n = 0
      for (let y = top; y <= bottom; y++) n += pixels[y * w + x]
      return n / bh
    }
    const row = (y: number): number => {
      let n = 0
      for (let x = left; x <= right; x++) n += pixels[y * w + x]
      return n / bw
    }
    // Determine stroke centres rather than including antialiased fringe pixels.
    const band = (
      a: number,
      b: number,
      score: (v: number) => number,
      dir: number
    ): number | null => {
      const hits: number[] = []
      for (let v = a; dir > 0 ? v <= b : v >= b; v += dir) {
        if (score(v) >= 0.9) hits.push(v)
        else if (hits.length) break
      }
      return hits.length ? Math.round((hits[0] + hits[hits.length - 1]) / 2) : null
    }
    const pad = Math.min(8, Math.floor(Math.min(bw, bh) / 8))
    const x0 = left === 0 ? 0 : band(left, left + pad, col, 1)
    const x1 = right === w - 1 ? w : band(right, right - pad, col, -1)
    const y0 = top === 0 ? 0 : band(top, top + pad, row, 1)
    const y1 = bottom === h - 1 ? h : band(bottom, bottom - pad, row, -1)
    if (x0 == null || x1 == null || y0 == null || y1 == null) continue
    // Require at least two internal grid lines in each direction, not just a logo box.
    const countBands = (a: number, b: number, score: (v: number) => number): number => {
      let count = 0,
        on = false
      for (let v = a + pad + 1; v < b - pad; v++) {
        const next = score(v) >= 0.85
        if (next && !on) count++
        on = next
      }
      return count
    }
    if (countBands(x0, x1, col) < 2 || countBands(y0, y1, row) < 2) continue
    result.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 })
  }
  return result.sort((a, b) => a.y - b.y || a.x - b.x)
}

export function scaledLedRegions(layout: LedLayout | undefined, w: number, h: number): LedRect[] {
  if (!layout || !(layout.width > 0 && layout.height > 0)) return []
  return layout.regions
    .filter((r) => r.w > 0 && r.h > 0)
    .map((r) => ({
      x: (r.x * w) / layout.width,
      y: (r.y * h) / layout.height,
      w: (r.w * w) / layout.width,
      h: (r.h * h) / layout.height
    }))
}

export function safeGridSpacing(value: number | undefined): number {
  return value != null && Number.isFinite(value)
    ? Math.max(1, Math.min(500, Math.round(value)))
    : 10
}

export function snapLedGrid(p: Point, spacing: number, regions: LedRect[]): Point {
  const r = regions.find((r) => p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h)
  if (!r) return p // no attraction across non-LED gutters
  const step = safeGridSpacing(spacing)
  const axis = (v: number, origin: number, length: number): number =>
    origin +
    0.5 +
    Math.max(0, Math.min(Math.floor((length - 1) / step), Math.round((v - origin - 0.5) / step))) *
      step
  return { x: axis(p.x, r.x, r.w), y: axis(p.y, r.y, r.h) }
}
