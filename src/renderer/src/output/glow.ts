// 電飾のにじみ(グロー)の効き先を決める純関数。出力描画(OutputRenderer)と単体テストで共有。
// 「全体の既定 settings.ledGlowPx ＋ 図形ごとの上書き shape.glowPx」の解決と、
// blur を半径ごとに1回で済ませるためのグルーピングを行う。
import type { Chart, Shape } from '../model/types'

export const GLOW_MAX_PX = 50

/** この図形に効くグロー半径(px)。図形の指定が最優先（0=なし）、無ければ全体設定。 */
export function resolveGlowPx(shape: Shape, settings: Chart['settings']): number {
  const px = shape.glowPx ?? settings.ledGlowPx ?? 0
  if (!Number.isFinite(px)) return 0
  return Math.max(0, Math.min(GLOW_MAX_PX, px))
}

/** グローが効く図形を半径ごとにまとめる（半径の種類数だけ blur を走らせる＝図形ごとに
 *  blur しない。灯体ごとの CPU blur は過去に激重事故を起こした地雷）。
 *  写真(image)と照射系(uplight/movinghead)は光マップ側で表現するため対象外。 */
export function groupShapesByGlow(
  shapes: Shape[],
  settings: Chart['settings']
): Map<number, Shape[]> {
  const groups = new Map<number, Shape[]>()
  for (const s of shapes) {
    if (s.type === 'image' || s.type === 'uplight' || s.type === 'movinghead') continue
    const r = resolveGlowPx(s, settings)
    if (r <= 0) continue
    const g = groups.get(r)
    if (g) g.push(s)
    else groups.set(r, [s])
  }
  return groups
}
