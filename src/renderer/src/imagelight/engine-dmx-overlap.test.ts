import { describe, it, expect } from 'vitest'
import { detectDmxOverlaps } from './engine'

// 占有チャンネルは [start, start+count)（start は 1 始まり）。同 universe で区間が重なれば衝突。
const P = (universe: number, start: number, count: number): { universe: number; start: number; count: number } => ({
  universe,
  start,
  count
})

describe('detectDmxOverlaps（DMX 番地の重なり検出）', () => {
  it('順番に詰めた beam8（1,9,17…）は衝突なし', () => {
    const patches = [P(0, 1, 8), P(0, 9, 8), P(0, 17, 8)]
    expect([...detectDmxOverlaps(patches)].sort((a, b) => a - b)).toEqual([])
  })

  it('重なる 2 灯は両方の index を返す（1–8 と 5–12）', () => {
    const patches = [P(0, 1, 8), P(0, 5, 8)]
    expect([...detectDmxOverlaps(patches)].sort((a, b) => a - b)).toEqual([0, 1])
  })

  it('隣接（1–3 と 4–6）は衝突しない＝半開区間', () => {
    const patches = [P(0, 1, 3), P(0, 4, 3)]
    expect([...detectDmxOverlaps(patches)].sort((a, b) => a - b)).toEqual([])
  })

  it('universe が違えば同じ番地でも衝突しない', () => {
    const patches = [P(0, 1, 8), P(1, 1, 8)]
    expect([...detectDmxOverlaps(patches)].sort((a, b) => a - b)).toEqual([])
  })

  it('未パッチ（null/undefined）は無視する', () => {
    const patches = [null, P(0, 1, 8), undefined, P(0, 4, 3)]
    // index1(1–8) と index3(4–6) が重なる
    expect([...detectDmxOverlaps(patches)].sort((a, b) => a - b)).toEqual([1, 3])
  })

  it('3 灯が同じ番地に重なれば 3 つとも返す', () => {
    const patches = [P(0, 1, 8), P(0, 1, 8), P(0, 1, 8)]
    expect([...detectDmxOverlaps(patches)].sort((a, b) => a - b)).toEqual([0, 1, 2])
  })

  it('モード違い（rgb=3ch を 1 から・beam8 を 3 から）は ch3 で衝突', () => {
    const patches = [P(0, 1, 3), P(0, 3, 8)] // 1–3 と 3–10 → ch3 が重なる
    expect([...detectDmxOverlaps(patches)].sort((a, b) => a - b)).toEqual([0, 1])
  })

  it('空配列・1 要素は衝突なし（落ちない）', () => {
    expect([...detectDmxOverlaps([])]).toEqual([])
    expect([...detectDmxOverlaps([P(0, 1, 8)])]).toEqual([])
  })
})
