import { describe, it, expect } from 'vitest'
import { isEmptyPixel } from './mask'

describe('isEmptyPixel (chart pixel rule)', () => {
  it('alpha images: transparent = empty, opaque = LED face', () => {
    expect(isEmptyPixel(255, 255, 255, 0, true)).toBe(true) // fully transparent
    expect(isEmptyPixel(0, 0, 0, 100, true)).toBe(true) // mostly transparent (even black)
    expect(isEmptyPixel(0, 0, 0, 255, true)).toBe(false) // opaque black panel still counts
    expect(isEmptyPixel(200, 200, 200, 255, true)).toBe(false) // opaque panel
  })

  it('alpha-less images (JPG/flattened): near-black = empty', () => {
    expect(isEmptyPixel(0, 0, 0, 255, false)).toBe(true) // pure black background
    expect(isEmptyPixel(20, 20, 20, 255, false)).toBe(true) // compression noise in black
    expect(isEmptyPixel(24, 24, 24, 255, false)).toBe(false) // at the threshold: kept
    expect(isEmptyPixel(255, 255, 255, 255, false)).toBe(false) // bright panel
    expect(isEmptyPixel(80, 0, 0, 255, false)).toBe(false) // dark but coloured panel
  })
})
