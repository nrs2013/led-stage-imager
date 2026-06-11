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
export type DisplayMode = 'stroke' | 'fill' | 'both'
export type ChannelMode = 'rgb' | 'rgbdim' | 'dim' | 'rgbw'
export type BulbStyle = 'clear' | 'frost'

export interface Point {
  x: number
  y: number
}

export interface Shape {
  id: string
  type: ShapeType
  points: Point[] // geometry in canvas pixels
  display: DisplayMode
  strokeWidth: number
  /** Repeat this shape into a parametric array (e.g. a bar every 10px). */
  repeat?: { count: number; dx: number; dy: number }
  /** Painted chains (auto-cleaned strokes / Shift+click bars): indices into `points`
   *  marking the straight-segment corners (first and last included). Corners are
   *  grabbable; dragging one regenerates the adjacent dot runs. */
  verts?: number[]
  fixtureId?: string
  /** Bulb only: glass diameter in canvas px (points[0] is the centre). */
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
  /** Neon only: glow reach 0–100 (halo around the tubes; のむさんの「光りすぎ防止」ツマミ). */
  neonGlow?: number
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

export interface Chart {
  version: 1
  id: string
  name: string
  canvas: { w: number; h: number }
  underlay: {
    dataUrl: string
    opacity: number
    visible: boolean
    /** Use the image's alpha as a drawable-area mask (transparent = drawable; invert flips). */
    mask?: { enabled: boolean; invert: boolean }
  } | null
  shapes: Shape[]
  fixtures: Fixture[]
  syphon: { name: string }
  settings: { holdOnTimeout: boolean; gamma: boolean; glow: boolean; glowAmount: number }
}
