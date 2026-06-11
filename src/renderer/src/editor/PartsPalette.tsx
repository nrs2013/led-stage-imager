import { useEffect, useRef } from 'react'
import { C, F } from '../ui/tokens'
import { drawBulbGlass, drawBulbLit, BULB_DEFAULT_DIAMETER, type RGB } from '../render/bulb'
import { drawNeonGlyphLit, clearNeonLayoutCache } from '../render/neon'
import { drawStarsLit } from '../render/stars'
import { drawFestoonBulbLit, festoonSamples, festoonCount } from '../render/festoon'
import { drawParLit, drawBlinderCellLit, drawPattLit } from '../render/fixtures'
import type { Shape } from '../model/types'

/** Live-rendered thumbnail: the actual bulb renderer at a thumbnail-friendly size,
 *  lit warm — what you drag is what you get. */
function BulbThumb({ size = 46 }: { size?: number }): React.JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const ctx = cv.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, size, size)
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, size, size)
    const d = size * 0.62
    drawBulbGlass(ctx, size / 2, size / 2, d, 'clear')
    drawBulbLit(ctx, size / 2, size / 2, d, [255, 160, 60], 'clear')
  }, [size])
  return (
    <canvas
      ref={ref}
      width={size}
      height={size}
      style={{ display: 'block', borderRadius: 4, pointerEvents: 'none' }}
    />
  )
}

/** Live-rendered thumbnail: the real neon renderer — front half pink, back half
 *  ice blue, demonstrating 1文字=1番地 right on the shelf. */
function NeonThumb({ w = 74, h = 46 }: { w?: number; h?: number }): React.JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const draw = (): void => {
      const ctx = cv.getContext('2d')
      if (!ctx) return
      ctx.clearRect(0, 0, w, h)
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, w, h)
      const shape = {
        id: 'neon-thumb',
        type: 'neon',
        points: [{ x: w / 2, y: h / 2 }],
        display: 'fill',
        strokeWidth: 1,
        text: 'Neon',
        fontId: 'neonderthaw',
        fontSize: 30,
        neonGlow: 55
      } as Shape
      const cols: RGB[] = [
        [255, 90, 205],
        [255, 90, 205],
        [110, 195, 255],
        [110, 195, 255]
      ]
      for (let i = 0; i < cols.length; i++) drawNeonGlyphLit(ctx, shape, cols[i], i)
    }
    draw()
    const onFonts = (): void => {
      clearNeonLayoutCache()
      draw()
    }
    document.fonts?.addEventListener('loadingdone', onFonts)
    return () => document.fonts?.removeEventListener('loadingdone', onFonts)
  }, [w, h])
  return (
    <canvas
      ref={ref}
      width={w}
      height={h}
      style={{ display: 'block', borderRadius: 4, pointerEvents: 'none' }}
    />
  )
}

/** Live-rendered thumbnail: the real star-field renderer — the white sky and the
 *  blue sky both at full, exactly what the two desk faders bring up. */
function StarsThumb({ w = 74, h = 46 }: { w?: number; h?: number }): React.JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const ctx = cv.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, w, h)
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, w, h)
    const shape = {
      id: 'stars-thumb',
      type: 'stars',
      points: [
        { x: 3, y: 3 },
        { x: w - 3, y: h - 3 }
      ],
      display: 'fill',
      strokeWidth: 1,
      starDensity: 85,
      starWhiteRatio: 55,
      starSize: 2.4,
      starSeed: 7
    } as Shape
    drawStarsLit(ctx, shape, [235, 235, 235], 0)
    drawStarsLit(ctx, shape, [255, 255, 255], 1)
  }, [w, h])
  return (
    <canvas
      ref={ref}
      width={w}
      height={h}
      style={{ display: 'block', borderRadius: 4, pointerEvents: 'none' }}
    />
  )
}

/** Live-rendered thumbnail: a warm sagging string — the real festoon renderer. */
function FestoonThumb({ w = 74, h = 46 }: { w?: number; h?: number }): React.JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const ctx = cv.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, w, h)
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, w, h)
    const shape = {
      id: 'festoon-thumb',
      type: 'festoon',
      points: [
        { x: 6, y: 9 },
        { x: w - 6, y: 12 }
      ],
      display: 'fill',
      strokeWidth: 1,
      sagPct: 30,
      bulbPitch: 13,
      diameter: 5,
      neonGlow: 55
    } as Shape
    const pts = festoonSamples(shape, 48)
    ctx.strokeStyle = 'rgba(140,120,90,0.5)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(pts[0].x, pts[0].y)
    for (const p of pts) ctx.lineTo(p.x, p.y)
    ctx.stroke()
    const n = festoonCount(shape)
    for (let i = 0; i < n; i++) drawFestoonBulbLit(ctx, shape, [255, 170, 80], i)
  }, [w, h])
  return (
    <canvas
      ref={ref}
      width={w}
      height={h}
      style={{ display: 'block', borderRadius: 4, pointerEvents: 'none' }}
    />
  )
}

/** Generic live thumbnail: black stage + whatever the real renderer paints. */
function FixtureThumb({
  paint,
  w = 74,
  h = 46
}: {
  paint: (ctx: CanvasRenderingContext2D) => void
  w?: number
  h?: number
}): React.JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const ctx = cv.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, w, h)
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, w, h)
    paint(ctx)
  }, [w, h, paint])
  return (
    <canvas
      ref={ref}
      width={w}
      height={h}
      style={{ display: 'block', borderRadius: 4, pointerEvents: 'none' }}
    />
  )
}

