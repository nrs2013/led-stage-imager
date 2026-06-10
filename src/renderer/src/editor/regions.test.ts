import { describe, it, expect } from 'vitest'
import { findDrawableRegions } from './regions'

function bitmapOf(rows: string[]): { b: Uint8Array; w: number; h: number } {
  const h = rows.length
  const w = rows[0].length
  const b = new Uint8Array(w * h)
  rows.forEach((r, y) => {
    for (let x = 0; x < w; x++) if (r[x] === '#') b[y * w + x] = 1
  })
  return { b, w, h }
}

describe('findDrawableRegions (くり抜きの島検出)', () => {
  it('finds two separate rectangles with exact bboxes', () => {
    const { b, w, h } = bitmapOf([
      '..........',
      '.###...##.',
      '.###...##.',
      '.###......',
      '..........'
    ])
    const r = findDrawableRegions(b, w, h, { minArea: 2 })
    expect(r).toHaveLength(2)
    expect(r[0]).toEqual({ x: 1, y: 1, w: 3, h: 3 })
    expect(r[1]).toEqual({ x: 7, y: 1, w: 2, h: 2 })
  })

  it('an L-shaped island is one region with its bounding box', () => {
    const { b, w, h } = bitmapOf(['##...', '##...', '#####'])
    const r = findDrawableRegions(b, w, h, { minArea: 2 })
    expect(r).toHaveLength(1)
    expect(r[0]).toEqual({ x: 0, y: 0, w: 5, h: 3 })
  })

  it('tiny specks below minArea are ignored', () => {
    const { b, w, h } = bitmapOf(['#....', '...##', '.....'])
    expect(findDrawableRegions(b, w, h, { minArea: 4 })).toHaveLength(0)
  })
})
