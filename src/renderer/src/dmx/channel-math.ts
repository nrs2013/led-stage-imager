import type { Fixture, ChannelMode } from '../model/types'

export type RGB = [number, number, number]

export function channelCount(mode: ChannelMode): number {
  switch (mode) {
    case 'rgb':
      return 3
    case 'rgbdim':
      return 4
    case 'dim':
      return 1
    case 'rgbw':
      return 5
    case 'rgbw4':
      return 4
    case 'beam6':
      return 6
    case 'beam8':
      return 8
    case 'beam9':
      return 9
  }
}

const clamp = (n: number): number => (n < 0 ? 0 : n > 255 ? 255 : Math.round(n))
const gammaCorrect = (v: number): number => clamp(255 * Math.pow(v / 255, 2.2))

export function fixtureColor(fx: Fixture, data: Uint8Array, gamma: boolean): RGB {
  const i = fx.start - 1 // 1-based DMX address -> 0-based index
  let rgb: RGB
  switch (fx.mode) {
    case 'rgb':
      rgb = [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0]
      break
    case 'rgbdim': {
      const d = (data[i + 3] ?? 0) / 255
      rgb = [
        clamp((data[i] ?? 0) * d),
        clamp((data[i + 1] ?? 0) * d),
        clamp((data[i + 2] ?? 0) * d)
      ]
      break
    }
    case 'dim': {
      const d = (data[i] ?? 0) / 255
      const c = fx.fixedColor ?? [255, 255, 255]
      rgb = [clamp(c[0] * d), clamp(c[1] * d), clamp(c[2] * d)]
      break
    }
    case 'rgbw4': {
      // 標準の4ch RGBW（R,G,B,W・調光chなし）。W は白として全色に足す。
      // 現場の照明チームのリクエスト(2026-07-07)＝卓の汎用RGBWフィクスチャと同じ並び。
      const w = data[i + 3] ?? 0
      rgb = [
        clamp((data[i] ?? 0) + w),
        clamp((data[i + 1] ?? 0) + w),
        clamp((data[i + 2] ?? 0) + w)
      ]
      break
    }
    case 'rgbw': {
      const w = data[i + 3] ?? 0
      const d = (data[i + 4] ?? 0) / 255
      rgb = [
        clamp(((data[i] ?? 0) + w) * d),
        clamp(((data[i + 1] ?? 0) + w) * d),
        clamp(((data[i + 2] ?? 0) + w) * d)
      ]
      break
    }
    case 'beam6':
      // R,G,B,Pan,Tilt,Zoom — the first 3 are plain colour+gauge, like 'rgb'
      rgb = [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0]
      break
    case 'beam8': {
      // Pan,Tilt,Dimmer,Shutter,R,G,B,Zoom — 色は Dimmer(+2)×RGB(+4..+6)。卓でDimmerを上げると光る。
      // Shutter(+3) は色に混ぜない（点滅は OutputRenderer 側でゲート）。
      const d = (data[i + 2] ?? 0) / 255
      rgb = [
        clamp((data[i + 4] ?? 0) * d),
        clamp((data[i + 5] ?? 0) * d),
        clamp((data[i + 6] ?? 0) * d)
      ]
      break
    }
    case 'beam9': {
      // beam8 に White を1ch足した9ch: Pan,Tilt,Dimmer,Shutter,R,G,B,W,Zoom。
      // 「今まで通りの概念のままWを一丁追加」（現場の照明チーム 2026-07-07）。
      // 色は Dimmer(+2)×(RGB(+4..+6) + W(+7))。W は白として全色に加算。
      const d = (data[i + 2] ?? 0) / 255
      const w = data[i + 7] ?? 0
      rgb = [
        clamp(((data[i + 4] ?? 0) + w) * d),
        clamp(((data[i + 5] ?? 0) + w) * d),
        clamp(((data[i + 6] ?? 0) + w) * d)
      ]
      break
    }
  }
  return gamma ? [gammaCorrect(rgb[0]), gammaCorrect(rgb[1]), gammaCorrect(rgb[2])] : rgb
}

export interface BeamPose {
  /** -1..1 — out-of-plane swing: −=behind the panel (cut hard), +=towards the house */
  pan: number
  /** -1..1 — in-plane swing around the standing pose */
  tilt: number
  /** -1..1 — beam spread around the rigged width (0 = as placed) */
  zoom: number
}

/** ビーム灯体の卓ポーズ。DMX 128 = 中心 = のむさんが置いた姿。卓はその周りを振る
 *  （GDTFのdefault 128 で grandMA3 もそこにホーム）。番地割当はモードで異なる：
 *  beam6 = R,G,B,Pan(i+3),Tilt(i+4),Zoom(i+5) ／ beam8 = Pan(i+0),Tilt(i+1),...,Zoom(i+7)。
 *  ビーム以外の灯体は中心姿勢を返す。 */
export function beamPose(fx: Fixture, data: Uint8Array): BeamPose {
  const i = fx.start - 1
  const n = (v: number | undefined): number => (((v ?? 128) - 128) / 127) || 0
  if (fx.mode === 'beam6') return { pan: n(data[i + 3]), tilt: n(data[i + 4]), zoom: n(data[i + 5]) }
  if (fx.mode === 'beam8') return { pan: n(data[i]), tilt: n(data[i + 1]), zoom: n(data[i + 7]) }
  if (fx.mode === 'beam9') return { pan: n(data[i]), tilt: n(data[i + 1]), zoom: n(data[i + 8]) }
  return { pan: 0, tilt: 0, zoom: 0 }
}

/** Shutter ゲート（beam8 の +3ch）。0=消灯→0、それ以外=点灯→1。色には混ぜず描画強度を断つ用。
 *  ストロボ(高域での点滅)は将来の時間制御。今は「0=消灯／それ以外=点灯」の二値。 */
export function shutterGate(fx: Fixture, data: Uint8Array): number {
  if (fx.mode !== 'beam8' && fx.mode !== 'beam9') return 1
  return (data[fx.start - 1 + 3] ?? 0) === 0 ? 0 : 1
}
