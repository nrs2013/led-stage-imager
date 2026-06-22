// 深度マップ(near=明/far=暗のグレースケール) → 「立体感レリーフ(彫り)」を焼く。
//
// 方針: AIの“地面グラデ(下=近い=明)”や 8bit 段差ノイズは捨て、建物の【中間スケールの凹凸＝
//   柱・窓・ひさし】だけを取り出す（DoG＝大小ぼかしの差＝向き無依存の局所レリーフ）。
//   さらに、その局所レリーフに対して【光の向き(既定 下から)】で“出っ張りの上に影”を足す。
//   影は生の深度ではなく局所レリーフに掛けるので、全体が一様に暗くなる偏りは出ない。
//
// 出っ張り=明 / 凹み=暗 / 出っ張りの光源と反対側=影で暗 / 平ら=128(無変化)。
// 強さ(0..1)は描画側の globalAlpha。強さ0なら呼び出し側が描かない＝今と完全一致。

export interface DepthShadeOpts {
  /** 立体感(彫り)の強さ係数。既定 8。 */
  gain?: number
  /** “出っ張りの上の影”の強さ。0=影なし(対称の彫りだけ)。既定 5。 */
  shadowGain?: number
  /** 細部側ぼかし(px)：8bit段差/ノイズを均す。未指定で自動(短辺の約1.5%)。 */
  fineRadius?: number
  /** 基準側ぼかし(px)：これより大きいスケール(=全体グラデ)を消す基準。未指定で自動(短辺の約12%)。 */
  baseRadius?: number
  /** 光の向き（画面座標の単位ベクトル・自動正規化）。既定 下から (0,1)＝出っ張りの上が陰る。 */
  lightX?: number
  lightY?: number
  /** 影を伸ばす距離(px)。未指定で自動(短辺の約3%)。 */
  shadowShift?: number
  /** 明側(出っ張り)の効きの倍率 0..1。小さいほど白飛びしにくい（暗側=影はそのまま）。既定 0.55。 */
  highlightScale?: number
  /** 出っ張り/凹みを反転（素材で奥行きが逆の時）。 */
  invert?: boolean
}

/** A(細部側) と B(基準側) の差から「対称レリーフ」を作る純関数＝テスト対象。
 *  out は 128 中心: A>B(出っ張り)=明 / A<B(凹み)=暗 / 同じ(平ら/全体グラデ)=128。 */
export function reliefHighpassData(
  a: Uint8ClampedArray,
  b: Uint8ClampedArray,
  out: Uint8ClampedArray,
  gain = 5,
  invert = false,
  highlightScale = 0.55
): void {
  for (let i = 0; i < a.length; i += 4) {
    let hp = (a[i] - b[i]) / 255 // 中間スケールの凹凸（出っ張り>0 / 凹み<0 / 平ら・全体グラデ=0）
    if (invert) hp = -hp
    let val = gain * hp
    if (val > 0) val *= highlightScale // 明側(出っ張り)は控えめ＝白飛び防止。暗側(凹み/影)はそのまま。
    const v = Math.max(0, Math.min(255, Math.round(128 + val * 255)))
    out[i] = v
    out[i + 1] = v
    out[i + 2] = v
    out[i + 3] = 255
  }
}

/** 局所レリーフ bp(128中心) と、それを光源方向へずらした bpToward から、
 *  「対称の彫り＋出っ張りの上の影」を合成する純関数＝テスト対象。
 *  影(occ)＝光源側がより出っ張っているほど、ここは陰る（向き付き・全体偏り無し）。 */
