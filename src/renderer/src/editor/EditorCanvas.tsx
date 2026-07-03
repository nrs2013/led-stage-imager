import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as RPointerEvent
} from 'react'
import { useStore, activeLayerOf } from '../state/store'
import { visibleByFilter } from '../model/part-family'
import type { Point, Shape } from '../model/types'
import { fileToDataUrl } from '../io/image-pick'
import { saveChartToFile } from '../io/file-ops'
import { C, F } from '../ui/tokens'
import {
  cornerBounds,
  traceShape,
  shapeArrayBounds,
  shapeIntersectsRect,
  cellsBetween,
  isCellRun,
  segDist,
  bulbDiameter,
  pasteDelta,
  type Bounds
} from './geometry'
import {
  buildCandidates,
  centerCandidates,
  salientOf,
  salientOfGroup,
  snap1D,
  snapMoveDelta,
  buildGapCandidates,
  mergeCand,
  softAxis,
  type SnapCand,
  type Salient
} from './snapping'

/** Vertex / corner / edge handles are POINTS: they may snap to either family. */
const flatX = (c: SnapCand): number[] => [...c.xs, ...(c.cxs ?? [])]
const flatY = (c: SnapCand): number[] => [...c.ys, ...(c.cys ?? [])]
import { cleanPaintStroke, regenChain } from './stroke-fit'
import { findDrawableRegions, type Region } from './regions'
import {
  drawNeonSchematic,
  clearNeonLayoutCache,
  NEON_DEFAULT_TEXT,
  NEON_DEFAULT_FONT,
  NEON_DEFAULT_SIZE,
  NEON_DEFAULT_GLOW
} from '../render/neon'
import {
  drawMarqueeSchematic,
  clearMarqueeCache,
  MARQUEE_DEFAULT_TEXT,
  MARQUEE_DEFAULT_SIZE,
  MARQUEE_DEFAULT_PITCH,
  MARQUEE_DEFAULT_FONT
} from '../render/marquee'
import {
  drawStarsSchematic,
  STARS_DEFAULT_DENSITY,
  STARS_DEFAULT_WHITE_RATIO,
  STARS_DEFAULT_SIZE
} from '../render/stars'
import {
  drawFestoonSchematic,
  festoonSamples,
  FESTOON_DEFAULT_SAG,
  FESTOON_DEFAULT_PITCH,
  FESTOON_DEFAULT_DIAMETER,
  FESTOON_DEFAULT_GLOW
} from '../render/festoon'
import {
  drawParSchematic,
  drawBlinderSchematic,
  drawPattSchematic,
  drawPixelPattSchematic,
  PAR_DEFAULT_DIAMETER,
  BLINDER_DEFAULT_WIDTH,
  PATT_DEFAULT_DIAMETER,
  PIXELPATT_DEFAULT_DIAMETER
} from '../render/fixtures'
import {
  drawImageSchematic,
  drawUplightSchematic,
  UPLIGHT_DEFAULT_W0,
  UPLIGHT_DEFAULT_W1,
  UPLIGHT_DEFAULT_LEN
} from '../render/uplight'
import { BULB_DEFAULT_DIAMETER } from '../render/bulb'
import { drawRoomLampSchematic, ROOMLAMP_DEFAULT_DIAMETER } from '../render/roomlamp'
import { drawStreetLampSchematic, STREETLAMP_DEFAULT_DIAMETER } from '../render/streetlamp'
import { drawChandelierSchematic, CHANDELIER_DEFAULT_DIAMETER } from '../render/chandelier'
import { mmToCanvasPx, mmPerPx } from '../model/scale'

const cellOfPt = (p: Point): Point => ({ x: Math.floor(p.x), y: Math.floor(p.y) })

const MIN_SIZE = 3
const clamp = (n: number, lo: number, hi: number): number => (n < lo ? lo : n > hi ? hi : n)
const dist = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y)

// Editor-only display colours: each shape gets its own so adjacent runs are tellable
// apart at a glance. (The real colour on stage comes from the console via DMX.)
const SHAPE_COLORS = ['#7bc5e8', '#a8e878', '#f5c878', '#c186c8', '#ffe57a', '#e0726a', '#8fd8c8']
const shapeColor = (i: number): string => SHAPE_COLORS[i % SHAPE_COLORS.length]
const shapeFill = (i: number): string => {
  const hx = SHAPE_COLORS[i % SHAPE_COLORS.length]
  const r = parseInt(hx.slice(1, 3), 16)
  const g = parseInt(hx.slice(3, 5), 16)
  const b = parseInt(hx.slice(5, 7), 16)
  return `rgba(${r},${g},${b},0.16)`
}
const SELECT_STROKE = '#ffffff'

type DrawType = Exclude<Shape['type'], never>
interface View {
  scale: number
  tx: number
  ty: number
}

const isOpen = (t: Shape['type']): boolean => t === 'line' || t === 'polyline' || t === 'freehand'

/** Two-corner box shapes: resized by dragging a bounding-box corner. */
const BOXY = new Set<Shape['type']>([
  'rect',
  'ellipse',
  'triangle',
  'star',
  'polygon',
  'stars',
  'image'
])

/** One pointer gesture on the canvas: move the whole shape, drag one vertex
 *  (line/polyline), drag a box corner/edge against its fixed opposite side, or pull
 *  the end of a painted run to change its length. Alignment candidates are computed
 *  once at gesture start. */
type Interaction =
  | {
      kind: 'move'
      ids: string[] // one or many (group move)
      sx: number
      sy: number
      origs: Point[][]
      forceSnap?: boolean
      cand?: SnapCand // alignment targets (single-shape moves only)
      sal?: Salient
    }
  | { kind: 'vertex'; id: string; idx: number; cand?: SnapCand }
  | { kind: 'corner'; id: string; anchor: Point; aspect: number; cand?: SnapCand }
  | { kind: 'edge'; id: string; b: Bounds; dir: 'n' | 's' | 'e' | 'w'; cand?: SnapCand }
  | { kind: 'end'; id: string; anchor: Point; cand?: SnapCand } // anchor = fixed end's cell
  | { kind: 'chainvert'; id: string; idx: number; cand?: SnapCand } // idx into shape.verts

interface Handle {
  x: number
  y: number
  kind: 'vertex' | 'corner' | 'end' | 'edge' | 'chainvert'
  idx: number
  anchor?: Point
  dir?: 'n' | 's' | 'e' | 'w'
}

/** A painted dot run (any width) — shared cell-centre test from geometry. */
const isPaintedRun = isCellRun

/** Grabbable handles of a shape. Painted runs expose their two ends (pull = re-aim /
 *  change length); smooth pen strokes have none (move/delete/repaint). */
function shapeHandles(sh: Shape): Handle[] {
  if (sh.type === 'line' || sh.type === 'polyline' || sh.type === 'festoon') {
    return sh.points.map((p, i) => ({ x: p.x, y: p.y, kind: 'vertex' as const, idx: i }))
  }
  if (sh.type === 'freehand' && isPaintedRun(sh)) {
    // cleaned chains: every corner is grabbable (drag regenerates the adjacent runs)
    if (sh.verts && sh.verts.length >= 2) {
      return sh.verts.map((pi, i) => ({
        x: sh.points[pi].x,
        y: sh.points[pi].y,
        kind: 'chainvert' as const,
        idx: i
      }))
    }
    const a = sh.points[0]
    const b = sh.points[sh.points.length - 1]
    if (sh.points.length === 1 || (a.x === b.x && a.y === b.y)) {
      return [{ x: b.x, y: b.y, kind: 'end' as const, idx: 1, anchor: cellOfPt(a) }]
    }
    return [
      { x: a.x, y: a.y, kind: 'end' as const, idx: 0, anchor: cellOfPt(b) },
      { x: b.x, y: b.y, kind: 'end' as const, idx: 1, anchor: cellOfPt(a) }
    ]
  }
  if (BOXY.has(sh.type) && sh.points.length >= 2) {
    const b = cornerBounds(sh.points[0], sh.points[sh.points.length - 1])
    const corners = [
      { x: b.x, y: b.y },
      { x: b.x + b.w, y: b.y },
      { x: b.x, y: b.y + b.h },
      { x: b.x + b.w, y: b.y + b.h }
    ].map((c, i) => ({
      ...c,
      kind: 'corner' as const,
      idx: i,
      anchor: { x: 2 * b.x + b.w - c.x, y: 2 * b.y + b.h - c.y } // opposite corner stays put
    }))
    const edges: Handle[] = [
      { x: b.x + b.w / 2, y: b.y, kind: 'edge', idx: 4, dir: 'n' },
      { x: b.x + b.w / 2, y: b.y + b.h, kind: 'edge', idx: 5, dir: 's' },
      { x: b.x, y: b.y + b.h / 2, kind: 'edge', idx: 6, dir: 'w' },
      { x: b.x + b.w, y: b.y + b.h / 2, kind: 'edge', idx: 7, dir: 'e' }
    ]
    return [...corners, ...edges]
  }
  return []
}

/** Shift constraint: horizontal / vertical / 45° from the anchor (cell coords). */
function axisSnap(a: Point, c: Point): Point {
  const dx = c.x - a.x
  const dy = c.y - a.y
  if (Math.abs(dx) > 2 * Math.abs(dy)) return { x: c.x, y: a.y }
  if (Math.abs(dy) > 2 * Math.abs(dx)) return { x: a.x, y: c.y }
  const m = Math.round((Math.abs(dx) + Math.abs(dy)) / 2)
  return { x: a.x + Math.sign(dx) * m, y: a.y + Math.sign(dy) * m }
}

/** Draws one shape (with its repeat array) in a given colour into the content buffer.
 *  `boost` is a display-only minimum width so 1px LED lines stay visible (and their
 *  colours readable) when zoomed far out — the real output is always the exact width.
 *  Painted dot runs render as exact filled cells (pixel-solid, no AA fade). */
