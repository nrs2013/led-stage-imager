/* 画像照明モードの色まわり（UI・エンジン共通）。RGB は 0..255 の3要素タプル。 */
export type RGB3 = [number, number, number]

export const WHITE: RGB3 = [255, 255, 255]

/** COLOR 欄の固定8色（のむさん確定の並び）。 */
export const COLORS: { hex: string; rgb: RGB3 }[] = [
  { hex: '#ffa848', rgb: [255, 168, 72] },
  { hex: '#ffffff', rgb: [255, 255, 255] },
  { hex: '#ff3224', rgb: [255, 50, 36] },
  { hex: '#ffe028', rgb: [255, 224, 40] },
  { hex: '#30ff48', rgb: [48, 255, 72] },
  { hex: '#22dcff', rgb: [34, 220, 255] },
  { hex: '#4060ff', rgb: [64, 96, 255] },
  { hex: '#ff32c8', rgb: [255, 50, 200] }
]

export function hexToRgb(h: string): RGB3 {
  const s = h.replace('#', '')
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)]
}

export function rgbToHex(c: RGB3): string {
  return '#' + c.map((v) => ('0' + Math.round(v).toString(16)).slice(-2)).join('')
}

/** HSL(0..360, 0..1, 0..1) → RGB(0..255)。虹・カラーチェイスで使用。 */
export function hsl2rgb(h: number, s: number, l: number): RGB3 {
  h = (((h % 360) + 360) % 360) / 360
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const f = (t: number): number => {
    t = (t + 1) % 1
    return t < 1 / 6
      ? p + (q - p) * 6 * t
      : t < 1 / 2
        ? q
        : t < 2 / 3
          ? p + (q - p) * (2 / 3 - t) * 6
          : p
  }
  return [Math.round(f(h + 1 / 3) * 255), Math.round(f(h) * 255), Math.round(f(h - 1 / 3) * 255)]
}

export const sameRgb = (a: RGB3, b: RGB3): boolean =>
  a[0] === b[0] && a[1] === b[1] && a[2] === b[2]
