import { describe, it, expect } from 'vitest'
import { renumberOrder } from './engine'

describe('renumberOrder（番号を左下→右・下の段から上へ振り直す）', () => {
  it('一段：左端が1番、右へ順に増える', () => {
    // x: -2,-1,0,1,2（同じ段・index 0..4）。左端(x=-2, index0)から右へ。
    const pts = [
      { x: -2, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 }
    ]
    expect(renumberOrder(pts, 100)).toEqual([0, 1, 2, 3, 4])
  })

  it('下の段が先、その中で左→右', () => {
    const pts = [
      { x: -1, y: 0 }, // 0 上段
      { x: 0, y: 0 }, // 1 上段
      { x: 1, y: 0 }, // 2 上段
      { x: -1, y: 100 }, // 3 下段(yが大=下)
      { x: 0, y: 100 }, // 4 下段
      { x: 1, y: 100 } // 5 下段
    ]
    // 下段を左→右(3,4,5) → 上段を左→右(0,1,2)
    expect(renumberOrder(pts, 200)).toEqual([3, 4, 5, 0, 1, 2])
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
