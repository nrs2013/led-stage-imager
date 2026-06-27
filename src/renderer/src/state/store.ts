import { create } from 'zustand'
import type { Chart, Shape, Fixture, ChannelMode, Point, Layer, Underlay } from '../model/types'
import { createChart, addShape as addShapeToChart, newId } from '../model/chart-model'
import { familyOfType, type PaletteFilter } from '../model/part-family'
import { eraseCellsFromChart } from '../model/erase'
import { mergeRunCells, applyMerge } from '../model/merge-runs'
import { regenChain } from '../editor/stroke-fit'
import { pasteDelta, shapeArrayBounds } from '../editor/geometry'
import { mmPerPx, rescaleFixturesToScale } from '../model/scale'
import type { MaskData } from '../ui/mask'
import { addressAt, nextAddressAfter, repeatCount } from '../dmx/address'

/** 整列の基準辺（左/横中央/右/上/縦中央/下）。Inspector の整列ボタンが渡す。 */
export type AlignEdge = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom'

/** The layer the editor is working on — owns the visible underlay, the drawable-area
 *  mask, and every newly drawn shape. The live output ignores layers entirely. */
export const activeLayerOf = (c: Chart): Layer =>
  c.layers.find((l) => l.id === c.activeLayerId) ?? c.layers[0]

const patchActiveUnderlay = (
  c: Chart,
  fn: (u: Underlay | null) => Underlay | null
): Chart => {
  const active = activeLayerOf(c)
  return {
    ...c,
    layers: c.layers.map((l) => (l.id === active.id ? { ...l, underlay: fn(l.underlay) } : l))
  }
}

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
  | 'eraser'

interface AppState {
  chart: Chart
  mode: Mode
  tool: Tool
  /** Single-selection focus (handles / Inspector). Null when 0 or 2+ are selected. */
  selectedId: string | null
  /** The full selection set (rubber band / Shift+click). */
  selectedIds: string[]
  dmxByUniverse: Record<number, Uint8Array>
  lastSeenByUniverse: Record<number, number>
  manualMode: boolean
  manualByFixture: Record<string, [number, number, number]>
  /** 棚＆キャンバスの種別フィルタ（照明だけ/電飾だけ/両方）。UI状態でありchart(保存対象)には入れない。 */
  paletteFilter: PaletteFilter
  snapToPixel: boolean
  /** ステップアップモード: when ON, every newly drawn/dropped shape is auto-patched
   *  at the next free address (and pasted clones renumber instead of cloning). */
  stepPatch: boolean
  /** Stroke width (px) that Paint / ⌘-paint writes with. */
  penWidth: number
  /** Blueprint-style W/H dimension labels on the chart's punch-out islands. */
  showDims: boolean
  /** #N fixture-number labels on the canvas (matching the patch chips below). */
  showIds: boolean
  mask: MaskData | null
  /** True when the mask was computed but had ZERO drawable cells (wrong-polarity
   *  image): the restriction is auto-lifted and the UI shows why. */
  maskEmpty: boolean
  /** False until the user picks a doorway (chart image / blank / load); shows the start screen. */
  started: boolean
  /** 画像照明モード（のむさんが本番で回す・卓なし）。true の間はエディタ/Liveに代えて
   *  ImageLightingMode を全画面表示し、自前で Syphon へ publish する。 */
  imageLight: boolean
  /** 照明モード(LIGHTING)=true は LIGHT SKETCH から電飾(DECOR)タブを隠した照明特化版。
   *  簡単モード(EASY)=false は全部入り。imageLight が true の時だけ意味を持つ。 */
  lightingOnly: boolean
  /** Undo/redo: snapshots of `chart` (immutable, so stacking references is cheap). */
  history: Chart[]
  future: Chart[]
  histTag: string | null
  histAt: number

