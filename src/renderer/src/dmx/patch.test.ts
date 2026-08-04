import { describe, it, expect } from 'vitest'
import { channelRange, detectOverlaps } from './patch'
import type { Fixture, ChannelMode } from '../model/types'

const fx = (id: string, universe: number, start: number, mode: Fixture['mode']): Fixture => ({
  id,
  shapeId: id,
  universe,
  start,
  mode
})

describe('channelRange', () => {
  it('returns inclusive [start, end] from mode width', () => {
    expect(channelRange(fx('a', 0, 1, 'rgb'))).toEqual([1, 3])
    expect(channelRange(fx('a', 0, 10, 'rgbdim'))).toEqual([10, 13])
  })
})

describe('detectOverlaps', () => {
  it('allows identical start+mode in the same universe (intentional shared)', () => {
    const a = fx('a', 0, 1, 'rgb'),
      b = fx('b', 0, 1, 'rgb')
    expect(detectOverlaps([a, b])).toEqual([])
  })
  it('warns on partial overlap (different start, ranges intersect)', () => {
    const a = fx('a', 0, 1, 'rgb'),
      b = fx('b', 0, 2, 'rgb') // [1..3] vs [2..4]
    expect(detectOverlaps([a, b])).toEqual([['a', 'b']])
  })
  it('does not warn across different universes', () => {
    const a = fx('a', 0, 1, 'rgb'),
      b = fx('b', 1, 1, 'rgb')
    expect(detectOverlaps([a, b])).toEqual([])
  })
})

describe('detectOverlaps（連続複製ぶんも見る）', () => {
  const fx = (
    id: string,
    universe: number,
    start: number,
    mode: ChannelMode = 'rgb',
    addressStep?: number
  ): Fixture => ({ id, shapeId: 's' + id, universe, start, mode, addressStep }) as unknown as Fixture

  it('ネオン6文字(1.001から3chずつ=1.018まで)と 1.010 の電飾は重なる', () => {
    const neon = fx('neon', 0, 1)
    const other = fx('other', 0, 10)
    // 個数を渡さないと見逃す（今までの穴）
    expect(detectOverlaps([neon, other])).toHaveLength(0)
    // 個数を渡せば捕まえる
    const reps = (f: Fixture): number => (f.id === 'neon' ? 6 : 1)
    expect(detectOverlaps([neon, other], reps)).toEqual([['neon', 'other']])
  })

  it('連続複製ぶんの外なら重ならない', () => {
    const neon = fx('neon', 0, 1)
    const other = fx('other', 0, 19) // 1.018 の次
    const reps = (f: Fixture): number => (f.id === 'neon' ? 6 : 1)
    expect(detectOverlaps([neon, other], reps)).toHaveLength(0)
  })

  it('同じ番地・同じモード・同じ個数は「わざと一斉点灯」なので警告しない', () => {
    const a = fx('a', 0, 5)
    const b = fx('b', 0, 5)
    const reps = (): number => 4
    expect(detectOverlaps([a, b], reps)).toHaveLength(0)
  })

  it('同じ番地でも個数が違えば警告する（片方が長く伸びる）', () => {
    const a = fx('a', 0, 5)
    const b = fx('b', 0, 5)
    const reps = (f: Fixture): number => (f.id === 'a' ? 8 : 1)
    expect(detectOverlaps([a, b], reps)).toEqual([['a', 'b']])
  })

  it('ユニバースをまたいで伸びた分も見る（1.500 から 3ch×10 = 2.010 まで）', () => {
    const long = fx('long', 0, 500)
    const next = fx('next', 1, 5)
    const reps = (f: Fixture): number => (f.id === 'long' ? 10 : 1)
    expect(detectOverlaps([long, next], reps)).toEqual([['long', 'next']])
  })
})
