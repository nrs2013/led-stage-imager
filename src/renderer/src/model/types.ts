export type ShapeType =
  | 'line'
  | 'polyline'
  | 'freehand'
  | 'ellipse'
  | 'rect'
  | 'triangle'
  | 'star'
  | 'polygon'
  | 'bulb'
  | 'neon'
  | 'stars'
  | 'festoon'
  | 'parlight'
  | 'blinder'
  | 'patt'
  | 'pixelpatt'
  | 'image'
  | 'uplight'
  | 'movinghead'
  | 'roomlamp'
  | 'streetlamp'
  | 'chandelier'
  | 'marquee'
/** 部品の種別：電飾(LED/装飾) か 照明(ステージ灯体)。棚のグループ分け・表示フィルタ用。 */
export type PartFamily = 'decor' | 'light'
export type DisplayMode = 'stroke' | 'fill' | 'both'
export type ChannelMode = 'rgb' | 'rgbdim' | 'dim' | 'rgbw' | 'beam6' | 'beam8'
export type BulbStyle = 'clear' | 'frost'

export interface Point {
  x: number
  y: number
}

export interface Shape {
  id: string
  type: ShapeType
  /** Which layer (song page) owns this shape; absent only mid-migration. */
  layerId?: string
  /** 種別: 電飾(decor) か 照明(light)。棚の2グループ分け・表示フィルタ用。
   *  ※種別はここ(部品の属性)に持つ。Layer(曲ページ)では絶対に分けない＝
   *  出力(OutputRenderer)は全レイヤーの全shapeを合算するので混ざる。
   *  古いshowは欠損し得るので読む側は必ず (family ?? 'decor') で参照する。 */
  family?: PartFamily
  points: Point[] // geometry in canvas pixels
  display: DisplayMode
  strokeWidth: number
  /** Repeat this shape into a parametric array (e.g. a bar every 10px). */
  repeat?: { count: number; dx: number; dy: number }
  /** Painted chains (auto-cleaned strokes / Shift+click bars): indices into `points`
   *  marking the straight-segment corners (first and last included). Corners are
   *  grabbable; dragging one regenerates the adjacent dot runs. */
  verts?: number[]
  /** Locked: invisible to canvas picking (click / rubber band) so big backdrops like
   *  a star field stop hijacking every selection. Still draws, still lights, and the
   *  patch chip below can still select it (= the unlock door). */
  locked?: boolean
  fixtureId?: string
  /** Bulb / PAR / PAT: diameter in canvas px; Blinder: housing WIDTH (height = 2×).
   *  points[0] is always the part's centre. */
  diameter?: number
  /** Bulb only: clear glass (filament visible) or frosted (milky globe). */
  bulbStyle?: BulbStyle
  /** Neon only: the sign text (one line). Each non-space character is one
   *  addressable tube; points[0] is the sign's centre. */
  text?: string
  /** Neon only: id into render/neon NEON_FONTS. */
  fontId?: string
  /** Neon only: glyph height in canvas px. */
  fontSize?: number
  /** Marquee only: per-letter base colour (hex), indexed by visible-letter order
   *  (spaces skipped). Missing/empty entry = the default dark channel. Lit bulbs
   *  always dye warm on top regardless of the base colour (のむさん 2026-06-15). */
  letterColors?: string[]
  /** Neon / Festoon: glow dial 0–100 (halo reach; のむさんの「光りすぎ防止」ツマミ). */
  neonGlow?: number
  /** 電飾のにじみ(グロー)半径 px — この図形だけの上書き。undefined=全体設定
   *  (settings.ledGlowPx) に従う・0=この図形はにじみ無し。出力(LIVE/Syphon)にのみ効く。 */
  glowPx?: number
  /** Festoon only: sag depth as % of the span between the two grabbed ends. */
  sagPct?: number
  /** Festoon only: bulb spacing in px along the wire (longer string = more bulbs). */
  bulbPitch?: number
  /** Stars only: density dial 0–100 — more = a thick sky, less = sparse and airy.
   *  points[0]/[1] are the field's corners (a rect the sky fills). */
  starDensity?: number
  /** Stars only: white share 0–100% (the rest is blue). */
  starWhiteRatio?: number
  /** Stars only: hero-dot size in canvas px (most stars render smaller). */
  starSize?: number
  /** Stars only: layout seed — locked so a saved chart reopens with the same sky. */
  starSeed?: number
  /** Image (photo material) only: the picture itself as a data URL, persisted inside
   *  the chart file like the underlay. points[0]/[1] are the placed corners. The
   *  photo never emits light — it shows only where an uplight's beam washes it. */
  imageData?: string
  /** Uplight only: beam exit width in canvas px (出口の幅). points[0] is the lamp —
   *  it may sit outside the chart. The standing pose is the desk's home position. */
  beamW0?: number
  /** Uplight only: beam tip width in canvas px (広がり). */
  beamW1?: number
  /** Uplight only: throw height in canvas px (届く高さ — a rigging value, NOT a desk
   *  channel: the desk steers Pan/Tilt/Zoom only, のむさん確定 2026-06-11). */
  beamLen?: number
}

export interface Fixture {
  id: string
  shapeId: string
  universe: number // 0..32767
  start: number // 1..512
  mode: ChannelMode
  /** Address increment per repeat (defaults to the channel width); enables 連番採番. */
  addressStep?: number
  fixedColor?: [number, number, number] // for 'dim' mode (the fixed color the dimmer scales)
}

export interface Underlay {
  dataUrl: string
  opacity: number
  visible: boolean
  /** Use the image's alpha as a drawable-area mask (transparent = drawable; invert flips). */
  mask?: { enabled: boolean; invert: boolean }
}

/** One song's page: its chart image + the shapes drawn on it. Layers exist for the
 *  EDITOR only — the live output always renders every layer's shapes (unlit = invisible),
 *  so the console "calls up" a song simply by raising that song's addresses. */
export interface Layer {
  id: string
  name: string
  underlay: Underlay | null
  /** Editor-side visibility (ghosting other songs in/out); never affects the output. */
  visible: boolean
}

export interface Chart {
  version: 2
  id: string
  name: string
  canvas: { w: number; h: number }
  layers: Layer[]
  activeLayerId: string
  shapes: Shape[]
  fixtures: Fixture[]
  syphon: { name: string }
  settings: {
    holdOnTimeout: boolean
    gamma: boolean
    glow: boolean
    glowAmount: number
    /** 電飾のにじみ(グロー)半径 px — 全図形の既定（0/未設定=なし・1px刻み）。
     *  図形側の glowPx が指定されていればそちらが勝つ。Smoke(glow/glowAmount=会場の霞)とは別物。 */
    ledGlowPx?: number
    /** Real stage width in millimetres. When set, the chart is calibrated to real
     *  scale (1px = stageWidthMm / canvas.w mm) and parts drop at true physical size
     *  via model/scale.mmToCanvasPx. Absent = uncalibrated (parts use raw px). */
    stageWidthMm?: number
  }
}