  /** Snapshot the chart before a mutation. Same `tag` within 600ms coalesces
   *  (one undo step per drag gesture / arrow-key burst / scrub). */
  beginHistory: (tag?: string) => void
  undo: () => void
  redo: () => void
  setStarted: (on: boolean) => void
  setImageLight: (on: boolean) => void
  setLightingOnly: (on: boolean) => void
  /** 画像照明モードが提供する Undo/Redo/Copy/Paste（⌘Z/⌘C/⌘V をエンジンへ橋渡し）。モード外は null。 */
  imageLightUndo: (() => void) | null
  imageLightRedo: (() => void) | null
  imageLightCopy: (() => void) | null
  imageLightPaste: (() => void) | null
  setImageLightHandlers: (
    h: { undo: () => void; redo: () => void; copy: () => void; paste: () => void } | null
  ) => void
  /** Loads a chart image: canvas snaps to the image's pixel size, the image becomes the
   *  underlay, and the mask defaults to "transparent hole = where decorations go" —
   *  the chart is show artwork with the decoration areas punched out (invert OFF). */
  applyChartImage: (dataUrl: string, w: number, h: number) => void
  setChart: (c: Chart) => void
  setMode: (m: Mode) => void
  setTool: (t: Tool) => void
  select: (id: string | null) => void
  selectMany: (ids: string[]) => void
  toggleSelect: (id: string) => void
  /** Deletes several shapes (group delete) in one undo step. */
  removeShapes: (ids: string[]) => void
  /** 「1本に結合」: merges the selected painted runs into one chain (one fixture),
   *  bridging gaps with straight dot runs. */
  mergeShapes: (ids: string[]) => void
  /** Stamp copy/paste: ⌘C snapshots the selection, ⌘V arms paste mode, every click
   *  stamps a copy centred there (fixtures cloned with the same address). */
  clipboard: { shapes: Shape[]; fixtures: Fixture[] } | null
  pasteArmed: boolean
  /** A spot marked by clicking empty canvas in Select mode — ⌘V pastes centred here. */
  pasteMark: Point | null
  copySelection: () => void
  setPasteArmed: (on: boolean) => void
  setPasteMark: (p: Point | null) => void
  pasteAt: (center: Point) => void
  /** 元から少し横にずらして即ペースト（マウス追従の連続スタンプはしない・LIGHT SKETCH と同じ）。 */
  pasteOffset: () => void
  /** 選択中の図形を端/中央でそろえる（2個以上で有効・ロック分は対象外）。 */
  alignShapes: (edge: AlignEdge) => void
  /** 選択中の図形を等間隔に散らす（3個以上で有効・両端は固定して間を均す）。 */
  distributeShapes: (axis: 'h' | 'v') => void
  updateShape: (id: string, patch: Partial<Shape>) => void
  addShape: (init: { type: Shape['type']; points: Shape['points'] } & Partial<Shape>) => string
  removeShape: (id: string) => void
  nudgeShape: (id: string, dx: number, dy: number) => void
  /** Arrow-key nudge for a multi selection — all shapes move as one undo step. */
  nudgeShapes: (ids: string[], dx: number, dy: number) => void
  setShapePoints: (id: string, points: Point[]) => void
  duplicateShape: (id: string) => void
  /** The last ⌘D pair — duplicating the copy again repeats THEIR offset, so
   *  duplicate → drag into place → ⌘D ⌘D ⌘D lays out an even run (PowerPoint style). */
  lastDup: { srcId: string; newId: string } | null
  setUniverseData: (universe: number, data: Uint8Array) => void

  setUnderlay: (u: Underlay | null) => void
  setUnderlayOpacity: (opacity: number) => void
  setUnderlayVisible: (visible: boolean) => void

  /** Layers = one page per song. Adds a layer (optionally born with a chart image)
   *  and makes it active; returns its id. */
  addLayer: (init?: { name?: string; underlay?: Underlay | null }) => string
  /** Deletes the layer AND its shapes/fixtures (one undo step). The last layer stays. */
  removeLayer: (id: string) => void
  setActiveLayer: (id: string) => void
  setLayerVisible: (id: string, visible: boolean) => void
  renameLayer: (id: string, name: string) => void

