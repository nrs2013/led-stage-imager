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
    case 'beam6':
      return 6
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

/** Beam 6ch desk pose. DMX 128 = centre = exactly the pose のむさん placed; the desk
 *  steers around it (a GDTF default of 128 keeps grandMA3 homing there). Non-beam6
 *  fixtures return the centred pose. */
export function beamPose(fx: Fixture, data: Uint8Array): BeamPose {
  if (fx.mode !== 'beam6') return { pan: 0, tilt: 0, zoom: 0 }
  const i = fx.start - 1
  const n = (v: number | undefined): number => (((v ?? 128) - 128) / 127) || 0
  return { pan: n(data[i + 3]), tilt: n(data[i + 4]), zoom: n(data[i + 5]) }
}
