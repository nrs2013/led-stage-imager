import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { useStore } from '../state/store'
import type { Point, Shape } from '../model/types'
import { C, F } from '../ui/tokens'
import { cornerBounds, traceShape, shapeArrayBounds } from './geometry'

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
      const dShape: Shape = {
        id: '__draft',
        type: draft.type,
        points: draft.points,
        display: draft.type === 'rect' || draft.type === 'ellipse' ? 'both' : 'stroke',
        strokeWidth: tool === 'pixelpen' ? 1 : 4,
        glowRadius: 0,
        glowIntensity: 0
      }
      drawShapeInto(ctx, dShape, C.accent, 'rgba(123,197,232,0.3)')
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
      const hs = 8 / v.scale
      ctx.fillStyle = C.accent
      for (const c of [
        { x: b.x, y: b.y },
        { x: b.x + b.w, y: b.y },
        { x: b.x, y: b.y + b.h },
        { x: b.x + b.w, y: b.y + b.h }
      ]) {
        ctx.fillRect(c.x - hs / 2, c.y - hs / 2, hs, hs)
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

  const toCanvas = (clientX: number, clientY: number): Point => {
    const r = canvasRef.current!.getBoundingClientRect()
    const v = viewRef.current
    const x = (clientX - r.left - v.tx) / v.scale
    const y = (clientY - r.top - v.ty) / v.scale
    const snap = snapToPixel || tool === 'pixelpen'
    return snap ? { x: Math.round(x), y: Math.round(y) } : { x, y }
  }

  const isDrawable = (p: Point): boolean => {
    if (!mask) return true
    const xi = Math.floor(p.x)
    const yi = Math.floor(p.y)
    if (xi < 0 || yi < 0 || xi >= mask.w || yi >= mask.h) return false
    return mask.bitmap[yi * mask.w + xi] === 1
  }

  const hitTest = (p: Point): string | null => {
    const tol = Math.max(3, 4 / view.scale)
    for (let i = chart.shapes.length - 1; i >= 0; i--) {
      const b = shapeArrayBounds(chart.shapes[i])
      if (p.x >= b.x - tol && p.x <= b.x + b.w + tol && p.y >= b.y - tol && p.y <= b.y + b.h + tol) {
        return chart.shapes[i].id
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
      select(hitTest(p))
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
    const dt: DrawType = tool === 'pixelpen' ? 'freehand' : (tool as DrawType)
    setDraft({ type: dt, points: [p, p] })
    canvasRef.current?.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: RPointerEvent<HTMLCanvasElement>): void => {
    if (panning.current) {
      const pan = panning.current
      userAdjusted.current = true
      setView((v) => ({ ...v, tx: pan.tx + (e.clientX - pan.x), ty: pan.ty + (e.clientY - pan.y) }))
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
      if (pts.length >= 2)
        addShape({
          type: 'freehand',
          points: pts,
          ...(tool === 'pixelpen' ? { strokeWidth: 1, glowRadius: 6, glowIntensity: 0.5 } : {})
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
          title="1ピクセル単位に吸着して描く"
        >
          {snapToPixel ? 'PX吸着 ON' : 'PX吸着 OFF'}
        </button>
      </div>
      {tool === 'polyline' && draft && (
        <div style={hintStyle}>クリックで頂点追加 / ダブルクリックで確定 / Escでキャンセル</div>
      )}
      {spaceUi && <div style={hintStyle}>スペース＋ドラッグで移動中</div>}
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