  upsertFixture: (shapeId: string, patch: Partial<Omit<Fixture, 'id' | 'shapeId'>>) => void
  /** Bulk-apply patch fields to every given shape's fixture (creating fixtures where
   *  missing) — ONE undo step; the multi-select Inspector's 一括変更. */
  bulkPatch: (shapeIds: string[], patch: Partial<Omit<Fixture, 'id' | 'shapeId'>>) => void
  setStepPatch: (on: boolean) => void
  /** Lock/unlock shapes (one undo step). Locking also drops them from the selection
   *  so they become untouchable immediately. */
  setLocked: (shapeIds: string[], on: boolean) => void
  removeFixture: (shapeId: string) => void
  setManualMode: (on: boolean) => void
  setManualColor: (fixtureId: string, rgb: [number, number, number]) => void
  setManualAll: (rgb: [number, number, number] | null) => void
  /** Quick Light: paint several fixtures one colour in a single update (and switch
   *  to manual so it shows immediately) — the no-console "splash a colour" button. */
  setManualMany: (fixtureIds: string[], rgb: [number, number, number]) => void
  setSnap: (on: boolean) => void
  setPaletteFilter: (f: PaletteFilter) => void
  setUnderlayMask: (patch: { enabled?: boolean; invert?: boolean }) => void
  setMaskData: (m: MaskData | null) => void
  setMaskEmpty: (on: boolean) => void
  setShowDims: (on: boolean) => void
  setPenWidth: (w: number) => void
  setShowIds: (on: boolean) => void
  /** Erases the given 1px cells ("x,y" keys) out of painted strokes (splits as needed). */
  eraseCells: (keys: string[]) => void
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
  /** Declare the chart's real stage width in metres → calibrates scale so new parts
   *  drop at true physical size. 0 / empty clears calibration. */
  setStageWidthMeters: (m: number) => void
  /** Resize fixtures placed before calibration to real size at the current scale
   *  (interprets each fixture's current px as millimetres). Positions unchanged.
   *  No-op when uncalibrated. Undoable. */
  fitFixturesToScale: () => void
  setGamma: (on: boolean) => void
  setHoldOnTimeout: (on: boolean) => void
  setGlow: (on: boolean) => void
  setGlowAmount: (px: number) => void
  setSyphonName: (name: string) => void
  /** Show title — becomes the default save filename. */
  setChartName: (name: string) => void
  /** The Keys cheat-sheet panel ("?" or the Toolbar button). */
  helpOpen: boolean
  setHelpOpen: (on: boolean) => void
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
  selectedIds: [],
  dmxByUniverse: {},
  lastSeenByUniverse: {},
  manualMode: false,
  manualByFixture: {},
  paletteFilter: 'all',
  snapToPixel: true,
  stepPatch: false,
  penWidth: 1,
  showDims: true,
  showIds: true,
  mask: null,
  maskEmpty: false,
  clipboard: null,
  pasteArmed: false,
  pasteMark: null,
  lastDup: null,
  started: initialStarted(),
  imageLight: false,
  lightingOnly: false,
  imageLightUndo: null,
  imageLightRedo: null,
  imageLightCopy: null,
  imageLightPaste: null,
  history: [],
  future: [],
  histTag: null,
  histAt: 0,

