import { describe, it, expect } from 'vitest'
import { findWarmBlobs } from './lantern-detect'

/** w×h の RGBA バイト列を作る（既定は不透明の黒）。 */
function makeImg(w: number, h: number): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i++) d[i * 4 + 3] = 255 // alpha=255
  return d
}
/** (cx,cy) 中心の (2r+1)四方を色で塗る。 */
function paint(d: Uint8ClampedArray, w: number, cx: number, cy: number, r: number, rgb: [number, number, number]): void {
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      const i = (y * w + x) * 4
      d[i] = rgb[0]
      d[i + 1] = rgb[1]
      d[i + 2] = rgb[2]
      d[i + 3] = 255
    }
  }
}

describe('findWarmBlobs（行灯さがし）', () => {
  it('暖色で明るい塊を2つ見つけ、重心が中心に来る', () => {
    const w = 20
    const h = 20
    const d = makeImg(w, h)
    paint(d, w, 5, 5, 1, [255, 150, 40]) // 行灯っぽいオレンジ
    paint(d, w, 14, 14, 1, [255, 165, 50])
    const blobs = findWarmBlobs(d, w, h, { minAreaFrac: 0 })
    expect(blobs).toHaveLength(2)
    const sorted = blobs.map((b) => ({ x: Math.round(b.cx), y: Math.round(b.cy) })).sort((a, b) => a.x - b.x)
    expect(sorted[0]).toEqual({ x: 5, y: 5 })
    expect(sorted[1]).toEqual({ x: 14, y: 14 })
  })

  it('白いテカリ(r≈g≈b)は行灯と誤検出しない', () => {
    const w = 20
    const h = 20
    const d = makeImg(w, h)
    paint(d, w, 10, 10, 1, [255, 255, 255]) // 真っ白＝暖色ではない
    expect(findWarmBlobs(d, w, h, { minAreaFrac: 0 })).toHaveLength(0)
  })

  it('暗い暖色（点いていない行灯）は拾わない', () => {
    const w = 20
    const h = 20
    const d = makeImg(w, h)
    paint(d, w, 10, 10, 1, [80, 45, 15]) // 暗いオレンジ＝消灯中
    expect(findWarmBlobs(d, w, h, { minAreaFrac: 0 })).toHaveLength(0)
  })

  it('小さすぎるノイズは minArea で捨てる', () => {
    const w = 30
    const h = 30
    const d = makeImg(w, h)
    paint(d, w, 15, 15, 0, [255, 150, 40]) // 1px だけ
    expect(findWarmBlobs(d, w, h)).toHaveLength(0) // 既定 minAreaFrac で 1px は捨てられる
  })
})
