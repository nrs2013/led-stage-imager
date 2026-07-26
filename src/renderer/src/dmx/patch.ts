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
  const reps = (fx: Fixture): number => Math.max(1, Math.round(repsOf?.(fx) ?? 1))
  for (let i = 0; i < fixtures.length; i++) {
    for (let j = i + 1; j < fixtures.length; j++) {
      const a = fixtures[i],
        b = fixtures[j]
      const ra = reps(a),
        rb = reps(b)
      // 同じ番地・同じモード・同じ個数＝わざと一斉点灯にしている形なので警告しない
      if (a.universe === b.universe && a.start === b.start && a.mode === b.mode && ra === rb) continue
      const [as, ae] = usedSpan(a, ra),
        [bs, be] = usedSpan(b, rb)
      if (as <= be && bs <= ae) out.push([a.id, b.id])
    }
  }
  return out
}
