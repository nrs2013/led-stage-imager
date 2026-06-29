import { describe, it, expect } from 'vitest'
import { embossFromLuminance } from './relief-map'

function img(w: number, h: number, fill: number): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    d[i * 4] = fill
    d[i * 4 + 1] = fill
    d[i * 4 + 2] = fill
    d[i * 4 + 3] = 255
  }
  return d
}

describe('embossFromLuminance（AIなし立体マップ）', () => {
  it('平らな画像は全部128（=立体なし）', () => {
    const out = embossFromLuminance(img(8, 8, 120), 8, 8)
    for (let i = 0; i < 8 * 8; i++) expect(out[i * 4]).toBe(128)
  })

  it('明暗の段差があると128から外れる（=立体が出る）', () => {
    const w = 8
    const h = 8
    const d = img(w, h, 40)
    // 右半分を明るく（縦の段差）
    for (let y = 0; y < h; y++)
      for (let x = 4; x < w; x++) {
        const i = (y * w + x) * 4
        d[i] = d[i + 1] = d[i + 2] = 220
      }
    const out = embossFromLuminance(d, w, h, { gain: 2 })
    let deviated = false
    for (let i = 0; i < w * h; i++) if (Math.abs(out[i * 4] - 128) > 5) deviated = true
    expect(deviated).toBe(true)
  })

  it('出力は常に不透明(alpha=255)', () => {
    const out = embossFromLuminance(img(4, 4, 100), 4, 4)
    for (let i = 0; i < 4 * 4; i++) expect(out[i * 4 + 3]).toBe(255)
  })
})