function drawShapeInto(
  ctx: CanvasRenderingContext2D,
  shape: Shape,
  stroke: string,
  fill: string,
  boost = 1
): void {
  const reps = shape.repeat && shape.repeat.count > 1 ? shape.repeat.count : 1
  const dx = shape.repeat?.dx ?? 0
  const dy = shape.repeat?.dy ?? 0
  if (isCellRun(shape)) {
    ctx.fillStyle = stroke
    const n = Math.max(Math.round(shape.strokeWidth || 1), boost)
    const off = Math.floor((n - 1) / 2)
    for (let i = 0; i < reps; i++) {
      const ox = dx * i
      const oy = dy * i
      let px = NaN
      let py = NaN
      for (const p of shape.points) {
        const cx = Math.floor(p.x + ox)
        const cy = Math.floor(p.y + oy)
        if (cx === px && cy === py) continue
        px = cx
        py = cy
        ctx.fillRect(cx - off, cy - off, n, n)
      }
    }
    return
  }
  // ball bulbs: schematic in the editor — glass-edge ring + the exact centre cell.
  // (The photoreal lit render lives in Live / Syphon output.)
  if (shape.type === 'bulb') {
    const c0 = shape.points[0]
    if (!c0) return
    const r = bulbDiameter(shape) / 2
    ctx.strokeStyle = stroke
    ctx.lineWidth = Math.max(1, boost) * 0.6
    for (let i = 0; i < reps; i++) {
      const x = c0.x + dx * i
      const y = c0.y + dy * i
      ctx.fillStyle = fill
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
      ctx.fillStyle = stroke
      ctx.fillRect(x - 0.5, y - 0.5, 1, 1)
    }
    return
  }
  // neon signs: schematic cold tubes in the editor (the lit render lives in
  // Live / Syphon output, like the bulb)
  if (shape.type === 'neon') {
    drawNeonSchematic(ctx, shape, stroke, fill, boost)
    return
  }
  // marquee lights: cold bulb-letters in the editor (lit render in Live/Syphon)
  if (shape.type === 'marquee') {
    drawMarqueeSchematic(ctx, shape, stroke, fill, boost)
    return
  }
  // star fields: dashed frame + the cold dots (same sky the output will light)
  if (shape.type === 'stars') {
    drawStarsSchematic(ctx, shape, stroke, fill, boost)
    return
  }
  // festoon strings: the sagging wire + cold sockets
  if (shape.type === 'festoon') {
    drawFestoonSchematic(ctx, shape, stroke, fill, boost)
    return
  }
  // stage fixtures: cold housings (the lit render lives in Live / Syphon output)
  if (shape.type === 'parlight') {
    drawParSchematic(ctx, shape, stroke, fill, boost)
    return
  }
  if (shape.type === 'blinder') {
    drawBlinderSchematic(ctx, shape, stroke, fill, boost)
    return
  }
  if (shape.type === 'patt') {
    drawPattSchematic(ctx, shape, stroke, fill, boost)
    return
  }
  if (shape.type === 'pixelpatt') {
    drawPixelPattSchematic(ctx, shape, stroke, fill, boost)
    return
  }
  // virtual set-dressing lights: cold housings in the editor (lit render in Live/Syphon)
  if (shape.type === 'roomlamp') {
    drawRoomLampSchematic(ctx, shape, stroke, fill, boost)
    return
  }
  if (shape.type === 'streetlamp') {
    drawStreetLampSchematic(ctx, shape, stroke, fill, boost)
    return
  }
  if (shape.type === 'chandelier') {
    drawChandelierSchematic(ctx, shape, stroke, fill, boost)
    return
  }
  // photo material: the albedo at half strength + dashed frame (lights up in Live)
  if (shape.type === 'image') {
    drawImageSchematic(ctx, shape, stroke, boost)
    return
  }
  // uplight / movinghead: housing mark + dashed beam outline (the rigging plot)
  if (shape.type === 'uplight' || shape.type === 'movinghead') {
    drawUplightSchematic(ctx, shape, stroke, fill, boost)
    return
  }
  const open = isOpen(shape.type)
  ctx.strokeStyle = stroke
  ctx.fillStyle = fill
  ctx.lineWidth = Math.max(shape.strokeWidth || 1, boost)
  for (let i = 0; i < reps; i++) {
    ctx.save()
    if (dx * i || dy * i) ctx.translate(dx * i, dy * i)
    traceShape(ctx, shape)
    if (!open && shape.display !== 'stroke') ctx.fill()
    if (open || shape.display !== 'fill') ctx.stroke()
    ctx.restore()
  }
}