export function directionalReliefData(
  bp: Uint8ClampedArray,
  bpToward: Uint8ClampedArray,
  out: Uint8ClampedArray,
  gain = 8,
  shadowGain = 5,
  highlightScale = 0.55,
  invert = false
): void {
  for (let i = 0; i < bp.length; i += 4) {
    let hp = (bp[i] - 128) / 255 // 局所レリーフ（出っ張り>0 / 凹み<0）
    let hpT = (bpToward[i] - 128) / 255 // 光源側のレリーフ
    if (invert) {
      hp = -hp
      hpT = -hpT
    }
    const occ = Math.max(0, hpT - hp) // 光源側が出っ張り → ここは影
    let val = gain * hp
    if (val > 0) val *= highlightScale // 明側ひかえめ＝白飛び防止
    val -= shadowGain * occ // 出っ張りの“上(光源と反対側)”を暗く＝リアルな落ち影
    const v = Math.max(0, Math.min(255, Math.round(128 + val * 255)))
    out[i] = v
    out[i + 1] = v
    out[i + 2] = v
    out[i + 3] = 255
  }
}

/** ぼかした深度を ImageData データで返す内部ヘルパ。 */
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

/** 深度 canvas → 立体感レリーフ canvas（同サイズ・128中立・局所彫り＋向き付き影）。 */
export function buildDepthShadeCanvas(
  depth: HTMLCanvasElement,
  opts: DepthShadeOpts = {}
): HTMLCanvasElement {
  const w = depth.width
  const h = depth.height
  const gain = opts.gain ?? 8
  const shadowGain = opts.shadowGain ?? 5
  const highlightScale = opts.highlightScale ?? 0.55
  const rFine = opts.fineRadius ?? Math.max(2, Math.round(Math.min(w, h) * 0.015))
  const rBase = opts.baseRadius ?? Math.max(8, Math.round(Math.min(w, h) * 0.12))
  const shadowShift = opts.shadowShift ?? Math.max(3, Math.round(Math.min(w, h) * 0.03))
  let lx = opts.lightX ?? 0
  let ly = opts.lightY ?? 1 // 既定＝下から（出っ張りの上が陰る）
  const ln = Math.hypot(lx, ly) || 1
  lx /= ln
  ly /= ln

  const fine = blurredData(depth, rFine) // 細部を残しノイズだけ均す
  const base = blurredData(depth, rBase) // 全体グラデ(下が近い)を表す基準
  // 局所レリーフ bp = 128 + (fine - base)（向き無依存・全体グラデ無し）
  const bp = new Uint8ClampedArray(fine.length)
  reliefHighpassData(fine, base, bp, 1, false, 1)
  // bp を canvas 化して光源方向へずらす（影の比較対象）
  const bpC = document.createElement('canvas')
  bpC.width = w
  bpC.height = h
  bpC.getContext('2d', { willReadFrequently: true })!.putImageData(new ImageData(bp, w, h), 0, 0)
  const shiftC = document.createElement('canvas')
  shiftC.width = w
  shiftC.height = h
  const sctx = shiftC.getContext('2d', { willReadFrequently: true })!
  sctx.drawImage(bpC, -lx * shadowShift, -ly * shadowShift) // shifted[here] = bp[ここ＋光向き]
  const bpToward = sctx.getImageData(0, 0, w, h).data
  // 合成：対称の彫り(gain) ＋ 出っ張りの上の影(shadowGain)
  const out = new ImageData(w, h)
  directionalReliefData(bp, bpToward, out.data, gain, shadowGain, highlightScale, !!opts.invert)
  // 端のぼかし由来の“縁の線”(下端などが明るく筋になる＝blurが画像外の透明を巻き込む)を消す：
  // 外周 margin px を中立(128)へなめらかにフェード。内側の彫りはそのまま。
  const margin = rBase
  for (let y = 0; y < h; y++) {
    const dy = Math.min(y, h - 1 - y)
    for (let x = 0; x < w; x++) {
      const d = Math.min(x, w - 1 - x, dy)
      if (d < margin) {
        const f = d / margin
        const idx = (y * w + x) * 4
        const v = Math.round(128 + (out.data[idx] - 128) * f)
        out.data[idx] = v
        out.data[idx + 1] = v
        out.data[idx + 2] = v
      }
    }
  }
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  c.getContext('2d')!.putImageData(out, 0, 0)
  return c
}
