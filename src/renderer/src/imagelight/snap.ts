/* 灯体配置のスナップ（吸着）計算 — PowerPoint/Figma 風。
 * canvas に依存しない純粋関数なので単体テストできる（snap.test.ts）。
 *   alignSnap  … 他の灯体と縦/横が揃うと吸着（整列）
 *   equalSnapX … 間隔が等しくなると吸着（等間隔・横方向・単体ドラッグ用）
 */

export interface Pt {
  x: number
  y: number
}

export interface AlignResult {
  dx: number // 群へ加える補正
  dy: number
  vx: number[] // 縦の整列ガイド線（x座標）
  hy: number[] // 横の整列ガイド線（y座標）
}

/** 整列スナップ: 群の各点を他の灯体の x / y に吸着（各方向いちばん近い1本だけ）。 */
export function alignSnap(pts: Pt[], others: Pt[], snap: number): AlignResult {
  let bestDx = 0
  let bestAbsDx = snap + 1
  let lineX = NaN
  let bestDy = 0
  let bestAbsDy = snap + 1
  let lineY = NaN
  for (const p of pts) {
    for (const o of others) {
      const ddx = o.x - p.x
      const adx = Math.abs(ddx)
      if (adx < bestAbsDx) {
        bestAbsDx = adx
        bestDx = ddx
        lineX = o.x
      }
      const ddy = o.y - p.y
      const ady = Math.abs(ddy)
      if (ady < bestAbsDy) {
        bestAbsDy = ady
        bestDy = ddy
        lineY = o.y
      }
    }
  }
  const r: AlignResult = { dx: 0, dy: 0, vx: [], hy: [] }
  if (bestAbsDx <= snap) {
    r.dx = bestDx
    r.vx = [lineX]
  }
  if (bestAbsDy <= snap) {
    r.dy = bestDy
    r.hy = [lineY]
  }
  return r
}

export interface EqualResult {
  x: number // 吸着後の x
  marks: Array<[number, number]> // 等しい2区間 [x0,x1]
}

/** 等間隔スナップ（横方向・単体ドラッグ用）: 他の2灯体に対し3つが等間隔になる x へ吸着。 */
export function equalSnapX(px: number, others: Pt[], snap: number): EqualResult | null {
  const xs = Array.from(new Set(others.map((o) => o.x))).sort((a, b) => a - b)
  if (xs.length < 2) return null
  let best: EqualResult | null = null
  const consider = (cx: number, marks: Array<[number, number]>): void => {
    const d = Math.abs(cx - px)
    if (d <= snap && (best === null || d < Math.abs(best.x - px))) best = { x: cx, marks }
  }
  for (let i = 0; i + 1 < xs.length; i++) {
    const a = xs[i]
    const b = xs[i + 1]
    const g = b - a
    if (g <= 0) continue
    consider(b + g, [
      [a, b],
      [b, b + g]
    ]) // 右に並べて等間隔
    consider(a - g, [
      [a - g, a],
      [a, b]
    ]) // 左に並べて等間隔
    const mid = (a + b) / 2
    consider(mid, [
      [a, mid],
      [mid, b]
    ]) // 真ん中に入って等間隔
  }
  return best
}