export function EditorCanvas(): React.JSX.Element {
  const chart = useStore((s) => s.chart)
  const tool = useStore((s) => s.tool)
  const selectedId = useStore((s) => s.selectedId)
  const selectedIds = useStore((s) => s.selectedIds)
  const select = useStore((s) => s.select)
  const pasteArmed = useStore((s) => s.pasteArmed)
  const clipboard = useStore((s) => s.clipboard)
  const pasteMark = useStore((s) => s.pasteMark)
  /** True while ⌘+drag in Select mode paints dots (Paint without leaving the arrow). */
  const paintFromSelect = useRef(false)
  /** ⌘+press in Select: painting only starts once the pointer crosses into another
   *  cell — a plain ⌘click stays a click (no stray 1–2 dot strokes, no flash). */
  const pendingCmdPaint = useRef<{ cell: Point; center: Point } | null>(null)
  const addShape = useStore((s) => s.addShape)
  const snapToPixel = useStore((s) => s.snapToPixel)
  const setSnap = useStore((s) => s.setSnap)
  const mask = useStore((s) => s.mask)
  const showDims = useStore((s) => s.showDims)
  const showIds = useStore((s) => s.showIds)
  const penWidth = useStore((s) => s.penWidth)
  const paletteFilter = useStore((s) => s.paletteFilter)
  /** Punch-out islands of the chart (for the blueprint dimension labels). */
  const regions = useMemo<Region[]>(
    () => (mask ? findDrawableRegions(mask.bitmap, mask.w, mask.h) : []),
    [mask]
  )
  /** Island centres + the canvas centre: extra alignment-snap targets so parts land
   *  dead-centre in their LED panel (のむさん要望 2026-06-11). */
  const centerCand = useMemo<SnapCand>(
    () => centerCandidates(regions, chart.canvas),
    [regions, chart.canvas]
  )
  const withCenters = (c: SnapCand): SnapCand => mergeCand(c, centerCand)

  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const contentRef = useRef<HTMLCanvasElement | null>(null)
  if (!contentRef.current && typeof document !== 'undefined') {
    contentRef.current = document.createElement('canvas')
  }
  const underlayImg = useRef<HTMLImageElement | null>(null)
  const holesImg = useRef<HTMLImageElement | null>(null)
  const contentDirty = useRef(true)
  const boostRef = useRef(1) // display-only min stroke width (recomputed per zoom bucket)

  const [view, setView] = useState<View>({ scale: 0.4, tx: 40, ty: 40 })
  // test/debug hook (the browser preview converts chart coords → client coords for drags)
  useEffect(() => {
    ;(window as unknown as { __decorView?: View }).__decorView = view
  }, [view])
  const viewRef = useRef(view)
  viewRef.current = view
  const [draft, setDraftState] = useState<{ type: DrawType; points: Point[] } | null>(null)
  const draftRef = useRef(draft)
  /** Draft writes go through here: the ref is updated SYNCHRONOUSLY so gesture handlers
   *  (move/commit) never see a stale draft, regardless of React's render timing. */
  const setDraft = (
    u:
      | { type: DrawType; points: Point[] }
      | null
      | ((d: { type: DrawType; points: Point[] } | null) => { type: DrawType; points: Point[] } | null)
  ): void => {
    const next = typeof u === 'function' ? u(draftRef.current) : u
    draftRef.current = next
    setDraftState(next)
  }
  const drawing = useRef(false)
  const interaction = useRef<Interaction | null>(null)
  const lastCell = useRef<Point | null>(null)
  const guidesRef = useRef<{ x: number | null; y: number | null }>({ x: null, y: null })
  /** Rubber-band selection rectangle (Select tool drag on empty space). */
  const marquee = useRef<{ x0: number; y0: number; x1: number; y1: number; add: boolean } | null>(
    null
  )
  /** Right-button press: becomes a context menu on click, a grab-move on drag. */
  const rcPending = useRef<{ id: string; x: number; y: number } | null>(null)
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null)
  /** Cursor position while paste mode is armed (the ghost preview follows it). */
  const ghostPos = useRef<Point | null>(null)
  useEffect(() => {
    if (tool !== 'select' && useStore.getState().pasteArmed) {
      useStore.getState().setPasteArmed(false) // leaving Select disarms paste mode
    }
  }, [tool])
  const posRef = useRef<HTMLSpanElement>(null)
  const [cursorOv, setCursorOv] = useState<string | null>(null)
  // "why didn't that draw?" toast — silent blocking is forbidden
  const [blocked, setBlocked] = useState(false)
  const blockedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showBlocked = (): void => {
    setBlocked(true)
    if (blockedTimer.current) clearTimeout(blockedTimer.current)
    blockedTimer.current = setTimeout(() => setBlocked(false), 2800)
  }
  useEffect(
    () => () => {
      if (blockedTimer.current) clearTimeout(blockedTimer.current)
    },
    []
  )
  // live measurement badge near the cursor: X/Y spans, dot counts, W×H — updated
  // imperatively (no React state) while drawing / pulling / resizing / moving
  const measureRef = useRef<HTMLDivElement>(null)
  const showMeasure = (e: { clientX: number; clientY: number }, text: string): void => {
    const el = measureRef.current
    const wr = wrapRef.current
    if (!el || !wr) return
    const r = wr.getBoundingClientRect()
    el.style.display = 'block'
    el.style.left = `${Math.min(e.clientX - r.left + 14, r.width - 160)}px`
    el.style.top = `${Math.min(e.clientY - r.top + 18, r.height - 30)}px`
    el.textContent = text
  }
  const hideMeasure = (): void => {
    if (measureRef.current) measureRef.current.style.display = 'none'
  }
  const scratchCtx = useRef<CanvasRenderingContext2D | null>(null)
  if (!scratchCtx.current && typeof document !== 'undefined') {
    scratchCtx.current = document.createElement('canvas').getContext('2d')
  }
  const panning = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null)
  const spaceHeld = useRef(false)
  const [spaceUi, setSpaceUi] = useState(false)
  const userAdjusted = useRef(false)

  const { w, h } = chart.canvas

  const fit = (): void => {
    const el = wrapRef.current
    if (!el) return
    userAdjusted.current = false
    const cw = el.clientWidth
    const ch = el.clientHeight
    if (cw === 0 || ch === 0) return
    const scale = Math.min(cw / w, ch / h) * 0.92
    setView({ scale, tx: (cw - w * scale) / 2, ty: (ch - h * scale) / 2 })
  }

  const fitRef = useRef<() => void>(() => {})
  fitRef.current = fit

  const zoomTo = (scale: number): void => {
    const el = wrapRef.current
    if (!el) return
    userAdjusted.current = true
    const cxs = el.clientWidth / 2
    const cys = el.clientHeight / 2
    const v = viewRef.current
    const cx = (cxs - v.tx) / v.scale
    const cy = (cys - v.ty) / v.scale
    setView({ scale, tx: cxs - cx * scale, ty: cys - cy * scale })
  }

  // ---- content buffer (chart-resolution) ----
  const drawContent = (): void => {
    const cc = contentRef.current
    if (!cc) return
    if (cc.width !== w) cc.width = w
    if (cc.height !== h) cc.height = h
    const ctx = cc.getContext('2d')
    if (!ctx) return
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, w, h)
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, w, h)
    const u = activeLayerOf(chart).underlay
    // neutral grey under the drawable punch-outs (before the artwork, so the artwork
    // itself is never tinted) — makes transparent holes readable on dark charts
    if (holesImg.current) ctx.drawImage(holesImg.current, 0, 0, w, h)
    if (u?.visible && underlayImg.current) {
      ctx.globalAlpha = u.opacity
      ctx.drawImage(underlayImg.current, 0, 0, w, h)
      ctx.globalAlpha = 1
    }
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    // other songs' layers: hidden unless toggled visible, and then only as ghosts —
    // the active layer is always full-strength and is the only editable one
    const layerVisible = new Map(chart.layers.map((l) => [l.id, l.visible]))
    const activeId = chart.activeLayerId
    const homeId = chart.layers[0]?.id // layerless shapes = first layer (v1 rule)
    chart.shapes.forEach((shape, i) => {
      const lid = shape.layerId ?? homeId
      const ghost = lid !== activeId
      if (ghost && !layerVisible.get(lid)) return
      if (!visibleByFilter(shape, paletteFilter)) return // 種別フィルタ（照明だけ/電飾だけ）
      ctx.globalAlpha = ghost ? 0.22 : shape.locked ? 0.4 : 1
      drawShapeInto(ctx, shape, shapeColor(i), shapeFill(i), boostRef.current)
      ctx.globalAlpha = 1
    })
  }

  const drawGrid = (ctx: CanvasRenderingContext2D, cw: number, ch: number, v: View): void => {
    const x0 = Math.max(0, Math.floor((0 - v.tx) / v.scale))
    const x1 = Math.min(w, Math.ceil((cw - v.tx) / v.scale))
    const y0 = Math.max(0, Math.floor((0 - v.ty) / v.scale))
    const y1 = Math.min(h, Math.ceil((ch - v.ty) / v.scale))
    const step = (s: number, color: string): void => {
      ctx.strokeStyle = color
      ctx.lineWidth = 1
      ctx.beginPath()
      for (let x = Math.ceil(x0 / s) * s; x <= x1; x += s) {
        const sx = v.tx + x * v.scale
        ctx.moveTo(sx, v.ty + y0 * v.scale)
        ctx.lineTo(sx, v.ty + y1 * v.scale)
      }
      for (let y = Math.ceil(y0 / s) * s; y <= y1; y += s) {
        const sy = v.ty + y * v.scale
        ctx.moveTo(v.tx + x0 * v.scale, sy)
        ctx.lineTo(v.tx + x1 * v.scale, sy)
      }
      ctx.stroke()
    }
    if (v.scale >= 6) step(1, '#211f1d')
    step(10, '#3f3a33')
  }

  // ---- visible canvas ----
  const draw = (): void => {
    const cv = canvasRef.current
    const wrap = wrapRef.current
    if (!cv || !wrap) return
    const cw = wrap.clientWidth
    const ch = wrap.clientHeight
    if (cv.width !== cw) cv.width = cw
    if (cv.height !== ch) cv.height = ch
    const ctx = cv.getContext('2d')
    if (!ctx) return
    // keep 1px lines visible when zoomed out — but NEVER fatten them at >=100% zoom
    // (round, not ceil: at scale 1.0 a 1px line must display as exactly 1px)
    const boost = view.scale >= 1 ? 1 : Math.min(8, Math.max(1, Math.round(1.3 / view.scale)))
    if (boost !== boostRef.current) {
      boostRef.current = boost
      contentDirty.current = true
    }
    if (contentDirty.current) {
      drawContent()
      contentDirty.current = false
    }
    const v = view
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, cw, ch)
    // シネマティックなヴィネット（編集画面だけ・出力(Syphon)＝OutputRenderer には無関係）。
    // 中央は色を正確に見るため中立に保ち、周辺をすっと落として "暗転した客席" の奥行きを出す。
    const vg = ctx.createRadialGradient(
      cw / 2,
      ch * 0.42,
      0,
      cw / 2,
      ch * 0.42,
      Math.hypot(cw, ch) * 0.58
    )
    vg.addColorStop(0, '#101016')
    vg.addColorStop(0.5, '#0a0a0d')
    vg.addColorStop(1, '#020205')
    ctx.fillStyle = vg
    ctx.fillRect(0, 0, cw, ch)

    // content blit (crisp pixels when zoomed in, smooth when zoomed out)
    ctx.imageSmoothingEnabled = v.scale < 1
    ctx.setTransform(v.scale, 0, 0, v.scale, v.tx, v.ty)
    if (contentRef.current) ctx.drawImage(contentRef.current, 0, 0)

    // canvas border (screen space)
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.strokeStyle = C.border
    ctx.lineWidth = 1
    ctx.strokeRect(v.tx, v.ty, w * v.scale, h * v.scale)

    if (v.scale >= 1.5) drawGrid(ctx, cw, ch, v)

    // draft preview + selection (content transform)
    ctx.setTransform(v.scale, 0, 0, v.scale, v.tx, v.ty)
    if (draft) {
      if (tool === 'pixelpen' || paintFromSelect.current) {
        // paint feel: every visited cell fills in as you drag — drawn at the same
        // display width as the committed stroke, so nothing "changes" on release
        const s2 = Math.max(penWidth, boostRef.current)
        ctx.fillStyle = C.accent
        for (const pp of draft.points) ctx.fillRect(pp.x - s2 / 2, pp.y - s2 / 2, s2, s2)
      } else {
        const dShape: Shape = {
          id: '__draft',
          type: draft.type,
          points: draft.points,
          display: draft.type === 'rect' || draft.type === 'ellipse' ? 'both' : 'stroke',
          strokeWidth: 2
        }
        drawShapeInto(ctx, dShape, C.accent, 'rgba(123,197,232,0.3)', boostRef.current)
      }
    }
    // every selected shape lights up white; handles only for a single selection
    for (const sid of selectedIds) {
      if (sid === selectedId) continue // drawn below with bounds + handles
      const ssh = chart.shapes.find((s) => s.id === sid)
      if (ssh) drawShapeInto(ctx, ssh, SELECT_STROKE, 'rgba(255,255,255,0.25)', boostRef.current)
    }
    const sel = chart.shapes.find((s) => s.id === selectedId)
    if (sel) {
      drawShapeInto(ctx, sel, SELECT_STROKE, 'rgba(255,255,255,0.25)', boostRef.current)
      const b = shapeArrayBounds(sel)
      const lw = 1 / v.scale
      ctx.strokeStyle = C.accent
      ctx.lineWidth = lw
      ctx.setLineDash([4 / v.scale, 3 / v.scale])
      ctx.strokeRect(b.x, b.y, b.w, b.h)
      ctx.setLineDash([])
      // real grab handles: vertices (line/polyline) or box corners (rect etc.)
      const hs = 8 / v.scale
      ctx.fillStyle = C.accent
      ctx.strokeStyle = '#0a0a0a'
      ctx.lineWidth = 1 / v.scale
      for (const hd of shapeHandles(sel)) {
        const s2 = hd.kind === 'edge' ? hs * 0.78 : hs
        ctx.fillRect(hd.x - s2 / 2, hd.y - s2 / 2, s2, s2)
        ctx.strokeRect(hd.x - s2 / 2, hd.y - s2 / 2, s2, s2)
      }
    }
    // alignment guides (lit while something snaps onto another shape's line)
    const g = guidesRef.current
    if (g.x != null || g.y != null) {
      ctx.strokeStyle = C.green
      ctx.lineWidth = 1 / v.scale
      ctx.setLineDash([6 / v.scale, 4 / v.scale])
      ctx.beginPath()
      if (g.x != null) {
        ctx.moveTo(g.x, -1e4)
        ctx.lineTo(g.x, 1e4)
      }
      if (g.y != null) {
        ctx.moveTo(-1e4, g.y)
        ctx.lineTo(1e4, g.y)
      }
      ctx.stroke()
      ctx.setLineDash([])
    }
    // paste-mode ghost: the clipboard follows the cursor (bulbs ride centred on it,
    // everything else keeps its top-left anchor — same rule as pasteAt)
    if (pasteArmed && clipboard && clipboard.shapes.length && ghostPos.current) {
      const gd = pasteDelta(clipboard.shapes, ghostPos.current)
      const gdx = gd.x
      const gdy = gd.y
      ctx.save()
      ctx.globalAlpha = 0.45
      ctx.translate(gdx, gdy)
      for (const sh of clipboard.shapes) {
        drawShapeInto(ctx, sh, C.accent, 'rgba(123,197,232,0.2)', boostRef.current)
      }
      ctx.restore()
    }
    // paste-mark crosshair (click an empty spot, then ⌘V pastes centred here)
    if (pasteMark && tool === 'select' && !pasteArmed) {
      const r2 = 7 / v.scale
      ctx.strokeStyle = C.green
      ctx.lineWidth = 1.2 / v.scale
      ctx.beginPath()
      ctx.moveTo(pasteMark.x - r2, pasteMark.y)
      ctx.lineTo(pasteMark.x + r2, pasteMark.y)
      ctx.moveTo(pasteMark.x, pasteMark.y - r2)
      ctx.lineTo(pasteMark.x, pasteMark.y + r2)
      ctx.stroke()
      ctx.strokeRect(pasteMark.x - 0.5, pasteMark.y - 0.5, 1, 1)
    }
    // rubber-band rectangle
    const mq = marquee.current
    if (mq) {
      const mx = Math.min(mq.x0, mq.x1)
      const my = Math.min(mq.y0, mq.y1)
      const mw = Math.abs(mq.x1 - mq.x0)
      const mh = Math.abs(mq.y1 - mq.y0)
      ctx.fillStyle = 'rgba(123,197,232,0.07)'
      ctx.fillRect(mx, my, mw, mh)
      ctx.strokeStyle = C.accent
      ctx.lineWidth = 1 / v.scale
      ctx.setLineDash([5 / v.scale, 4 / v.scale])
      ctx.strokeRect(mx, my, mw, mh)
      ctx.setLineDash([])
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0)

    // #N fixture labels — same numbers as the patch chips below (screen-space).
    // Dense autoFill scenes only label the selection to avoid wallpapering the canvas.
    if (showIds && chart.fixtures.length) {
      const dense = chart.fixtures.length > 400
      ctx.font = "9px 'JetBrains Mono', monospace"
      ctx.textBaseline = 'middle'
      ctx.textAlign = 'center'
      chart.fixtures.forEach((f, i) => {
        const isSel = selectedIds.includes(f.shapeId)
        if (dense && !isSel) return
        const sh = chart.shapes.find((x) => x.id === f.shapeId)
        if (!sh || !sh.points.length) return
        const p0 = sh.points[0]
        const sx = v.tx + p0.x * v.scale
        const sy = v.ty + p0.y * v.scale - 11
        if (sx < -30 || sy < -20 || sx > cw + 30 || sy > ch + 20) return
        const label = `#${i + 1}`
        const tw = ctx.measureText(label).width
        ctx.fillStyle = isSel ? 'rgba(123,197,232,0.95)' : 'rgba(15,14,13,0.82)'
        ctx.fillRect(sx - tw / 2 - 3, sy - 7, tw + 6, 14)
        ctx.fillStyle = isSel ? '#0a0a0a' : '#9fb6c0'
        ctx.fillText(label, sx, sy)
      })
    }

    // blueprint dimension lines on the chart's punch-out islands (screen-space text,
    // editor-only — never part of the Syphon output)
    if (showDims && regions.length) {
      ctx.font = "10px 'JetBrains Mono', monospace"
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      const arrow = (x1: number, y1: number, x2: number, y2: number): void => {
        ctx.beginPath()
        ctx.moveTo(x1, y1)
        ctx.lineTo(x2, y2)
        const a = Math.atan2(y2 - y1, x2 - x1)
        for (const [ex, ey, ang] of [
          [x1, y1, a],
          [x2, y2, a + Math.PI]
        ] as const) {
          ctx.moveTo(ex + Math.cos(ang + 0.42) * 5, ey + Math.sin(ang + 0.42) * 5)
          ctx.lineTo(ex, ey)
          ctx.lineTo(ex + Math.cos(ang - 0.42) * 5, ey + Math.sin(ang - 0.42) * 5)
        }
        ctx.stroke()
      }
      const chip = (text: string, x: number, y: number): void => {
        const tw = ctx.measureText(text).width
        ctx.fillStyle = 'rgba(15,14,13,0.85)'
        ctx.fillRect(x - tw / 2 - 4, y - 8, tw + 8, 16)
        ctx.fillStyle = '#b8c8cf'
        ctx.fillText(text, x, y)
      }
      ctx.strokeStyle = 'rgba(160,190,205,0.55)'
      ctx.lineWidth = 1
      for (const rg of regions) {
        const sx0 = v.tx + rg.x * v.scale
        const sy0 = v.ty + rg.y * v.scale
        const sw2 = rg.w * v.scale
        const sh2 = rg.h * v.scale
        if (sx0 + sw2 < 0 || sy0 + sh2 < 0 || sx0 > cw || sy0 > ch) continue // offscreen
        // centre tick (＋): the spot parts snap onto
        if (sw2 >= 24 && sh2 >= 24) {
          const ccx = sx0 + sw2 / 2
          const ccy = sy0 + sh2 / 2
          ctx.beginPath()
          ctx.moveTo(ccx - 5, ccy)
          ctx.lineTo(ccx + 5, ccy)
          ctx.moveTo(ccx, ccy - 5)
          ctx.lineTo(ccx, ccy + 5)
          ctx.stroke()
        }
        if (sw2 >= 46) {
          const yLine = sy0 + Math.min(12, sh2 * 0.3)
          arrow(sx0 + 1, yLine, sx0 + sw2 - 1, yLine)
          chip(`${rg.w}`, sx0 + sw2 / 2, yLine)
        }
        if (sh2 >= 46) {
          const xLine = sx0 + Math.min(12, sw2 * 0.3)
          arrow(xLine, sy0 + 1, xLine, sy0 + sh2 - 1)
          chip(`${rg.h}`, xLine, sy0 + sh2 / 2)
        }
      }
    }
  }

  // schedule a draw after every render (rAF-coalesced)
  const drawRef = useRef(draw)
  drawRef.current = draw
  const rafRef = useRef(0)
  useEffect(() => {
    cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => drawRef.current())
  })

  // mark content dirty when chart / layers / mask change
  useEffect(() => {
    contentDirty.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chart.shapes, chart.canvas, chart.layers, chart.activeLayerId, mask, paletteFilter])

  // neon webfonts arrive async: stale measurements (taken against the fallback
  // font) must be thrown away and the offscreen repainted once the real font lands
  useEffect(() => {
    const onDone = (): void => {
      clearNeonLayoutCache()
      clearMarqueeCache()
      contentDirty.current = true
      drawRef.current()
    }
    document.fonts?.addEventListener('loadingdone', onDone)
    return () => document.fonts?.removeEventListener('loadingdone', onDone)
  }, [])

  // photo materials decode async (dataURL → albedo): repaint once each one lands
  useEffect(() => {
    const onImg = (): void => {
      contentDirty.current = true
      drawRef.current()
    }
    window.addEventListener('decor:image-loaded', onImg)
    return () => window.removeEventListener('decor:image-loaded', onImg)
  }, [])

  // New（SubBar）でビューを全体表示にリセット＝空でも「効いた」と分かる
  useEffect(() => {
    const onFit = (): void => fitRef.current()
    window.addEventListener('decor:fit', onFit)
    return () => window.removeEventListener('decor:fit', onFit)
  }, [])

  // cache underlay + mask images (the ACTIVE layer's chart image)
  const activeUnderlayUrl = activeLayerOf(chart).underlay?.dataUrl
  useEffect(() => {
    const url = activeUnderlayUrl
    if (!url) {
      underlayImg.current = null
      contentDirty.current = true
      drawRef.current()
      return
    }
    const img = new Image()
    img.onload = (): void => {
      underlayImg.current = img
      contentDirty.current = true
      drawRef.current()
    }
    img.src = url
  }, [activeUnderlayUrl])
  useEffect(() => {
    const url = mask?.holes
    if (!url) {
      holesImg.current = null
      contentDirty.current = true
      return
    }
    const img = new Image()
    img.onload = (): void => {
      holesImg.current = img
      contentDirty.current = true
      drawRef.current()
    }
    img.src = url
  }, [mask?.holes])

  useLayoutEffect(() => {
    fit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [w, h])

  // space-to-pan + escape-to-cancel
  useEffect(() => {
    const down = (e: KeyboardEvent): void => {
      if (e.code === 'Space') {
        spaceHeld.current = true
        setSpaceUi(true)
      } else if (e.code === 'Escape') {
        hideMeasure()
        setCtxMenu(null)
        const stp = useStore.getState()
        stp.setPasteMark(null)
        if (stp.pasteArmed) {
          stp.setPasteArmed(false) // leave stamp mode first
        } else if (draftRef.current) {
          setDraft(null)
          drawing.current = false
        } else {
          stp.select(null) // Esc with nothing in progress = deselect
        }
      }
    }
    const up = (e: KeyboardEvent): void => {
      if (e.code === 'Space') {
        spaceHeld.current = false
        setSpaceUi(false)
      }
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  // keyboard precision editing: nudge / delete / duplicate
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return
      const st = useStore.getState()
      // undo / redo
      if ((e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z')) {
        if (e.shiftKey) st.redo()
        else st.undo()
        e.preventDefault()
        return
      }
      // copy / paste (browser path; the Mac app routes these via the app menu)
      if ((e.metaKey || e.ctrlKey) && (e.key === 'c' || e.key === 'C')) {
        if (st.selectedIds.length) {
          st.copySelection()
          e.preventDefault()
        }
        return
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === 'v' || e.key === 'V')) {
        if (st.clipboard) {
          if (st.pasteMark) {
            st.pasteAt(st.pasteMark) // クリックで印を付けた場所に貼る
            st.setPasteMark(null)
          } else {
            st.pasteOffset() // 印が無ければ少し横にずらして即1個（マウス追従の連続スタンプはしない）
          }
          e.preventDefault()
        }
        return
      }
      // ⌘S = save to file (the Save button's keyboard twin; blocks the browser dialog)
      if ((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault()
        void saveChartToFile(st.chart).then((label) => {
          if (label) window.dispatchEvent(new CustomEvent('decor:saved', { detail: label }))
        })
        return
      }
      // ⌘A = select the whole active layer (locked shapes stay out, ghosts untouched)
      if ((e.metaKey || e.ctrlKey) && (e.key === 'a' || e.key === 'A')) {
        const c = st.chart
        const ids = c.shapes
          .filter(
            (s) =>
              !s.locked &&
              (s.layerId ?? c.layers[0]?.id) === c.activeLayerId &&
              visibleByFilter(s, st.paletteFilter)
          )
          .map((s) => s.id)
        if (ids.length) {
          st.setTool('select')
          st.selectMany(ids)
        }
        e.preventDefault()
        return
      }
      // quick tool keys (industry-standard letters) + F = fit + Z = one-key undo
      if (!e.metaKey && !e.ctrlKey && !e.altKey) {
        const k = e.key.toLowerCase()
        if (k === 'z') {
          if (e.shiftKey) st.redo()
          else st.undo()
          e.preventDefault()
          return
        }
        if (k === 'f') {
          fitRef.current()
          e.preventDefault()
          return
        }
        if (k === '?') {
          st.setHelpOpen(!st.helpOpen)
          e.preventDefault()
          return
        }
        const quick: Record<string, Parameters<typeof st.setTool>[0]> = {
          v: 'select',
          p: 'pixelpen',
          e: 'eraser',
          l: 'line'
        }
        if (quick[k]) {
          st.setTool(quick[k])
          e.preventDefault()
          return
        }
      }
      // ⌘G = 1本に結合（the context menu's merge, as a shortcut）
      if ((e.metaKey || e.ctrlKey) && (e.key === 'g' || e.key === 'G')) {
        if (st.selectedIds.length >= 2) st.mergeShapes(st.selectedIds)
        e.preventDefault()
        return
      }
      // ⌘L = lock the selection (locked = canvas picking ignores it; unlock via the
      // patch chip → Inspector, or ⌘L again after chip-selecting)
      if ((e.metaKey || e.ctrlKey) && (e.key === 'l' || e.key === 'L')) {
        const ids = st.selectedIds.length
          ? st.selectedIds
          : st.selectedId
            ? [st.selectedId]
            : []
        if (ids.length) {
          const shs = st.chart.shapes.filter((s) => ids.includes(s.id))
          st.setLocked(
            ids,
            shs.some((s) => !s.locked)
          )
        }
        e.preventDefault()
        return
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && st.selectedIds.length > 1) {
        if (
          st.selectedIds.length >= 5 &&
          !window.confirm(`電飾 ${st.selectedIds.length} 個を削除しますか？（⌘Zで戻せます）`)
        ) {
          e.preventDefault()
          return
        }
        st.removeShapes(st.selectedIds) // group delete = one undo step
        e.preventDefault()
        return
      }
      // arrow-key nudge — single or multi selection (1 dot, Shift = 10)
      if (e.key.startsWith('Arrow')) {
        const stp = e.shiftKey ? 10 : 1
        let dx = 0
        let dy = 0
        if (e.key === 'ArrowLeft') dx = -stp
        else if (e.key === 'ArrowRight') dx = stp
        else if (e.key === 'ArrowUp') dy = -stp
        else if (e.key === 'ArrowDown') dy = stp
        const ids = st.selectedIds.length
          ? st.selectedIds
          : st.selectedId
            ? [st.selectedId]
            : []
        if ((dx || dy) && ids.length) {
          st.nudgeShapes(ids, dx, dy)
          e.preventDefault()
        }
        return
      }
      const sel = st.selectedId
      if (!sel) return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        st.removeShape(sel)
        e.preventDefault()
        return
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === 'd' || e.key === 'D')) {
        st.duplicateShape(sel)
        e.preventDefault()
        return
      }
      if (e.key === '[' || e.key === ']') {
        const sh = st.chart.shapes.find((x) => x.id === sel)
        if (sh) {
          st.updateShape(sel, {
            strokeWidth: Math.max(1, (sh.strokeWidth || 1) + (e.key === ']' ? 1 : -1))
          })
        }
        e.preventDefault()
        return
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // non-passive wheel zoom + auto-fit on resize
  useEffect(() => {
    const cv = canvasRef.current
    if (!cv) return
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      const v = viewRef.current
      userAdjusted.current = true
      // pinch (ctrlKey), Cmd+scroll, or a classic mouse-wheel notch (integer, large,
      // vertical-only) zooms toward the cursor; trackpad two-finger scroll pans.
      const notch = Math.abs(e.deltaY) >= 80 && e.deltaX === 0 && Number.isInteger(e.deltaY)
      if (e.ctrlKey || e.metaKey || notch) {
        const r = cv.getBoundingClientRect()
        const mx = e.clientX - r.left
        const my = e.clientY - r.top
        const k = e.ctrlKey && !e.metaKey ? 0.012 : 0.0015 // pinch sends small deltas
        const factor = Math.exp(-e.deltaY * k)
        const scale = clamp(v.scale * factor, 0.05, 64)
        const cx = (mx - v.tx) / v.scale
        const cy = (my - v.ty) / v.scale
        setView({ scale, tx: mx - cx * scale, ty: my - cy * scale })
      } else {
        const dx = e.shiftKey && e.deltaX === 0 ? e.deltaY : e.deltaX
        const dy = e.shiftKey && e.deltaX === 0 ? 0 : e.deltaY
        setView({ ...v, tx: v.tx - dx, ty: v.ty - dy })
      }
    }
    cv.addEventListener('wheel', onWheel, { passive: false })
    return () => cv.removeEventListener('wheel', onWheel)
  }, [])
  useEffect(() => {
    const el = wrapRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      if (!userAdjusted.current) fit()
      else drawRef.current()
    })
    ro.observe(el)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [w, h])

  const toCanvasRaw = (clientX: number, clientY: number): Point => {
    const r = canvasRef.current!.getBoundingClientRect()
    const v = viewRef.current
    return { x: (clientX - r.left - v.tx) / v.scale, y: (clientY - r.top - v.ty) / v.scale }
  }
  const toCanvas = (clientX: number, clientY: number): Point => {
    const p = toCanvasRaw(clientX, clientY)
    return snapToPixel ? { x: Math.round(p.x), y: Math.round(p.y) } : p
  }
  /** The 1px cell under the pointer (clamped to the canvas). */
  const toCell = (clientX: number, clientY: number): Point => {
    const p = toCanvasRaw(clientX, clientY)
    return { x: clamp(Math.floor(p.x), 0, w - 1), y: clamp(Math.floor(p.y), 0, h - 1) }
  }

  const isDrawable = (p: Point): boolean => {
    if (!mask) return true
    const xi = Math.floor(p.x)
    const yi = Math.floor(p.y)
    if (xi < 0 || yi < 0 || xi >= mask.w || yi >= mask.h) return false
    return mask.bitmap[yi * mask.w + xi] === 1
  }

  /** Precise pick, NEAREST-first: among everything within reach of the cursor the
   *  closest stroke wins — so tightly packed 1px lines pick the one you aimed at,
   *  not whichever is on top. */
  const hitTest = (p: Point, opts?: { locked?: boolean }): string | null => {
    const wantLocked = opts?.locked ?? false // locked-only pass = the unlock door (right-click)
    const ctx = scratchCtx.current
    const tol = Math.max(2, 6 / viewRef.current.scale)
    let best: string | null = null
    let bd = Infinity
    for (let i = chart.shapes.length - 1; i >= 0; i--) {
      const sh = chart.shapes[i]
      if (!!sh.locked !== wantLocked) continue // locked backdrops: left-clicks pass through
      // other songs' ghosts are untouchable — only the active layer is editable
      if ((sh.layerId ?? chart.layers[0]?.id) !== chart.activeLayerId) continue
      if (!visibleByFilter(sh, paletteFilter)) continue // 種別フィルタ外はクリックを透過
      const b = shapeArrayBounds(sh)
      const half = (sh.strokeWidth || 1) / 2
      const pad = tol + half
      if (p.x < b.x - pad || p.x > b.x + b.w + pad || p.y < b.y - pad || p.y > b.y + b.h + pad) {
        continue
      }
      const reps = sh.repeat && sh.repeat.count > 1 ? sh.repeat.count : 1
      const rdx = sh.repeat?.dx ?? 0
      const rdy = sh.repeat?.dy ?? 0
      let d = Infinity
      for (let r = 0; r < reps; r++) {
        const q = { x: p.x - rdx * r, y: p.y - rdy * r }
        if (sh.type === 'freehand') {
          for (const pt of sh.points) {
            const dd = Math.hypot(pt.x - q.x, pt.y - q.y)
            if (dd < d) d = dd
          }
        } else if (sh.type === 'festoon') {
          // the belly sags below the chord: test against the sampled wire itself
          for (const pt of festoonSamples(sh, 48)) {
            const dd = Math.hypot(pt.x - q.x, pt.y - q.y)
            if (dd < d) d = dd
          }
        } else if (sh.type === 'line' || sh.type === 'polyline') {
          for (let k = 1; k < sh.points.length; k++) {
            const dd = segDist(q, sh.points[k - 1], sh.points[k])
            if (dd < d) d = dd
          }
        } else if (ctx) {
          // box shapes: in/near = distance 0 (they're area targets, not hairlines)
          ctx.lineWidth = Math.max(sh.strokeWidth || 1, tol * 2)
          ctx.lineJoin = 'round'
          ctx.lineCap = 'round'
          traceShape(ctx, sh)
          if (
            ctx.isPointInStroke(q.x, q.y) ||
            (sh.display !== 'stroke' && ctx.isPointInPath(q.x, q.y))
          ) {
            d = 0
          }
        }
      }
      const reach = tol + half
      if (d <= reach && d < bd - 1e-9) {
        bd = d
        best = sh.id
      }
    }
    return best
  }

  /** Nearest grabbable handle of a shape around p. The radius shrinks for small shapes
   *  so the middle of a short line stays grabbable for plain moving when zoomed out. */
  const findHandle = (sh: Shape, p: Point): Handle | undefined => {
    const b = shapeArrayBounds(sh)
    const span = Math.max(b.w, b.h)
    const tolH = Math.min(9 / viewRef.current.scale, Math.max(2, span * 0.25))
    let hd: Handle | undefined
    let bestD = Infinity
    for (const hh of shapeHandles(sh)) {
      const d = Math.hypot(hh.x - p.x, hh.y - p.y)
      if (d <= tolH && d < bestD) {
        bestD = d
        hd = hh
      }
    }
    return hd
  }

  /** Starts a move gesture for one or many shapes (one undo step; alignment snapping
   *  only when a single shape moves). */
  const startMove = (ids: string[], raw: Point, forceSnap: boolean): boolean => {
    const shs = ids
      .map((i) => chart.shapes.find((s) => s.id === i))
      .filter((s): s is Shape => !!s)
    if (!shs.length) return false
    useStore.getState().beginHistory()
    const single = shs.length === 1 ? shs[0] : null
    interaction.current = {
      kind: 'move',
      ids: shs.map((s) => s.id),
      sx: raw.x,
      sy: raw.y,
      origs: shs.map((s) => s.points.map((pp) => ({ ...pp }))),
      forceSnap,
      // groups align as one body (union bbox + centre); island/canvas centres are
      // always on the candidate list so parts can click onto panel middles
      cand: (() => {
        const ex = single ? single.id : new Set(shs.map((s) => s.id))
        // edges + centres + island middles + equal-spacing rhythm
        return mergeCand(
          withCenters(buildCandidates(chart.shapes, ex)),
          buildGapCandidates(chart.shapes, ex)
        )
      })(),
      sal: single ? salientOf(single) : salientOfGroup(shs)
    }
    return true
  }

  const onPointerDown = (e: RPointerEvent<HTMLCanvasElement>): void => {
    if (ctxMenu) setCtxMenu(null)
    // canvas を触ったら Inspector 等の入力欄に残ったフォーカスを外す。残っていると、図形を選んでも
    // その後の Delete / 矢印キーが「入力欄を編集中」と見なされて飲み込まれ、選択した線が消せなくなる。
    const ae = document.activeElement as HTMLElement | null
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT')) ae.blur()
    if (spaceHeld.current || e.button === 1) {
      panning.current = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty }
      canvasRef.current?.setPointerCapture(e.pointerId)
      return
    }
    if (e.button === 2) {
      // right button: click = context menu, drag = grab & move (decided on movement).
      // Locked shapes ignore left-clicks entirely, so right-click is their one
      // remaining door — fall back to a locked-only pass to reach the unlock menu.
      const raw = toCanvasRaw(e.clientX, e.clientY)
      const hit = hitTest(raw) ?? hitTest(raw, { locked: true })
      if (hit) {
        rcPending.current = { id: hit, x: e.clientX, y: e.clientY }
        canvasRef.current?.setPointerCapture(e.pointerId)
      }
      return
    }
    if (e.button !== 0) return
    const p = toCanvas(e.clientX, e.clientY)
    if (tool === 'select') {
      const raw = toCanvasRaw(e.clientX, e.clientY)
      if (pasteArmed) {
        useStore.getState().pasteAt(raw) // stamp! stays armed for the next click
        return
      }
      // ⌘+press in the arrow = paint dots, but only once a real drag starts
      if (e.metaKey) {
        const cell = toCell(e.clientX, e.clientY)
        const center = { x: cell.x + 0.5, y: cell.y + 0.5 }
        if (mask && !isDrawable(center)) {
          showBlocked()
          return
        }
        pendingCmdPaint.current = { cell, center }
        canvasRef.current?.setPointerCapture(e.pointerId)
        return
      }
      // grab a handle of the already-selected shape first (resize/reshape/pull)
      const sel = chart.shapes.find((s) => s.id === selectedId)
      if (sel) {
        const hd = findHandle(sel, raw)
        if (hd) {
          // 全ハンドル共通: ドラッグ開始時に1回だけ履歴を積む＝「1ドラッグ=1アンドゥ」。
          // (以前は chainvert だけ updateShape の600msまとめ書きに任せていて、ゆっくり
          //  ドラッグすると1操作が複数のアンドゥ手に割れる非対称があった)
          useStore.getState().beginHistory()
          const cand = withCenters(buildCandidates(chart.shapes, sel.id))
          if (hd.kind === 'chainvert') {
            interaction.current = { kind: 'chainvert', id: sel.id, idx: hd.idx, cand }
          } else if (hd.kind === 'vertex') {
            interaction.current = { kind: 'vertex', id: sel.id, idx: hd.idx, cand }
          } else if (hd.kind === 'end') {
            interaction.current = { kind: 'end', id: sel.id, anchor: hd.anchor!, cand }
          } else if (hd.kind === 'edge') {
            interaction.current = {
              kind: 'edge',
              id: sel.id,
              b: cornerBounds(sel.points[0], sel.points[sel.points.length - 1]),
              dir: hd.dir!,
              cand
            }
          } else {
            const bb = cornerBounds(sel.points[0], sel.points[sel.points.length - 1])
            interaction.current = {
              kind: 'corner',
              id: sel.id,
              anchor: hd.anchor!,
              aspect: bb.h > 0 ? bb.w / bb.h : 1,
              cand
            }
          }
          canvasRef.current?.setPointerCapture(e.pointerId)
          return
        }
      }
      const hit = hitTest(raw)
      if (hit) {
        useStore.getState().setPasteMark(null)
        if (e.shiftKey) {
          useStore.getState().toggleSelect(hit) // Shift+click = add / remove
          return
        }
        // clicking inside a multi-selection moves the whole group
        const ids =
          selectedIds.includes(hit) && selectedIds.length > 1 ? selectedIds : [hit]
        if (!selectedIds.includes(hit)) select(hit)
        if (startMove(ids, raw, false)) canvasRef.current?.setPointerCapture(e.pointerId)
        return
      }
      // empty space: rubber-band selection (Shift adds to the current selection)
      marquee.current = { x0: raw.x, y0: raw.y, x1: raw.x, y1: raw.y, add: e.shiftKey }
      if (!e.shiftKey) select(null)
      canvasRef.current?.setPointerCapture(e.pointerId)
      return
    }
    // Cmd/Opt + drag in any drawing tool = grab & move without switching to Select
    if (e.metaKey || e.altKey) {
      const raw = toCanvasRaw(e.clientX, e.clientY)
      const hit = hitTest(raw)
      if (hit) {
        select(hit)
        if (startMove([hit], raw, true)) canvasRef.current?.setPointerCapture(e.pointerId)
        return
      }
    }
    if (tool === 'eraser') {
      const cell = toCell(e.clientX, e.clientY)
      drawing.current = true
      lastCell.current = cell
      useStore.getState().eraseCells([`${cell.x},${cell.y}`])
      canvasRef.current?.setPointerCapture(e.pointerId)
      return
    }
    if (tool === 'pixelpen') {
      const cell = toCell(e.clientX, e.clientY)
      const center = { x: cell.x + 0.5, y: cell.y + 0.5 }
      if (mask && !isDrawable(center)) {
        showBlocked() // never block silently
        return
      }
      drawing.current = true
      lastCell.current = cell
      setDraft({ type: 'freehand', points: [center] })
      canvasRef.current?.setPointerCapture(e.pointerId)
      return
    }
    if (mask && !isDrawable(p)) {
      showBlocked() // never block silently
      return
    }
    if (tool === 'polyline') {
      setDraft((d) =>
        d && d.type === 'polyline'
          ? { ...d, points: [...d.points.slice(0, -1), p, p] }
          : { type: 'polyline', points: [p, p] }
      )
      return
    }
    drawing.current = true
    setDraft({ type: tool as DrawType, points: [p, p] })
    canvasRef.current?.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: RPointerEvent<HTMLCanvasElement>): void => {
    {
      // cell-coordinate readout + hover cursor (cheap, no React state unless it changes)
      const rp = toCanvasRaw(e.clientX, e.clientY)
      if (posRef.current) {
        const inside = rp.x >= 0 && rp.y >= 0 && rp.x < w && rp.y < h
        posRef.current.textContent = inside ? `${Math.floor(rp.x)} , ${Math.floor(rp.y)}` : ''
      }
      if (
        e.buttons === 0 &&
        !panning.current &&
        !interaction.current &&
        !drawing.current &&
        tool === 'select'
      ) {
        let cur: string | null = null
        const selSh = chart.shapes.find((s) => s.id === selectedId)
        const hd = selSh ? findHandle(selSh, rp) : undefined
        if (hd) {
          cur =
            hd.kind === 'corner'
              ? hd.idx === 0 || hd.idx === 3
                ? 'nwse-resize'
                : 'nesw-resize'
              : hd.kind === 'edge'
                ? hd.dir === 'n' || hd.dir === 's'
                  ? 'ns-resize'
                  : 'ew-resize'
                : 'pointer'
        } else if (hitTest(rp)) {
          cur = 'move'
        }
        if (cur !== cursorOv) setCursorOv(cur)
      }
    }
    if (pasteArmed) {
      ghostPos.current = toCanvasRaw(e.clientX, e.clientY)
      drawRef.current()
    }
    if (rcPending.current && (e.buttons & 2) !== 0) {
      // right-drag past the threshold = grab & move (otherwise it stays a menu click);
      // locked shapes never move — their right-click stays menu-only (the unlock door)
      const d = Math.hypot(e.clientX - rcPending.current.x, e.clientY - rcPending.current.y)
      const grabbed = useStore.getState().chart.shapes.find((s) => s.id === rcPending.current!.id)
      if (d > 4 && !grabbed?.locked) {
        const p0 = rcPending.current
        rcPending.current = null
        const st0 = useStore.getState()
        const ids =
          st0.selectedIds.includes(p0.id) && st0.selectedIds.length > 1
            ? st0.selectedIds
            : [p0.id]
        if (!st0.selectedIds.includes(p0.id)) st0.select(p0.id)
        startMove(ids, toCanvasRaw(p0.x, p0.y), true)
      }
    }
    if (panning.current) {
      const pan = panning.current
      userAdjusted.current = true
      setView((v) => ({ ...v, tx: pan.tx + (e.clientX - pan.x), ty: pan.ty + (e.clientY - pan.y) }))
      return
    }
    if (marquee.current) {
      const raw = toCanvasRaw(e.clientX, e.clientY)
      marquee.current.x1 = raw.x
      marquee.current.y1 = raw.y
      drawRef.current()
      return
    }
    if (interaction.current) {
      const it = interaction.current
      const raw = toCanvasRaw(e.clientX, e.clientY)
      const st = useStore.getState()
      const tolA = 6 / viewRef.current.scale
      if (it.kind === 'move') {
        const free = it.forceSnap ? false : e.metaKey || e.altKey // Cmd/Opt = no pixel snap
        let dx = raw.x - it.sx
        let dy = raw.y - it.sy
        // Shift while moving = straight horizontal / vertical slide (PowerPoint style)
        if (e.shiftKey) {
          if (Math.abs(dx) >= Math.abs(dy)) dy = 0
          else dx = 0
        }
        let gx: number | null = null
        let gy: number | null = null
        if (!free && snapToPixel && it.cand && it.sal) {
          const r2 = snapMoveDelta(dx, dy, it.sal, it.cand, tolA)
          dx = r2.dx
          dy = r2.dy
          gx = r2.gx
          gy = r2.gy
        } else if (!free) {
          dx = Math.round(dx)
          dy = Math.round(dy)
        }
        guidesRef.current = { x: gx, y: gy }
        it.ids.forEach((sid, i) =>
          st.setShapePoints(sid, it.origs[i].map((pt) => ({ x: pt.x + dx, y: pt.y + dy })))
        )
        showMeasure(e, `ΔX ${Math.round(dx)} · ΔY ${Math.round(dy)}`)
        return
      }
      if (it.kind === 'chainvert') {
        // drag one corner of a cleaned chain: only its two adjacent runs regenerate
        const sh2 = st.chart.shapes.find((s) => s.id === it.id)
        if (!sh2 || !sh2.verts || sh2.verts.length < 2) return
        let cell = toCell(e.clientX, e.clientY)
        const vcells = sh2.verts.map((pi) => cellOfPt(sh2.points[pi]))
        const nb = vcells[it.idx === 0 ? 1 : it.idx - 1] // neighbour corner = axis anchor
        if (e.shiftKey) {
          const sn = axisSnap(nb, cell)
          cell = { x: clamp(sn.x, 0, w - 1), y: clamp(sn.y, 0, h - 1) }
        } else if (snapToPixel && !(e.metaKey || e.altKey)) {
          let gx: number | null = null
          let gy: number | null = null
          if (it.cand) {
            const sx2 = snap1D(cell.x + 0.5, flatX(it.cand), tolA, 0, 0, false)
            const sy2 = snap1D(cell.y + 0.5, flatY(it.cand), tolA, 0, 0, false)
            gx = sx2.guide
            gy = sy2.guide
            cell = { x: Math.floor(sx2.v), y: Math.floor(sy2.v) }
          }
          cell = softAxis(nb, cell, Math.max(1, Math.round(tolA)))
          cell = { x: clamp(cell.x, 0, w - 1), y: clamp(cell.y, 0, h - 1) }
          guidesRef.current = { x: gx, y: gy }
        }
        vcells[it.idx] = cell
        const { points, verts } = regenChain(vcells)
        if (!mask || points.every((c) => isDrawable(c))) {
          // 履歴なしの直接更新（履歴はドラッグ開始時に1回積んである＝他のハンドルと同じ）
          st.setShapePoints(it.id, points, verts)
          showMeasure(e, `${points.length} dots`)
        }
        return
      }
      if (it.kind === 'end') {
        // pull a painted run's end: regenerate a straight dot run from the fixed end
        let cell = toCell(e.clientX, e.clientY)
        let gx: number | null = null
        let gy: number | null = null
        if (e.shiftKey) {
          const sn = axisSnap(it.anchor, cell)
          cell = { x: clamp(sn.x, 0, w - 1), y: clamp(sn.y, 0, h - 1) }
        } else if (snapToPixel && !(e.metaKey || e.altKey)) {
          // soft snaps: align to other shapes first, then gently towards H/V/45°
          if (it.cand) {
            const sx2 = snap1D(cell.x + 0.5, flatX(it.cand), tolA, 0, 0, false)
            const sy2 = snap1D(cell.y + 0.5, flatY(it.cand), tolA, 0, 0, false)
            gx = sx2.guide
            gy = sy2.guide
            cell = { x: Math.floor(sx2.v), y: Math.floor(sy2.v) }
          }
          cell = softAxis(it.anchor, cell, Math.max(1, Math.round(tolA)))
          cell = { x: clamp(cell.x, 0, w - 1), y: clamp(cell.y, 0, h - 1) }
        }
        guidesRef.current = { x: gx, y: gy }
        const pts: Point[] = []
        for (const c of [it.anchor, ...cellsBetween(it.anchor, cell)]) {
          const center = { x: c.x + 0.5, y: c.y + 0.5 }
          if (mask && !isDrawable(center)) break // stop at the chart's edge
          pts.push(center)
        }
        if (pts.length) {
          st.setShapePoints(it.id, pts.length === 1 ? [pts[0], pts[0]] : pts)
          const f0 = pts[0]
          const f1 = pts[pts.length - 1]
          showMeasure(
            e,
            `X ${Math.abs(Math.floor(f1.x) - Math.floor(f0.x)) + 1} · Y ${Math.abs(Math.floor(f1.y) - Math.floor(f0.y)) + 1} · ${pts.length} dots`
          )
        }
        return
      }
      const free = e.metaKey || e.altKey
      const sh = st.chart.shapes.find((s) => s.id === it.id)
      if (!sh) return
      if (it.kind === 'vertex') {
        let np = free ? raw : { x: Math.round(raw.x), y: Math.round(raw.y) }
        let gx: number | null = null
        let gy: number | null = null
        if (!free && snapToPixel && it.cand) {
          const sx2 = snap1D(raw.x, flatX(it.cand), tolA, 10, 2, true)
          const sy2 = snap1D(raw.y, flatY(it.cand), tolA, 10, 2, true)
          np = { x: sx2.v, y: sy2.v }
          gx = sx2.guide
          gy = sy2.guide
        }
        if (sh.type === 'line' && sh.points.length >= 2) {
          const other = sh.points[it.idx === 0 ? sh.points.length - 1 : 0]
          if (e.shiftKey) np = axisSnap(other, np)
          else if (!free && snapToPixel) np = softAxis(other, np, Math.max(1, tolA))
        }
        guidesRef.current = { x: gx, y: gy }
        st.setShapePoints(it.id, sh.points.map((pt, i) => (i === it.idx ? np : pt)))
        if (sh.type === 'line' && sh.points.length >= 2) {
          const other = sh.points[it.idx === 0 ? sh.points.length - 1 : 0]
          const ddx = Math.abs(Math.round(np.x - other.x))
          const ddy = Math.abs(Math.round(np.y - other.y))
          showMeasure(e, `X ${ddx} · Y ${ddy} · L ${Math.round(Math.hypot(ddx, ddy))}`)
        }
        return
      }
      if (it.kind === 'edge') {
        const b = it.b
        const p1 = { x: b.x, y: b.y }
        const p2 = { x: b.x + b.w, y: b.y + b.h }
        let gx: number | null = null
        let gy: number | null = null
        if (it.dir === 'e' || it.dir === 'w') {
          let nx = free ? raw.x : Math.round(raw.x)
          if (!free && snapToPixel && it.cand) {
            const s2 = snap1D(raw.x, flatX(it.cand), tolA, 10, 2, true)
            nx = s2.v
            gx = s2.guide
          }
          if (it.dir === 'e') p2.x = nx
          else p1.x = nx
        } else {
          let ny = free ? raw.y : Math.round(raw.y)
          if (!free && snapToPixel && it.cand) {
            const s2 = snap1D(raw.y, flatY(it.cand), tolA, 10, 2, true)
            ny = s2.v
            gy = s2.guide
          }
          if (it.dir === 's') p2.y = ny
          else p1.y = ny
        }
        guidesRef.current = { x: gx, y: gy }
        st.setShapePoints(it.id, [p1, p2])
        showMeasure(e, `W ${Math.abs(Math.round(p2.x - p1.x))} × H ${Math.abs(Math.round(p2.y - p1.y))}`)
        return
      }
      // corner: opposite corner anchored; Shift keeps the original aspect ratio
      {
        let np = free ? raw : { x: Math.round(raw.x), y: Math.round(raw.y) }
        let gx: number | null = null
        let gy: number | null = null
        if (!free && snapToPixel && it.cand) {
          const sx2 = snap1D(raw.x, flatX(it.cand), tolA, 10, 2, true)
          const sy2 = snap1D(raw.y, flatY(it.cand), tolA, 10, 2, true)
          np = { x: sx2.v, y: sy2.v }
          gx = sx2.guide
          gy = sy2.guide
        }
        if (e.shiftKey && it.aspect > 0) {
          const w2 = Math.abs(np.x - it.anchor.x)
          const h2 = Math.abs(np.y - it.anchor.y)
          if (w2 / it.aspect >= h2) {
            np = {
              x: np.x,
              y: it.anchor.y + Math.sign(np.y - it.anchor.y || 1) * Math.round(w2 / it.aspect)
            }
          } else {
            np = {
              x: it.anchor.x + Math.sign(np.x - it.anchor.x || 1) * Math.round(h2 * it.aspect),
              y: np.y
            }
          }
          gx = null
          gy = null
        }
        guidesRef.current = { x: gx, y: gy }
        st.setShapePoints(it.id, [it.anchor, np])
        showMeasure(
          e,
          `W ${Math.abs(Math.round(np.x - it.anchor.x))} × H ${Math.abs(Math.round(np.y - it.anchor.y))}`
        )
        return
      }
    }
    if (drawing.current && tool === 'eraser') {
      const cell = toCell(e.clientX, e.clientY)
      const last = lastCell.current
      if (!last || (cell.x === last.x && cell.y === last.y)) return
      const keys = cellsBetween(last, cell).map((c) => `${c.x},${c.y}`)
      lastCell.current = cell
      useStore.getState().eraseCells(keys)
      return
    }
    if (pendingCmdPaint.current && (e.buttons & 1) !== 0) {
      const cell = toCell(e.clientX, e.clientY)
      const p0 = pendingCmdPaint.current
      if (cell.x !== p0.cell.x || cell.y !== p0.cell.y) {
        // crossed into another cell: the ⌘press is a real drag — start painting now
        pendingCmdPaint.current = null
        useStore.getState().setPasteMark(null)
        paintFromSelect.current = true
        drawing.current = true
        lastCell.current = p0.cell
        setDraft({ type: 'freehand', points: [p0.center] })
        // fall through: the paint branch below appends up to the current cell
      }
    }
    if (drawing.current && (tool === 'pixelpen' || paintFromSelect.current) && draftRef.current) {
      const cell = toCell(e.clientX, e.clientY)
      if (e.shiftKey) {
        // Shift: one straight run (H / V / 45°) from where the stroke started
        const anchor = {
          x: Math.floor(draftRef.current.points[0].x),
          y: Math.floor(draftRef.current.points[0].y)
        }
        const sn = axisSnap(anchor, cell)
        const target = { x: clamp(sn.x, 0, w - 1), y: clamp(sn.y, 0, h - 1) }
        const pts: Point[] = []
        for (const c of [anchor, ...cellsBetween(anchor, target)]) {
          const center = { x: c.x + 0.5, y: c.y + 0.5 }
          if (mask && !isDrawable(center)) break
          pts.push(center)
        }
        lastCell.current = target
        if (pts.length) {
          setDraft((d) => (d ? { ...d, points: pts } : d))
          const f0 = pts[0]
          const f1 = pts[pts.length - 1]
          showMeasure(
            e,
            `X ${Math.abs(Math.floor(f1.x) - Math.floor(f0.x)) + 1} · Y ${Math.abs(Math.floor(f1.y) - Math.floor(f0.y)) + 1} · ${pts.length} dots`
          )
        }
        return
      }
      const last = lastCell.current
      if (!last || (cell.x === last.x && cell.y === last.y)) return
      const adds: Point[] = []
      for (const c of cellsBetween(last, cell)) {
        const center = { x: c.x + 0.5, y: c.y + 0.5 }
        if (!mask || isDrawable(center)) adds.push(center)
      }
      lastCell.current = cell
      if (adds.length) setDraft((d) => (d ? { ...d, points: [...d.points, ...adds] } : d))
      {
        const d2 = draftRef.current
        if (d2 && d2.points.length) {
          let minX = Infinity
          let maxX = -Infinity
          let minY = Infinity
          let maxY = -Infinity
          for (const q of d2.points) {
            if (q.x < minX) minX = q.x
            if (q.x > maxX) maxX = q.x
            if (q.y < minY) minY = q.y
            if (q.y > maxY) maxY = q.y
          }
          showMeasure(
            e,
            `X ${Math.round(maxX - minX) + 1} · Y ${Math.round(maxY - minY) + 1} · ${d2.points.length} dots`
          )
        }
      }
      return
    }
    const p = toCanvas(e.clientX, e.clientY)
    if (tool === 'polyline' && draftRef.current?.type === 'polyline') {
      setDraft((d) => (d ? { ...d, points: [...d.points.slice(0, -1), p] } : d))
      return
    }
    const d0 = draftRef.current // always the latest draft (state can lag a frame)
    if (!drawing.current || !d0) return
    if (d0.type === 'freehand') {
      if (!mask || isDrawable(p)) setDraft((d) => (d ? { ...d, points: [...d.points, p] } : d))
      const d2 = draftRef.current
      if (d2 && d2.points.length > 1) {
        let minX = Infinity
        let maxX = -Infinity
        let minY = Infinity
        let maxY = -Infinity
        for (const q of d2.points) {
          if (q.x < minX) minX = q.x
          if (q.x > maxX) maxX = q.x
          if (q.y < minY) minY = q.y
          if (q.y > maxY) maxY = q.y
        }
        showMeasure(e, `X ${Math.round(maxX - minX)} · Y ${Math.round(maxY - minY)}`)
      }
    } else {
      let b2 = p
      const a = d0.points[0]
      if (e.shiftKey) {
        if (d0.type === 'line') {
          b2 = axisSnap(a, p) // straight: H / V / 45°
        } else {
          // square / circle / regular shape
          const dx2 = p.x - a.x
          const dy2 = p.y - a.y
          const m = Math.max(Math.abs(dx2), Math.abs(dy2))
          b2 = { x: a.x + Math.sign(dx2 || 1) * m, y: a.y + Math.sign(dy2 || 1) * m }
        }
      }
      setDraft((d) => (d ? { ...d, points: [d.points[0], b2] } : d))
      if (d0.type === 'line') {
        const ddx = Math.abs(Math.round(b2.x - a.x))
        const ddy = Math.abs(Math.round(b2.y - a.y))
        showMeasure(e, `X ${ddx} · Y ${ddy} · L ${Math.round(Math.hypot(ddx, ddy))}`)
      } else {
        const bb = cornerBounds(a, b2)
        showMeasure(e, `W ${Math.round(bb.w)} × H ${Math.round(bb.h)}`)
      }
    }
  }

  const commit = (): void => {
    const d0 = draftRef.current // never commit a stale draft (state can lag a frame)
    if (!d0) return
    const pts = d0.points
    const a = pts[0]
    const b = pts[pts.length - 1]
    if (d0.type === 'freehand') {
      // a single painted dot is a valid shape (duplicate the point so the stroke renders)
      const pp = pts.length === 1 ? [pts[0], pts[0]] : pts
      const isPaint = tool === 'pixelpen' || paintFromSelect.current
      if (pp.length >= 2) {
        const id = addShape({
          type: 'freehand',
          points: pp,
          ...(isPaint ? { strokeWidth: penWidth } : {})
        })
        if (isPaint) {
          // なぞり×自動清書: fit the raw trail on release. Recorded as its own history
          // step, so Z = back to the raw trail, Z again = stroke gone.
          const fit = cleanPaintStroke(pp)
          if (fit.kind !== 'raw' && (!mask || fit.points.every((c) => isDrawable(c)))) {
            useStore.getState().updateShape(id, { points: fit.points, verts: fit.verts })
          }
        }
      }
    } else if (d0.type === 'line') {
      if (dist(a, b) >= MIN_SIZE) addShape({ type: 'line', points: [a, b] })
    } else {
      const bnd = cornerBounds(a, b)
      if (bnd.w >= MIN_SIZE || bnd.h >= MIN_SIZE) addShape({ type: d0.type, points: [a, b] })
    }
    setDraft(null)
  }

  const onPointerUp = (e: RPointerEvent<HTMLCanvasElement>): void => {
    hideMeasure()
    if (pendingCmdPaint.current) {
      // ⌘click without dragging: behave like a normal click (select / set paste mark)
      pendingCmdPaint.current = null
      const raw = toCanvasRaw(e.clientX, e.clientY)
      const st = useStore.getState()
      const hit = hitTest(raw)
      if (hit) {
        st.setPasteMark(null)
        st.select(hit)
      } else if (raw.x >= 0 && raw.y >= 0 && raw.x < w && raw.y < h) {
        st.setPasteMark({ x: Math.floor(raw.x) + 0.5, y: Math.floor(raw.y) + 0.5 })
      }
      canvasRef.current?.releasePointerCapture(e.pointerId)
      return
    }
    if (rcPending.current && e.button === 2) {
      // right CLICK (no drag): context menu on the shape under the cursor
      const p0 = rcPending.current
      rcPending.current = null
      const st = useStore.getState()
      if (!st.selectedIds.includes(p0.id)) st.select(p0.id)
      const wr = wrapRef.current?.getBoundingClientRect()
      if (wr) setCtxMenu({ x: p0.x - wr.left + 2, y: p0.y - wr.top + 2 })
      canvasRef.current?.releasePointerCapture(e.pointerId)
      return
    }
    if (marquee.current) {
      const m = marquee.current
      marquee.current = null
      const x0 = Math.min(m.x0, m.x1)
      const x1 = Math.max(m.x0, m.x1)
      const y0 = Math.min(m.y0, m.y1)
      const y1 = Math.max(m.y0, m.y1)
      const st = useStore.getState()
      if (x1 - x0 > 2 || y1 - y0 > 2) {
        // real geometry test — a hollow L-chain must not be grabbed through the empty
        // interior of its bounding box
        const inIds = chart.shapes
          .filter(
            (s) =>
              !s.locked &&
              (s.layerId ?? chart.layers[0]?.id) === chart.activeLayerId &&
              visibleByFilter(s, st.paletteFilter) &&
              shapeIntersectsRect(s, x0, y0, x1, y1)
          )
          .map((s) => s.id)
        st.selectMany(m.add ? Array.from(new Set([...st.selectedIds, ...inIds])) : inIds)
        st.setPasteMark(null)
      } else if (m.x0 >= 0 && m.y0 >= 0 && m.x0 < w && m.y0 < h) {
        // a plain click on empty canvas marks the spot — ⌘V pastes centred here
        st.setPasteMark({ x: Math.floor(m.x0) + 0.5, y: Math.floor(m.y0) + 0.5 })
      }
      drawRef.current()
      canvasRef.current?.releasePointerCapture(e.pointerId)
      return
    }
    if (panning.current) {
      panning.current = null
      canvasRef.current?.releasePointerCapture(e.pointerId)
      return
    }
    if (interaction.current) {
      interaction.current = null
      guidesRef.current = { x: null, y: null }
      canvasRef.current?.releasePointerCapture(e.pointerId)
      return
    }
    if (tool === 'polyline') return
    if (!drawing.current) return
    drawing.current = false
    commit()
    paintFromSelect.current = false
  }

  const onDoubleClick = (): void => {
    const d0 = draftRef.current
    if (d0?.type === 'polyline') {
      const verts = d0.points.slice(0, -1)
      if (verts.length >= 2) addShape({ type: 'polyline', points: verts })
      setDraft(null)
    }
  }

  // parts palette drop target: dropping a part stamps it centred on the cell under
  // the cursor (bulb centre = the dropped dot), then hands over to Select for moving
  const onDragOver = (e: React.DragEvent<HTMLCanvasElement>): void => {
    if (
      e.dataTransfer.types.includes('application/x-decor-part') ||
      e.dataTransfer.types.includes('Files')
    ) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    }
  }
  const onDrop = (e: React.DragEvent<HTMLCanvasElement>): void => {
    // a chart image dropped mid-edit = a new song page (layer), named after the file
    const file = Array.from(e.dataTransfer.files ?? []).find((f) => f.type.startsWith('image/'))
    if (file) {
      e.preventDefault()
      void fileToDataUrl(file).then((dataUrl) => {
        if (!dataUrl) return
        useStore.getState().addLayer({
          name: file.name.replace(/\.[^.]+$/, ''),
          underlay: { dataUrl, opacity: 0.5, visible: true, mask: { enabled: true, invert: false } }
        })
      })
      return
    }
    const part = e.dataTransfer.getData('application/x-decor-part')
    const PARTS = [
      'bulb',
      'neon',
      'marquee',
      'stars',
      'festoon',
      'parlight',
      'blinder',
      'patt',
      'pixelpatt',
      'image',
      'uplight',
      'movinghead',
      'roomlamp',
      'streetlamp',
      'chandelier'
    ]
    if (!PARTS.includes(part)) return
    e.preventDefault()
    const cell = toCell(e.clientX, e.clientY)
    let center = { x: cell.x + 0.5, y: cell.y + 0.5 }
    // dropped parts click onto a nearby island / canvas centre (Snap ON のとき)
    if (useStore.getState().snapToPixel) {
      const tol = Math.max(3, 8 / viewRef.current.scale)
      const nearest = (v: number, cands: number[]): number => {
        let best = v
        let bd = tol
        for (const c of cands) {
          const d = Math.abs(c - v)
          if (d <= bd) {
            bd = d
            best = c
          }
        }
        return best
      }
      center = { x: nearest(center.x, centerCand.xs), y: nearest(center.y, centerCand.ys) }
    }
    if (mask && !isDrawable(center)) {
      showBlocked()
      return
    }
    useStore.getState().setTool('select')
    if (part === 'bulb') {
      addShape({
        type: 'bulb',
        points: [center],
        display: 'fill',
        strokeWidth: 1,
        diameter: mmToCanvasPx(useStore.getState().chart, BULB_DEFAULT_DIAMETER)
      })
    } else if (part === 'neon') {
      addShape({
        type: 'neon',
        points: [center],
        display: 'fill',
        strokeWidth: 1,
        text: NEON_DEFAULT_TEXT,
        fontId: NEON_DEFAULT_FONT,
        fontSize: NEON_DEFAULT_SIZE,
        neonGlow: NEON_DEFAULT_GLOW
      })
    } else if (part === 'marquee') {
      // marquee sign: type text in the Inspector — each letter is filled with bulbs,
      // 1 letter = 1 address (per-letter chase, same as neon)
      addShape({
        type: 'marquee',
        points: [center],
        display: 'fill',
        strokeWidth: 1,
        text: MARQUEE_DEFAULT_TEXT,
        fontId: MARQUEE_DEFAULT_FONT,
        fontSize: MARQUEE_DEFAULT_SIZE,
        bulbPitch: MARQUEE_DEFAULT_PITCH
      })
    } else if (part === 'stars') {
      // star field: a corner-box part — drops as a 120×70 sky centred on the cell,
      // then the ordinary corner/edge handles stretch it over the LED area
      addShape({
        type: 'stars',
        points: [
          { x: center.x - 60, y: center.y - 35 },
          { x: center.x + 60, y: center.y + 35 }
        ],
        display: 'fill',
        strokeWidth: 1,
        starDensity: STARS_DEFAULT_DENSITY,
        starWhiteRatio: STARS_DEFAULT_WHITE_RATIO,
        starSize: STARS_DEFAULT_SIZE,
        starSeed: (Math.random() * 0xffffffff) >>> 0
      })
    } else if (part === 'festoon') {
      // festoon string: drops as a horizontal 160px wire — then grab either end
      addShape({
        type: 'festoon',
        points: [
          { x: center.x - 80, y: center.y },
          { x: center.x + 80, y: center.y }
        ],
        display: 'fill',
        strokeWidth: 1,
        sagPct: FESTOON_DEFAULT_SAG,
        bulbPitch: FESTOON_DEFAULT_PITCH,
        diameter: FESTOON_DEFAULT_DIAMETER,
        neonGlow: FESTOON_DEFAULT_GLOW
      })
    } else if (part === 'image') {
      // photo material: drops as a 160×100 frame — pick the picture in the Inspector
      addShape({
        type: 'image',
        points: [
          { x: center.x - 80, y: center.y - 50 },
          { x: center.x + 80, y: center.y + 50 }
        ],
        display: 'fill',
        strokeWidth: 1
      })
    } else if (part === 'uplight' || part === 'movinghead') {
      // uplight(スポット)/movinghead(ムービング): 1点配置・ビーム上向き・チャート外も可。
      // ビーム資産は共通。違いは種別(family=light)と既定パッチmode(beam8)＝part-family/store側で連動。
      addShape({
        type: part === 'movinghead' ? 'movinghead' : 'uplight',
        points: [center],
        display: 'fill',
        strokeWidth: 1,
        beamW0: UPLIGHT_DEFAULT_W0,
        beamW1: UPLIGHT_DEFAULT_W1,
        beamLen: UPLIGHT_DEFAULT_LEN
      })
    } else {
      // stage fixtures: one-point parts, size = diameter (blinder: housing width).
      // 既定サイズは実寸mm。チャート校正時(settings.stageWidthMm)は背景の縮尺に合わせて
      // px へ変換し実物大で置く。未校正なら mm をそのまま px（従来動作）。§7-4。
      const dia =
        part === 'parlight'
          ? PAR_DEFAULT_DIAMETER
          : part === 'blinder'
            ? BLINDER_DEFAULT_WIDTH
            : part === 'patt'
              ? PATT_DEFAULT_DIAMETER
              : part === 'pixelpatt'
                ? PIXELPATT_DEFAULT_DIAMETER
                : part === 'roomlamp'
                  ? ROOMLAMP_DEFAULT_DIAMETER
                  : part === 'streetlamp'
                    ? STREETLAMP_DEFAULT_DIAMETER
                    : CHANDELIER_DEFAULT_DIAMETER
      addShape({
        type: part as
          | 'parlight'
          | 'blinder'
          | 'patt'
          | 'pixelpatt'
          | 'roomlamp'
          | 'streetlamp'
          | 'chandelier',
        points: [center],
        display: 'fill',
        strokeWidth: 1,
        diameter: mmToCanvasPx(useStore.getState().chart, dia)
      })
    }
  }

  // grid unit indicator: what one visible cell currently means (mirrors drawGrid).
  // 校正済みチャートは px ではなく実寸 mm で表示（縮尺が効いてるか目視できる）。§7-4。
  const cellPx = view.scale >= 6 ? 1 : view.scale >= 1.5 ? 10 : 0
  const mmpp = mmPerPx(chart)
  const unit =
    cellPx === 0
      ? 'grid off'
      : mmpp
        ? `1 cell = ${(cellPx * mmpp).toFixed(cellPx * mmpp < 10 ? 1 : 0)}mm`
        : `1 cell = ${cellPx}px`
  const [unitFlash, setUnitFlash] = useState<{ text: string; key: number } | null>(null)
  const prevUnit = useRef<string | null>(null)
  useEffect(() => {
    const prev = prevUnit.current
    prevUnit.current = unit
    if (prev !== null && prev !== unit) {
      setUnitFlash({ text: unit, key: Date.now() })
      const t = setTimeout(() => setUnitFlash(null), 1150)
      return () => clearTimeout(t)
    }
    return undefined
  }, [unit])

  const cursor = spaceUi
    ? 'grab'
    : pasteArmed
      ? 'copy'
      : (cursorOv ?? (tool === 'select' ? 'default' : 'crosshair'))

  return (
    <div ref={wrapRef} style={{ position: 'relative', flex: 1, overflow: 'hidden', background: C.canvas }}>
      <canvas
        ref={canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => {
          if (posRef.current) posRef.current.textContent = ''
          if (cursorOv) setCursorOv(null)
          hideMeasure()
        }}
        onDoubleClick={onDoubleClick}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onContextMenu={(e) => e.preventDefault()}
        style={{ display: 'block', width: '100%', height: '100%', cursor, touchAction: 'none' }}
      />

      <div style={{ position: 'absolute', left: 10, bottom: 10, display: 'flex', gap: 6, alignItems: 'center' }}>
        <button onClick={fit} style={zoomBtn}>
          FIT
        </button>
        <button onClick={() => zoomTo(1)} style={zoomBtn}>
          100%
        </button>
        <button onClick={() => zoomTo(8)} style={zoomBtn}>
          800%
        </button>
        <span style={{ fontFamily: F.mono, fontSize: 11, color: C.hint, minWidth: 44, textAlign: 'center' }}>
          {Math.round(view.scale * 100)}%
        </span>
        <span
          ref={posRef}
          style={{ fontFamily: F.mono, fontSize: 11, color: C.hint, minWidth: 76 }}
        />
        <span
          style={{
            fontFamily: F.mono,
            fontSize: 11,
            color: C.accent,
            border: `0.5px solid ${C.accent}`,
            borderRadius: 4,
            padding: '3px 9px',
            background: 'rgba(123,197,232,0.08)',
            whiteSpace: 'nowrap'
          }}
          title="いまのグリッド1マスが何ピクセルか"
        >
          {unit}
        </span>
        <button
          onClick={() => setSnap(!snapToPixel)}
          style={{
            ...zoomBtn,
            background: snapToPixel ? C.accent : 'rgba(123,197,232,0.15)',
            color: snapToPixel ? '#0a0a0a' : C.white
          }}
          title="Snap to 1px grid"
        >
          {snapToPixel ? 'Snap ON' : 'Snap OFF'}
        </button>
        {(() => {
          // ロック解除の「必ず効く出口」。ロック品（画像/未パッチのモチーフ含む）は右クリックや
          // パッチチップから解除しづらいので、ロックが1つでもあれば常にこのボタンを出す（⌘Zで戻せる）。
          const lockedIds = chart.shapes.filter((s) => s.locked).map((s) => s.id)
          if (lockedIds.length === 0) return null
          return (
            <button
              onClick={() => useStore.getState().setLocked(lockedIds, false)}
              style={{
                ...zoomBtn,
                background: 'rgba(245,200,120,0.16)',
                border: `0.5px solid ${C.amber}`,
                color: C.amber
              }}
              title="ロックした部品・画像を全部解除（掴めるように戻す）。⌘Zで戻せます"
            >
              Unlock {lockedIds.length}
            </button>
          )
        })()}
      </div>
      {tool === 'polyline' && draft && (
        <div style={hintStyle}>Click to add points · Double-click to finish · Esc to cancel</div>
      )}
      {spaceUi && <div style={hintStyle}>Space + drag to pan</div>}
      {pasteArmed && (
        <div style={hintStyle}>クリックでペースト（連続OK）· Esc で終了 · 番地はコピー元と同じ</div>
      )}
      {!pasteArmed && pasteMark && clipboard && (
        <div style={hintStyle}>⌘V でマークした場所にペースト · Esc でマーク解除</div>
      )}
      {blocked && (
        <div style={{ ...hintStyle, border: '0.5px solid #8a6a31', color: C.amber }}>
          ここは描けないエリアです（チャートの絵がある所）。Invert で反転 / Mask OFF で解除
        </div>
      )}
      {unitFlash && (
        <div key={unitFlash.key} style={unitFlashStyle}>
          <style>{'@keyframes decorUnitFade{0%{opacity:1}55%{opacity:1}100%{opacity:0}}'}</style>
          {unitFlash.text}
        </div>
      )}
      <div ref={measureRef} style={measureBadge} />
      {ctxMenu && (
        <div
          style={{
            position: 'absolute',
            left: Math.min(ctxMenu.x, (wrapRef.current?.clientWidth ?? 300) - 170),
            top: Math.min(ctxMenu.y, (wrapRef.current?.clientHeight ?? 200) - 80),
            zIndex: 10,
            background: 'rgba(15,14,13,0.97)',
            border: `0.5px solid ${C.border}`,
            borderRadius: 5,
            padding: 4,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            minWidth: 160
          }}
        >
          {(() => {
            const mergeCount = chart.shapes.filter(
              (s) => selectedIds.includes(s.id) && isPaintedRun(s) && (s.repeat?.count ?? 1) <= 1
            ).length
            return (
              <button
                style={menuBtn}
                disabled={mergeCount < 2}
                onClick={() => {
                  const st = useStore.getState()
                  st.mergeShapes(st.selectedIds)
                  setCtxMenu(null)
                }}
              >
                1本に結合（{mergeCount}本 → 1本・同じフェーダー）
              </button>
            )
          })()}
          {(() => {
            const lockedCount = chart.shapes.filter(
              (s) => selectedIds.includes(s.id) && s.locked
            ).length
            const unlockMode = lockedCount > 0
            return (
              <button
                style={menuBtn}
                onClick={() => {
                  const st = useStore.getState()
                  st.setLocked(st.selectedIds, !unlockMode)
                  setCtxMenu(null)
                }}
              >
                {unlockMode
                  ? `ロック解除（${lockedCount}個）`
                  : 'ロック（キャンバスから掴めなくする・⌘L）'}
              </button>
            )
          })()}
          <button
            style={{ ...menuBtn, color: '#e0726a' }}
            onClick={() => {
              const st = useStore.getState()
              st.removeShapes(st.selectedIds)
              setCtxMenu(null)
            }}
          >
            削除（{selectedIds.length}個）
          </button>
        </div>
      )}
    </div>
  )
}

