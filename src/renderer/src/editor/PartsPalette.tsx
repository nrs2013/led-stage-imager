import { useEffect, useRef, useState } from 'react'
import { C, F } from '../ui/tokens'
import { useStore } from '../state/store'
import { PART_ICON } from '../render/part-icons'
import { familyOfType } from '../model/part-family'
import type { ShapeType } from '../model/types'
import { drawBulbGlass, drawBulbLit, BULB_DEFAULT_DIAMETER, type RGB } from '../render/bulb'
import { drawNeonGlyphLit, clearNeonLayoutCache } from '../render/neon'
import { drawMarqueeGlyphLit, clearMarqueeCache, marqueeCharCount } from '../render/marquee'
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
import { drawRoomLampLit } from '../render/roomlamp'
import { drawStreetLampLit } from '../render/streetlamp'
import { drawChandelierLit } from '../render/chandelier'
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

/** Live-rendered thumbnail: the real marquee renderer — letters filled with warm bulbs. */
function MarqueeThumb({ w = 74, h = 46 }: { w?: number; h?: number }): React.JSX.Element {
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
        id: 'marquee-thumb',
        type: 'marquee',
        points: [{ x: w / 2, y: h / 2 }],
        display: 'fill',
        strokeWidth: 1,
        text: 'LED',
        fontSize: 32,
        bulbPitch: 5
      } as Shape
      const n = marqueeCharCount('LED')
      for (let i = 0; i < n; i++) drawMarqueeGlyphLit(ctx, shape, [255, 180, 100], i)
    }
    draw()
    const onFonts = (): void => {
      clearMarqueeCache()
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

const paintRoomLamp = (ctx: CanvasRenderingContext2D): void => drawRoomLampLit(ctx, 37, 13, 38, WARM)
const paintStreetLamp = (ctx: CanvasRenderingContext2D): void =>
  drawStreetLampLit(ctx, 37, 6, 11, WARM)
const paintChandelier = (ctx: CanvasRenderingContext2D): void =>
  drawChandelierLit(ctx, 37, 24, 46, WARM)

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
    label: '電球',
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
    label: '8-Lamp Blinder',
    hint: '2×4',
    title: '8灯ミニブル — 既定は8球一斉（番地間隔3で8球バラバラ）',
    thumb: <FixtureThumb paint={paintBlinder} />
  },
  {
    part: 'festoon',
    label: 'フェストゥーン',
    hint: 'ひも状',
    title: 'ドラッグして張り、両端をつかんで掛け直す（1球=1番地・たわみはInspector）',
    thumb: <FestoonThumb />
  },
  {
    part: 'neon',
    label: 'ネオン',
    hint: '1文字=1番地',
    title: 'ドラッグしてチャートに置き、Inspectorで文字を打つ（1文字=1番地）',
    thumb: <NeonThumb />
  },
  {
    part: 'marquee',
    label: 'マーキー',
    hint: '電球で文字',
    title: 'マーキーライト — 電球で文字を描く劇場サイン。Inspectorで文字を打つ（1文字=1番地・文字ごとにチェイス・電球間隔も調整可）',
    thumb: <MarqueeThumb />
  },
  {
    part: 'stars',
    label: '星',
    hint: '白+青 2番地',
    title: 'ドラッグして置き、四隅で広げる（白ch+青chの2番地・密度はInspector）',
    thumb: <StarsThumb />
  },
  {
    part: 'image',
    label: '写真',
    hint: '光らない',
    title: '写真（実物の電飾やセット）を置く — 自分では光らず、「スポット」が当たった所だけ浮かぶ。写真はInspectorで選ぶ',
    thumb: <FixtureThumb paint={paintImage} />
  },
  {
    part: 'uplight',
    label: 'Spot',
    hint: 'SPOT',
    title: 'スポット — 1灯ずつ置いて、出口の幅・広がり・届く高さをInspectorで決める。チャートの外にも置ける。Beam 6chモードで卓からPan/Tilt/Zoom',
    thumb: <FixtureThumb paint={paintUplight} />
  },
  {
    part: 'movinghead',
    label: 'Moving',
    hint: '8CH',
    title: 'ムービング（汎用照明灯体）— 卓のDMXで Pan/Tilt/Dimmer/Shutter/RGB/Zoom（8ch）を受けて向き・明るさ・色・点滅・広がりが動く。出口/広がり/届く高さはInspector。スポットと同じビーム見た目。',
    thumb: <FixtureThumb paint={paintUplight} />
  },
  {
    part: 'roomlamp',
    label: '室内ランプ',
    hint: '1番地',
    title: '室内ランプ — シェードが暖色に灯り、下へ光がこぼれる。電飾屋が用意できないセットの灯り（卓RGBで色・明るさ・単一番地）',
    thumb: <FixtureThumb paint={paintRoomLamp} />
  },
  {
    part: 'streetlamp',
    label: '街灯',
    hint: '1番地',
    title: '街灯 — 灯具から下へ光のコーン・地面に光の輪。夜景・寒色にも（卓RGBで色・明るさ・単一番地）',
    thumb: <FixtureThumb paint={paintStreetLamp} />
  },
  {
    part: 'chandelier',
    label: 'シャンデリア',
    hint: '1番地',
    title: 'シャンデリア — 複数のロウソク球が暖色に灯る豪華アイテム。まず全体を1番地で一斉点灯（卓RGBで色・明るさ）',
    thumb: <FixtureThumb paint={paintChandelier} />
  }
]

