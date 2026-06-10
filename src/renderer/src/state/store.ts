import { create } from 'zustand'
import type { Chart, Shape, Fixture, ChannelMode, Point } from '../model/types'
import { createChart, addShape as addShapeToChart, newId } from '../model/chart-model'
import type { MaskData } from '../ui/mask'
import { addressAt } from '../dmx/address'

export type Mode = 'edit' | 'live'
export type Tool =
  | 'select'
  | 'line'
  | 'polyline'
  | 'freehand'
  | 'ellipse'
  | 'rect'
  | 'triangle'
  | 'star'
  | 'polygon'
  | 'pixelpen'

interface AppState {
  chart: Chart
  mode: Mode
  tool: Tool
  selectedId: string | null
  dmxByUniverse: Record<number, Uint8Array>
  lastSeenByUniverse: Record<number, number>
  manualMode: boolean
  manualByFixture: Record<string, [number, number, number]>
  snapToPixel: boolean
  mask: MaskData | null
  /** False until the user picks a doorway (chart image / blank / load); shows the start screen. */
  started: boolean

  setStarted: (on: boolean) => void
  /** Loads a chart image: canvas snaps to the image's pixel size, the image becomes the
   *  underlay, and the mask defaults to "opaque = LED face = drawable" (invert ON). */
  applyChartImage: (dataUrl: string, w: number, h: number) => void
  setChart: (c: Chart) => void
  setMode: (m: Mode) => void
  setTool: (t: Tool) => void
  select: (id: string | null) => void
  updateShape: (id: string, patch: Partial<Shape>) => void
  addShape: (init: { type: Shape['type']; points: Shape['points'] } & Partial<Shape>) => string
  removeShape: (id: string) => void
  nudgeShape: (id: string, dx: number, dy: number) => void
  setShapePoints: (id: string, points: Point[]) => void
  duplicateShape: (id: string) => void
  setUniverseData: (universe: number, data: Uint8Array) => void

  setUnderlay: (u: Chart['underlay']) => void
  setUnderlayOpacity: (opacity: number) => void
  setUnderlayVisible: (visible: boolean) => void

  upsertFixture: (shapeId: string, patch: Partial<Omit<Fixture, 'id' | 'shapeId'>>) => void
  removeFixture: (shapeId: string) => void
  setManualMode: (on: boolean) => void
  setManualColor: (fixtureId: string, rgb: [number, number, number]) => void
  setManualAll: (rgb: [number, number, number] | null) => void
  setSnap: (on: boolean) => void
  setUnderlayMask: (patch: { enabled?: boolean; invert?: boolean }) => void
  setMaskData: (m: MaskData | null) => void
  /** Auto-fill the masked drawable area with a grid of addressed cells; returns the count. */
  autoFill: (opts: {
    pitchX: number
    pitchY: number
    cellW: number
    cellH: number
    universe: number
    start: number
    mode: ChannelMode
    step: number
  }) => number
  setCanvasSize: (w: number, h: number) => void
  setGamma: (on: boolean) => void
  setHoldOnTimeout: (on: boolean) => void
  setGlow: (on: boolean) => void
  setGlowAmount: (px: number) => void
  setSyphonName: (name: string) => void
}

/** A small sample chart (shapes patched to U0/1 so the test sender lights them). */
function demoChart(): Chart {
  let c = createChart({ w: 1920, h: 1080 })
  c.name = 'Demo'
  c = addShapeToChart(c, {
    type: 'ellipse',
    points: [
      { x: 380, y: 400 },
      { x: 760, y: 700 }
    ],
    strokeWidth: 14
  })
  c = addShapeToChart(c, {
    type: 'star',
    points: [
      { x: 1080, y: 300 },
      { x: 1460, y: 660 }
    ],
    strokeWidth: 12
  })
  c = addShapeToChart(c, {
    type: 'line',
    points: [
      { x: 200, y: 200 },
      { x: 1720, y: 240 }
    ],
    strokeWidth: 18
  })
  const fixtures: Fixture[] = c.shapes.map((sh) => ({
    id: newId('fx'),
    shapeId: sh.id,
    universe: 0,
    start: 1,
    mode: 'rgb' as ChannelMode
  }))
  return {
    ...c,
    fixtures,
    shapes: c.shapes.map((sh, i) => ({ ...sh, fixtureId: fixtures[i].id }))
  }
}

