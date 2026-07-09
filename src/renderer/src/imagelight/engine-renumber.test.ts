import { describe, it, expect } from 'vitest'
import { renumberOrder } from './engine'

describe('renumberOrder（番号を左下→右、下の段から振り直す）', () => {
  it('一段：左端が1、左→右で番号が進む', () => {
    // x: -2,-1,0,1,2（同じ段）。左端=index0
    const pts = [
      { x: -2, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 }
    ]
    // 期待(old index)：左から順にそのまま 0,1,2,3,4
    expect(renumberOrder(pts, 100)).toEqual([0, 1, 2, 3, 4])
  })

  it('左下が1番：下の段を左→右、次に上の段を左→右', () => {
    const pts = [
      { x: -1, y: 0 }, // 0 上段・左
      { x: 0, y: 0 }, // 1 上段・中
      { x: 1, y: 0 }, // 2 上段・右
      { x: -1, y: 100 }, // 3 下段・左（＝左下＝1番）
      { x: 0, y: 100 }, // 4 下段・中
      { x: 1, y: 100 } // 5 下段・右
    ]
    // 下段(左3,中4,右5) → 上段(左0,中1,右2)
    expect(renumberOrder(pts, 200)).toEqual([3, 4, 5, 0, 1, 2])
  })

  it('段の中で順不同に置いても、左→右へ並べ替わる', () => {
    const pts = [
      { x: 2, y: 100 }, // 0 下段・右
      { x: -2, y: 100 }, // 1 下段・左（＝左下＝1番）
      { x: 0, y: 100 } // 2 下段・中
    ]
    expect(renumberOrder(pts, 200)).toEqual([1, 2, 0])
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
