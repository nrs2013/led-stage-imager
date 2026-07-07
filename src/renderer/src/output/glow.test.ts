import { describe, it, expect } from 'vitest'
import { resolveGlowPx, groupShapesByGlow } from './glow'
import type { Shape, Chart } from '../model/types'

// グローの効き先の決定はここが唯一の正。全体既定と図形上書きの優先順位を保証する。
const S = (over: Partial<Shape>): Shape =>
  ({ id: 'x', type: 'line', layerId: 'l', family: 'decor', points: [], ...over }) as Shape
const SET = (ledGlowPx?: number): Chart['settings'] =>
  ({ holdOnTimeout: true, gamma: false, glow: false, glowAmount: 14, ledGlowPx }) as Chart['settings']

describe('resolveGlowPx（全体既定と図形上書き）', () => {
  it('未指定＝全体設定に従う・全体も未設定なら0', () => {
    expect(resolveGlowPx(S({}), SET())).toBe(0)
    expect(resolveGlowPx(S({}), SET(3))).toBe(3)
  })
  it('図形の指定が最優先（0=この図形はなし）', () => {
    expect(resolveGlowPx(S({ glowPx: 2 }), SET(10))).toBe(2)
    expect(resolveGlowPx(S({ glowPx: 0 }), SET(10))).toBe(0)
  })
  it('範囲外は安全側に丸める（負・NaN→0、大きすぎ→50）', () => {
    expect(resolveGlowPx(S({ glowPx: -5 }), SET())).toBe(0)
    expect(resolveGlowPx(S({ glowPx: Number.NaN }), SET())).toBe(0)
    expect(resolveGlowPx(S({ glowPx: 999 }), SET())).toBe(50)
  })
})

describe('groupShapesByGlow（半径ごとに1回のblurで済ませる）', () => {
  it('同じ半径はまとまり、0は除外、写真/照射系は対象外', () => {
    const shapes = [
      S({ id: 'a', glowPx: 2 }),
      S({ id: 'b', glowPx: 2 }),
      S({ id: 'c', glowPx: 5 }),
      S({ id: 'd', glowPx: 0 }),
      S({ id: 'e' }), // 全体=0 → 除外
      S({ id: 'f', type: 'image', glowPx: 9 }),
      S({ id: 'g', type: 'uplight', glowPx: 9 }),
      S({ id: 'h', type: 'movinghead', glowPx: 9 })
    ]
    const g = groupShapesByGlow(shapes, SET(0))
    expect([...g.keys()].sort()).toEqual([2, 5])
    expect(g.get(2)!.map((s) => s.id)).toEqual(['a', 'b'])
    expect(g.get(5)!.map((s) => s.id)).toEqual(['c'])
  })
  it('全体設定だけでも効く（上書きなし図形が全体半径のグループに入る）', () => {
    const g = groupShapesByGlow([S({ id: 'a' }), S({ id: 'b', glowPx: 1 })], SET(4))
    expect(g.get(4)!.map((s) => s.id)).toEqual(['a'])
    expect(g.get(1)!.map((s) => s.id)).toEqual(['b'])
  })
})
