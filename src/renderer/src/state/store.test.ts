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

  it('copySelection + pasteAt stamps a clone starting at the mark (top-left)', () => {
    const st = useStore.getState()
    st.select('bar1')
    useStore.getState().copySelection()
    useStore.getState().pasteAt({ x: 100, y: 50 })
    const s = useStore.getState()
    expect(s.chart.shapes).toHaveLength(2)
    const copy = s.chart.shapes[1]
    expect(copy.id).not.toBe('bar1')
    // 左上(10.5,10.5)が(100,50)へ: 整数オフセットで .5 中心が保たれる
    expect(copy.points[0].x % 1).toBeCloseTo(0.5, 9)
    expect(copy.points[0].x).toBe(100.5) // 左上スタート
    expect(copy.points[0].y).toBe(50.5)
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

describe('ステップアップモード (store)', () => {
  beforeEach(() => {
    useStore.setState({
      chart: seed(),
      stepPatch: true,
      selectedId: null,
      selectedIds: [],
      clipboard: null,
      pasteArmed: false,
      history: [],
      future: [],
      histTag: null,
      histAt: 0
    })
  })
  it('addShape lands right after the last fixture, inheriting its mode', () => {
    const id = useStore.getState().addShape({
      type: 'line',
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 }
      ]
    })
    const fx = useStore.getState().chart.fixtures.find((f) => f.shapeId === id)
    expect(fx).toBeTruthy()
    expect(fx!.universe).toBe(2)
    expect(fx!.start).toBe(36)
    expect(fx!.mode).toBe('rgb')
    const id2 = useStore.getState().addShape({
      type: 'bulb',
      points: [{ x: 5.5, y: 5.5 }],
      display: 'fill',
      strokeWidth: 1
    })
    const fx2 = useStore.getState().chart.fixtures.find((f) => f.shapeId === id2)
    expect(fx2!.start).toBe(39)
  })
  it('OFF keeps the existing behaviour: new shapes stay unpatched', () => {
    useStore.setState({ stepPatch: false })
    const id = useStore.getState().addShape({
      type: 'line',
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 }
      ]
    })
    expect(useStore.getState().chart.fixtures.find((f) => f.shapeId === id)).toBeUndefined()
  })
})

describe('bulkPatch: 複数選択の一括変更', () => {
  beforeEach(() => {
    const c = seed()
    const extra: Shape = {
      id: 'bar2',
      type: 'rect',
      points: [
        { x: 0, y: 0 },
        { x: 5, y: 5 }
      ],
      display: 'stroke',
      strokeWidth: 1
    }
    useStore.setState({
      chart: { ...c, shapes: [...c.shapes, extra] },
      selectedId: null,
      selectedIds: [],
      clipboard: null,
      pasteArmed: false,
      history: [],
      future: [],
      histTag: null,
      histAt: 0
    })
  })
  it('updates all selected fixtures, creates missing ones, leaves other fields alone', () => {
    useStore.getState().bulkPatch(['bar1', 'bar2'], { universe: 7 })
    const fxs = useStore.getState().chart.fixtures
    const f1 = fxs.find((f) => f.shapeId === 'bar1')!
    const f2 = fxs.find((f) => f.shapeId === 'bar2')!
    expect(f1.universe).toBe(7)
    expect(f1.start).toBe(33)
    expect(f2.universe).toBe(7)
    expect(f2.start).toBe(1)
  })
  it('is ONE undo step', () => {
    useStore.getState().bulkPatch(['bar1', 'bar2'], { universe: 7 })
    useStore.getState().undo()
    const fxs = useStore.getState().chart.fixtures
    expect(fxs.find((f) => f.shapeId === 'bar1')!.universe).toBe(2)
    expect(fxs.find((f) => f.shapeId === 'bar2')).toBeUndefined()
  })
})

describe('setLocked: ロック（背景化）', () => {
  beforeEach(() => {
    useStore.setState({
      chart: seed(),
      selectedId: 'bar1',
      selectedIds: ['bar1'],
      clipboard: null,
      pasteArmed: false,
      history: [],
      future: [],
      histTag: null,
      histAt: 0
    })
  })
  it('locking flags the shape AND drops it from the selection', () => {
    useStore.getState().setLocked(['bar1'], true)
    const st = useStore.getState()
    expect(st.chart.shapes.find((s) => s.id === 'bar1')!.locked).toBe(true)
    expect(st.selectedIds).toEqual([])
    expect(st.selectedId).toBeNull()
  })
  it('unlocking clears the flag and is one undo step away', () => {
    useStore.getState().setLocked(['bar1'], true)
    useStore.getState().setLocked(['bar1'], false)
    expect(useStore.getState().chart.shapes.find((s) => s.id === 'bar1')!.locked).toBe(false)
    useStore.getState().undo()
    expect(useStore.getState().chart.shapes.find((s) => s.id === 'bar1')!.locked).toBe(true)
  })
})

