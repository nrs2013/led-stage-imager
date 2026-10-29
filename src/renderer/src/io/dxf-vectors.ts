import DxfParser from 'dxf-parser'
import type { Point, Shape } from '../model/types'
import type { LedRect } from '../model/led-layout'

type Vertex = Point & { z?: number; bulge?: number }
interface Entity {
  type: string
  layer?: string
  visible?: boolean
  inPaperSpace?: boolean
  vertices?: Vertex[]
  shape?: boolean
  center?: Point
  radius?: number
  startAngle?: number
  endAngle?: number
  majorAxisEndPoint?: Point
  axisRatio?: number
  name?: string
  position?: Point
  rotation?: number
  xScale?: number
  yScale?: number
  rowCount?: number
  columnCount?: number
  rowSpacing?: number
  columnSpacing?: number
  extrusionDirection?: { x?: number; y?: number; z?: number }
  extrusionDirectionZ?: number
}
export interface VectorDrawing {
  paths: Point[][]
  bounds: LedRect
  unit: string
  warnings: string[]
}
const TAU = Math.PI * 2

export function parseDxfVectors(text: string): VectorDrawing {
  if (text.length > 20_000_000)
    throw new Error('DXFが大きすぎます。必要な図形だけを書き出してください。')
  if (text.startsWith('AutoCAD Binary DXF'))
    throw new Error('テキスト形式のDXFで書き出してください。')
  const doc = new DxfParser().parseSync(text)
  if (!doc) throw new Error('DXFを読み込めませんでした。')
  const paths: Point[][] = [],
    skipped = new Set<string>()
  let vertices = 0,
    visited = 0
  const emit = (points: Point[], map: (p: Point) => Point): void => {
    const transformed = points.map(map)
    if (
      transformed.length < 2 ||
      transformed.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))
    )
      return
    vertices += transformed.length
    if (vertices > 200_000 || paths.length >= 10_000)
      throw new Error('図形が多すぎます。必要な電飾だけを選んで書き出してください。')
    paths.push(transformed)
  }
  const curve = (
    center: Point,
    rx: number,
    ry: number,
    start: number,
    sweep: number,
    rotation = 0
  ): Point[] => {
    const n = Math.max(8, Math.ceil(Math.abs(sweep) / (Math.PI / 180)))
    return Array.from({ length: n + 1 }, (_, i) => {
      const a = start + (sweep * i) / n,
        x = rx * Math.cos(a),
        y = ry * Math.sin(a)
      return {
        x: center.x + x * Math.cos(rotation) - y * Math.sin(rotation),
        y: center.y + x * Math.sin(rotation) + y * Math.cos(rotation)
      }
    })
  }
  const visit = (e: Entity, map: (p: Point) => Point, parents: string[]): void => {
    if (++visited > 50_000) throw new Error('DXFの図形数が上限を超えています。')
    if (e.visible === false || e.inPaperSpace) return
    if ((e.extrusionDirectionZ ?? e.extrusionDirection?.z ?? 1) !== 1) {
      skipped.add('3D/反転座標の図形')
      return
    }
    if (e.type === 'INSERT' && e.name) {
      const block = doc.blocks?.[e.name]
      if (!block || parents.includes(e.name) || parents.length >= 12) {
        skipped.add('参照できないブロック')
        return
      }
      if ((e.rowCount ?? 1) > 1 || (e.columnCount ?? 1) > 1) {
        skipped.add('配列ブロック')
        return
      }
      const base = block.position ?? { x: 0, y: 0 },
        pos = e.position ?? { x: 0, y: 0 }
      const angle = ((e.rotation ?? 0) * Math.PI) / 180
      const transform = (p: Point): Point => {
        const x = (p.x - base.x) * (e.xScale ?? 1),
          y = (p.y - base.y) * (e.yScale ?? 1)
        return map({
          x: pos.x + x * Math.cos(angle) - y * Math.sin(angle),
          y: pos.y + x * Math.sin(angle) + y * Math.cos(angle)
        })
      }
      for (const child of block.entities ?? [])
        visit(child as Entity, transform, [...parents, e.name])
      return
    }
    if (e.type === 'LINE' || e.type === 'LWPOLYLINE' || e.type === 'POLYLINE') {
      const vs = e.vertices ?? []
      if (vs.some((p) => Math.abs(p.z ?? 0) > 1e-6)) {
        skipped.add('3D頂点')
        return
      }
      const points: Point[] = []
      const count = e.shape ? vs.length : vs.length - 1
      for (let i = 0; i < count; i++) {
        const a = vs[i],
          b = vs[(i + 1) % vs.length],
          bulge = a.bulge ?? 0
        points.push({ x: a.x, y: a.y })
        const chord = Math.hypot(b.x - a.x, b.y - a.y)
        if (Math.abs(bulge) > 1e-9 && chord > 0) {
          const sweep = 4 * Math.atan(bulge),
            offset = (chord * (1 - bulge * bulge)) / (4 * bulge)
          const center = {
            x: (a.x + b.x) / 2 - ((b.y - a.y) * offset) / chord,
            y: (a.y + b.y) / 2 + ((b.x - a.x) * offset) / chord
          }
          const radius = Math.hypot(a.x - center.x, a.y - center.y)
          points.push(
            ...curve(
              center,
              radius,
              radius,
              Math.atan2(a.y - center.y, a.x - center.x),
              sweep
            ).slice(1, -1)
          )
        }
      }
      if (vs.length)
        points.push(
          e.shape ? { x: vs[0].x, y: vs[0].y } : { x: vs[vs.length - 1].x, y: vs[vs.length - 1].y }
        )
      emit(points, map)
      return
    }
    if ((e.type === 'CIRCLE' || e.type === 'ARC') && e.center && (e.radius ?? 0) > 0) {
      const start = e.startAngle ?? 0
      const sweep = e.type === 'CIRCLE' ? TAU : ((e.endAngle ?? TAU) - start + TAU) % TAU || TAU
      emit(curve(e.center, e.radius!, e.radius!, start, sweep), map)
      return
    }
    if (e.type === 'ELLIPSE' && e.center && e.majorAxisEndPoint) {
      const major = e.majorAxisEndPoint,
        radius = Math.hypot(major.x, major.y)
      const start = e.startAngle ?? 0,
        sweep = ((e.endAngle ?? TAU) - start + TAU) % TAU || TAU
      emit(
        curve(
          e.center,
          radius,
          radius * (e.axisRatio ?? 1),
          start,
          sweep,
          Math.atan2(major.y, major.x)
        ),
        map
      )
      return
    }
    skipped.add(e.type)
  }
  for (const e of doc.entities ?? []) visit(e as Entity, (p) => p, [])
  if (!paths.length)
    throw new Error('取り込める2Dの線がありません。線・多角形・円・円弧として書き出してください。')
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity
  for (const path of paths)
    for (const p of path) {
      minX = Math.min(minX, p.x)
      minY = Math.min(minY, p.y)
      maxX = Math.max(maxX, p.x)
      maxY = Math.max(maxY, p.y)
    }
  const units: Record<number, string> = { 1: 'inch', 2: 'ft', 4: 'mm', 5: 'cm', 6: 'm' }
  return {
    paths: paths.map((path) => path.map((p) => ({ x: p.x - minX, y: maxY - p.y }))),
    bounds: { x: 0, y: 0, w: maxX - minX, h: maxY - minY },
    unit: units[Number(doc.header?.$INSUNITS)] ?? '図面単位',
    warnings: [...skipped].map((type) => `${type}は未対応のため省略`)
  }
}

/** Centre a selected motif while preserving aspect, relative spacing and CAD precision. */
export function placeVectors(
  drawing: VectorDrawing,
  target: LedRect,
  fraction = 0.8
): Omit<Shape, 'id' | 'layerId'>[] {
  const { w, h } = drawing.bounds
  const scale =
    Math.min(w > 0 ? target.w / w : Infinity, h > 0 ? target.h / h : Infinity) * fraction
  if (!Number.isFinite(scale) || scale <= 0) throw new Error('図形の寸法が不正です。')
  const ox = target.x + (target.w - w * scale) / 2,
    oy = target.y + (target.h - h * scale) / 2
  return drawing.paths.map((points) => ({
    type: points.length === 2 ? 'line' : 'polyline',
    points: points.map((p) => ({ x: ox + p.x * scale, y: oy + p.y * scale })),
    display: 'stroke',
    strokeWidth: 1,
    family: 'decor'
  }))
}
