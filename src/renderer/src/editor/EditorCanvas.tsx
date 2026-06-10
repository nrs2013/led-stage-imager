import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { useStore } from '../state/store'
import type { Point, Shape } from '../model/types'
import { C, F } from '../ui/tokens'
import { cornerBounds, traceShape, shapeArrayBounds, cellsBetween } from './geometry'

const MIN_SIZE = 3
const clamp = (n: number, lo: number, hi: number): number => (n < lo ? lo : n > hi ? hi : n)
const dist = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y)
const STROKE = '#cfeaf6'
const FILL = 'rgba(123,197,232,0.16)'

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
 *  (line/polyline), or drag a box corner against its fixed opposite corner. */
type Interaction =
  | { kind: 'move'; id: string; sx: number; sy: number; orig: Point[] }
  | { kind: 'vertex'; id: string; idx: number }
  | { kind: 'corner'; id: string; anchor: Point }

interface Handle {
  x: number
  y: number
  kind: 'vertex' | 'corner'
  idx: number
  anchor?: Point
}

/** Grabbable handles of a shape. Freehand strokes have none (move/delete/repaint). */
function shapeHandles(sh: Shape): Handle[] {
  if (sh.type === 'line' || sh.type === 'polyline') {
    return sh.points.map((p, i) => ({ x: p.x, y: p.y, kind: 'vertex' as const, idx: i }))
  }
  if (BOXY.has(sh.type) && sh.points.length >= 2) {
    const b = cornerBounds(sh.points[0], sh.points[sh.points.length - 1])
    const corners = [
      { x: b.x, y: b.y },
      { x: b.x + b.w, y: b.y },
      { x: b.x, y: b.y + b.h },
      { x: b.x + b.w, y: b.y + b.h }
    ]
    return corners.map((c, i) => ({
      ...c,
      kind: 'corner' as const,
      idx: i,
      anchor: { x: 2 * b.x + b.w - c.x, y: 2 * b.y + b.h - c.y } // opposite corner stays put
    }))
  }
  return []
}

