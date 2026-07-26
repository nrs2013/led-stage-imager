import type { Fixture } from '../model/types'
import { channelCount } from './channel-math'
import { addressAt } from './address'

export function channelRange(fx: Fixture): [number, number] {
  return [fx.start, fx.start + channelCount(fx.mode) - 1]
}

/** 連続複製ぶんを含めた「本当に使う範囲」を 0 始まりの通し番号で返す。
 *  ネオン6文字×3ch は 1.001 だけでなく 1.001〜1.018 を使うので、reps を渡さないと
 *  重なりを見逃す（本番で卓の1本のフェーダーが別の電飾も動かす）。 */
function usedSpan(fx: Fixture, reps: number): [number, number] {
  const ch = channelCount(fx.mode)
  const first = fx.universe * 512 + (fx.start - 1)
  const last = addressAt(fx.universe, fx.start, fx.mode, fx.addressStep, Math.max(0, reps - 1))
  const lastAbs = last.universe * 512 + (last.start - 1) + ch - 1
  return [Math.min(first, lastAbs), Math.max(first + ch - 1, lastAbs)]
}

/** Returns pairs of fixture ids that partially overlap (a warning). Identical
 *  start+mode in the same universe is allowed (intentional 一斉点灯).
 *  repsOf: 図形1個あたりの個体数（ネオンの文字数・連続複製の個数など）。省略時は1個扱い。 */
export function detectOverlaps(
  fixtures: Fixture[],
  repsOf?: (fx: Fixture) => number
): Array<[string, string]> {
  const out: Array<[string, string]> = []
  // 🔴 範囲は「1灯につき1回」だけ計算する。総当たりの中で計算すると図形数の2乗ぶん
  //    アドレス計算が走り、ドラッグ中（毎フレーム再計算）に画面がもたつく。
  const n = fixtures.length
  const spans: [number, number][] = new Array(n)
  const rp: number[] = new Array(n)
  for (let i = 0; i < n; i++) {
    rp[i] = Math.max(1, Math.round(repsOf?.(fixtures[i]) ?? 1))
    spans[i] = usedSpan(fixtures[i], rp[i])
  }
  for (let i = 0; i < n; i++) {
    const a = fixtures[i]
    const [as, ae] = spans[i]
    for (let j = i + 1; j < n; j++) {
      const b = fixtures[j]
      const [bs, be] = spans[j]
      if (as > be || bs > ae) continue // 重なっていない（先に弾く＝比較だけで済む）
      // 同じ番地・同じモード・同じ個数＝わざと一斉点灯にしている形なので警告しない
      if (a.universe === b.universe && a.start === b.start && a.mode === b.mode && rp[i] === rp[j])
        continue
      out.push([a.id, b.id])
    }
  }
  return out
}
