import { describe, it, expect, beforeEach } from 'vitest'
import { useStore } from './store'
import { createChart } from '../model/chart-model'
import type { Shape } from '../model/types'

/** ミラー反転（mirrorShapes）。単体＝その場で裏返る／複数＝位置関係を保ったまま固まりで裏返る。
 *  外枠（選択全体の左右端・上下端）は動かないのが正。 */
const line = (id: string, pts: [number, number][]): Shape =>
  ({
    id,
    type: 'polyline',
    points: pts.map(([x, y]) => ({ x, y })),
    display: 'fill',
    strokeWidth: 1
  }) as Shape

function setChart(shapes: Shape[], selected: string[]): void {
  const base = createChart({ w: 1920, h: 1080 })
  useStore.setState({
    chart: { ...base, shapes },
    selectedIds: selected,
    selectedId: selected.length === 1 ? selected[0] : null,
    history: [],
    future: []
  })
}
const shapeById = (id: string): Shape => useStore.getState().chart.shapes.find((s) => s.id === id)!

describe('mirrorShapes', () => {
  beforeEach(() => setChart([], []))

  it('1本だけ選ぶと、その線の中心で左右が入れ替わる（外枠は動かない）', () => {
    setChart([line('a', [[100, 10], [140, 10], [200, 60]])], ['a'])
    useStore.getState().mirrorShapes('h')
    // 中心 x=150 → 100↔200 / 140↔160。y は変わらない。
    expect(shapeById('a').points).toEqual([
      { x: 200, y: 10 },
      { x: 160, y: 10 },
      { x: 100, y: 60 }
    ])
  })

  it('複数選ぶと、位置関係を保ったまま1つの固まりとして反転する', () => {
    setChart([line('a', [[0, 0], [10, 0]]), line('b', [[90, 0], [100, 0]])], ['a', 'b'])
    useStore.getState().mirrorShapes('h')
    // 全体の外枠 0〜100 が軸。左の線が右へ、右の線が左へ入れ替わる。
    expect(shapeById('a').points.map((p) => p.x)).toEqual([100, 90])
    expect(shapeById('b').points.map((p) => p.x)).toEqual([10, 0])
  })

  it('選んでいない線・ロックした線は動かない', () => {
    const locked = { ...line('c', [[0, 0], [10, 0]]), locked: true }
    setChart([line('a', [[0, 0], [10, 0]]), line('b', [[90, 0], [100, 0]]), locked], ['a', 'c'])
    useStore.getState().mirrorShapes('h')
    expect(shapeById('b').points.map((p) => p.x)).toEqual([90, 100]) // 非選択
    expect(shapeById('c').points.map((p) => p.x)).toEqual([0, 10]) // ロック
  })

  it('上下反転は y だけが入れ替わる', () => {
    setChart([line('a', [[5, 20], [5, 80]])], ['a'])
    useStore.getState().mirrorShapes('v')
    expect(shapeById('a').points).toEqual([
      { x: 5, y: 80 },
      { x: 5, y: 20 }
    ])
  })

  it('2回反転すると元に戻る', () => {
    const pts: [number, number][] = [[12, 3], [44, 9], [80, 51]]
    setChart([line('a', pts)], ['a'])
    useStore.getState().mirrorShapes('h')
    useStore.getState().mirrorShapes('h')
    expect(shapeById('a').points).toEqual(pts.map(([x, y]) => ({ x, y })))
  })

  it('連続複製(repeat)は伸びる向きも裏返る', () => {
    const s = { ...line('a', [[0, 0]]), repeat: { count: 4, dx: 10, dy: 0 } }
    setChart([s], ['a'])
    useStore.getState().mirrorShapes('h')
    expect(shapeById('a').repeat).toEqual({ count: 4, dx: -10, dy: 0 })
  })

  it('⌘Z で戻せるよう履歴を1手積む', () => {
    setChart([line('a', [[0, 0], [10, 0]])], ['a'])
    useStore.getState().mirrorShapes('h')
    expect(useStore.getState().history).toHaveLength(1)
    useStore.getState().undo()
    expect(shapeById('a').points.map((p) => p.x)).toEqual([0, 10])
  })
})
