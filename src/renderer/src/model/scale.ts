import type { Chart } from './types'

// 実寸スケール（のむさん 2026-06-14, §7-4）。
// canvas のピクセル数は出力解像度そのもの（mm にすると数千万画素＝OOM）。なので canvas は
// 据え置きにして、チャートに「ステージ実寸 横◯m」＝ settings.stageWidthMm を持たせる＝校正。
// 背景(underlay)は canvas.w px いっぱいに引き伸ばして描かれるので、その px が stageWidthMm を
// 表す → 1px = stageWidthMm / canvas.w (mm)。部品はドロップ時に実寸mm→px へ変換して置く。

/** 1canvas px あたりの実寸 mm。未校正（stageWidthMm 無し／不正）なら null。 */
export function mmPerPx(chart: Chart): number | null {
  const mm = chart.settings.stageWidthMm
  const w = chart.canvas.w
  if (!mm || mm <= 0 || w <= 0) return null
  return mm / w
}

/** 実寸 mm を canvas px へ。未校正なら mm をそのまま px として返す（＝校正前の従来動作
 *  ＝既存チャートは一切変わらない）。校正済みなら背景の縮尺に合わせて実物大に縮める。 */
export function mmToCanvasPx(chart: Chart, mm: number): number {
  const k = mmPerPx(chart)
  return k ? mm / k : mm
}

/** 表示用：ステージ実寸の横幅（m）。未校正なら null。 */
export function stageWidthMeters(chart: Chart): number | null {
  const mm = chart.settings.stageWidthMm
  return mm && mm > 0 ? mm / 1000 : null
}