  beginHistory: (tag) =>
    set((s) => {
      const now = Date.now()
      if (tag && s.histTag === tag && now - s.histAt < 600) return { histAt: now }
      return {
        history: [...s.history.slice(-49), s.chart],
        future: [],
        histTag: tag ?? null,
        histAt: now
      }
    }),
  undo: () =>
    set((s) => {
      const prev = s.history[s.history.length - 1]
      if (!prev) return {}
      return {
        chart: prev,
        history: s.history.slice(0, -1),
        future: [s.chart, ...s.future].slice(0, 50),
        selectedId: null,
        selectedIds: [],
        histTag: null
      }
    }),
  redo: () =>
    set((s) => {
      const next = s.future[0]
      if (!next) return {}
      return {
        chart: next,
        future: s.future.slice(1),
        history: [...s.history.slice(-49), s.chart],
        selectedId: null,
        selectedIds: [],
        histTag: null
      }
    }),
  setStarted: (started) => set({ started }),
  setImageLight: (imageLight) => set({ imageLight }),
  setLightingOnly: (lightingOnly) => set({ lightingOnly }),
  setImageLightHandlers: (h) =>
    set(
      h
        ? {
            imageLightUndo: h.undo,
            imageLightRedo: h.redo,
            imageLightCopy: h.copy,
            imageLightPaste: h.paste
          }
        : {
            imageLightUndo: null,
            imageLightRedo: null,
            imageLightCopy: null,
            imageLightPaste: null
          }
    ),
  applyChartImage: (dataUrl, w, h) => {
    get().beginHistory()
    set((s) => ({
      chart: {
        ...s.chart,
        canvas: { w, h },
        layers: s.chart.layers.map((l) =>
          l.id === s.chart.activeLayerId
            ? {
                ...l,
                underlay: {
                  dataUrl,
                  opacity: 0.5,
                  visible: true,
                  mask: { enabled: true, invert: false }
                }
              }
            : l
        )
      }
    }))
  },
  setChart: (chart) => set({ chart, selectedId: null, selectedIds: [] }),
  setMode: (mode) => set({ mode }),
  setTool: (tool) => set({ tool }),
  select: (selectedId) => set({ selectedId, selectedIds: selectedId ? [selectedId] : [] }),
  selectMany: (ids) => set({ selectedIds: ids, selectedId: ids.length === 1 ? ids[0] : null }),
  toggleSelect: (id) =>
    set((s) => {
      const ids = s.selectedIds.includes(id)
        ? s.selectedIds.filter((x) => x !== id)
        : [...s.selectedIds, id]
      return { selectedIds: ids, selectedId: ids.length === 1 ? ids[0] : null }
    }),
  removeShapes: (ids) => {
    if (ids.length === 0) return
    get().beginHistory()
    const drop = new Set(ids)
    set((s) => ({
      chart: {
        ...s.chart,
        shapes: s.chart.shapes.filter((sh) => !drop.has(sh.id)),
        fixtures: s.chart.fixtures.filter((f) => !drop.has(f.shapeId))
      },
      selectedId: null,
      selectedIds: []
    }))
  },
  mergeShapes: (ids) => {
    const m = mergeRunCells(get().chart, ids)
    if (!m) return
    get().beginHistory()
    const { points, verts } = regenChain(m.vertCells)
    set((s) => ({
      chart: applyMerge(s.chart, m.keepId, points, verts, m.dropIds),
      selectedId: m.keepId,
      selectedIds: [m.keepId]
    }))
  },
  copySelection: () => {
    const s = get()
    const ids = new Set(s.selectedIds)
    if (ids.size === 0) return
    const shapes = s.chart.shapes
      .filter((sh) => ids.has(sh.id))
      .map((sh) => ({ ...sh, points: sh.points.map((p) => ({ ...p })) }))
    const fixtures = s.chart.fixtures.filter((f) => ids.has(f.shapeId)).map((f) => ({ ...f }))
    set({ clipboard: { shapes, fixtures } })
  },
  setPasteArmed: (pasteArmed) => set({ pasteArmed }),
  setPasteMark: (pasteMark) => set({ pasteMark }),
  pasteAt: (at) => {
    const cb = get().clipboard
    if (!cb || cb.shapes.length === 0) return
    get().beginHistory()
    // anchor rule lives in pasteDelta: bulbs land CENTRED on the clicked dot, other
    // shapes keep the top-left anchor; whole-cell offsets keep .5 centres crisp
    const { x: dx, y: dy } = pasteDelta(cb.shapes, at)
    const idMap = new Map<string, string>()
    const pasteLayer = get().chart.activeLayerId // stamps land on the song being edited
    const newShapes: Shape[] = cb.shapes.map((sh) => {
      const nid = newId('shape')
      idMap.set(sh.id, nid)
      return {
        ...sh,
        id: nid,
        layerId: pasteLayer,
        points: sh.points.map((p) => ({ x: p.x + dx, y: p.y + dy })),
        fixtureId: undefined // wired below when the original was patched
      }
    })
    const newFixtures: Fixture[] = []
    for (const f of cb.fixtures) {
      const shapeId = idMap.get(f.shapeId)
      if (!shapeId) continue
      const nf: Fixture = { ...f, id: newId('fx'), shapeId } // same address: lights together
      newFixtures.push(nf)
      const sh = newShapes.find((x) => x.id === shapeId)
      if (sh) sh.fixtureId = nf.id
    }
    // ステップアップ中のスタンプは「クローン番地」ではなく連番で刻む — ボール球を
    // ペタペタ押すだけで仕込みが進む
    if (get().stepPatch && newFixtures.length > 0) {
      const all = get().chart.fixtures
      let prev: Fixture | undefined = all[all.length - 1]
      let prevShape = prev ? get().chart.shapes.find((x) => x.id === prev!.shapeId) : undefined
      for (const nf of newFixtures) {
        const addr = prev
          ? nextAddressAfter(prev, prevShape ? repeatCount(prevShape) : 1)
          : { universe: 0, start: 1 }
        nf.universe = addr.universe
        nf.start = addr.start
        prev = nf
        prevShape = newShapes.find((x) => x.id === nf.shapeId)
      }
    }
    set((s) => ({
      chart: {
        ...s.chart,
        shapes: [...s.chart.shapes, ...newShapes],
        fixtures: [...s.chart.fixtures, ...newFixtures]
      },
      selectedIds: newShapes.map((x) => x.id),
      selectedId: newShapes.length === 1 ? newShapes[0].id : null
    }))
  },

  pasteOffset: () => {
    const cb = get().clipboard
    if (!cb || cb.shapes.length === 0) return
    // 元から少し横にずらして即ペースト（LIGHT SKETCH と同じ）。pasteDelta(…,{0,0}) は -アンカー
    // なので、それを打ち消して +OFF した点を pasteAt に渡すと、結果は元位置から +OFF の平行移動。
    const OFF = 14
    const d0 = pasteDelta(cb.shapes, { x: 0, y: 0 })
    get().pasteAt({ x: -d0.x + OFF, y: -d0.y + OFF })
  },