/** Draws one shape (with its repeat array) in a given colour into the content buffer. */
function drawShapeInto(ctx: CanvasRenderingContext2D, shape: Shape, stroke: string, fill: string): void {
  const reps = shape.repeat && shape.repeat.count > 1 ? shape.repeat.count : 1
  const dx = shape.repeat?.dx ?? 0
  const dy = shape.repeat?.dy ?? 0
  const open = isOpen(shape.type)
  ctx.strokeStyle = stroke
  ctx.fillStyle = fill
  ctx.lineWidth = shape.strokeWidth || 4
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

  const [view, setView] = useState<View>({ scale: 0.4, tx: 40, ty: 40 })
  const viewRef = useRef(view)
  viewRef.current = view
  const [draft, setDraft] = useState<{ type: DrawType; points: Point[] } | null>(null)
  const drawing = useRef(false)
  const interaction = useRef<Interaction | null>(null)
  const lastCell = useRef<Point | null>(null)
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
    for (const shape of chart.shapes) drawShapeInto(ctx, shape, STROKE, FILL)
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
        drawShapeInto(ctx, dShape, C.accent, 'rgba(123,197,232,0.3)')
      }
    }
    const sel = chart.shapes.find((s) => s.id === selectedId)
    if (sel) {
      drawShapeInto(ctx, sel, C.accent, 'rgba(123,197,232,0.3)')
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
        ctx.fillRect(hd.x - hs / 2, hd.y - hs / 2, hs, hs)
        ctx.strokeRect(hd.x - hs / 2, hd.y - hs / 2, hs, hs)
      }
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
        setDraft(null)
        drawing.current = false
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
      const r = cv.getBoundingClientRect()
      const mx = e.clientX - r.left
      const my = e.clientY - r.top
      const v = viewRef.current
      const factor = Math.exp(-e.deltaY * 0.0015)
      const scale = clamp(v.scale * factor, 0.05, 64)
      const cx = (mx - v.tx) / v.scale
      const cy = (my - v.ty) / v.scale
      userAdjusted.current = true
      setView({ scale, tx: mx - cx * scale, ty: my - cy * scale })
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

  const onPointerDown = (e: RPointerEvent<HTMLCanvasElement>): void => {
    if (spaceHeld.current || e.button === 1) {
      panning.current = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty }
      canvasRef.current?.setPointerCapture(e.pointerId)
      return
    }
    if (e.button !== 0) return
    const p = toCanvas(e.clientX, e.clientY)
    if (tool === 'select') {
      const raw = toCanvasRaw(e.clientX, e.clientY)
      // grab a handle of the already-selected shape first (resize/reshape)
      const sel = chart.shapes.find((s) => s.id === selectedId)
      if (sel) {
        const tolH = 9 / viewRef.current.scale
        const hd = shapeHandles(sel).find(
          (hh) => Math.abs(hh.x - raw.x) <= tolH && Math.abs(hh.y - raw.y) <= tolH
        )
        if (hd) {
          interaction.current =
            hd.kind === 'vertex'
              ? { kind: 'vertex', id: sel.id, idx: hd.idx }
              : { kind: 'corner', id: sel.id, anchor: hd.anchor! }
          canvasRef.current?.setPointerCapture(e.pointerId)
          return
        }
      }
      const hit = hitTest(toCanvasRaw(e.clientX, e.clientY))
      select(hit)
      if (hit) {
        const sh = chart.shapes.find((s) => s.id === hit)
        if (sh) {
          interaction.current = {
            kind: 'move',
            id: hit,
            sx: raw.x,
            sy: raw.y,
            orig: sh.points.map((pp) => ({ ...pp }))
          }
          canvasRef.current?.setPointerCapture(e.pointerId)
        }
      }
      return
    }
    if (tool === 'pixelpen') {
      // paint: press fills the cell under the cursor, drag keeps filling
      const cell = toCell(e.clientX, e.clientY)
      const center = { x: cell.x + 0.5, y: cell.y + 0.5 }
      if (mask && !isDrawable(center)) return
      drawing.current = true
      lastCell.current = cell
      setDraft({ type: 'freehand', points: [center] })
      canvasRef.current?.setPointerCapture(e.pointerId)
      return
    }
    if (mask && !isDrawable(p)) return
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
    if (panning.current) {
      const pan = panning.current
      userAdjusted.current = true
      setView((v) => ({ ...v, tx: pan.tx + (e.clientX - pan.x), ty: pan.ty + (e.clientY - pan.y) }))
      return
    }
    if (interaction.current) {
      const it = interaction.current
      const raw = toCanvasRaw(e.clientX, e.clientY)
      const free = e.metaKey || e.altKey // hold Cmd/Opt for free movement (no pixel snap)
      const st = useStore.getState()
      if (it.kind === 'move') {
        let dx = raw.x - it.sx
        let dy = raw.y - it.sy
        if (!free) {
          dx = Math.round(dx)
          dy = Math.round(dy)
        }
        st.setShapePoints(it.id, it.orig.map((pt) => ({ x: pt.x + dx, y: pt.y + dy })))
        return
      }
      const np = free ? raw : { x: Math.round(raw.x), y: Math.round(raw.y) }
      const sh = st.chart.shapes.find((s) => s.id === it.id)
      if (!sh) return
      if (it.kind === 'vertex') {
        st.setShapePoints(it.id, sh.points.map((pt, i) => (i === it.idx ? np : pt)))
      } else {
        st.setShapePoints(it.id, [it.anchor, np]) // box reshape: opposite corner anchored
      }
      return
    }
    if (drawing.current && tool === 'pixelpen' && draft) {
      const cell = toCell(e.clientX, e.clientY)
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
    if (tool === 'polyline' && draft?.type === 'polyline') {
      setDraft((d) => (d ? { ...d, points: [...d.points.slice(0, -1), p] } : d))
      return
    }
    if (!drawing.current || !draft) return
    if (draft.type === 'freehand') {
      if (!mask || isDrawable(p)) setDraft((d) => (d ? { ...d, points: [...d.points, p] } : d))
    } else {
      setDraft((d) => (d ? { ...d, points: [d.points[0], p] } : d))
    }
  }

  const commit = (): void => {
    if (!draft) return
    const pts = draft.points
    const a = pts[0]
    const b = pts[pts.length - 1]
    if (draft.type === 'freehand') {
      // a single painted dot is a valid shape (duplicate the point so the stroke renders)
      const pp = pts.length === 1 ? [pts[0], pts[0]] : pts
      if (pp.length >= 2)
        addShape({
          type: 'freehand',
          points: pp,
          ...(tool === 'pixelpen' ? { strokeWidth: 1 } : {})
        })
    } else if (draft.type === 'line') {
      if (dist(a, b) >= MIN_SIZE) addShape({ type: 'line', points: [a, b] })
    } else {
      const bnd = cornerBounds(a, b)
      if (bnd.w >= MIN_SIZE || bnd.h >= MIN_SIZE) addShape({ type: draft.type, points: [a, b] })
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
      canvasRef.current?.releasePointerCapture(e.pointerId)
      return
    }
    if (tool === 'polyline') return
    if (!drawing.current) return
    drawing.current = false
    commit()
  }

  const onDoubleClick = (): void => {
    if (draft?.type === 'polyline') {
      const verts = draft.points.slice(0, -1)
      if (verts.length >= 2) addShape({ type: 'polyline', points: verts })
      setDraft(null)
    }
  }

  const cursor = spaceUi ? 'grab' : tool === 'select' ? 'default' : 'crosshair'

  return (
    <div ref={wrapRef} style={{ position: 'relative', flex: 1, overflow: 'hidden', background: C.canvas }}>
      <canvas
        ref={canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={onDoubleClick}
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
