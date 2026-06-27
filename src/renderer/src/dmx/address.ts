import type { ChannelMode, Fixture, Shape } from '../model/types'
import { channelCount } from './channel-math'
import { neonCharCount } from '../render/neon'
import { marqueeBulbCount } from '../render/marquee'
import { festoonCount } from '../render/festoon'

export interface Addr {
  universe: number
  start: number
}

/** grandMA 流の DMX 表記 `universe.address`：universe は 1 始まり・address は 3 桁ゼロ埋め（例 `1.001`）。
 *  内部の universe は Art-Net の 0 始まりなので、表示でだけ +1 する＝**表示専用**（受信/MVR書き出しは 0 始まりのまま）。 */
export const formatDmx = (universe: number, address: number): string =>
  `${universe + 1}.${String(address).padStart(3, '0')}`

/** How many addressed instances a shape expands to: repeat arrays = count,
 *  neon signs = one per non-space character, star fields = 2 (white sky / blue sky),
 *  festoon strings = one per bulb, otherwise 1. */
export function repeatCount(
  shape: Pick<Shape, 'repeat' | 'type' | 'text' | 'points' | 'sagPct' | 'bulbPitch'>
): number {
  if (shape.type === 'neon') return neonCharCount(shape.text ?? '')
  if (shape.type === 'marquee') return marqueeBulbCount({ text: shape.text })
  if (shape.type === 'stars') return 2
  if (shape.type === 'festoon') return festoonCount(shape)
  if (shape.type === 'blinder') return 8
  if (shape.type === 'pixelpatt') return 7
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

/** First free address right AFTER a fixture's whole span — ステップアップモード:
 *  draw, and the next fixture lands here automatically. Rolls over 512 into the
 *  next universe like everything else. */
export function nextAddressAfter(
  fx: Pick<Fixture, 'universe' | 'start' | 'mode' | 'addressStep'>,
  reps: number
): Addr {
  const last = addressAt(fx.universe, fx.start, fx.mode, fx.addressStep, Math.max(0, reps - 1))
  const zero = last.universe * 512 + (last.start - 1) + channelCount(fx.mode)
  return { universe: Math.floor(zero / 512), start: (zero % 512) + 1 }
}
