import { describe, it, expect, beforeEach } from 'vitest'
import { useStore } from './store'
import { createChart } from '../model/chart-model'
import type { Chart, Shape, Fixture } from '../model/types'

const cc = (x: number, y: number): { x: number; y: number } => ({ x: x + 0.5, y: y + 0.5 })

function seed(): Chart {
  const c = createChart({ w: 400, h: 300 })
  const sh: Shape = {
    id: 'bar1',
    type: 'freehand',
    points: [cc(10, 10), cc(11, 10), cc(12, 10), cc(13, 10)],
    display: 'stroke',
    strokeWidth: 1,
    verts: [0, 3],
    fixtureId: 'fx1'
  }
  const fx: Fixture = { id: 'fx1', shapeId: 'bar1', universe: 2, start: 33, mode: 'rgb' }
  return { ...c, shapes: [sh], fixtures: [fx] }
}

describe('stamp copy/paste (store)', () => {
  beforeEach(() => {
    useStore.setState({
      chart: seed(),
      selectedId: null,
      selectedIds: [],
      clipboard: null,
      pasteArmed: false,
      history: [],
      future: []
    })
  })

  it('copySelection + pasteAt stamps a centred clone with the same DMX address', () => {
    const st = useStore.getState()
    st.select('bar1')
    useStore.getState().copySelection()
    useStore.getState().pasteAt({ x: 100, y: 50 })
    const s = useStore.getState()
    expect(s.chart.shapes).toHaveLength(2)
    const copy = s.chart.shapes[1]
    expect(copy.id).not.toBe('bar1')
    // 中心(12,10.5)→(100,50): 整数オフセットで .5 中心が保たれる
    expect(copy.points[0].x % 1).toBeCloseTo(0.5, 9)
    const cx = (copy.points[0].x + copy.points[3].x) / 2
    expect(Math.abs(cx - 100)).toBeLessThanOrEqual(1)
    expect(copy.verts).toEqual([0, 3]) // 角情報も複製
    const nf = s.chart.fixtures.find((f) => f.shapeId === copy.id)!
    expect(nf.universe).toBe(2)
    expect(nf.start).toBe(33) // 同じフェーダーで一緒に光る
    expect(copy.fixtureId).toBe(nf.id)
    expect(s.selectedIds).toEqual([copy.id]) // 貼った物が選択される
  })

  it('repeated pasteAt keeps stamping from the same clipboard (one undo step each)', () => {
    useStore.getState().select('bar1')
    useStore.getState().copySelection()
    useStore.getState().pasteAt({ x: 100, y: 50 })
    useStore.getState().pasteAt({ x: 200, y: 80 })
    expect(useStore.getState().chart.shapes).toHaveLength(3)
    useStore.getState().undo()
    expect(useStore.getState().chart.shapes).toHaveLength(2)
    useStore.getState().undo()
    expect(useStore.getState().chart.shapes).toHaveLength(1)
  })

  it('pasteAt without a clipboard does nothing', () => {
    useStore.getState().pasteAt({ x: 50, y: 50 })
    expect(useStore.getState().chart.shapes).toHaveLength(1)
  })
})
