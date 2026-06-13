/* ============================== 色比保持トーン ==============================
 * 写真（アルベド）×光マップ の合成。チャンネル独立clip（＝強い色光が白へ飛ぶ「白茶け」
 * バグ）の代わりに、色比（彩度）を保ったまま明るさだけを Reinhard 圧縮する。
 * 「白いものに色光が一番鮮やかに乗る」を実現する核心（のむさん確定 2026-06-13）。
 * 家訓「色は白へ振らない」を写真素材へ正しく適用したもの。
 *
 *   dr,dg,db = albedo × (light × gain)         // 強光で 1 を超えてよい
 *   mx = max(dr,dg,db)
 *   v  = mx / (1 + mx*0.45)                     // 最大チャンネルだけを圧縮
 *   s  = v / mx ; dr*=s; dg*=s; db*=s           // 同じ係数を全channelへ → 色比そのまま
 */

/** Reinhard 圧縮係数（最大チャンネルの飽和カーブ）。大きいほど早く頭打ち。 */
export const TONE_K = 0.45
/** 光マップ→露出のゲイン。フル光（light=1.0）で白アルベドがほぼ飽和するよう調整。 */
export const TONE_GAIN = 2.2

/** 1ピクセル分の色比保持トーン。albedo/light は 0..1 の線形値、戻りも 0..1。
 *  out は長さ3の配列に書き込む（呼び出し側で確保・再利用）。 */
export function toneRatioPixel(
  aR: number,
  aG: number,
  aB: number,
  lR: number,
  lG: number,
  lB: number,
  gain: number,
  out: [number, number, number]
): void {
  let dr = aR * lR * gain
  let dg = aG * lG * gain
  let db = aB * lB * gain
  const mx = dr > dg ? (dr > db ? dr : db) : dg > db ? dg : db
  if (mx > 1e-4) {
    const s = mx / (1 + mx * TONE_K) / mx
    dr *= s
    dg *= s
    db *= s
  }
  out[0] = dr
  out[1] = dg
  out[2] = db
}

/** 写真ボックスの RGBA を in-place で色比保持トーン合成する。
 *  - `albedo`: アルベド版写真の RGBA（A=写真の形・0..255）
 *  - `light` : 同サイズの光マップ RGBA（強度・0..255）
 *  - `out`   : 書き込み先 RGBA（`albedo` と同一でも可）。A は albedo の A をそのまま使う
 *  - `tone`  : 暗部トー 0..1（低ゲージほど大）。露出を絞って暗部から沈ませる
 *  無灯（light=0）の所は albedo×0=0 で完全な闇のまま。 */
export function composeColorRatio(
  albedo: Uint8ClampedArray,
  light: Uint8ClampedArray,
  out: Uint8ClampedArray,
  tone = 0
): void {
  const gain = TONE_GAIN * (1 - 0.45 * Math.max(0, Math.min(1, tone)))
  const px: [number, number, number] = [0, 0, 0]
  for (let i = 0; i < albedo.length; i += 4) {
    const a = albedo[i + 3]
    if (a === 0) {
      out[i] = 0
      out[i + 1] = 0
      out[i + 2] = 0
      out[i + 3] = 0
      continue
    }
    toneRatioPixel(
      albedo[i] / 255,
      albedo[i + 1] / 255,
      albedo[i + 2] / 255,
      light[i] / 255,
      light[i + 1] / 255,
      light[i + 2] / 255,
      gain,
      px
    )
    out[i] = px[0] * 255
    out[i + 1] = px[1] * 255
    out[i + 2] = px[2] * 255
    out[i + 3] = a
  }
}