/** 置き続け中のボタン表示に使う部品名（CARDS の label をそのまま引く）。 */
const PART_LABEL: Record<string, string> = Object.fromEntries(CARDS.map((c) => [c.part, c.label]))

/** Parts＝別窓。右の列には PARTS ボタンだけを置き、棚は窓として開く（のむさん 2026-07-25
 *  「棚が場所を取って番地を見るスペースが小さい」）。窓は背景を塞がない＝開いたまま
 *  キャンバスへドラッグして置ける。 */
export function PartsPalette(): React.JSX.Element {
  // 電飾モード＝電飾(decor)パーツのみ。照明灯体(Spot/Moving/PAR等)は照明モードへ。照明/電飾フィルタは廃止。
  const placingPart = useStore((s) => s.placingPart)
  const setPlacingPart = useStore((s) => s.setPlacingPart)
  const setTool = useStore((s) => s.setTool)
  const [open, setOpen] = useState(false)

  // Esc で窓を閉じる（SettingsDialog / HelpPanel と同じ作法）
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.code === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const card = (c: (typeof CARDS)[number]): React.JSX.Element => (
    <div
      key={c.part}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-decor-part', c.part)
        e.dataTransfer.effectAllowed = 'copy'
      }}
      onClick={() => {
        // クリック＝連続配置モード（キャンバスをクリック連打で置き続ける・Escかもう一度クリックで終了）
        if (placingPart === c.part) {
          setPlacingPart(null)
        } else {
          setPlacingPart(c.part)
          setTool('select')
          // 窓は閉じない＝別の種類へ続けて持ち替えられる／選択中のカードが目印として残る
          // （閉じると「置き続けモード」の手がかりがカーソルの形だけになり、置きすぎ事故になる）
        }
      }}
      title={`${c.title}\nクリック→キャンバスを連打で置き続け（Esc で終了）／ドラッグでも置けます`}
      style={
        placingPart === c.part
          ? { ...cardStyle, border: `1px solid ${C.amber}`, boxShadow: `inset 0 0 0 0.5px ${C.amber}` }
          : cardStyle
      }
    >
      <svg
        viewBox="0 0 24 24"
        style={partIconStyle}
        dangerouslySetInnerHTML={{ __html: PART_ICON[c.part] }}
      />
      <div
        style={{
          fontSize: 10,
          color: C.text,
          fontFamily: F.ui,
          marginTop: 4,
          width: '100%',
          textAlign: 'center',
          lineHeight: 1.15,
          // 英語名は日本語より長い → 2行まで折り返し、全カード同じ高さで揃える（崩れ防止）
          minHeight: 23,
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          overflowWrap: 'break-word'
        }}
        title={c.label}
      >
        {c.label}
      </div>
      <div style={{ fontSize: 8.5, color: C.hint, fontFamily: F.mono }}>{c.hint}</div>
    </div>
  )

  // 電飾モードは電飾(decor)パーツだけを並べる（照明灯体は照明モードへ）。
  const cards = CARDS.filter((c) => familyOfType(c.part as ShapeType) === 'decor')

  return (
    <div style={wrapStyle}>
      <button
        style={
          placingPart
            ? { ...openBtnStyle, border: `0.5px solid ${C.amber}`, color: C.amber }
            : open
              ? { ...openBtnStyle, border: `0.5px solid ${C.accent}`, color: C.white }
              : openBtnStyle
        }
        onClick={() => (placingPart ? setPlacingPart(null) : setOpen((v) => !v))}
        title={
          placingPart
            ? '置き続けモード中。押すとやめます（Esc でも同じ）'
            : '電飾の部品棚を開く（Esc で閉じる）。開いたままキャンバスへドラッグして置けます'
        }
      >
        {placingPart ? `置き続け中: ${PART_LABEL[placingPart] ?? placingPart} — やめる` : '部品棚'}
      </button>

      {open && (
        <div style={winStyle}>
          <div style={winHeadStyle}>
            <div style={titleStyle}>部品棚</div>
            <button style={closeBtnStyle} onClick={() => setOpen(false)} title="閉じる（Esc）">
              閉じる
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 6 }}>
            {cards.map(card)}
          </div>
          <div style={{ fontSize: 10, color: C.faint, fontFamily: F.ui, marginTop: 10, lineHeight: 1.5 }}>
            カードをクリック → キャンバスをクリックした所に置き続けます（Esc でやめる） ·
            ドラッグ＆ドロップでも置けます（中心がドロップ地点に乗ります） ·
            この窓は開いたままにできます
          </div>
        </div>
      )}
    </div>
  )
}

