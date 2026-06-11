import { useEffect, useRef } from 'react'
import { C, F } from '../ui/tokens'
import { drawBulbGlass, drawBulbLit, BULB_DEFAULT_DIAMETER, type RGB } from '../render/bulb'
import { drawNeonGlyphLit, clearNeonLayoutCache } from '../render/neon'
import { drawStarsLit } from '../render/stars'
import { drawFestoonBulbLit, drawFestoonWireLit, festoonCount } from '../render/festoon'
import {
  drawParLit,
  drawBlinderCellLit,
  drawPattLit,
  drawPixelPattCellLit,
  drawPixelPattFrame,
  drawBlinderHousing
} from '../render/fixtures'
import { drawWallBeamInto } from '../render/uplight'
import type { Shape } from '../model/types'

/** Live-rendered thumbnail: the actual bulb renderer at a thumbnail-friendly size,
 *  lit warm — what you drag is what you get. */
function BulbThumb({ w = 74, h = 46 }: { w?: number; h?: number }): React.JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const ctx = cv.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, w, h)
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, w, h)
    const d = h * 0.62
    drawBulbGlass(ctx, w / 2, h / 2, d, 'clear')
    drawBulbLit(ctx, w / 2, h / 2, d, [255, 160, 60], 'clear')
  }, [w, h])
  return (
    <canvas
      ref={ref}
      width={w}
      height={h}
      style={{ display: 'block', width: '100%', height: 'auto', borderRadius: 4, pointerEvents: 'none' }}
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
      style={{ display: 'block', width: '100%', height: 'auto', borderRadius: 4, pointerEvents: 'none' }}
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
      style={{ display: 'block', width: '100%', height: 'auto', borderRadius: 4, pointerEvents: 'none' }}
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
    const n = festoonCount(shape)
    const rgbs = new Array(n).fill([255, 170, 80] as [number, number, number])
    drawFestoonWireLit(ctx, shape, rgbs)
    for (let i = 0; i < n; i++) drawFestoonBulbLit(ctx, shape, [255, 170, 80], i)
  }, [w, h])
  return (
    <canvas
      ref={ref}
      width={w}
      height={h}
      style={{ display: 'block', width: '100%', height: 'auto', borderRadius: 4, pointerEvents: 'none' }}
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
      style={{ display: 'block', width: '100%', height: 'auto', borderRadius: 4, pointerEvents: 'none' }}
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
  drawBlinderHousing(ctx, sh, new Array(8).fill(WARM))
  for (let i = 0; i < 8; i++) drawBlinderCellLit(ctx, sh, WARM, i)
}
const paintPatt = (ctx: CanvasRenderingContext2D): void => drawPattLit(ctx, 37, 23, 42, WARM)
const paintPixelPatt = (ctx: CanvasRenderingContext2D): void => {
  const sh = {
    id: 'th-pp',
    type: 'pixelpatt',
    points: [{ x: 37, y: 23 }],
    display: 'fill',
    strokeWidth: 1,
    diameter: 42
  } as Shape
  drawPixelPattFrame(ctx, sh, new Array(7).fill(WARM))
  for (let i = 0; i < 7; i++) drawPixelPattCellLit(ctx, sh, WARM, i)
}
const paintUplight = (ctx: CanvasRenderingContext2D): void => {
  drawWallBeamInto(
    ctx,
    {
      id: 'th-up',
      type: 'uplight',
      points: [{ x: 37, y: 44 }],
      display: 'fill',
      strokeWidth: 1,
      beamW0: 8,
      beamW1: 50,
      beamLen: 42
    } as Shape,
    WARM,
    0.8,
    { pan: 0, tilt: 0, zoom: 0 }
  )
}
const paintImage = (ctx: CanvasRenderingContext2D): void => {
  // 額縁＋下から照らされた写真の面影（素材カードの絵）
  ctx.save()
  ctx.strokeStyle = 'rgba(170,176,188,0.8)'
  ctx.setLineDash([3, 3])
  ctx.lineWidth = 1
  ctx.strokeRect(14, 7, 46, 32)
  ctx.setLineDash([])
  const g = ctx.createLinearGradient(0, 39, 0, 10)
  g.addColorStop(0, 'rgba(255,178,96,0.85)')
  g.addColorStop(1, 'rgba(255,178,96,0)')
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.moveTo(17, 36)
  ctx.lineTo(31, 14)
  ctx.lineTo(40, 26)
  ctx.lineTo(47, 18)
  ctx.lineTo(57, 36)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

/** The shelf line-up — のむさん指定の並び：上段=電球系の灯体、下段=ストリング/文字/面。 */
const CARDS: {
  part: string
  label: string
  hint: string
  title: string
  thumb: React.ReactNode
}[] = [
  {
    part: 'bulb',
    label: 'ボール球',
    hint: `Φ${BULB_DEFAULT_DIAMETER}`,
    title: 'ドラッグしてチャートに置く（中心がそのマスに乗る）',
    thumb: <BulbThumb />
  },
  {
    part: 'parlight',
    label: 'PAR',
    hint: 'FRONT',
    title: '大型ステージ照明（正面）— フレネルの輪・フルで全体が白く飛ぶ',
    thumb: <FixtureThumb paint={paintPar} />
  },
  {
    part: 'patt',
    label: 'PAT',
    hint: 'MESH',
    title: 'PAT — 金網メッシュ越しにジュワッと面で光る大物',
    thumb: <FixtureThumb paint={paintPatt} />
  },
  {
    part: 'pixelpatt',
    label: 'Pixel PAT',
    hint: '7CELL',
    title: 'Pixel PAT — ミニPAT 7個の六角ユニット。1セル=1番地（中央→上から時計回り）・間隔0で一斉',
    thumb: <FixtureThumb paint={paintPixelPatt} />
  },
  {
    part: 'blinder',
    label: '8灯ミニブル',
    hint: '2×4',
    title: '8灯ミニブル — 既定は8球一斉（番地間隔3で8球バラバラ）',
    thumb: <FixtureThumb paint={paintBlinder} />
  },
  {
    part: 'festoon',
    label: '垂れ電球',
    hint: 'STRING',
    title: 'ドラッグして張り、両端をつかんで掛け直す（1球=1番地・たわみはInspector）',
    thumb: <FestoonThumb />
  },
  {
    part: 'neon',
    label: 'ネオン管',
    hint: 'TEXT',
    title: 'ドラッグしてチャートに置き、Inspectorで文字を打つ（1文字=1番地）',
    thumb: <NeonThumb />
  },
  {
    part: 'stars',
    label: '星球',
    hint: 'W+B 2ch',
    title: 'ドラッグして置き、四隅で広げる（白ch+青chの2番地・密度はInspector）',
    thumb: <StarsThumb />
  },
  {
    part: 'image',
    label: '写真素材',
    hint: 'ALBEDO',
    title: '写真（実物の電飾やセット）を置く — 自分では光らず、「照らし」が当たった所だけ浮かぶ。写真はInspectorで選ぶ',
    thumb: <FixtureThumb paint={paintImage} />
  },
  {
    part: 'uplight',
    label: '照らし',
    hint: 'BEAM',
    title: 'アッパーライト — 1灯ずつ置いて、出口の幅・広がり・届く高さをInspectorで決める。チャートの外にも置ける。Beam 6chモードで卓からPan/Tilt/Zoom',
    thumb: <FixtureThumb paint={paintUplight} />
  }
]

/** アイコン棚 — drag a part onto the chart to place it (part centre = the dropped
 *  cell). 4-up grid so every card stays readable as the family grows. */
export function PartsPalette(): React.JSX.Element {
  return (
    <div style={wrapStyle}>
      <div style={titleStyle}>Parts</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
        {CARDS.map((c) => (
          <div
            key={c.part}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData('application/x-decor-part', c.part)
              e.dataTransfer.effectAllowed = 'copy'
            }}
            title={c.title}
            style={cardStyle}
          >
            {c.thumb}
            <div
              style={{
                fontSize: 10,
                color: C.text,
                fontFamily: F.ui,
                marginTop: 4,
                whiteSpace: 'nowrap'
              }}
            >
              {c.label}
            </div>
            <div style={{ fontSize: 8.5, color: C.hint, fontFamily: F.mono }}>{c.hint}</div>
          </div>
        ))}
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
