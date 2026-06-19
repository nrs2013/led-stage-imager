import type { Fixture } from '../model/types'
import { fixtureColor, type RGB } from './channel-math'

const ZEROS = new Uint8Array(512)

/** Resolves a fixture's display colour: a manual override (test faders) takes precedence
 *  over the live Art-Net value. */
export function resolveColor(
  fx: Fixture,
  dmxByUniverse: Record<number, Uint8Array>,
  gamma: boolean,
  manual: Record<string, RGB> | null
): RGB {
  const m = manual?.[fx.id]
  if (m) return m
  return fixtureColor(fx, dmxByUniverse[fx.universe] ?? ZEROS, gamma)
}

/** 信号断の既定タイムアウト（ms）。最後にArt-Netを受けてからこれを超えたら「信号が切れた」とみなす。 */
export const SIGNAL_TIMEOUT_MS = 2000

/** On Signal Loss の実装。holdOnTimeout=false のとき、最後の受信から timeoutMs を超えた
 *  ユニバースを ZEROS（黒）に落とした「実効DMX」を返す。true(=Hold Last)なら最後の値を保持。
 *  毎フレーム呼ばれる前提なので、変化が無ければ元の参照をそのまま返す（無駄な再生成を避ける）。 */
export function effectiveDmxByUniverse(
  dmxByUniverse: Record<number, Uint8Array>,
  lastSeenByUniverse: Record<number, number>,
  holdOnTimeout: boolean,
  now: number,
  timeoutMs: number = SIGNAL_TIMEOUT_MS
): Record<number, Uint8Array> {
  if (holdOnTimeout) return dmxByUniverse // Hold Last: 最後の絵をそのまま保持
  let changed = false
  const out: Record<number, Uint8Array> = {}
  for (const k of Object.keys(dmxByUniverse)) {
    const u = Number(k)
    if (now - (lastSeenByUniverse[u] ?? 0) > timeoutMs) {
      out[u] = ZEROS // 信号断 → 黒に落とす
      changed = true
    } else {
      out[u] = dmxByUniverse[u]
    }
  }
  return changed ? out : dmxByUniverse
}