const WARM: [number, number, number] = [255, 178, 96]
const paintPar = (ctx: CanvasRenderingContext2D): void => drawParLit(ctx, 37, 23, 36, WARM)
const paintBlinder = (ctx: CanvasRenderingContext2D): void => {
  const sh = {
    id: 'th-bl',
    type: 'blinder',
    points: [{ x: 37, y: 23 }],
    display: 'fill',
    strokeWidth: 1,
    diameter: 20
  } as Shape
  for (let i = 0; i < 8; i++) drawBlinderCellLit(ctx, sh, WARM, i)
}
const paintPatt = (ctx: CanvasRenderingContext2D): void => drawPattLit(ctx, 37, 23, 42, WARM)

/** アイコン棚 — drag a part onto the chart to place it (part centre = the dropped
 *  cell). Residents: bulb, neon, stars, festoon, PAR, blinder, PAT. */
export function PartsPalette(): React.JSX.Element {
  return (
    <div style={wrapStyle}>
      <div style={titleStyle}>Parts</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <div
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData('application/x-decor-part', 'bulb')
            e.dataTransfer.effectAllowed = 'copy'
          }}
          title="ドラッグしてチャートに置く（中心がそのマスに乗る）"
          style={cardStyle}
        >
          <BulbThumb />
          <div style={{ fontSize: 11, color: C.text, fontFamily: F.ui, marginTop: 5 }}>ボール球</div>
          <div style={{ fontSize: 9, color: C.hint, fontFamily: F.mono }}>
            Φ{BULB_DEFAULT_DIAMETER}
          </div>
        </div>
        <div
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData('application/x-decor-part', 'neon')
            e.dataTransfer.effectAllowed = 'copy'
          }}
          title="ドラッグしてチャートに置き、Inspectorで文字を打つ（1文字=1番地）"
          style={cardStyle}
        >
          <NeonThumb />
          <div style={{ fontSize: 11, color: C.text, fontFamily: F.ui, marginTop: 5 }}>ネオン管</div>
          <div style={{ fontSize: 9, color: C.hint, fontFamily: F.mono }}>TEXT</div>
        </div>
        <div
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData('application/x-decor-part', 'stars')
            e.dataTransfer.effectAllowed = 'copy'
          }}
          title="ドラッグして置き、四隅で広げる（白ch+青chの2番地・密度はInspector）"
          style={cardStyle}
        >
          <StarsThumb />
          <div style={{ fontSize: 11, color: C.text, fontFamily: F.ui, marginTop: 5 }}>星球</div>
          <div style={{ fontSize: 9, color: C.hint, fontFamily: F.mono }}>W+B 2ch</div>
        </div>
        <div
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData('application/x-decor-part', 'festoon')
            e.dataTransfer.effectAllowed = 'copy'
          }}
          title="ドラッグして張り、両端をつかんで掛け直す（1球=1番地・たわみはInspector）"
          style={cardStyle}
        >
          <FestoonThumb />
          <div style={{ fontSize: 11, color: C.text, fontFamily: F.ui, marginTop: 5 }}>垂れ電球</div>
          <div style={{ fontSize: 9, color: C.hint, fontFamily: F.mono }}>STRING</div>
        </div>
        <div
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData('application/x-decor-part', 'parlight')
            e.dataTransfer.effectAllowed = 'copy'
          }}
          title="大型ステージ照明（正面）— フレネルの輪・フルで全体が白く飛ぶ"
          style={cardStyle}
        >
          <FixtureThumb paint={paintPar} />
          <div style={{ fontSize: 11, color: C.text, fontFamily: F.ui, marginTop: 5 }}>PAR</div>
          <div style={{ fontSize: 9, color: C.hint, fontFamily: F.mono }}>FRONT</div>
        </div>
        <div
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData('application/x-decor-part', 'blinder')
            e.dataTransfer.effectAllowed = 'copy'
          }}
          title="8連ブラインダー — 既定は8球一斉（番地間隔3で8球バラバラ）"
          style={cardStyle}
        >
          <FixtureThumb paint={paintBlinder} />
          <div style={{ fontSize: 11, color: C.text, fontFamily: F.ui, marginTop: 5 }}>ブラインダー</div>
          <div style={{ fontSize: 9, color: C.hint, fontFamily: F.mono }}>2×4</div>
        </div>
        <div
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData('application/x-decor-part', 'patt')
            e.dataTransfer.effectAllowed = 'copy'
          }}
          title="PAT — 金網メッシュ越しにジュワッと面で光る大物"
          style={cardStyle}
        >
          <FixtureThumb paint={paintPatt} />
          <div style={{ fontSize: 11, color: C.text, fontFamily: F.ui, marginTop: 5 }}>PAT</div>
          <div style={{ fontSize: 9, color: C.hint, fontFamily: F.mono }}>MESH</div>
        </div>
      </div>
      <div style={{ fontSize: 10, color: C.faint, fontFamily: F.ui, marginTop: 8, lineHeight: 1.5 }}>
        ドラッグ＆ドロップで設置 · 2個目からは ⌘C → クリック → ⌘V
      </div>
    </div>
  )
}

const wrapStyle: React.CSSProperties = {
  padding: '12px 16px 14px',
  borderBottom: `0.5px solid ${C.border}`,
  flexShrink: 0
}

const titleStyle: React.CSSProperties = {
  fontFamily: F.display,
  fontSize: 15,
  letterSpacing: '0.1em',
  color: C.white,
  marginBottom: 8,
  textTransform: 'uppercase'
}

const cardStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  padding: '8px 10px 7px',
  background: '#242220',
  border: `1px solid #3b3631`,
  borderRadius: 5,
  cursor: 'grab',
  userSelect: 'none',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05)'
}