const zoomBtn: React.CSSProperties = {
  background: 'rgba(123,197,232,0.15)',
  border: `0.5px solid ${C.accent}`,
  color: C.white,
  padding: '7px 12px',
  borderRadius: 4,
  fontSize: 11,
  fontFamily: "'Bebas Neue', sans-serif",
  letterSpacing: '0.08em',
  cursor: 'pointer'
}
const unitFlashStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  pointerEvents: 'none',
  fontFamily: F.mono,
  fontSize: 46,
  letterSpacing: '0.12em',
  color: 'rgba(232,229,220,0.13)',
  animation: 'decorUnitFade 1.15s ease-out forwards',
  userSelect: 'none',
  zIndex: 4
}
const menuBtn: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: C.text,
  textAlign: 'left',
  padding: '9px 12px',
  borderRadius: 3,
  fontSize: 12,
  fontFamily: F.ui,
  cursor: 'pointer'
}
const measureBadge: React.CSSProperties = {
  position: 'absolute',
  display: 'none',
  pointerEvents: 'none',
  background: 'rgba(15,14,13,0.92)',
  border: `0.5px solid ${C.accent}`,
  borderRadius: 4,
  padding: '3px 8px',
  fontSize: 11,
  fontFamily: F.mono,
  color: C.white,
  whiteSpace: 'nowrap',
  zIndex: 5
}
const hintStyle: React.CSSProperties = {
  position: 'absolute',
  left: '50%',
  bottom: 12,
  transform: 'translateX(-50%)',
  background: 'rgba(15,14,13,0.9)',
  border: `0.5px solid ${C.border}`,
  borderRadius: 4,
  padding: '5px 12px',
  fontSize: 11,
  color: C.label,
  fontFamily: "'Inter','Noto Sans JP',sans-serif",
  pointerEvents: 'none'
}
