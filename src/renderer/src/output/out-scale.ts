import type { Chart } from '../model/types'

/** 選べる縮小率（整数分の1だけ）。1=原寸。 */
export const OUTPUT_PRESETS = [75, 50, 25] as const

/** チャートの設定から、送出の縮小率を取り出す（未設定・変な値=原寸）。 */
export function outDivOf(chart: Chart): number {
  const d = chart.settings.outDiv
  if (typeof d !== 'number' || !Number.isFinite(d)) return 1
  const n = Math.round(d)
  return n >= 1 && n <= 8 ? n : 1
}

const safeDimension = (value: unknown, fallback: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) return fallback
  return Math.max(1, Math.round(value))
}

/** 現在の送出サイズ。新形式を優先し、旧 outDiv もそのまま読める。 */
export function outputSizeOf(chart: Chart): { w: number; h: number } {
  const saved = chart.settings.outputSize
  if (saved && typeof saved === 'object') {
    return {
      w: safeDimension(saved.w, chart.canvas.w),
      h: safeDimension(saved.h, chart.canvas.h)
    }
  }
  return sendSize(chart.canvas.w, chart.canvas.h, outDivOf(chart))
}

/** チャート原寸に対するプリセットの送出サイズ。 */
export function percentSize(w: number, h: number, percent: number): { w: number; h: number } {
  const scale = Math.max(0.01, percent / 100)
  return {
    w: Math.max(1, Math.round(w * scale)),
    h: Math.max(1, Math.round(h * scale))
  }
}

/** 送出サイズ＝キャンバスを整数分の1にしたもの。div<=1 は原寸そのまま。
 *  🔴 整数割りしか許さない理由: LED は 1px が実際の球に対応するので、半端な倍率だと
 *  間引かれる列とされない列ができて縦ラインがガタつく。1/2・1/3 なら等間隔で残る。 */
export function sendSize(w: number, h: number, div: number): { w: number; h: number } {
  if (!(div > 1)) return { w, h }
  return { w: Math.max(1, Math.floor(w / div)), h: Math.max(1, Math.floor(h / div)) }
}

/** その縮小率で「きれいに割り切れる」か（割り切れないと端の1列が半端になる）。 */
export function dividesEvenly(w: number, h: number, div: number): boolean {
  return div <= 1 || (w % div === 0 && h % div === 0)
}
