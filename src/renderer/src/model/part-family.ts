import type { PartFamily, Shape, ShapeType } from './types'

/** パレット/キャンバスの表示フィルタ。'all' は完全 no-op（既定挙動を1bitも変えない）。 */
export type PaletteFilter = 'all' | PartFamily

/** ステージ照明（光を放つ灯体）として扱う ShapeType。これ以外は全て電飾/装飾(decor)。
 *  「迷ったら decor」＝古いデータが照明扱いでフィルタから消える事故を防ぐ大原則。
 *  どの既存部品を照明に入れるかは のむさん確認事項（初期案：照らし/PAR/PAT/PixelPAT/8灯ミニブル）。 */
const LIGHT_TYPES: ReadonlySet<ShapeType> = new Set<ShapeType>([
  'uplight',
  'movinghead',
  'parlight',
  'patt',
  'pixelpatt',
  'blinder'
])

/** ShapeType から既定の種別を決める唯一の関数（part===ShapeType なので棚もこれで分ける）。 */
export function familyOfType(type: ShapeType): PartFamily {
  return LIGHT_TYPES.has(type) ? 'light' : 'decor'
}

/** 表示フィルタの判定。family 欠損時も type から補完して安全側に倒す。 */
export function visibleByFilter(
  shape: Pick<Shape, 'family' | 'type'>,
  filter: PaletteFilter
): boolean {
  if (filter === 'all') return true
  return (shape.family ?? familyOfType(shape.type)) === filter
}
