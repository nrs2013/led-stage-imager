import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { useStore } from '../state/store'
import type { Point, Shape } from '../model/types'
import { C, F } from '../ui/tokens'
import {
  cornerBounds,
  trianglePoints,
  starPoints,
  regularPolygonPoints,
  pointsAttr,
  shapeBounds
} from './geometry'

const MIN_SIZE = 3
const clamp = (n: number, lo: number, hi: number): number => (n < lo ? lo : n > hi ? hi : n)
const dist = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y)

type DrawType = Exclude<Shape['type'], never>

interface View {
  scale: number
  tx: number
  ty: number
}

/** Renders one shape as the matching SVG element. */
function ShapeEl({
  shape,
  selected,
  crisp = false,
  onPick
}: {
  shape: Shape
  selected: boolean
  crisp?: boolean
  onPick?: (e: RPointerEvent) => void
}): React.JSX.Element | null {
  const sw = shape.strokeWidth || 4
  const strokeCol = selected ? C.accent : '#cfeaf6'
  const fillCol = selected ? 'rgba(123,197,232,0.30)' : 'rgba(123,197,232,0.16)'
  const open = shape.type === 'line' || shape.type === 'polyline' || shape.type === 'freehand'
  const stroke = shape.display === 'fill' && !open ? 'none' : strokeCol
  const fill = open ? 'none' : shape.display === 'stroke' ? 'none' : fillCol
  const common = {
    stroke,
    strokeWidth: sw,
    fill,
    strokeLinejoin: 'round' as const,
    strokeLinecap: 'round' as const,
    shapeRendering: crisp ? 'crispEdges' : 'geometricPrecision',
    onPointerDown: onPick,
    style: { cursor: onPick ? 'pointer' : 'default' }
  }
  const p = shape.points
  if (p.length < 2) return null
  switch (shape.type) {
    case 'line':
      return <line x1={p[0].x} y1={p[0].y} x2={p[1].x} y2={p[1].y} {...common} />
    case 'polyline':
    case 'freehand':
      return <polyline points={pointsAttr(p)} {...common} />
    case 'rect': {
      const b = cornerBounds(p[0], p[p.length - 1])
      return <rect x={b.x} y={b.y} width={b.w} height={b.h} {...common} />
    }
    case 'ellipse': {
      const b = cornerBounds(p[0], p[p.length - 1])
      return <ellipse cx={b.x + b.w / 2} cy={b.y + b.h / 2} rx={b.w / 2} ry={b.h / 2} {...common} />
    }
    case 'triangle':
      return <polygon points={pointsAttr(trianglePoints(p[0], p[p.length - 1]))} {...common} />
    case 'star':
      return <polygon points={pointsAttr(starPoints(p[0], p[p.length - 1]))} {...common} />
    case 'polygon':
      return <polygon points={pointsAttr(regularPolygonPoints(p[0], p[p.length - 1]))} {...common} />
    default:
      return null
  }
}

