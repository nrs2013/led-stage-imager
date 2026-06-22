// 深度マップ(near=明/far=暗のグレースケール) → 「立体感レリーフ(彫り)」を焼く。
//
// 方針: AIの“地面グラデ（画面の下＝近い＝明）”や 8bit の段差ノイズは捨て、
//   建物の【中間スケールの凹凸＝柱・窓・ひさし】だけを取り出す（DoG＝大小ぼかしの差）。
//   出っ張り=明 / 凹み=暗 / 平ら=128(無変化)。overlay で重ねて立体に見せる。
//
// ※ 向き付き(光の向きで影を落とす)は、地面グラデを“偏り(下が暗い等)”に変えてしまうのでやめ、
//   向き無依存の純粋な局所彫りにする＝全体が一様に暗くなる/明るくなる偏りが出ない。
// 強さ(0..1)は描画側の globalAlpha。強さ0なら呼び出し側が描かない＝今と完全一致。

export interface DepthShadeOpts {
  /** 立体感の強さ係数（高いほど凹凸がはっきり）。既定 5。 */
  gain?: number
  /** 細部側ぼかし(px)：8bit段差/ノイズを均す。未指定で自動(短辺の約1.5%)。 */
  fineRadius?: number
  /** 基準側ぼかし(px)：これより大きいスケール(=全体グラデ)を消す基準。未指定で自動(短辺の約12%)。 */
  baseRadius?: number
  /** 出っ張り/凹みを反転（素材で奥行きが逆の時）。 */
  invert?: boolean
}

/** A(細部側) と B(基準側) の差から「立体感レリーフ」を作る純関数＝テスト対象。
 *  out は 128 中心: A>B(出っ張り)=明(>128) / A<B(凹み)=暗(<128) / 同じ(平ら/全体グラデ)=128。 */
export function reliefHighpassData(
  a: Uint8ClampedArray,
  b: Uint8ClampedArray,
  out: Uint8ClampedArray,
  gain = 5,
  invert = false
): void {
  for (let i = 0; i < a.length; i += 4) {
    let hp = (a[i] - b[i]) / 255 // 中間スケールの凹凸（出っ張り>0 / 凹み<0 / 平ら・全体グラデ=0）
    if (invert) hp = -hp
    const v = Math.max(0, Math.min(255, Math.round(128 + gain * hp * 255)))
    out[i] = v
    out[i + 1] = v
    out[i + 2] = v
    out[i + 3] = 255
  }
}

/** ぼかした深度を ImageData で返す内部ヘルパ。 */
function blurredData(src: HTMLCanvasElement, radius: number): Uint8ClampedArray {
  const w = src.width
  const h = src.height
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.filter = `blur(${radius}px)`
  ctx.drawImage(src, 0, 0)
  ctx.filter = 'none'
  return ctx.getImageData(0, 0, w, h).data
}

/** 深度 canvas → 立体感レリーフ canvas（同サイズ・128中立・DoG＝向き無依存の局所彫り）。 */
export function buildDepthShadeCanvas(
  depth: HTMLCanvasElement,
  opts: DepthShadeOpts = {}
): HTMLCanvasElement {
  const w = depth.width
  const h = depth.height
  const gain = opts.gain ?? 5
  const rFine = opts.fineRadius ?? Math.max(2, Math.round(Math.min(w, h) * 0.015))
  const rBase = opts.baseRadius ?? Math.max(8, Math.round(Math.min(w, h) * 0.12))
  const fine = blurredData(depth, rFine) // 細部を残しノイズだけ均す
  const base = blurredData(depth, rBase) // 全体グラデ(下が近い)を表す基準
  const out = new ImageData(w, h)
  // relief = 細部 − 基準：中間スケールの凹凸だけ残る（全体グラデも細かいノイズも消える）。
  reliefHighpassData(fine, base, out.data, gain, !!opts.invert)
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  c.getContext('2d')!.putImageData(out, 0, 0)
  return c
}
