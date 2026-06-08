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
  }
  return gamma ? [gammaCorrect(rgb[0]), gammaCorrect(rgb[1]), gammaCorrect(rgb[2])] : rgb
}
