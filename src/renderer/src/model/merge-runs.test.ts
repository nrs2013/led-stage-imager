import { describe, it, expect } from 'vitest'
import { mergeRunCells, applyMerge } from './merge-runs'
import { regenChain } from '../editor/stroke-fit'
import { createChart } from './chart-model'
import type { Chart, Shape, Fixture } from './types'

const cc = (x: number, y: number): { x: number; y: number } => ({ x: x + 0.5, y: y + 0.5 })

function run(id: string, cells: [number, number][], fx?: boolean): { shape: Shape; fixture?: Fixture } {
  const shape: Shape = {
    id,
    type: 'freehand',
    points: cells.map(([x, y]) => cc(x, y)),
    display: 'stroke',
    strokeWidth: 1,
    fixtureId: fx ? `fx-${id}` : undefined
  }
  return {
    shape,
    fixture: fx ? { id: `fx-${id}`, shapeId: id, universe: 0, start: 1, mode: 'rgb' } : undefined
  }
}

function chartWith(...rs: ReturnType<typeof run>[]): Chart {
  const c = createChart({ w: 200, h: 200 })
  return {
    ...c,
    shapes: rs.map((r) => r.shape),
    fixtures: rs.flatMap((r) => (r.fixture ? [r.fixture] : []))
  }
}

describe('mergeRunCells + applyMerge (1本に結合)', () => {
  it('eraser-separated pieces reunite into one chain bridging the gap', () => {
    // (0,5)-(9,5) と (13,5)-(20,5)（間に切れ目）
    const a = run('a', Array.from({ length: 10 }, (_, i) => [i, 5] as [number, number]), true)
    const b = run('b', Array.from({ length: 8 }, (_, i) => [13 + i, 5] as [number, number]), true)
    const chart = chartWith(a, b)
    const m = mergeRunCells(chart, ['a', 'b'])!
    expect(m.keepId).toBe('a')
    expect(m.dropIds).toEqual(['b'])
    const { points, verts } = regenChain(m.vertCells)
    const merged = applyMerge(chart, m.keepId, points, verts, m.dropIds)
    expect(merged.shapes).toHaveLength(1)
    expect(merged.shapes[0].points).toHaveLength(21) // 0..20 隙間も埋まる
    expect(merged.fixtures).toHaveLength(1) // 残るのは a のフェーダーだけ
  })

  it('reverses a run when its far end is closer (head-to-head joins work)', () => {
    const a = run('a', [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]])
    const b = run('b', [[10, 0], [9, 0], [8, 0], [7, 0], [6, 0]]) // 逆向きに描かれた棒
    const m = mergeRunCells(chartWith(a, b), ['a', 'b'])!
    const { points } = regenChain(m.vertCells)
    expect(points).toHaveLength(11)
    expect(points[10]).toEqual(cc(10, 0))
  })

  it('returns null when fewer than 2 painted runs are involved', () => {
    const a = run('a', [[0, 0], [1, 0]])
    expect(mergeRunCells(chartWith(a), ['a'])).toBeNull()
  })

  it('preserves an orphan fixture (shape missing) while dropping the merged-away run', () => {
    const a = run('a', [[0, 0], [1, 0], [2, 0]], true)
    const b = run('b', [[4, 0], [5, 0], [6, 0]], true)
    const base = chartWith(a, b)
    const chart: Chart = {
      ...base,
      fixtures: [
        ...base.fixtures,
        { id: 'fx-orphan', shapeId: 'ghost', universe: 0, start: 100, mode: 'rgb' }
      ]
    }
    const m = mergeRunCells(chart, ['a', 'b'])!
    const { points, verts } = regenChain(m.vertCells)
    const merged = applyMerge(chart, m.keepId, points, verts, m.dropIds)
    expect(merged.fixtures.find((f) => f.id === 'fx-orphan')).toBeTruthy() // 無関係な孤児は残る
    expect(merged.fixtures.find((f) => f.id === 'fx-b')).toBeFalsy() // 統合された run の灯体は消える
  })
})