  // 選択した図形を各 points ごと平行移動して動かす共通処理（整列・等間隔の land）。
  // ロック分は触らない（掴めない＝動かさない、の一貫）。⌘Z で1手で戻せる。
  alignShapes: (edge) => {
    const ids = get().selectedIds
    const sel = get().chart.shapes.filter((s) => ids.includes(s.id) && !s.locked)
    if (sel.length < 2) return
    get().beginHistory()
    const bs = sel.map((s) => ({ id: s.id, b: shapeArrayBounds(s) }))
    const minX = Math.min(...bs.map((x) => x.b.x))
    const maxX = Math.max(...bs.map((x) => x.b.x + x.b.w))
    const minY = Math.min(...bs.map((x) => x.b.y))
    const maxY = Math.max(...bs.map((x) => x.b.y + x.b.h))
    const cx = (minX + maxX) / 2
    const cy = (minY + maxY) / 2
    const d = new Map<string, Point>()
    for (const { id, b } of bs) {
      let dx = 0
      let dy = 0
      if (edge === 'left') dx = minX - b.x
      else if (edge === 'right') dx = maxX - (b.x + b.w)
      else if (edge === 'hcenter') dx = cx - (b.x + b.w / 2)
      else if (edge === 'top') dy = minY - b.y
      else if (edge === 'bottom') dy = maxY - (b.y + b.h)
      else if (edge === 'vcenter') dy = cy - (b.y + b.h / 2)
      d.set(id, { x: dx, y: dy })
    }
    set((state) => ({
      chart: {
        ...state.chart,
        shapes: state.chart.shapes.map((s) => {
          const m = d.get(s.id)
          return m ? { ...s, points: s.points.map((p) => ({ x: p.x + m.x, y: p.y + m.y })) } : s
        })
      }
    }))
  },

  distributeShapes: (axis) => {
    const ids = get().selectedIds
    const sel = get().chart.shapes.filter((s) => ids.includes(s.id) && !s.locked)
    if (sel.length < 3) return
    get().beginHistory()
    const cen = (b: { x: number; y: number; w: number; h: number }): number =>
      axis === 'h' ? b.x + b.w / 2 : b.y + b.h / 2
    const bs = sel.map((s) => ({ id: s.id, b: shapeArrayBounds(s) })).sort((a, c) => cen(a.b) - cen(c.b))
    const first = cen(bs[0].b)
    const last = cen(bs[bs.length - 1].b)
    const step = (last - first) / (bs.length - 1) // 中心を等間隔に。両端2個は動かさない
    const d = new Map<string, Point>()
    bs.forEach(({ id, b }, i) => {
      const delta = first + step * i - cen(b)
      d.set(id, axis === 'h' ? { x: delta, y: 0 } : { x: 0, y: delta })
    })
    set((state) => ({
      chart: {
        ...state.chart,
        shapes: state.chart.shapes.map((s) => {
          const m = d.get(s.id)
          return m ? { ...s, points: s.points.map((p) => ({ x: p.x + m.x, y: p.y + m.y })) } : s
        })
      }
    }))
  },

  updateShape: (id, patch) => {
    get().beginHistory(`upd-${id}`)
    set((s) => ({
      chart: {
        ...s.chart,
        shapes: s.chart.shapes.map((sh) => (sh.id === id ? { ...sh, ...patch } : sh))
      }
    }))
  },

  addShape: (init) => {
    get().beginHistory()
    let c2 = addShapeToChart(get().chart, init)
    const created = c2.shapes[c2.shapes.length - 1]
    // ステップアップ: the new shape lands right after the last fixture's span
    // (mode inherited) — heavy plots never need per-shape manual addressing
    if (get().stepPatch) {
      const prev = c2.fixtures[c2.fixtures.length - 1]
      const prevShape = prev ? c2.shapes.find((s) => s.id === prev.shapeId) : undefined
      const addr = prev
        ? nextAddressAfter(prev, prevShape ? repeatCount(prevShape) : 1)
        : { universe: 0, start: 1 }
      const fx: Fixture = {
        id: newId('fx'),
        shapeId: created.id,
        universe: addr.universe,
        start: addr.start,
        mode: prev?.mode ?? 'rgb',
        ...(prev?.mode === 'dim' && prev.fixedColor ? { fixedColor: prev.fixedColor } : {})
      }
      c2 = {
        ...c2,
        shapes: c2.shapes.map((s) => (s.id === created.id ? { ...s, fixtureId: fx.id } : s)),
        fixtures: [...c2.fixtures, fx]
      }
    }
    set({ chart: c2, selectedId: created.id, selectedIds: [created.id] })
    return created.id
  },

