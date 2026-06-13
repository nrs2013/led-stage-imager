import type { Shape } from '../model/types'
import type { RGB } from './bulb'
import type { BeamPose } from '../dmx/channel-math'

/* ============================== アッパーライト ==============================
 * A photo (image shape) never emits light: it is an albedo (反射率の地図).
 * Uplights pour cone beams into ONE light map; the photo shows only where the
 * map washes it (multiply), and the air beam is visible only through smoke.
 * Confirmed on the試打台 with のむさん (2026-06-11):
 *  - coloured light STAYS its colour at full — never shifts to white
 *  - dimming sinks warm (amber drift), fading up rises out of the dark (tone)
 *  - 届く高さ is a RIGGING value; the desk steers Pan/Tilt/Zoom only (beam6)
 *  - pan: behind the panel cuts hard, towards the house shortens the throw
 */

export const UPLIGHT_DEFAULT_W0 = 14
export const UPLIGHT_DEFAULT_W1 = 90
export const UPLIGHT_DEFAULT_LEN = 200

export const uplightW0 = (s: Pick<Shape, 'beamW0'>): number => {
  const v = s.beamW0 ?? UPLIGHT_DEFAULT_W0
  return v < 2 ? 2 : v
}
export const uplightW1 = (s: Pick<Shape, 'beamW1'>): number => {
  const v = s.beamW1 ?? UPLIGHT_DEFAULT_W1
  return v < 4 ? 4 : v
}
export const uplightLen = (s: Pick<Shape, 'beamLen'>): number => {
  const v = s.beamLen ?? UPLIGHT_DEFAULT_LEN
  return v < 20 ? 20 : v
}

