// AIなしの“深度っぽい”立体: 写真の明るさを高さに見立てた方向つきエンボス（浮き彫り）マップ。
// 「明るい所=出っ張り」と仮定し、指定の光の向きに対する斜面に明暗を付ける。
// 出力は rgba グレー: 128=平ら / >128=光の向きを向いた面(ハイライト) / <128=反対(影)。
// soft-light で写真に重ねると、もとの彫りに方向性のある立体が乗る。写真読込時に一回だけ計算する想定。

export interface EmbossOpts {
  /** 光の向き（サンプル offset・既定は左上から）。 */
  dx?: number
  dy?: number
  /** 立体の強さ（傾きの増幅）。 */
  gain?: number
}

/** RGBA バイト列(data)から、方向つきエンボス(relief)の RGBA バイト列を返す。純関数。 */
export function embossFromLuminance(
  data: Uint8ClampedArray | Uint8Array | number[],
  w: number,
  h: number,
  opts: EmbossOpts = {}
): Uint8ClampedArray {
  const dx = opts.dx ?? 1 // 左上から照らす
  const dy = opts.dy ?? 1
  const gain = opts.gain ?? 2
  const out = new Uint8ClampedArray(w * h * 4)
  if (w <= 0 || h <= 0 || data.length < w * h * 4) return out
  const lum = (idx: number): number => 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const xa = x - dx < 0 ? 0 : x - dx // 光側
      const ya = y - dy < 0 ? 0 : y - dy
      const xb = x + dx > w - 1 ? w - 1 : x + dx // 反対側
      const yb = y + dy > h - 1 ? h - 1 : y + dy
      const la = lum((ya * w + xa) * 4)
      const lb = lum((yb * w + xb) * 4)
      // 光側が明るい(出っ張りが光を向く)ほど >128＝ハイライト、暗いほど <128＝影。
      const v = 128 + (la - lb) * gain
      const g = v < 0 ? 0 : v > 255 ? 255 : v
      out[i] = g
      out[i + 1] = g
      out[i + 2] = g
      out[i + 3] = 255
    }
  }
  return out
}
