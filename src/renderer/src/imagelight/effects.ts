/* エフェクト9種の式（モック「画像照明モード-試打台.html」から移植・正典）。
 * すべて純関数。引数 ms = (now - t0)（エフェクト開始からの経過ミリ秒）。
 * K 系は「明るさの倍率」（0..1超）、color 系は RGB を返す。 */
import { hsl2rgb, type RGB3 } from './colors'

export interface FxParams {
  search: { speed: number; width: number }
  rndsearch: { vari: number }
  chase: { speed: number; soft: number }
  strobe: { speed: number; duty: number }
  rndstrobe: { speed: number; dens: number; flow: number }
  colorchase: { speed: number; blend: number }
  breath: { speed: number; depth: number }
  fire: { speed: number; amount: number }
  wave: { speed: number; length: number }
  bolt: { rate: number; strength: number }
  rainbow: { speed: number; spread: number }
  zoompulse: { speed: number; amount: number }
}

export const defaultFxp = (): FxParams => ({
  search: { speed: 0.3, width: 12 },
  rndsearch: { vari: 60 },
  chase: { speed: 1.0, soft: 70 },
  strobe: { speed: 6, duty: 30 },
  rndstrobe: { speed: 10, dens: 28, flow: 40 },
  colorchase: { speed: 1.5, blend: 0 },
  breath: { speed: 0.22, depth: 80 },
  fire: { speed: 1.0, amount: 60 },
  wave: { speed: 0.35, length: 50 },
  bolt: { rate: 0.5, strength: 90 },
  rainbow: { speed: 0.15, spread: 50 },
  zoompulse: { speed: 0.25, amount: 60 }
})

export interface SearchParams {
  phase: number
  speedK: number
  widthK: number
}

export const frac = (x: number): number => x - Math.floor(x)
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

/** チェイス: 1灯ずつ山が流れる。soft=山のなだらかさ（カチッ↔ふわっ）。 */
export function chaseK(P: FxParams['chase'], ms: number, i: number): number {
  const e = 4 - 3.2 * (P.soft / 100)
  const ph = (ms / 700) * P.speed - i * 0.55
  return Math.pow(Math.max(0, Math.sin(ph)), e)
}

/** ストロボ all: 全灯一斉（速さHz・点灯率%）。 */
export function strobeAllK(P: FxParams['strobe'], ms: number): number {
  return frac((ms / 1000) * P.speed) < P.duty / 100 ? 1 : 0
}

/** ストロボ rnd: 規則的ローリング。全灯が一定リズム(speed Hz・点灯率 dens%)で点滅し、
 *  位相を灯ごとに少しずつずらして順に流れる。flow=ずらし幅（0＝全灯一斉でカチッ＝STROBE相当、
 *  大＝灯ごとに位相がずれて整った連続閃光が流れる）。乱数の不揃いクランプは無し＝素直。
 *  古い保存データに flow が無ければ 40 扱い。 */
export function strobeRndK(P: FxParams['rndstrobe'], ms: number, i: number): number {
  const flow = (P.flow ?? 40) / 100
  // 灯ごとの位相オフセット（最大 0.5 周期/灯）。frac で 0..1 に巻き取り、点灯率で on/off。
  const phase = frac((ms / 1000) * P.speed - i * flow * 0.5)
  return phase < P.dens / 100 ? 1 : 0
}

/** 呼吸: 全灯ゆっくり膨らみ沈む（深さ%まで沈む）。 */
export function breathK(P: FxParams['breath'], ms: number): number {
  const d = P.depth / 100
  return 1 - d + d * (0.5 + 0.5 * Math.sin(2 * Math.PI * P.speed * (ms / 1000)))
}

/** 炎: 各灯が焚き火のように不規則ゆらゆら。 */
export function fireK(P: FxParams['fire'], ms: number, i: number): number {
  const s = (ms / 1000) * 5 * P.speed
  const a = P.amount / 100
  const v =
    0.72 +
    a *
      0.42 *
      (0.55 * Math.sin(s + i * 7.1) +
        0.3 * Math.sin(s * 2.7 + i * 13.3) +
        0.15 * Math.sin(s * 5.1 + i * 3.7))
  return Math.max(0.05, Math.min(1, v))
}

/** 波: 明るさのうねりが端から端へ流れ続ける。 */
export function waveK(P: FxParams['wave'], ms: number, i: number): number {
  const len = P.length / 100
  return (
    0.25 +
    0.75 * (0.5 + 0.5 * Math.sin(2 * Math.PI * P.speed * (ms / 1000) - i * (0.4 + 2.5 * len)))
  )
}

/** 雷: 不規則な間隔でバシャッと光って残光で消える（全灯一斉・1超フラッシュ）。 */
export function boltK(P: FxParams['bolt'], ms: number): number {
  const r = (ms / 1000) * 2 * Math.max(0.1, P.rate)
  const s = Math.floor(r)
  const h = frac(Math.sin(s * 127.1) * 43758.5453)
  return h < 0.22 ? 1 + (P.strength / 100) * Math.exp(-(r - s) * 5) : 1
}

/** 開閉: 扇がゆっくり開いたり絞ったり（zoom倍率に乗る）。 */
export function zoomPulseK(P: FxParams['zoompulse'], ms: number): number {
  return Math.max(0.3, 1 + (P.amount / 100) * 0.9 * Math.sin(2 * Math.PI * P.speed * (ms / 1000)))
}

/** 虹: 色相がぐるぐる回る。spread%で全灯同色↔灯ごとにずれて虹。 */
export function rainbowColor(P: FxParams['rainbow'], ms: number, i: number): RGB3 {
  const hue = (ms / 1000) * P.speed * 360 + i * (P.spread / 100) * 55
  return hsl2rgb(hue, 0.95, 0.6)
}

const mixc = (a: RGB3, b: RGB3, t: number): RGB3 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t
]

/** カラフルチェイス: 8色が灯体を順送り。blend%＝切替の混色（0=パッ／100=じわっ）。 */
export function colorChaseColor(
  P: FxParams['colorchase'],
  palette: RGB3[],
  ms: number,
  i: number
): RGB3 {
  const pos = (ms / 1000) * P.speed
  const step = Math.floor(pos)
  const c1 = palette[(i + step) % palette.length]
  const cf = P.blend / 100
  if (cf <= 0.01) return c1
  const f = pos - step
  if (f < 1 - cf) return c1
  const c2 = palette[(i + step + 1) % palette.length]
  return mixc(c1, c2, (f - (1 - cf)) / cf)
}

/** SEARCH中の実効TILT: 基準tiltを中心に±widthの扇で正弦の揺れ。RANDOMなら各灯の個性で
 *  バラバラに揺れる（vari=ばらつき%）。 */
export function searchTilt(
  baseTilt: number,
  P: FxParams['search'],
  rndP: FxParams['rndsearch'],
  random: boolean,
  sp: SearchParams,
  ms: number
): number {
  let w = P.width
  let spd = P.speed
  let ph = 0
  if (random) {
    const v = rndP.vari / 100
    w *= 1 + (sp.widthK - 1) * v
    spd *= 1 + (sp.speedK - 1) * v
    ph = sp.phase * v
  }
  return baseTilt + w * Math.sin(2 * Math.PI * spd * (ms / 1000) + ph)
}

export { clamp01 }
