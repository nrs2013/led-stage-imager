import { describe, it, expect } from 'vitest'
import { renumberOrder } from './engine'

describe('renumberOrder（番号を中央下→左右の外へ振り直す）', () => {
  it('一段：中央が1、同距離は右が先で左右交互に外へ', () => {
    // x: -2,-1,0,1,2（同じ段）。中央=index2
    const pts = [
      { x: -2, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 }
    ]
    // 期待(old index)：中央2 → 右1個3 → 左1個1 → 右2個4 → 左2個0
    expect(renumberOrder(pts, 100)).toEqual([2, 3, 1, 4, 0])
  })

  it('下の段が先、その中で中央下→外側', () => {
    const pts = [
      { x: -1, y: 0 }, // 0 上段
      { x: 0, y: 0 }, // 1 上段
      { x: 1, y: 0 }, // 2 上段
      { x: -1, y: 100 }, // 3 下段(yが大=下)
      { x: 0, y: 100 }, // 4 下段
      { x: 1, y: 100 } // 5 下段
    ]
    // 下段(中央4,右5,左3) → 上段(中央1,右2,左0)
    expect(renumberOrder(pts, 200)).toEqual([4, 5, 3, 1, 2, 0])
  })

  it('perm は全 index をちょうど1回ずつ含む（保存データの並べ替えが安全）', () => {
    const pts = Array.from({ length: 11 }, (_, i) => ({ x: (i % 4) * 10, y: Math.floor(i / 4) * 100 }))
    const perm = renumberOrder(pts)
    expect([...perm].sort((a, b) => a - b)).toEqual(pts.map((_, i) => i))
  })

  it('灯体0/1個はそのまま（落ちない）', () => {
    expect(renumberOrder([])).toEqual([])
    expect(renumberOrder([{ x: 5, y: 5 }])).toEqual([0])
  })
})