  removeShape: (id) => {
    get().beginHistory()
    set((s) => ({
      chart: {
        ...s.chart,
        shapes: s.chart.shapes.filter((sh) => sh.id !== id),
        fixtures: s.chart.fixtures.filter((f) => f.shapeId !== id)
      },
      selectedId: s.selectedId === id ? null : s.selectedId,
      selectedIds: s.selectedIds.filter((x) => x !== id)
    }))
  },

  setUniverseData: (universe, data) =>
    set((s) => ({
      dmxByUniverse: { ...s.dmxByUniverse, [universe]: data },
      lastSeenByUniverse: { ...s.lastSeenByUniverse, [universe]: Date.now() }
    })),

  setUnderlay: (underlay) => {
    get().beginHistory()
    set((s) => ({ chart: patchActiveUnderlay(s.chart, () => underlay) }))
  },
  setUnderlayOpacity: (opacity) => {
    get().beginHistory('underlay-op')
    set((s) => ({ chart: patchActiveUnderlay(s.chart, (u) => (u ? { ...u, opacity } : null)) }))
  },
  setUnderlayVisible: (visible) =>
    set((s) => ({ chart: patchActiveUnderlay(s.chart, (u) => (u ? { ...u, visible } : null)) })),

  addLayer: (init) => {
    const id = newId('layer')
    get().beginHistory()
    set((s) => ({
      chart: {
        ...s.chart,
        layers: [
          ...s.chart.layers,
          {
            id,
            name: init?.name ?? `CHART ${s.chart.layers.length + 1}`,
            underlay: init?.underlay ?? null,
            visible: true
          }
        ],
        activeLayerId: id
      },
      selectedId: null,
      selectedIds: []
    }))
    return id
  },
  removeLayer: (id) => {
    get().beginHistory()
    set((s) => {
      if (s.chart.layers.length <= 1) return {}
      const layers = s.chart.layers.filter((l) => l.id !== id)
      const dead = new Set(s.chart.shapes.filter((sh) => sh.layerId === id).map((sh) => sh.id))
      return {
        chart: {
          ...s.chart,
          layers,
          activeLayerId: s.chart.activeLayerId === id ? layers[0].id : s.chart.activeLayerId,
          shapes: s.chart.shapes.filter((sh) => sh.layerId !== id),
          fixtures: s.chart.fixtures.filter((f) => !dead.has(f.shapeId))
        },
        selectedId: null,
        selectedIds: []
      }
    })
  },
  setActiveLayer: (id) =>
    set((s) =>
      s.chart.layers.some((l) => l.id === id)
        ? { chart: { ...s.chart, activeLayerId: id }, selectedId: null, selectedIds: [] }
        : {}
    ),
  setLayerVisible: (id, visible) =>
    set((s) => ({
      chart: {
        ...s.chart,
        layers: s.chart.layers.map((l) => (l.id === id ? { ...l, visible } : l))
      }
    })),
  renameLayer: (id, name) =>
    set((s) => ({
      chart: {
        ...s.chart,
        layers: s.chart.layers.map((l) => (l.id === id ? { ...l, name } : l))
      }
    })),

