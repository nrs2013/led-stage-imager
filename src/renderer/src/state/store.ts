import { create } from 'zustand'
import type { Chart, Shape, Fixture, ChannelMode } from '../model/types'
import { createChart, addShape as addShapeToChart, newId } from '../model/chart-model'

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

interface AppState {
  chart: Chart
  mode: Mode
  tool: Tool
  selectedId: string | null
  dmxByUniverse: Record<number, Uint8Array>

  setChart: (c: Chart) => void
  setMode: (m: Mode) => void
  setTool: (t: Tool) => void
  select: (id: string | null) => void
  updateShape: (id: string, patch: Partial<Shape>) => void
  addShape: (init: { type: Shape['type']; points: Shape['points'] } & Partial<Shape>) => string
  removeShape: (id: string) => void
  setUniverseData: (universe: number, data: Uint8Array) => void

  setUnderlay: (u: Chart['underlay']) => void
  setUnderlayOpacity: (opacity: number) => void
  setUnderlayVisible: (visible: boolean) => void

  upsertFixture: (shapeId: string, patch: Partial<Omit<Fixture, 'id' | 'shapeId'>>) => void
  removeFixture: (shapeId: string) => void
}

export const useStore = create<AppState>()((set, get) => ({
  chart: createChart({ w: 1920, h: 1080 }),
  mode: 'edit',
  tool: 'select',
  selectedId: null,
  dmxByUniverse: {},

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
    set((s) => ({ dmxByUniverse: { ...s.dmxByUniverse, [universe]: data } })),

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
    }))
}))

// Test/debug hook: lets the browser preview drive the store (e.g. seed demo shapes).
if (typeof window !== 'undefined') {
  ;(window as unknown as { __decorStore?: typeof useStore }).__decorStore = useStore
}
