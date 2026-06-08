export type ShapeType =
  | 'line'
  | 'polyline'
  | 'freehand'
  | 'ellipse'
  | 'rect'
  | 'triangle'
  | 'star'
  | 'polygon'
export type DisplayMode = 'stroke' | 'fill' | 'both'
export type ChannelMode = 'rgb' | 'rgbdim' | 'dim' | 'rgbw'

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
  glowRadius: number // px
  glowIntensity: number // 0..1
  fixedColor?: [number, number, number] // for 'dim' mode
  fixtureId?: string
}

export interface Fixture {
  id: string
  shapeId: string
  universe: number // 0..32767
  start: number // 1..512
  mode: ChannelMode
}

export interface Chart {
  version: 1
  id: string
  name: string
  canvas: { w: number; h: number }
  underlay: { dataUrl: string; opacity: number; visible: boolean } | null
  shapes: Shape[]
  fixtures: Fixture[]
  syphon: { name: string }
  settings: { holdOnTimeout: boolean; gamma: boolean }
}