function initialChart(): Chart {
  if (typeof window !== 'undefined' && window.location.search.includes('demo')) return demoChart()
  return createChart({ w: 1920, h: 1080 })
}

/** Demo charts arrive pre-populated, so they skip the start screen. */
function initialStarted(): boolean {
  return typeof window !== 'undefined' && window.location.search.includes('demo')
}

export const useStore = create<AppState>()((set, get) => ({
  chart: initialChart(),
  mode: typeof window !== 'undefined' && window.location.search.includes('live') ? 'live' : 'edit',
  tool: 'select',
  selectedId: null,
  dmxByUniverse: {},
  lastSeenByUniverse: {},
  manualMode: false,
  manualByFixture: {},
  snapToPixel: true,
  mask: null,
  started: initialStarted(),

  setStarted: (started) => set({ started }),
  applyChartImage: (dataUrl, w, h) =>
    set((s) => ({
      chart: {
        ...s.chart,
        canvas: { w, h },
        underlay: {
          dataUrl,
          opacity: 0.5,
          visible: true,
          mask: { enabled: true, invert: true }
        }
      }
    })),
  setChart: (chart) => set({ chart, selectedId: null }),
  setMode: (mode) => set({ mode }),
  setTool: (tool) => set({ tool }),
  select: (selectedId) => set({ selectedId }),

  updateShape: (id, patch) =>
    set((s) => ({
      chart: {
        ...s.chart,
        shapes: s.chart.shapes.map((sh) => (sh.id === id ? { ...sh, ...patch } : sh))
      }
    })),

  addShape: (init) => {
    const c2 = addShapeToChart(get().chart, init)
    const created = c2.shapes[c2.shapes.length - 1]
    set({ chart: c2, selectedId: created.id })
    return created.id
  },

  removeShape: (id) =>
    set((s) => ({
      chart: {
        ...s.chart,
        shapes: s.chart.shapes.filter((sh) => sh.id !== id),
        fixtures: s.chart.fixtures.filter((f) => f.shapeId !== id)
      },
      selectedId: s.selectedId === id ? null : s.selectedId
    })),

  setUniverseData: (universe, data) =>
    set((s) => ({
      dmxByUniverse: { ...s.dmxByUniverse, [universe]: data },
      lastSeenByUniverse: { ...s.lastSeenByUniverse, [universe]: Date.now() }
    })),

  setUnderlay: (underlay) => set((s) => ({ chart: { ...s.chart, underlay } })),
  setUnderlayOpacity: (opacity) =>
    set((s) => ({
      chart: {
        ...s.chart,
        underlay: s.chart.underlay ? { ...s.chart.underlay, opacity } : null
      }
    })),
  setUnderlayVisible: (visible) =>
    set((s) => ({
      chart: {
        ...s.chart,
        underlay: s.chart.underlay ? { ...s.chart.underlay, visible } : null
      }
    })),

  upsertFixture: (shapeId, patch) =>
    set((s) => {
      const existing = s.chart.fixtures.find((f) => f.shapeId === shapeId)
      if (existing) {
        return {
          chart: {
            ...s.chart,
            fixtures: s.chart.fixtures.map((f) => (f.shapeId === shapeId ? { ...f, ...patch } : f))
          }
        }
      }
      const fx: Fixture = {
        id: newId('fx'),
        shapeId,
        universe: 0,
        start: 1,
        mode: 'rgb' as ChannelMode,
        ...patch
      }
      return {
        chart: {
          ...s.chart,
          fixtures: [...s.chart.fixtures, fx],
          shapes: s.chart.shapes.map((sh) => (sh.id === shapeId ? { ...sh, fixtureId: fx.id } : sh))
        }
      }
    }),

  removeFixture: (shapeId) =>
    set((s) => ({
      chart: {
        ...s.chart,
        fixtures: s.chart.fixtures.filter((f) => f.shapeId !== shapeId),
        shapes: s.chart.shapes.map((sh) =>
          sh.id === shapeId ? { ...sh, fixtureId: undefined } : sh
        )
      }
    })),

  setManualMode: (on) => set({ manualMode: on }),
  setManualColor: (fixtureId, rgb) =>
    set((s) => ({ manualByFixture: { ...s.manualByFixture, [fixtureId]: rgb } })),
  setManualAll: (rgb) =>
    set((s) => {
      if (rgb === null) return { manualByFixture: {} }
      const m: Record<string, [number, number, number]> = {}
      for (const f of s.chart.fixtures) m[f.id] = rgb
      return { manualByFixture: m }
    }),

  setCanvasSize: (w, h) => set((s) => ({ chart: { ...s.chart, canvas: { w, h } } })),
  setGamma: (on) =>
    set((s) => ({ chart: { ...s.chart, settings: { ...s.chart.settings, gamma: on } } })),
  setHoldOnTimeout: (on) =>
    set((s) => ({ chart: { ...s.chart, settings: { ...s.chart.settings, holdOnTimeout: on } } })),
  setGlow: (on) => set((s) => ({ chart: { ...s.chart, settings: { ...s.chart.settings, glow: on } } })),
  setGlowAmount: (px) =>
    set((s) => ({ chart: { ...s.chart, settings: { ...s.chart.settings, glowAmount: px } } })),
  setSyphonName: (name) => set((s) => ({ chart: { ...s.chart, syphon: { name } } })),
  setSnap: (on) => set({ snapToPixel: on }),
  setUnderlayMask: (patch) =>
    set((s) => {
      if (!s.chart.underlay) return {}
      const cur = s.chart.underlay.mask ?? { enabled: false, invert: false }
      return {
        chart: { ...s.chart, underlay: { ...s.chart.underlay, mask: { ...cur, ...patch } } }
      }
    }),
  setMaskData: (m) => set({ mask: m }),
  autoFill: (opts) => {
    const { mask } = get()
    if (!mask) return 0
    const px = Math.max(1, Math.round(opts.pitchX))
    const py = Math.max(1, Math.round(opts.pitchY))
    const cap = 4000
    const newShapes: Shape[] = []
    const newFixtures: Fixture[] = []
    let i = 0
    for (let y = Math.floor(py / 2); y < mask.h && newShapes.length < cap; y += py) {
      for (let x = Math.floor(px / 2); x < mask.w && newShapes.length < cap; x += px) {
        if (mask.bitmap[y * mask.w + x] !== 1) continue
        const id = newId('shape')
        const fid = newId('fx')
        const a = addressAt(opts.universe, opts.start, opts.mode, opts.step, i)
        newShapes.push({
          id,
          type: 'rect',
          points: [
            { x: Math.round(x - opts.cellW / 2), y: Math.round(y - opts.cellH / 2) },
            { x: Math.round(x + opts.cellW / 2), y: Math.round(y + opts.cellH / 2) }
          ],
          display: 'fill',
          strokeWidth: 1,
          fixtureId: fid
        })
        newFixtures.push({ id: fid, shapeId: id, universe: a.universe, start: a.start, mode: opts.mode })
        i++
      }
    }
    set((s) => ({
      chart: {
        ...s.chart,
        shapes: [...s.chart.shapes, ...newShapes],
        fixtures: [...s.chart.fixtures, ...newFixtures]
      }
    }))
    return newShapes.length
  },
  nudgeShape: (id, dx, dy) =>
    set((s) => ({
      chart: {
        ...s.chart,
        shapes: s.chart.shapes.map((sh) =>
          sh.id === id ? { ...sh, points: sh.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) } : sh
        )
      }
    })),
  setShapePoints: (id, points) =>
    set((s) => ({
      chart: { ...s.chart, shapes: s.chart.shapes.map((sh) => (sh.id === id ? { ...sh, points } : sh)) }
    })),
  duplicateShape: (id) =>
    set((s) => {
      const sh = s.chart.shapes.find((x) => x.id === id)
      if (!sh) return {}
      const nid = newId('shape')
      const copy: Shape = {
        ...sh,
        id: nid,
        points: sh.points.map((p) => ({ x: p.x + 10, y: p.y + 10 })),
        fixtureId: undefined
      }
      let fixtures = s.chart.fixtures
      const fx = s.chart.fixtures.find((f) => f.shapeId === id)
      if (fx) {
        const nfid = newId('fx')
        copy.fixtureId = nfid
        fixtures = [...fixtures, { ...fx, id: nfid, shapeId: nid }]
      }
      return { chart: { ...s.chart, shapes: [...s.chart.shapes, copy], fixtures }, selectedId: nid }
    })
}))

// Test/debug hook: lets the browser preview drive the store (e.g. seed demo shapes).
if (typeof window !== 'undefined') {
  ;(window as unknown as { __decorStore?: typeof useStore }).__decorStore = useStore
}
