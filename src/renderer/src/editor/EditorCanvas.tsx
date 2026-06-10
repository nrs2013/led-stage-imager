import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { useStore } from '../state/store'
import type { Point, Shape } from '../model/types'
import { C, F } from '../ui/tokens'
import { cornerBounds, traceShape, shapeArrayBounds, cellsBetween, type Bounds } from './geometry'
import { buildCandidates, salientOf, snap1D, snapMoveDelta, softAxis, type SnapCand } from './snapping'

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
const BOXY = new Set<Shape['type']>(['rect', 'ellipse', 'triangle', 'star', 'polygon'])

/** One pointer gesture on the canvas: move the whole shape, drag one vertex
 *  (line/polyline), drag a box corner/edge against its fixed opposite side, or pull
 *  the end of a painted run to change its length. Alignment candidates are computed
 *  once at gesture start. */
type Interaction =
  | {
      kind: 'move'
      id: string
      sx: number
      sy: number
      orig: Point[]
      forceSnap?: boolean
      cand?: SnapCand
      sal?: { xs: number[]; ys: number[] }
    }
  | { kind: 'vertex'; id: string; idx: number; cand?: SnapCand }
  | { kind: 'corner'; id: string; anchor: Point; aspect: number; cand?: SnapCand }
  | { kind: 'edge'; id: string; b: Bounds; dir: 'n' | 's' | 'e' | 'w'; cand?: SnapCand }
  | { kind: 'end'; id: string; anchor: Point; cand?: SnapCand } // anchor = fixed end's cell

interface Handle {
  x: number
  y: number
  kind: 'vertex' | 'corner' | 'end' | 'edge'
  idx: number
  anchor?: Point
  dir?: 'n' | 's' | 'e' | 'w'
}

/** A painted dot run: 1px freehand whose points all sit on cell centres (x.5/y.5). */
function isPaintedRun(sh: Shape): boolean {
  return (
    sh.type === 'freehand' &&
    (sh.strokeWidth || 1) <= 1 &&
    sh.points.length >= 1 &&
    sh.points.every(
      (p) => Math.abs((p.x % 1) - 0.5) < 1e-6 && Math.abs((p.y % 1) - 0.5) < 1e-6
    )
  )
}

/** Grabbable handles of a shape. Painted runs expose their two ends (pull = re-aim /
 *  change length); smooth pen strokes have none (move/delete/repaint). */