const wrapStyle: React.CSSProperties = {
  padding: '10px 16px 12px',
  borderBottom: `0.5px solid ${C.border}`,
  flexShrink: 0
}

/** 右の列に残す唯一のボタン。当たり判定は大きめ（線と文字は細いまま）。 */
const openBtnStyle: React.CSSProperties = {
  width: '100%',
  padding: '11px 0',
  background: 'rgba(255,255,255,0.04)',
  border: `0.5px solid ${C.border}`,
  borderRadius: 4,
  color: C.text,
  fontFamily: F.ui,
  fontSize: 13,
  fontWeight: 300,
  letterSpacing: '0.24em',
  cursor: 'pointer'
}

/** 部品棚の窓。背景を塞がない＝開いたままキャンバスへドラッグできる。 */
const winStyle: React.CSSProperties = {
  position: 'fixed',
  top: 100,
  right: 352,
  width: 430,
  maxHeight: 'calc(100vh - 180px)',
  overflowY: 'auto',
  padding: '12px 16px 14px',
  background: C.panel,
  border: `0.5px solid ${C.border}`,
  borderRadius: 6,
  boxShadow: '0 12px 40px rgba(0,0,0,0.55)',
  zIndex: 90
}

const winHeadStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: 8
}

const closeBtnStyle: React.CSSProperties = {
  padding: '7px 12px',
  background: 'rgba(255,255,255,0.04)',
  border: `0.5px solid ${C.border}`,
  borderRadius: 4,
  color: C.label,
  fontFamily: F.ui,
  fontSize: 11,
  letterSpacing: '0.16em',
  cursor: 'pointer'
}

const titleStyle: React.CSSProperties = {
  fontFamily: F.ui,
  fontSize: 13,
  fontWeight: 300,
  letterSpacing: '0.24em',
  color: C.label,
  marginBottom: 8,
  textTransform: 'uppercase'
}

// 電飾モードのParts＝共有の線アイコン（render/part-icons.ts）を cyan アクセントで描く。
const partIconStyle = {
  width: 30,
  height: 30,
  display: 'block',
  margin: '4px auto 2px',
  color: C.label,
  '--icon-accent': C.accent
} as unknown as React.CSSProperties

const cardStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  padding: '8px 5px 7px',
  background: '#242220',
  border: `1px solid #3b3631`,
  borderRadius: 5,
  cursor: 'grab',
  userSelect: 'none',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05)'
}