describe('layers (song pages)', () => {
  beforeEach(() => {
    useStore.setState({
      chart: seed(),
      selectedId: null,
      selectedIds: [],
      clipboard: null,
      pasteArmed: false,
      history: [],
      future: [],
      histTag: null,
      histAt: 0
    })
  })

  it('addLayer appends, activates, and new shapes land on it', () => {
    const id = useStore.getState().addLayer({ name: 'SONG 2' })
    const st = useStore.getState()
    expect(st.chart.layers).toHaveLength(2)
    expect(st.chart.activeLayerId).toBe(id)
    const sid = st.addShape({ type: 'bulb', points: [{ x: 5, y: 5 }] })
    expect(useStore.getState().chart.shapes.find((s) => s.id === sid)!.layerId).toBe(id)
  })

  it('removeLayer deletes its shapes and fixtures, keeps the rest', () => {
    const baseLayer = useStore.getState().chart.activeLayerId
    const id = useStore.getState().addLayer({ name: 'SONG 2' })
    const sid = useStore.getState().addShape({ type: 'bulb', points: [{ x: 5, y: 5 }] })
    useStore.getState().upsertFixture(sid, { universe: 9, start: 1, mode: 'rgb' })
    useStore.getState().removeLayer(id)
    const st = useStore.getState()
    expect(st.chart.layers).toHaveLength(1)
    expect(st.chart.activeLayerId).toBe(baseLayer)
    expect(st.chart.shapes.find((s) => s.id === sid)).toBeUndefined()
    expect(st.chart.fixtures.some((f) => f.shapeId === sid)).toBe(false)
    // the original layer's shape survives
    expect(st.chart.shapes.find((s) => s.id === 'bar1')).toBeTruthy()
  })

  it('the last layer cannot be removed', () => {
    const only = useStore.getState().chart.activeLayerId
    useStore.getState().removeLayer(only)
    expect(useStore.getState().chart.layers).toHaveLength(1)
  })

  it('removeLayer is one undo step (shapes come back)', () => {
    const id = useStore.getState().addLayer({ name: 'SONG 2' })
    useStore.getState().addShape({ type: 'bulb', points: [{ x: 5, y: 5 }] })
    useStore.getState().removeLayer(id)
    useStore.getState().undo()
    const st = useStore.getState()
    expect(st.chart.layers).toHaveLength(2)
    expect(st.chart.shapes.some((s) => s.layerId === id)).toBe(true)
  })

  it('eraseCells leaves other layers strokes alone', () => {
    // bar1 lives on the base layer; switch to a new layer and erase its cells
    useStore.getState().addLayer({ name: 'SONG 2' })
    useStore.getState().eraseCells(['10,10', '11,10', '12,10', '13,10'])
    expect(useStore.getState().chart.shapes.find((s) => s.id === 'bar1')).toBeTruthy()
  })
})

describe('duplicate run (cmd-D rhythm)', () => {
  beforeEach(() => {
    useStore.setState({
      chart: seed(),
      selectedId: null,
      selectedIds: [],
      clipboard: null,
      pasteArmed: false,
      lastDup: null,
      history: [],
      future: [],
      histTag: null,
      histAt: 0
    })
  })

  it('first duplicate lands at +10,+10', () => {
    useStore.getState().duplicateShape('bar1')
    const st = useStore.getState()
    const copy = st.chart.shapes[st.chart.shapes.length - 1]
    expect(copy.points[0]).toEqual({ x: 20.5, y: 20.5 })
    expect(st.lastDup).toEqual({ srcId: 'bar1', newId: copy.id })
  })

  it('duplicating the dragged copy repeats the pair offset (even run)', () => {
    useStore.getState().duplicateShape('bar1')
    let st = useStore.getState()
    const copy = st.chart.shapes[st.chart.shapes.length - 1]
    // drag the copy 30 right of the original (y unchanged)
    st.setShapePoints(
      copy.id,
      st.chart.shapes
        .find((s) => s.id === 'bar1')!
        .points.map((p) => ({ x: p.x + 30, y: p.y }))
    )
    useStore.getState().duplicateShape(copy.id)
    st = useStore.getState()
    const third = st.chart.shapes[st.chart.shapes.length - 1]
    // third continues the run: another +30,0 from the copy
    expect(third.points[0]).toEqual({ x: 70.5, y: 10.5 })
  })
})

describe('setManualMany (Quick Light)', () => {
  beforeEach(() => {
    useStore.setState({
      chart: seed(),
      manualMode: false,
      manualByFixture: {},
      history: [],
      future: []
    })
  })
  it('paints all given fixtures one colour and switches to manual', () => {
    useStore.getState().setManualMany(['fx1', 'fx9'], [255, 96, 0])
    const st = useStore.getState()
    expect(st.manualMode).toBe(true)
    expect(st.manualByFixture['fx1']).toEqual([255, 96, 0])
    expect(st.manualByFixture['fx9']).toEqual([255, 96, 0])
  })
  it('leaves other fixtures untouched', () => {
    useStore.getState().setManualColor('fxKeep', [1, 2, 3])
    useStore.getState().setManualMany(['fx1'], [0, 0, 0])
    expect(useStore.getState().manualByFixture['fxKeep']).toEqual([1, 2, 3])
  })
})
