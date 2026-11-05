import { describe, expect, it } from 'vitest'
import { appendLedBoxOutlines, type LedBoxOutline, type OutlinePatch } from './led-box-outlines'
import { createChart } from './chart-model'
import { parseChart, serializeChart } from '../io/chart-file'
import { fixtureColor } from '../dmx/channel-math'

const binding = (u: number, edge: number): OutlinePatch => ({
  key: `group-${u}-edge-${edge}`, universe: u, start: 1 + (edge - 1) * 18, count: 6
})
function box(id: string, universe: number, x = 0, flat = false): LedBoxOutline {
  const patch: Record<string, OutlinePatch> = {
    'bottom:0': binding(universe, 1), 'bottom:1': binding(universe, 2),
    'top:0': binding(universe, 5), 'top:1': binding(universe, 6),
    'vertical:0': binding(universe, 9), 'vertical:1': binding(universe, flat ? 11 : 10)
  }
  if (!flat) patch['vertical:2'] = binding(universe, 11)
  return { id, rect: { x, y: 10, w: 300, h: 200 }, folds: flat ? [] : [1 / 3], splits: flat ? [0.5] : [], patch }
}
const base = () => createChart({ w: 800, h: 600 })

describe('LED envelope boxes', () => {
  it('draws only the real perimeter and one L-fold vertical, never a tilted motif', () => {
    const result = appendLedBoxOutlines(base(), [box('left', 100), box('right', 101, 400)])
    expect(result.shapes).toHaveLength(84)
    for (const shape of result.shapes) {
      const [a, b] = shape.points
      expect(a.x === b.x || a.y === b.y).toBe(true)
      expect(shape.strokeWidth).toBe(2)
      expect(shape.glowPx).toBe(0)
      expect(shape.points.every((p) => p.y >= 11 && p.y <= 209)).toBe(true)
    }
    const left = result.shapes.slice(0, 42)
    expect([...new Set(left.filter((s) => s.points[0].x === s.points[1].x).map((s) => s.points[0].x))]).toEqual([1, 100, 299])
    expect(Math.min(...left.flatMap((s) => s.points.map((p) => p.y)))).toBe(11)
    expect(Math.max(...left.flatMap((s) => s.points.map((p) => p.y)))).toBe(209)
  })

  it('does not invent a center vertical on a flat LED face, even when DMX is divided', () => {
    const result = appendLedBoxOutlines(base(), [box('flat', 100, 0, true), box('other', 101, 400)])
    const lines = result.shapes.filter((s) => s.id.startsWith('outline:flat:'))
    expect(lines).toHaveLength(36)
    expect([...new Set(lines.filter((s) => s.points[0].x === s.points[1].x).map((s) => s.points[0].x))]).toEqual([1, 299])
  })

  it('keeps the visible-edge source slots and bottom-to-top vertical chase', () => {
    const result = appendLedBoxOutlines(base(), [box('left', 100), box('right', 101, 400)])
    const addresses = result.fixtures.filter((f) => f.universe === 100).map((f) => f.start).sort((a,b) => a-b)
    expect(addresses).toEqual([1,2,5,6,9,10,11].flatMap((edge) => Array.from({length:6},(_,i)=>1+(edge-1)*18+i*3)))
    const vertical = result.shapes.filter((s) => s.id.startsWith('outline:left:vertical:0:'))
    expect(vertical).toHaveLength(6)
    expect(vertical.every((s) => s.points[0].y > s.points[1].y)).toBe(true)
    for (let i=1;i<6;i++) expect(vertical[i].points[0]).toEqual(vertical[i-1].points[1])
  })

  it('adds only a missing bottom when existing hardware already supplies the other edges', () => {
    const left: LedBoxOutline = { id:'base-left',rect:{x:0,y:0,w:300,h:200},folds:[],parts:['bottom'],patch:{'bottom:0':binding(100,3)} }
    const right = { ...left, id:'base-right', rect:{x:400,y:0,w:300,h:200}, patch:{'bottom:0':binding(101,3)} }
    const result=appendLedBoxOutlines(base(),[left,right])
    expect(result.shapes).toHaveLength(12)
    expect(result.shapes.every((s)=>s.points.every((p)=>p.y===199))).toBe(true)
  })

  it('links matching keys while preserving RGB, reduction and individual lamp order', () => {
    const result=appendLedBoxOutlines(base(),[box('a',100),box('b',101,400),{...box('linked',100),rect:{x:0,y:300,w:300,h:200}}])
    for (const fixture of result.fixtures) {
      const frame=new Uint8Array(512);frame.set([80,40,20],fixture.start-1)
      expect(fixtureColor(fixture,frame,false)).toEqual([80,40,20])
      expect(result.fixtures.filter((f)=>f.universe===fixture.universe && f.start===fixture.start).every((f)=>fixtureColor(f,frame,false).join(',')==='80,40,20')).toBe(true)
    }
  })

  it('preserves all old data and the existing chart save format', () => {
    const input=base()
    input.fixtures.push({id:'old',shapeId:'old',universe:2,start:1,mode:'rgb'})
    const before=JSON.stringify(input)
    const result=appendLedBoxOutlines(input,[box('a',100),box('b',101,400)])
    expect(JSON.stringify(input)).toBe(before)
    expect(result.fixtures[0]).toBe(input.fixtures[0])
    expect(result.layers).toBe(input.layers)
    expect(result.settings).toBe(input.settings)
    expect(parseChart(serializeChart(result))).toEqual(result)
  })

  it('rejects occupied universes, overflow, inconsistent aliases and overlapping ranges', () => {
    const input=base();input.fixtures.push({id:'old',shapeId:'old',universe:100,start:512,mode:'dim'})
    expect(()=>appendLedBoxOutlines(input,[box('a',100),box('b',101,400)])).toThrow(/occupied/)
    const bad=box('a',100);bad.patch['top:0']={...bad.patch['top:0'],start:510}
    expect(()=>appendLedBoxOutlines(base(),[bad,box('b',101,400)])).toThrow(/overflowing/)
    const overlap=box('a',100);overlap.patch['top:0']={...overlap.patch['bottom:0'],key:'different'}
    expect(()=>appendLedBoxOutlines(base(),[overlap,box('b',101,400)])).toThrow(/Overlapping/)
    const alias=box('linked',100);alias.patch['top:0']={...alias.patch['top:0'],start:74}
    expect(()=>appendLedBoxOutlines(base(),[box('a',100),alias,box('b',101,400)])).toThrow(/Inconsistent/)
  })

  it('rejects invalid folds, off-canvas faces, duplicate IDs and page-control collisions', () => {
    const invalid=box('a',100);invalid.folds=[NaN]
    expect(()=>appendLedBoxOutlines(base(),[invalid,box('b',101,400)])).toThrow(/fold/)
    invalid.folds=[0.000001]
    expect(()=>appendLedBoxOutlines(base(),[invalid,box('b',101,400)])).toThrow(/fold/)
    expect(()=>appendLedBoxOutlines(base(),[box('a',100,700),box('b',101,400)])).toThrow(/rectangle/)
    expect(()=>appendLedBoxOutlines(base(),[box('a',100),box('a',101,400)])).toThrow(/identifier/)
    const input=base();input.settings.pageSwitch={enabled:true,universe:100,address:512}
    expect(()=>appendLedBoxOutlines(input,[box('a',100),box('b',101,400)])).toThrow(/occupied/)
  })
})
