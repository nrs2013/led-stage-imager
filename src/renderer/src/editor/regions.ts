// くり抜きの島検出: connected components over the drawable mask cells. Each island's
// cell bounding box feeds the blueprint-style dimension lines (←— 120 —→ / ↕ 80).

export interface Region {
  x: number
  y: number
  w: number
  h: number
}

/** Finds connected drawable regions (4-connectivity) and returns their cell bboxes.
 *  Tiny specks (area < minArea) are skipped; the scan stops at maxRegions as a guard. */
export function findDrawableRegions(
  bitmap: Uint8Array,
  w: number,
  h: number,
  opts?: { minArea?: number; maxRegions?: number }
): Region[] {
  const minArea = opts?.minArea ?? 4
  const maxRegions = opts?.maxRegions ?? 200
  const seen = new Uint8Array(w * h)
  const out: Region[] = []
  const stack: number[] = []

  for (let start = 0; start < w * h; start++) {
    if (bitmap[start] !== 1 || seen[start]) continue
    let minX = w
    let minY = h
    let maxX = -1
    let maxY = -1
    let area = 0
    stack.length = 0
    stack.push(start)
    seen[start] = 1
    while (stack.length) {
      const i = stack.pop()!
      const x = i % w
      const y = (i / w) | 0
      area++
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
      if (x > 0 && bitmap[i - 1] === 1 && !seen[i - 1]) {
        seen[i - 1] = 1
        stack.push(i - 1)
      }
      if (x < w - 1 && bitmap[i + 1] === 1 && !seen[i + 1]) {
        seen[i + 1] = 1
        stack.push(i + 1)
      }
      if (y > 0 && bitmap[i - w] === 1 && !seen[i - w]) {
        seen[i - w] = 1
        stack.push(i - w)
      }
      if (y < h - 1 && bitmap[i + w] === 1 && !seen[i + w]) {
        seen[i + w] = 1
        stack.push(i + w)
      }
    }
    if (area >= minArea) {
      out.push({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 })
      if (out.length >= maxRegions) break
    }
  }
  return out
}