const rgba = (c: RGB, a: number): string => {
  const al = a < 0 ? 0 : a > 1 ? 1 : a
  return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${al.toFixed(3)})`
}

/** 調光アンバードリフト: 絞ると白熱灯のように赤橙へ沈む。色は最後まで色のまま
 *  （白へは絶対に振らない — のむさん確定 2026-06-11）。 */
export function beamDimColor(hue: RGB, I: number): RGB {
  const low = Math.max(0, (0.5 - I) / 0.5)
  return [hue[0] * I, hue[1] * (1 - 0.3 * low) * I, hue[2] * (1 - 0.6 * low) * I]
}

/** 看板面に乗る光のパン係数: 奥(−)=パネルの裏へ遮られて急減、手前(+)=面から
 *  離れていくだけなので緩やかに減る（非対称が本物の見え方）。 */
export function wallGain(pan: number): number {
  const phi = (pan * Math.PI) / 2
  return Math.pow(Math.max(0, Math.cos(phi)), pan < 0 ? 3.2 : 1.8)
}

/** 空中の光の水のパン係数: 奥は看板の裏に隠れて消え、手前はこちらへ向かう光と
 *  して残る。 */
export function airGain(pan: number): number {
  const c = Math.cos((pan * Math.PI) / 2)
  return pan < 0 ? Math.pow(Math.max(0, c), 2.5) : 0.8 + 0.2 * c
}

/** パンで倒すと投影が縮む（伸びがなくなる）・先がやや太く見える。 */
export function airGeometry(
  w0: number,
  w1: number,
  len: number,
  pan: number
): { w0: number; w1: number; len: number } {
  const c = Math.abs(Math.cos((pan * Math.PI) / 2))
  return { w0, w1: w1 * (1 + 0.4 * (1 - c)), len: Math.max(len * 0.1, len * c) }
}

/** 暗部トー: 低ゲージでは写真が「露出が足りない」ように暗部から沈む。光マップの
 *  乗算をこの量だけ二度掛けする（カメラのS字の近似）。 */
export const darkTone = (I: number): number => Math.max(0, (0.5 - I) / 0.5) * 0.85

// 卓モードの可動域は広く（のむさん 2026-06-11「配置は仕込み・卓では自由に動けた方がいい」）。
// ±180°まで開放（のむさん確定 2026-06-13）: 灯体を上に置きTILTを振ればトップライト＝上から
// 当たる。新パラメータは作らず、チルトだけで「下から/横から/上から」を全部まかなう。
const TILT_MAX = Math.PI // チルト振り幅 ±180°（面内・真上から真下まで一周）
export const beamTiltRad = (tilt: number): number => tilt * TILT_MAX
/** 卓のZoom: -1..1 → 置いた広がりの 0.15〜4.0 倍（128=置いた姿のまま）。上げ側を×4.0へ拡張
 *  （のむさん確定 2026-06-13・DMX255で扇が4倍開く・ホーム128は不変）。 */
export const beamZoomScale = (zoom: number): number =>
  zoom < 0 ? 1 + zoom * 0.85 : 1 + zoom * 3.0

function trapLocal(
  ctx: CanvasRenderingContext2D,
  w0: number,
  w1: number,
  len: number,
  wf: number
): void {
  const e = (w0 * wf) / 2
  const t = (w1 * wf) / 2
  ctx.beginPath()
  ctx.moveTo(-e, 0)
  ctx.lineTo(e, 0)
  ctx.lineTo(t, -len)
  ctx.lineTo(-t, -len)
  ctx.closePath()
}

/** ビーム本体（ローカル座標: 出口=(0,0)・-Y向き）。横=12枚の台形の連続的な重なり
 *  （中心軸ほど厚く・縁へ滑らかに）。各層は「届く長さ」を変える: 外側の層ほど早く尽き、
 *  中心の層だけ最後まで届く → 先端が横棒でなく丸い舌になり、両脇から先に暗くなる
 *  （終わり際の丸み・のむさん指摘 2026-06-13）。各層は自分の長さ内で逆二乗ガンマ減衰
 *  （28点グラデ・折れ線なし）するので段差は出ない。 */
function drawBeamCoreLocal(
  ctx: CanvasRenderingContext2D,
  w0: number,
  w1: number,
  len: number,
  col: RGB,
  ampl: number
): void {
  // 'screen' (≈ linear-light mixing): overlapping beams approach the brightness
  // ceiling smoothly instead of slamming into clip — red+green meets as a clean
  // yellow and same-colour overlaps brighten naturally (照明屋さん判定 2026-06-11)
  ctx.globalCompositeOperation = 'screen'
  const NL = 12
  for (let k = 0; k < NL; k++) {
    const u = k / (NL - 1)
    const wf = 1 - u * 0.62 // 横: 外1.0 → 中心0.38
    const lf = 0.7 + 0.3 * Math.pow(u, 1.4) // 縦: 外側0.70 → 中心1.00
    const L = len * lf // この層の届く長さ
    const tipW = w0 + (w1 - w0) * lf // 同じ円錐の距離Lでの太さ（先細りを保つ）
    const gr = ctx.createLinearGradient(0, 0, 0, -L)
    for (let s = 0; s <= 28; s++) {
      const t = s / 28
      const v = Math.pow(Math.pow(1 - t, 2), 1 / 2.2)
      gr.addColorStop(t, rgba(col, v))
    }
    ctx.fillStyle = gr
    ctx.globalAlpha = ampl / NL
    trapLocal(ctx, w0, tipW, L, wf)
    ctx.fill()
  }
  ctx.globalAlpha = 1
}

/** 看板を照らすビームを光マップへ（screen合算＝リニア混色前提・照明屋さん判定）。hue/I は卓のRGB由来、
 *  pose は beam6 の Pan/Tilt/Zoom（3ch なら常にセンター）。 */
export function drawWallBeamInto(
  ctx: CanvasRenderingContext2D,
  shape: Shape,
  hue: RGB,
  I: number,
  pose: BeamPose
): void {
  const p = shape.points[0]
  if (!p || I <= 0.004) return
  const g = wallGain(pose.pan)
  if (g <= 0.004) return
  const base = beamDimColor(hue, I)
  const col: RGB = [base[0] * g, base[1] * g, base[2] * g]
  const w0 = uplightW0(shape)
  const w1 = uplightW1(shape) * beamZoomScale(pose.zoom)
  const len = uplightLen(shape)
  const drive = I > 0.55 ? (I - 0.55) / 0.45 : 0
  ctx.save()
  ctx.translate(p.x, p.y)
  ctx.rotate(beamTiltRad(pose.tilt))
  drawBeamCoreLocal(ctx, w0, w1, len, col, 2.0 * (1 + 0.55 * drive))
  if (drive > 0) {
    // 根元の「強い」帯 — 同色のまま濃く（白は混ぜない）
    ctx.globalCompositeOperation = 'screen'
    const hL = len * 0.2
    const gr2 = ctx.createLinearGradient(0, 0, 0, -hL)
    gr2.addColorStop(0, rgba(col, 0.6 * drive))
    gr2.addColorStop(1, rgba(col, 0))
    ctx.fillStyle = gr2
    trapLocal(ctx, w0, w1 * (hL / len) + w0 * (1 - hL / len), hL, 0.9)
    ctx.fill()
  }
  ctx.restore()
}

/** 空中の光の水（スモークの中でだけ見える側）。パンで縮む・隠れる。 */
export function drawAirBeamInto(
  ctx: CanvasRenderingContext2D,
  shape: Shape,
  hue: RGB,
  I: number,
  pose: BeamPose
): void {
  const p = shape.points[0]
  if (!p || I <= 0.004) return
  const g = airGain(pose.pan)
  if (g <= 0.004) return
  const base = beamDimColor(hue, I)
  const col: RGB = [base[0] * g, base[1] * g, base[2] * g]
  const geo = airGeometry(
    uplightW0(shape),
    uplightW1(shape) * beamZoomScale(pose.zoom),
    uplightLen(shape),
    pose.pan
  )
  ctx.save()
  ctx.translate(p.x, p.y)
  ctx.rotate(beamTiltRad(pose.tilt))
  drawBeamCoreLocal(ctx, geo.w0, geo.w1, geo.len, col, 2.0)
  ctx.restore()
}

/** 編集室の仕込み図: 灯体の筐体マーク＋ビーム輪郭の点線（出力には一切出ない）。 */
export function drawUplightSchematic(
  ctx: CanvasRenderingContext2D,
  shape: Shape,
  stroke: string,
  fill: string,
  boost = 1
): void {
  const p = shape.points[0]
  if (!p) return
  const w0 = uplightW0(shape)
  const w1 = uplightW1(shape)
  const len = uplightLen(shape)
  ctx.save()
  ctx.lineWidth = Math.max(1, boost) * 0.6
  ctx.strokeStyle = stroke
  ctx.fillStyle = fill
  const hw = Math.max(6, w0 * 0.6)
  ctx.fillRect(p.x - hw, p.y - hw * 0.55, hw * 2, hw * 1.1)
  ctx.strokeRect(p.x - hw, p.y - hw * 0.55, hw * 2, hw * 1.1)
  ctx.setLineDash([4, 4])
  ctx.beginPath()
  ctx.moveTo(p.x - w0 / 2, p.y)
  ctx.lineTo(p.x - w1 / 2, p.y - len)
  ctx.moveTo(p.x + w0 / 2, p.y)
  ctx.lineTo(p.x + w1 / 2, p.y - len)
  ctx.stroke()
  ctx.setLineDash([])
  ctx.fillStyle = stroke
  ctx.fillRect(p.x - 0.5, p.y - 0.5, 1, 1)
  ctx.restore()
}

/* ============================== 写真素材 ============================== */

export interface ImageBox {
  x: number
  y: number
  w: number
  h: number
}

export function imageBox(shape: Pick<Shape, 'points'>): ImageBox {
  const a = shape.points[0] ?? { x: 0, y: 0 }
  const b = shape.points[shape.points.length - 1] ?? a
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.max(1, Math.abs(b.x - a.x)),
    h: Math.max(1, Math.abs(b.y - a.y))
  }
}

interface AlbedoEntry {
  el: HTMLImageElement
  albedo: HTMLCanvasElement | null
}

const albedoCache = new Map<string, AlbedoEntry>()

/** 写真のアルベド版（最大反射率85%に正規化＝乗算で「自家発光」して見える事故の
 *  防止）。dataURL から非同期ロード — 仕上がるまで null。ロード完了時には
 *  'decor:image-loaded' を window に投げる（編集室の再描画フック）。 */
export function imageAlbedo(shape: Pick<Shape, 'id' | 'imageData'>): HTMLCanvasElement | null {
  const data = shape.imageData
  if (!data) return null
  const key = `${shape.id}:${data.length}`
  let e = albedoCache.get(key)
  if (!e) {
    const el = new Image()
    e = { el, albedo: null }
    albedoCache.set(key, e)
    el.onload = () => {
      const a = document.createElement('canvas')
      a.width = el.naturalWidth
      a.height = el.naturalHeight
      const c = a.getContext('2d')
      if (c) {
        c.drawImage(el, 0, 0)
        c.globalCompositeOperation = 'multiply'
        c.fillStyle = 'rgb(217,217,217)'
        c.fillRect(0, 0, a.width, a.height)
        c.globalCompositeOperation = 'destination-in'
        c.drawImage(el, 0, 0)
        e!.albedo = a
      }
      if (typeof window !== 'undefined') window.dispatchEvent(new Event('decor:image-loaded'))
    }
    el.src = data
    if (albedoCache.size > 40) {
      const first = albedoCache.keys().next().value
      if (first && first !== key) albedoCache.delete(first)
    }
  }
  return e.albedo
}

/** 編集室の写真表示: 半透明の実画像＋点線枠＋中心点。写真は「素材」なので
 *  編集室では薄く見せ、本番の見え方（光が当たった所だけ）と区別する。 */
export function drawImageSchematic(
  ctx: CanvasRenderingContext2D,
  shape: Shape,
  stroke: string,
  boost = 1
): void {
  const b = imageBox(shape)
  const img = imageAlbedo(shape)
  ctx.save()
  if (img) {
    ctx.globalAlpha = 0.45
    ctx.drawImage(img, b.x, b.y, b.w, b.h)
    ctx.globalAlpha = 1
  }
  ctx.strokeStyle = stroke
  ctx.lineWidth = Math.max(1, boost) * 0.6
  ctx.setLineDash([5, 4])
  ctx.strokeRect(b.x, b.y, b.w, b.h)
  ctx.setLineDash([])
  ctx.fillStyle = stroke
  ctx.fillRect(b.x + b.w / 2 - 0.5, b.y + b.h / 2 - 0.5, 1, 1)
  ctx.restore()
}
