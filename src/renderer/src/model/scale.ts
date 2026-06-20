import type { Chart, Shape } from './types'

// 実寸スケール（のむさん 2026-06-14, §7-4）。
// canvas のピクセル数は出力解像度そのもの（mm にすると数千万画素＝OOM）。なので canvas は
// 据え置きにして、チャートに「ステージ実寸 横◯m」＝ settings.stageWidthMm を持たせる＝校正。
// 背景(underlay)は canvas.w px いっぱいに引き伸ばして描かれるので、その px が stageWidthMm を
// 表す → 1px = stageWidthMm / canvas.w (mm)。部品はドロップ時に実寸mm→px へ変換して置く。

// 新規チャートの既定ステージ実寸 横幅（mm）。これを焼き込むことで「未校正＝部品が
// やたら大きい(mm=px)」を解消する。値は 2026-06-14 の実機検証（本物チャート 横40m で
// パッド70cm がΦ67px＝チャート幅の約1.75%）でOKとなった見え方を再現。
// 部品の見かけの大きさ＝700mm÷stageWidthMm（=チャート幅比）なので、canvas解像度に
// 関係なくこの比で入る。公演ごとに Setup の「ステージ実寸 横(m)」で変えられる（のむさん 2026-06-20）。
export const DEFAULT_STAGE_WIDTH_MM = 40000

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

// 実寸サイズが定義された「照明モチーフ」＝§5でmm化した灯体（diameter基準）。
// 手描き系（neon/festoon/stars/line/freehand/image）は実寸が未定義なので対象外。
const SIZED_FIXTURES = new Set<Shape['type']>([
  'parlight',
  'blinder',
  'patt',
  'pixelpatt',
  'bulb',
  'roomlamp',
  'streetlamp',
  'chandelier'
])

/** 「既にある部品を実寸に合わせる」対象の数（校正済みのとき Setup のボタンに出す）。 */
export function countFittableFixtures(shapes: Shape[]): number {
  return shapes.filter(
    (s) => SIZED_FIXTURES.has(s.type) || s.type === 'uplight' || s.type === 'movinghead'
  ).length
}

/** 校正前に置いた灯体（生px＝1px:1mm前提で置かれた）の大きさを、今の実寸スケールへ直す。
 *  各灯体の現在の px を「実寸mm」とみなして newPx = px / mmPerPx に。位置(points)は不変＝
 *  チャート上の置き場所は保ったままサイズだけ実物大に。手描き系は触らない。
 *  ⌘Zで戻せる前提（store側でbeginHistory）。mmPerPxが不正なら無変更。 */
export function rescaleFixturesToScale(shapes: Shape[], mmPerPxVal: number): Shape[] {
  if (!(mmPerPxVal > 0)) return shapes
  return shapes.map((s) => {
    if (SIZED_FIXTURES.has(s.type) && s.diameter != null) {
      return { ...s, diameter: s.diameter / mmPerPxVal }
    }
    if (s.type === 'uplight' || s.type === 'movinghead') {
      const o = { ...s }
      if (s.beamW0 != null) o.beamW0 = s.beamW0 / mmPerPxVal
      if (s.beamW1 != null) o.beamW1 = s.beamW1 / mmPerPxVal
      if (s.beamLen != null) o.beamLen = s.beamLen / mmPerPxVal
      return o
    }
    return s
  })
}
