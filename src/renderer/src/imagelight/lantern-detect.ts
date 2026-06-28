// 行灯(提灯)さがし — セット写真の中の「明るくて暖色(オレンジ)に光っている塊」を見つける。
// 重いAIは使わず、色と明るさのフィルタ＋連結成分(塊)抽出だけ。写真読込時に一回だけ走らせる想定。
// 純関数（ImageData の生バイト配列を受け取る）なのでテストしやすい。

export interface WarmBlob {
  /** 重心 X（ピクセル座標・0..w） */
  cx: number
  /** 重心 Y（ピクセル座標・0..h） */
  cy: number
  /** 塊の画素数 */
  area: number
}

export interface WarmBlobOpts {
  /** 明るさ閾値（max(r,g,b)）。これ未満は暗い＝対象外。 */
  minLum?: number
  /** 暖色判定: r-b がこれ以上（オレンジ/アンバーほど大きい）。 */
  warmGap?: number
  /** 採用する塊の最小面積（全画素に対する割合）。小さなテカリ/ノイズを捨てる。 */
  minAreaFrac?: number
  /** 返す塊の最大数（大きい順）。 */
  maxBlobs?: number
}

/** RGBA バイト列(data)から、暖色で明るい塊の重心一覧を返す（面積の大きい順）。 */
export function findWarmBlobs(
  data: Uint8ClampedArray | Uint8Array | number[],
  w: number,
  h: number,
  opts: WarmBlobOpts = {}
): WarmBlob[] {
  const minLum = opts.minLum ?? 170
  const warmGap = opts.warmGap ?? 35
  const minArea = Math.max(4, Math.round((opts.minAreaFrac ?? 0.0006) * w * h))
  const maxBlobs = opts.maxBlobs ?? 40
  const n = w * h
  if (n <= 0 || data.length < n * 4) return []

  // 1) 「暖色＆明るい」画素を 1 に。
  const on = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    const r = data[i * 4]
    const g = data[i * 4 + 1]
    const b = data[i * 4 + 2]
    const a = data[i * 4 + 3]
    if (a < 8) continue // 透明（黒バック/アルファ抜き）は対象外
    const lum = r > g ? (r > b ? r : b) : g > b ? g : b
    // 明るく / 赤が緑以上 / 赤と青の差が大きい（=オレンジ寄り。白いテカリは r≈b で弾く）
    if (lum >= minLum && r >= g && r - b >= warmGap) on[i] = 1
  }

  // 2) 連結成分(4近傍)で塊にまとめ、重心と面積を出す。
  const seen = new Uint8Array(n)
  const blobs: WarmBlob[] = []
  const stack: number[] = []
  for (let s = 0; s < n; s++) {
    if (!on[s] || seen[s]) continue
    let sx = 0
    let sy = 0
    let area = 0
    stack.length = 0
    stack.push(s)
    seen[s] = 1
    while (stack.length) {
      const p = stack.pop() as number
      const px = p % w
      const py = (p / w) | 0
      sx += px
      sy += py
      area++
      if (px > 0 && on[p - 1] && !seen[p - 1]) {
        seen[p - 1] = 1
        stack.push(p - 1)
      }
      if (px < w - 1 && on[p + 1] && !seen[p + 1]) {
        seen[p + 1] = 1
        stack.push(p + 1)
      }
      if (py > 0 && on[p - w] && !seen[p - w]) {
        seen[p - w] = 1
        stack.push(p - w)
      }
      if (py < h - 1 && on[p + w] && !seen[p + w]) {
        seen[p + w] = 1
        stack.push(p + w)
      }
    }
    if (area >= minArea) blobs.push({ cx: sx / area, cy: sy / area, area })
  }

  blobs.sort((a, b) => b.area - a.area)
  return blobs.slice(0, maxBlobs)
}
