import type { Chart, Fixture, Point, Shape } from './types'

export interface RibbonPart {
  sourceAddress: number
  type: 'line' | 'ellipse'
  points: [Point, Point]
}
export interface RibbonTemplate { id: string; parts: RibbonPart[] }
export interface RibbonPlacement {
  id: string; templateId: string; universe: number; start: number
  rect: { x: number; y: number; w: number; h: number }
}

/** Preserve the original address sequence and linked geometry (MVR multipatch).
 * Coordinates are explicit front projections extracted from the reference model.
 */
export function appendRibbonMotifs(chart: Chart, templates: RibbonTemplate[], placements: RibbonPlacement[]): Chart {
  const occupied = new Set(chart.fixtures.map((f) => f.universe))
  if (chart.settings.pageSwitch?.enabled) occupied.add(chart.settings.pageSwitch.universe)
  const channels = new Set<string>(), universes = new Set<number>()
  const ids = new Set([...chart.shapes, ...chart.fixtures].map((s) => s.id)), placementIds = new Set<string>()
  const shapes: Shape[] = [], fixtures: Fixture[] = []
  if (new Set(templates.map((t) => t.id)).size !== templates.length) throw new Error('Duplicate ribbon template')
  for (const placement of placements) {
    if (!placement.id || placementIds.has(placement.id)) throw new Error('Duplicate ribbon placement')
    placementIds.add(placement.id)
    const template = templates.find((t) => t.id === placement.templateId)
    if (!template?.parts.length) throw new Error('Missing ribbon template')
    const r = placement.rect
    if (![r.x,r.y,r.w,r.h].every(Number.isFinite) || r.x < 0 || r.y < 0 || r.w <= 12 || r.h <= 12 ||
        r.x+r.w > chart.canvas.w || r.y+r.h > chart.canvas.h) throw new Error('Invalid ribbon LED rectangle')
    for (const part of template.parts) {
      if (!Number.isInteger(part.sourceAddress) || part.sourceAddress < 1 || part.sourceAddress > 510 ||
          !['line','ellipse'].includes(part.type) || part.points.length !== 2 ||
          !part.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))) throw new Error('Invalid ribbon source')
    }
    const addresses = [...new Set(template.parts.map((p) => p.sourceAddress))].sort((a,b)=>a-b)
    if (addresses.some((a,i) => i > 0 && a < addresses[i-1]+3)) throw new Error('Overlapping source RGB channels')
    if (!Number.isInteger(placement.universe) || placement.universe < 0 || placement.universe > 32767 ||
        occupied.has(placement.universe) || !Number.isInteger(placement.start) || placement.start < 1 ||
        placement.start+addresses.length*3-1 > 512) throw new Error('Invalid, occupied or overflowing ribbon patch')
    universes.add(placement.universe)
    const addressMap = new Map(addresses.map((a,i)=>[a,placement.start+i*3]))
    for (let c=placement.start;c<placement.start+addresses.length*3;c++) {
      const key=`${placement.universe}:${c}`
      if (channels.has(key)) throw new Error('Overlapping ribbon patches')
      channels.add(key)
    }
    const points=template.parts.flatMap((p)=>p.points)
    const x0=Math.min(...points.map((p)=>p.x)),x1=Math.max(...points.map((p)=>p.x))
    const y0=Math.min(...points.map((p)=>p.y)),y1=Math.max(...points.map((p)=>p.y))
    if (![x1-x0,y1-y0].every((n)=>Number.isFinite(n)&&n>0)) throw new Error('Degenerate ribbon projection')
    const scale=Math.min((r.w-12)/(x1-x0),(r.h-12)/(y1-y0))
    const transform=(p:Point):Point=>({x:r.x+(r.w-(x1-x0)*scale)/2+(p.x-x0)*scale,
      y:r.y+(r.h-(y1-y0)*scale)/2+(p.y-y0)*scale})
    // Sorting changes no multipatch association; equal source addresses stay linked.
    const orderedParts = [...template.parts].sort((a,b)=>a.sourceAddress-b.sourceAddress)
    orderedParts.forEach((part,i)=>{
      const shapeId=`ribbon:${placement.id}:${i}:shape`,fixtureId=`ribbon:${placement.id}:${i}:fixture`
      if (ids.has(shapeId)||ids.has(fixtureId)) throw new Error('Ribbon already exists')
      ids.add(shapeId);ids.add(fixtureId)
      shapes.push({id:shapeId,layerId:chart.activeLayerId,family:'decor',type:part.type,points:part.points.map(transform),display:'stroke',strokeWidth:2,glowPx:0})
      fixtures.push({id:fixtureId,shapeId,universe:placement.universe,start:addressMap.get(part.sourceAddress)!,mode:'rgb'})
    })
  }
  if (universes.size!==2) throw new Error('Ribbon drawing requires exactly two new universes')
  return {...chart,shapes:[...chart.shapes,...shapes],fixtures:[...chart.fixtures,...fixtures]}
}
