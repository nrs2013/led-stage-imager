import { describe, it, expect, beforeEach } from 'vitest'
import { useStore } from './store'
import { createChart } from '../model/chart-model'
import type { Shape } from '../model/types'

/** 連番でふり直す（renumberSelection）。左上から順＝チャートを読む順でふる。 */
const line = (id: string, x: number, y: number): Shape =>
  ({
    id,
    type: 'polyline',
    points: [
      { x, y },
      { x: x + 20, y }
    ],
    display: 'fill',
    strokeWidth: 1
  }) as Shape

function setChart(shapes: Shape[], selected: string[], fixtures: unknown[] = []): void {
  const base = createChart({ w: 1920, h: 1080 })
  useStore.setState({
    chart: { ...base, shapes, fixtures: fixtures as never },
    selectedIds: selected,
    selectedId: selected.length === 1 ? selected[0] : null,
    history: [],
    future: []
  })
}
const addrOf = (shapeId: string): string => {
  const f = useStore.getState().chart.fixtures.find((x) => x.shapeId === shapeId)
  return f ? `${f.universe + 1}.${String(f.start).padStart(3, '0')}` : 'なし'
}

describe('renumberSelection', () => {
  beforeEach(() => setChart([], []))

  it('左上→右上→下の順に連番でふる（置いた順ではない）', () => {
    // 置いた順は 下・左上・右上。読む順は 左上・右上・下。
    setChart([line('下', 500, 300), line('左上', 200, 150), line('右上', 350, 150)], [
      '下',
      '左上',
      '右上'
    ])
    useStore.getState().renumberSelection()
    expect(addrOf('左上')).toBe('1.001')
    expect(addrOf('右上')).toBe('1.004') // RGB=3ch ぶん進む
    expect(addrOf('下')).toBe('1.007')
  })

  it('すでに番地がある時は、その中の一番小さい番地から始める', () => {
    setChart(
      [line('a', 100, 100), line('b', 300, 100)],
      ['a', 'b'],
      [
        { id: 'f1', shapeId: 'a', universe: 1, start: 20, mode: 'rgb' },
        { id: 'f2', shapeId: 'b', universe: 0, start: 50, mode: 'rgb' }
      ]
    )
    useStore.getState().renumberSelection()
    expect(addrOf('a')).toBe('1.050') // 小さい方（0.50）から
    expect(addrOf('b')).toBe('1.053')
  })

  it('モードごとのch数ぶん進む（Dim=1ch なら1つずつ）', () => {
    setChart(
      [line('a', 100, 100), line('b', 300, 100)],
      ['a', 'b'],
      [
        { id: 'f1', shapeId: 'a', universe: 0, start: 1, mode: 'dim' },
        { id: 'f2', shapeId: 'b', universe: 0, start: 9, mode: 'dim' }
      ]
    )
    useStore.getState().renumberSelection()
    expect(addrOf('a')).toBe('1.001')
    expect(addrOf('b')).toBe('1.002')
  })

  it('1手で ⌘Z で戻せる', () => {
    setChart([line('a', 100, 100), line('b', 300, 100)], ['a', 'b'])
    useStore.getState().renumberSelection()
    expect(useStore.getState().chart.fixtures).toHaveLength(2)
    expect(useStore.getState().history).toHaveLength(1)
    useStore.getState().undo()
    expect(useStore.getState().chart.fixtures).toHaveLength(0)
  })

  it('ロックした電飾は触らない', () => {
    const locked = { ...line('c', 50, 50), locked: true }
    setChart([line('a', 100, 100), line('b', 300, 100), locked], ['a', 'b', 'c'])
    useStore.getState().renumberSelection()
    expect(addrOf('c')).toBe('なし')
    expect(addrOf('a')).toBe('1.001')
  })

  it('1個以下では何もしない（誤爆防止）', () => {
    setChart([line('a', 100, 100)], ['a'])
    useStore.getState().renumberSelection()
    expect(useStore.getState().chart.fixtures).toHaveLength(0)
    expect(useStore.getState().history).toHaveLength(0)
  })
})