/** Renders a shape, expanding a repeat array into lightweight <use> copies. */
function ShapeNode({
  shape,
  selected,
  crisp,
  onPick
}: {
  shape: Shape
  selected: boolean
  crisp: boolean
  onPick?: (e: RPointerEvent) => void
}): React.JSX.Element | null {
  const count = shape.repeat && shape.repeat.count > 1 ? shape.repeat.count : 1
  if (count <= 1) return <ShapeEl shape={shape} selected={selected} crisp={crisp} onPick={onPick} />
  const dx = shape.repeat!.dx
  const dy = shape.repeat!.dy
  return (
    <g>
      <g id={`s-${shape.id}`}>
        <ShapeEl shape={shape} selected={selected} crisp={crisp} onPick={onPick} />
      </g>
      {Array.from({ length: count - 1 }, (_, k) => (
        <use
          key={k}
          href={`#s-${shape.id}`}
          x={dx * (k + 1)}
          y={dy * (k + 1)}
          onPointerDown={onPick}
          style={{ pointerEvents: onPick ? 'auto' : 'none', cursor: onPick ? 'pointer' : 'default' }}
        />
      ))}
    </g>
  )
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
  const svgRef = useRef<SVGSVGElement>(null)
  const [view, setView] = useState<View>({ scale: 0.4, tx: 40, ty: 40 })
  const viewRef = useRef(view)
  viewRef.current = view

  const [draft, setDraft] = useState<{ type: DrawType; points: Point[] } | null>(null)
  const drawing = useRef(false)
  const panning = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null)
  const spaceHeld = useRef(false)
  const [spaceUi, setSpaceUi] = useState(false)
  const userAdjusted = useRef(false) // true once the user zooms/pans → stop auto-fitting

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

  /** Zoom to an absolute scale, keeping the viewport centre fixed. */
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

  useLayoutEffect(() => {
    fit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [w, h])

  // Space-to-pan + Escape-to-cancel.
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

  // Keyboard precision editing: arrows nudge (Shift=10px), Delete removes, Cmd/Ctrl+D duplicates.
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
      const step = e.shiftKey ? 10 : 1
      let dx = 0
      let dy = 0
      if (e.key === 'ArrowLeft') dx = -step
      else if (e.key === 'ArrowRight') dx = step
      else if (e.key === 'ArrowUp') dy = -step
      else if (e.key === 'ArrowDown') dy = step
      else return
      st.nudgeShape(sel, dx, dy)
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Non-passive wheel zoom around the cursor.
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      const r = svg.getBoundingClientRect()
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
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  }, [])

  // Auto-fit the canvas to the container until the user manually zooms/pans.
  useEffect(() => {
    const el = wrapRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      if (!userAdjusted.current) fit()
    })
    ro.observe(el)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [w, h])

  const toCanvas = (clientX: number, clientY: number): Point => {
    const r = svgRef.current!.getBoundingClientRect()
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

  const onPointerDown = (e: RPointerEvent<SVGSVGElement>): void => {
    if (spaceHeld.current || e.button === 1) {
      panning.current = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty }
      svgRef.current?.setPointerCapture(e.pointerId)
      return
    }
    if (e.button !== 0) return
    const p = toCanvas(e.clientX, e.clientY)

    if (tool === 'select') {
      select(null) // empty-space click deselects (shapes stop propagation)
      return
    }
    if (mask && !isDrawable(p)) return // chart mask: can't start drawing outside the area
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
    svgRef.current?.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: RPointerEvent<SVGSVGElement>): void => {
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

  const onPointerUp = (e: RPointerEvent<SVGSVGElement>): void => {
    if (panning.current) {
      panning.current = null
      svgRef.current?.releasePointerCapture(e.pointerId)
      return
    }
    if (tool === 'polyline') return // polyline finishes on double-click
    if (!drawing.current) return
    drawing.current = false
    commit()
  }

  const onDoubleClick = (): void => {
    if (draft?.type === 'polyline') {
      const verts = draft.points.slice(0, -1) // drop trailing rubber-band point
      if (verts.length >= 2) addShape({ type: 'polyline', points: verts })
      setDraft(null)
    }
  }

  const sel = chart.shapes.find((s) => s.id === selectedId)
  let selB = sel ? shapeBounds(sel) : null
  if (sel && selB && sel.repeat && sel.repeat.count > 1) {
    const c = sel.repeat.count - 1
    const ex = sel.repeat.dx * c
    const ey = sel.repeat.dy * c
    selB = {
      x: Math.min(selB.x, selB.x + ex),
      y: Math.min(selB.y, selB.y + ey),
      w: selB.w + Math.abs(ex),
      h: selB.h + Math.abs(ey)
    }
  }
  const handle = 8 / view.scale
  const cursor = spaceUi ? 'grab' : tool === 'select' ? 'default' : 'crosshair'

  return (
    <div ref={wrapRef} style={{ position: 'relative', flex: 1, overflow: 'hidden', background: C.canvas }}>
      <svg
        ref={svgRef}
        width="100%"
        height="100%"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={onDoubleClick}
        style={{ display: 'block', cursor, touchAction: 'none' }}
      >
        <g transform={`translate(${view.tx},${view.ty}) scale(${view.scale})`}>
          {/* canvas = pure black background (also catches empty-space clicks) */}
          <rect x={0} y={0} width={w} height={h} fill="#000" />
          {chart.underlay && chart.underlay.visible && (
            <image
              href={chart.underlay.dataUrl}
              x={0}
              y={0}
              width={w}
              height={h}
              opacity={chart.underlay.opacity}
              preserveAspectRatio="none"
              style={{ pointerEvents: 'none', imageRendering: 'pixelated' }}
            />
          )}
          {/* chart mask: shade the non-drawable area */}
          {mask && (
            <image
              href={mask.overlay}
              x={0}
              y={0}
              width={w}
              height={h}
              preserveAspectRatio="none"
              style={{ pointerEvents: 'none', imageRendering: 'pixelated' }}
            />
          )}
          {/* canvas border */}
          <rect
            x={0}
            y={0}
            width={w}
            height={h}
            fill="none"
            stroke={C.border}
            strokeWidth={1 / view.scale}
            style={{ pointerEvents: 'none' }}
          />

          {/* pixel grid: 10px major when zoomed, 1px minor at high zoom */}
          {view.scale >= 1.5 && (
            <>
              <defs>
                <pattern id="grid-minor" width={1} height={1} patternUnits="userSpaceOnUse">
                  <path d="M1 0 H0 V1" fill="none" stroke="#2b2926" strokeWidth={0.7 / view.scale} />
                </pattern>
                <pattern id="grid-major" width={10} height={10} patternUnits="userSpaceOnUse">
                  <path d="M10 0 H0 V10" fill="none" stroke="#4d473f" strokeWidth={1 / view.scale} />
                </pattern>
              </defs>
              {view.scale >= 6 && (
                <rect x={0} y={0} width={w} height={h} fill="url(#grid-minor)" style={{ pointerEvents: 'none' }} />
              )}
              <rect x={0} y={0} width={w} height={h} fill="url(#grid-major)" style={{ pointerEvents: 'none' }} />
            </>
          )}

          {chart.shapes.map((shape) => (
            <ShapeNode
              key={shape.id}
              shape={shape}
              selected={shape.id === selectedId}
              crisp={snapToPixel}
              onPick={
                tool === 'select'
                  ? (e) => {
                      e.stopPropagation()
                      select(shape.id)
                    }
                  : undefined
              }
            />
          ))}

          {/* in-progress draft preview */}
          {draft && (
            <ShapeEl
              shape={{
                id: '__draft',
                type: draft.type,
                points: draft.points,
                display: draft.type === 'rect' || draft.type === 'ellipse' ? 'both' : 'stroke',
                strokeWidth: 4,
                glowRadius: 0,
                glowIntensity: 0
              }}
              selected
              crisp={snapToPixel}
            />
          )}

          {/* selection bounding box + handles */}
          {selB && (
            <g style={{ pointerEvents: 'none' }}>
              <rect
                x={selB.x}
                y={selB.y}
                width={selB.w}
                height={selB.h}
                fill="none"
                stroke={C.accent}
                strokeWidth={1 / view.scale}
                strokeDasharray={`${4 / view.scale} ${3 / view.scale}`}
              />
              {[
                { x: selB.x, y: selB.y },
                { x: selB.x + selB.w, y: selB.y },
                { x: selB.x, y: selB.y + selB.h },
                { x: selB.x + selB.w, y: selB.y + selB.h }
              ].map((c, i) => (
                <rect
                  key={i}
                  x={c.x - handle / 2}
                  y={c.y - handle / 2}
                  width={handle}
                  height={handle}
                  fill={C.accent}
                />
              ))}
            </g>
          )}
        </g>
      </svg>

      {/* zoom / fit / snap controls */}
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