function shapeHandles(sh: Shape): Handle[] {
  if (sh.type === 'line' || sh.type === 'polyline') {
    return sh.points.map((p, i) => ({ x: p.x, y: p.y, kind: 'vertex' as const, idx: i }))
  }
  if (sh.type === 'freehand' && isPaintedRun(sh)) {
    const a = sh.points[0]
    const b = sh.points[sh.points.length - 1]
    const cellOf = (p: Point): Point => ({ x: Math.floor(p.x), y: Math.floor(p.y) })
    if (sh.points.length === 1 || (a.x === b.x && a.y === b.y)) {
      return [{ x: b.x, y: b.y, kind: 'end' as const, idx: 1, anchor: cellOf(a) }]
    }
    return [
      { x: a.x, y: a.y, kind: 'end' as const, idx: 0, anchor: cellOf(b) },
      { x: b.x, y: b.y, kind: 'end' as const, idx: 1, anchor: cellOf(a) }
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
 *  colours readable) when zoomed far out — the real output is always the exact width. */
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
  const select = useStore((s) => s.select)
  const addShape = useStore((s) => s.addShape)
  const snapToPixel = useStore((s) => s.snapToPixel)
  const setSnap = useStore((s) => s.setSnap)
  const mask = useStore((s) => s.mask)

  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const contentRef = useRef<HTMLCanvasElement | null>(null)
  if (!contentRef.current && typeof document !== 'undefined') {
    contentRef.current = document.createElement('canvas')
  }
  const underlayImg = useRef<HTMLImageElement | null>(null)
  const maskImg = useRef<HTMLImageElement | null>(null)
  const contentDirty = useRef(true)
  const boostRef = useRef(1) // display-only min stroke width (recomputed per zoom bucket)

  const [view, setView] = useState<View>({ scale: 0.4, tx: 40, ty: 40 })
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
    const u = chart.underlay
    if (u?.visible && underlayImg.current) {
      ctx.globalAlpha = u.opacity
      ctx.drawImage(underlayImg.current, 0, 0, w, h)
      ctx.globalAlpha = 1
    }
    if (maskImg.current) ctx.drawImage(maskImg.current, 0, 0, w, h)
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    chart.shapes.forEach((shape, i) =>
      drawShapeInto(ctx, shape, shapeColor(i), shapeFill(i), boostRef.current)
    )
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
    // keep 1px lines >= ~1.3 screen px in the editor (quantised so we rarely redraw)
    const boost = Math.min(8, Math.max(1, Math.ceil(1.3 / view.scale)))
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
    ctx.fillStyle = C.canvas
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
      if (tool === 'pixelpen') {
        // paint feel: every visited 1px cell fills in as you drag
        ctx.fillStyle = C.accent
        for (const pp of draft.points) ctx.fillRect(pp.x - 0.5, pp.y - 0.5, 1, 1)
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
    ctx.setTransform(1, 0, 0, 1, 0, 0)
  }

  // schedule a draw after every render (rAF-coalesced)
  const drawRef = useRef(draw)
  drawRef.current = draw
  const rafRef = useRef(0)
  useEffect(() => {
    cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => drawRef.current())
  })

  // mark content dirty when chart / underlay / mask change
  useEffect(() => {
    contentDirty.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chart.shapes, chart.canvas, chart.underlay, mask])

  // cache underlay + mask images
  useEffect(() => {
    const url = chart.underlay?.dataUrl
    if (!url) {
      underlayImg.current = null
      contentDirty.current = true
      return
    }
    const img = new Image()
    img.onload = (): void => {
      underlayImg.current = img
      contentDirty.current = true
      drawRef.current()
    }
    img.src = url
  }, [chart.underlay?.dataUrl])
  useEffect(() => {
    const url = mask?.overlay
    if (!url) {
      maskImg.current = null
      contentDirty.current = true
      return
    }
    const img = new Image()
    img.onload = (): void => {
      maskImg.current = img
      contentDirty.current = true
      drawRef.current()
    }
    img.src = url
  }, [mask?.overlay])

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
        if (draftRef.current) {
          setDraft(null)
          drawing.current = false
        } else {
          useStore.getState().select(null) // Esc with nothing in progress = deselect
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
      // quick tool keys (industry-standard letters) + F = fit view
      if (!e.metaKey && !e.ctrlKey && !e.altKey) {
        const k = e.key.toLowerCase()
        if (k === 'f') {
          fitRef.current()
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
      const stp = e.shiftKey ? 10 : 1
      let dx = 0
      let dy = 0
      if (e.key === 'ArrowLeft') dx = -stp
      else if (e.key === 'ArrowRight') dx = stp
      else if (e.key === 'ArrowUp') dy = -stp
      else if (e.key === 'ArrowDown') dy = stp
      else return
      st.nudgeShape(sel, dx, dy)
      e.preventDefault()
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

  /** Precise pick: distance to the actual stroke/fill (not just the bounding box),
   *  so thin 1px lines are selectable without grabbing everything around them. */
  const hitTest = (p: Point): string | null => {
    const ctx = scratchCtx.current
    const tol = Math.max(2, 6 / viewRef.current.scale)
    for (let i = chart.shapes.length - 1; i >= 0; i--) {
      const sh = chart.shapes[i]
      const b = shapeArrayBounds(sh)
      const pad = tol + (sh.strokeWidth || 1) / 2
      if (p.x < b.x - pad || p.x > b.x + b.w + pad || p.y < b.y - pad || p.y > b.y + b.h + pad) {
        continue
      }
      if (!ctx) return sh.id // no scratch context: fall back to the bounding box
      const reps = sh.repeat && sh.repeat.count > 1 ? sh.repeat.count : 1
      const rdx = sh.repeat?.dx ?? 0
      const rdy = sh.repeat?.dy ?? 0
      ctx.lineWidth = Math.max(sh.strokeWidth || 1, tol * 2)
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      for (let r = 0; r < reps; r++) {
        const q = { x: p.x - rdx * r, y: p.y - rdy * r }
        traceShape(ctx, sh)
        if (ctx.isPointInStroke(q.x, q.y)) return sh.id
        if (!isOpen(sh.type) && sh.display !== 'stroke' && ctx.isPointInPath(q.x, q.y)) return sh.id
      }
    }
    return null
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

  /** Starts a whole-shape move gesture (records one undo step + alignment targets). */
  const startMove = (id: string, raw: Point, forceSnap: boolean): boolean => {
    const sh = chart.shapes.find((s) => s.id === id)
    if (!sh) return false
    select(id)
    useStore.getState().beginHistory()
    interaction.current = {
      kind: 'move',
      id,
      sx: raw.x,
      sy: raw.y,
      orig: sh.points.map((pp) => ({ ...pp })),
      forceSnap,
      cand: buildCandidates(chart.shapes, id),
      sal: salientOf(sh)
    }
    return true
  }

  const onPointerDown = (e: RPointerEvent<HTMLCanvasElement>): void => {
    if (spaceHeld.current || e.button === 1) {
      panning.current = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty }
      canvasRef.current?.setPointerCapture(e.pointerId)
      return
    }
    if (e.button === 2) {
      // right-drag: grab & move whatever is under the cursor, in any tool
      const raw = toCanvasRaw(e.clientX, e.clientY)
      const hit = hitTest(raw)
      if (hit && startMove(hit, raw, true)) canvasRef.current?.setPointerCapture(e.pointerId)
      return
    }
    if (e.button !== 0) return
    const p = toCanvas(e.clientX, e.clientY)
    if (tool === 'select') {
      const raw = toCanvasRaw(e.clientX, e.clientY)
      // grab a handle of the already-selected shape first (resize/reshape/pull)
      const sel = chart.shapes.find((s) => s.id === selectedId)
      if (sel) {
        const hd = findHandle(sel, raw)
        if (hd) {
          useStore.getState().beginHistory()
          const cand = buildCandidates(chart.shapes, sel.id)
          if (hd.kind === 'vertex') {
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
      select(hit)
      if (hit && startMove(hit, raw, false)) canvasRef.current?.setPointerCapture(e.pointerId)
      return
    }
    // Cmd/Opt + drag in any drawing tool = grab & move without switching to Select
    if (e.metaKey || e.altKey) {
      const raw = toCanvasRaw(e.clientX, e.clientY)
      const hit = hitTest(raw)
      if (hit) {
        if (startMove(hit, raw, true)) canvasRef.current?.setPointerCapture(e.pointerId)
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
      // paint: press fills the cell under the cursor, drag keeps filling
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
    if (panning.current) {
      const pan = panning.current
      userAdjusted.current = true
      setView((v) => ({ ...v, tx: pan.tx + (e.clientX - pan.x), ty: pan.ty + (e.clientY - pan.y) }))
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
        st.setShapePoints(it.id, it.orig.map((pt) => ({ x: pt.x + dx, y: pt.y + dy })))
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
            const sx2 = snap1D(cell.x + 0.5, it.cand.xs, tolA, 0, 0, false)
            const sy2 = snap1D(cell.y + 0.5, it.cand.ys, tolA, 0, 0, false)
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
        if (pts.length) st.setShapePoints(it.id, pts.length === 1 ? [pts[0], pts[0]] : pts)
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
          const sx2 = snap1D(raw.x, it.cand.xs, tolA, 10, 2, true)
          const sy2 = snap1D(raw.y, it.cand.ys, tolA, 10, 2, true)
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
            const s2 = snap1D(raw.x, it.cand.xs, tolA, 10, 2, true)
            nx = s2.v
            gx = s2.guide
          }
          if (it.dir === 'e') p2.x = nx
          else p1.x = nx
        } else {
          let ny = free ? raw.y : Math.round(raw.y)
          if (!free && snapToPixel && it.cand) {
            const s2 = snap1D(raw.y, it.cand.ys, tolA, 10, 2, true)
            ny = s2.v
            gy = s2.guide
          }
          if (it.dir === 's') p2.y = ny
          else p1.y = ny
        }
        guidesRef.current = { x: gx, y: gy }
        st.setShapePoints(it.id, [p1, p2])
        return
      }
      // corner: opposite corner anchored; Shift keeps the original aspect ratio
      {
        let np = free ? raw : { x: Math.round(raw.x), y: Math.round(raw.y) }
        let gx: number | null = null
        let gy: number | null = null
        if (!free && snapToPixel && it.cand) {
          const sx2 = snap1D(raw.x, it.cand.xs, tolA, 10, 2, true)
          const sy2 = snap1D(raw.y, it.cand.ys, tolA, 10, 2, true)
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
    if (drawing.current && tool === 'pixelpen' && draftRef.current) {
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
        if (pts.length) setDraft((d) => (d ? { ...d, points: pts } : d))
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
      if (pp.length >= 2)
        addShape({
          type: 'freehand',
          points: pp,
          ...(tool === 'pixelpen' ? { strokeWidth: 1 } : {})
        })
    } else if (d0.type === 'line') {
      if (dist(a, b) >= MIN_SIZE) addShape({ type: 'line', points: [a, b] })
    } else {
      const bnd = cornerBounds(a, b)
      if (bnd.w >= MIN_SIZE || bnd.h >= MIN_SIZE) addShape({ type: d0.type, points: [a, b] })
    }
    setDraft(null)
  }

  const onPointerUp = (e: RPointerEvent<HTMLCanvasElement>): void => {
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
  }

  const onDoubleClick = (): void => {
    const d0 = draftRef.current
    if (d0?.type === 'polyline') {
      const verts = d0.points.slice(0, -1)
      if (verts.length >= 2) addShape({ type: 'polyline', points: verts })
      setDraft(null)
    }
  }

  const cursor = spaceUi ? 'grab' : (cursorOv ?? (tool === 'select' ? 'default' : 'crosshair'))

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
        }}
        onDoubleClick={onDoubleClick}
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
      </div>
      {tool === 'polyline' && draft && (
        <div style={hintStyle}>Click to add points · Double-click to finish · Esc to cancel</div>
      )}
      {spaceUi && <div style={hintStyle}>Space + drag to pan</div>}
      {blocked && (
        <div style={{ ...hintStyle, border: '0.5px solid #8a6a31', color: C.amber }}>
          ここは描けないエリアです（チャートの絵がある所）。Invert で反転 / Mask OFF で解除
        </div>
      )}
    </div>
  )
}

const zoomBtn: React.CSSProperties = {
  background: 'rgba(123,197,232,0.15)',
  border: `0.5px solid ${C.accent}`,
  color: C.white,
  padding: '4px 10px',
  borderRadius: 4,
  fontSize: 11,
  fontFamily: "'Bebas Neue', sans-serif",
  letterSpacing: '0.08em',
  cursor: 'pointer'
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
