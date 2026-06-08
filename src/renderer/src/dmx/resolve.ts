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
