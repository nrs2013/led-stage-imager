import type { ChannelMode, Shape } from '../model/types'
import { channelCount } from './channel-math'
import { neonCharCount } from '../render/neon'

export interface Addr {
  universe: number
  start: number
}

/** grandMA2-style DMX notation: `universe.address` (Art-Net universe, 0-based). */
export const formatDmx = (universe: number, address: number): string => `${universe}.${address}`

/** How many addressed instances a shape expands to: repeat arrays = count,
 *  neon signs = one per non-space character, otherwise 1. */
export function repeatCount(shape: Pick<Shape, 'repeat' | 'type' | 'text'>): number {
  if (shape.type === 'neon') return neonCharCount(shape.text ?? '')
  const c = shape.repeat?.count ?? 1
  return c > 1 ? c : 1
}

/** Address of repeat index i: base universe/start advanced by i*step, rolling over
 *  512 channels into the next universe (so huge arrays keep valid addresses).
 *  An EXPLICIT step of 0 means "no advance": every instance shares the base address
 *  (a whole neon sign on one fader — 一斉点灯). */
export function addressAt(
  universe: number,
  start: number,
  mode: ChannelMode,
  step: number | undefined,
  i: number
): Addr {
  const s = step === undefined || step < 0 ? channelCount(mode) : step
  const zeroBased = start - 1 + i * s // 0-based channel offset across universes
  return {
    universe: universe + Math.floor(zeroBased / 512),
    start: (((zeroBased % 512) + 512) % 512) + 1
  }
}