  upsertFixture: (shapeId, patch) => {
    get().beginHistory(`fx-${shapeId}`)
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
      // 照明灯体(light)は既定で beam8(8ch)、それ以外は rgb。shape が見つからなければ rgb に倒す。
      const sh0 = s.chart.shapes.find((x) => x.id === shapeId)
      const defMode: ChannelMode =
        sh0 && (sh0.family ?? familyOfType(sh0.type)) === 'light' ? 'beam8' : 'rgb'
      const fx: Fixture = {
        id: newId('fx'),
        shapeId,
        universe: 0,
        start: 1,
        mode: defMode,
        ...patch
      }
      return {
        chart: {
          ...s.chart,
          fixtures: [...s.chart.fixtures, fx],
          shapes: s.chart.shapes.map((sh) => (sh.id === shapeId ? { ...sh, fixtureId: fx.id } : sh))
        }
      }
    })
  },

  setLocked: (shapeIds, on) => {
    get().beginHistory()
    set((s) => {
      const idSet = new Set(shapeIds)
      return {
        chart: {
          ...s.chart,
          shapes: s.chart.shapes.map((sh) => (idSet.has(sh.id) ? { ...sh, locked: on } : sh))
        },
        ...(on
          ? {
              selectedIds: s.selectedIds.filter((i) => !idSet.has(i)),
              selectedId: s.selectedId && idSet.has(s.selectedId) ? null : s.selectedId
            }
          : {})
      }
    })
  },

  bulkPatch: (shapeIds, patch) => {
    get().beginHistory('bulkpatch') // scrubbing a field = one undo step
    set((s) => {
      const idSet = new Set(shapeIds)
      const have = new Set(
        s.chart.fixtures.filter((f) => idSet.has(f.shapeId)).map((f) => f.shapeId)
      )
      const updated = s.chart.fixtures.map((f) => (idSet.has(f.shapeId) ? { ...f, ...patch } : f))
      const created: Fixture[] = shapeIds
        .filter((id) => !have.has(id))
        .map((id) => {
          const sh = s.chart.shapes.find((x) => x.id === id)
          const defMode: ChannelMode =
            sh && (sh.family ?? familyOfType(sh.type)) === 'light' ? 'beam8' : 'rgb'
          return {
            id: newId('fx'),
            shapeId: id,
            universe: 0,
            start: 1,
            mode: defMode,
            ...patch
          }
        })
      return { chart: { ...s.chart, fixtures: [...updated, ...created] } }
    })
  },

  removeFixture: (shapeId) => {
    get().beginHistory()
    set((s) => ({
      chart: {
        ...s.chart,
        fixtures: s.chart.fixtures.filter((f) => f.shapeId !== shapeId),
        shapes: s.chart.shapes.map((sh) =>
          sh.id === shapeId ? { ...sh, fixtureId: undefined } : sh
        )
      }
    }))
  },

  setManualMode: (on) => set({ manualMode: on }),
  setManualColor: (fixtureId, rgb) =>
    set((s) => ({ manualByFixture: { ...s.manualByFixture, [fixtureId]: rgb } })),
  setManualMany: (fixtureIds, rgb) =>
    set((s) => {
      const next = { ...s.manualByFixture }
      for (const id of fixtureIds) next[id] = rgb
      return { manualByFixture: next, manualMode: true }
    }),
  setManualAll: (rgb) =>
    set((s) => {
      if (rgb === null) return { manualByFixture: {} }
      const m: Record<string, [number, number, number]> = {}
      for (const f of s.chart.fixtures) m[f.id] = rgb
      return { manualByFixture: m }
    }),

  setCanvasSize: (w, h) => {
    get().beginHistory('canvas-size') // ⌘Zでサイズを戻せるように（連続変更は600msでまとめる）
    set((s) => ({ chart: { ...s.chart, canvas: { w, h } } }))
  },
  setStageWidthMeters: (m) => {
    get().beginHistory('stage-width')
    set((s) => ({
      chart: {
        ...s.chart,
        settings: {
          ...s.chart.settings,
          stageWidthMm: m > 0 && isFinite(m) ? Math.round(m * 1000) : undefined
        }
      }
    }))
  },
  fitFixturesToScale: () => {
    const k = mmPerPx(get().chart)
    if (!k) return
    get().beginHistory('fit-scale')
    set((s) => ({ chart: { ...s.chart, shapes: rescaleFixturesToScale(s.chart.shapes, k) } }))
  },
  setGamma: (on) =>
    set((s) => ({ chart: { ...s.chart, settings: { ...s.chart.settings, gamma: on } } })),
  setHoldOnTimeout: (on) =>
    set((s) => ({ chart: { ...s.chart, settings: { ...s.chart.settings, holdOnTimeout: on } } })),
  setGlow: (on) =>
    set((s) => ({ chart: { ...s.chart, settings: { ...s.chart.settings, glow: on } } })),
  setGlowAmount: (px) =>
    set((s) => ({ chart: { ...s.chart, settings: { ...s.chart.settings, glowAmount: px } } })),
  setSyphonName: (name) => set((s) => ({ chart: { ...s.chart, syphon: { name } } })),
  setChartName: (name) => set((s) => ({ chart: { ...s.chart, name } })),
  helpOpen: false,
  setHelpOpen: (helpOpen) => set({ helpOpen }),
  setSnap: (on) => set({ snapToPixel: on }),
  setPaletteFilter: (paletteFilter) => set({ paletteFilter }),
  setStepPatch: (on) => set({ stepPatch: on }),
  setUnderlayMask: (patch) =>
    set((s) => {
      const u = activeLayerOf(s.chart).underlay
      if (!u) return {}
      const cur = u.mask ?? { enabled: false, invert: false }
      return {
        chart: patchActiveUnderlay(s.chart, () => ({ ...u, mask: { ...cur, ...patch } }))
      }
    }),
  setMaskData: (m) => set({ mask: m }),
  setMaskEmpty: (maskEmpty) => set({ maskEmpty }),
  setShowDims: (showDims) => set({ showDims }),
  setPenWidth: (w) => set({ penWidth: Math.max(1, Math.min(500, Math.round(w))) }),
  setShowIds: (showIds) => set({ showIds }),
  eraseCells: (keys) => {
    get().beginHistory('erase')
    set((s) => {
      const r = eraseCellsFromChart(s.chart, new Set(keys), s.chart.activeLayerId)
      if (!r.changed) return {}
      const alive = new Set(r.chart.shapes.map((sh) => sh.id))
      const ids = s.selectedIds.filter((x) => alive.has(x))
      return {
        chart: r.chart,
        selectedIds: ids,
        selectedId: ids.length === 1 ? ids[0] : null
      }
    })
  },
  autoFill: (opts) => {
    const { mask } = get()
    if (!mask) return 0
    get().beginHistory()
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
          layerId: get().chart.activeLayerId,
          points: [
            { x: Math.round(x - opts.cellW / 2), y: Math.round(y - opts.cellH / 2) },
            { x: Math.round(x + opts.cellW / 2), y: Math.round(y + opts.cellH / 2) }
          ],
          display: 'fill',
          strokeWidth: 1,
          fixtureId: fid
        })
        newFixtures.push({
          id: fid,
          shapeId: id,
          universe: a.universe,
          start: a.start,
          mode: opts.mode
        })
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
  nudgeShape: (id, dx, dy) => {
    get().beginHistory(`nudge-${id}`)
    set((s) => ({
      chart: {
        ...s.chart,
        shapes: s.chart.shapes.map((sh) =>
          sh.id === id
            ? { ...sh, points: sh.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) }
            : sh
        )
      }
    }))
  },
  nudgeShapes: (ids, dx, dy) => {
    if (!ids.length) return
    get().beginHistory(`nudge-${ids.join('+')}`)
    const idSet = new Set(ids)
    set((s) => ({
      chart: {
        ...s.chart,
        shapes: s.chart.shapes.map((sh) =>
          idSet.has(sh.id)
            ? { ...sh, points: sh.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) }
            : sh
        )
      }
    }))
  },
  setShapePoints: (id, points) =>
    set((s) => ({
      chart: {
        ...s.chart,
        shapes: s.chart.shapes.map((sh) => (sh.id === id ? { ...sh, points } : sh))
      }
    })),
  duplicateShape: (id) => {
    get().beginHistory()
    set((s) => {
      const sh = s.chart.shapes.find((x) => x.id === id)
      if (!sh) return {}
      // duplicating the copy from the last ⌘D repeats that pair's offset — drag the
      // first copy into place, then ⌘D ⌘D ⌘D continues the run at the same pitch
      let dx = 10
      let dy = 10
      if (s.lastDup && s.lastDup.newId === id) {
        const src = s.chart.shapes.find((x) => x.id === s.lastDup!.srcId)
        if (src && src.points[0] && sh.points[0]) {
          const px = sh.points[0].x - src.points[0].x
          const py = sh.points[0].y - src.points[0].y
          if (px !== 0 || py !== 0) {
            dx = px
            dy = py
          }
        }
      }
      const nid = newId('shape')
      const copy: Shape = {
        ...sh,
        id: nid,
        points: sh.points.map((p) => ({ x: p.x + dx, y: p.y + dy })),
        fixtureId: undefined
      }
      let fixtures = s.chart.fixtures
      const fx = s.chart.fixtures.find((f) => f.shapeId === id)
      if (fx) {
        const nfid = newId('fx')
        copy.fixtureId = nfid
        fixtures = [...fixtures, { ...fx, id: nfid, shapeId: nid }]
      }
      return {
        chart: { ...s.chart, shapes: [...s.chart.shapes, copy], fixtures },
        selectedId: nid,
        selectedIds: [nid],
        lastDup: { srcId: id, newId: nid }
      }
    })
  }
}))

// Test/debug hook: lets the browser preview drive the store (e.g. seed demo shapes).
if (typeof window !== 'undefined') {
  ;(window as unknown as { __decorStore?: typeof useStore }).__decorStore = useStore
}
