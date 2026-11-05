import { describe, expect, it } from 'vitest'
import { appendRibbonMotifs, type RibbonTemplate, type RibbonPlacement } from './ribbon-layout'
import { createChart } from './chart-model'
import { fixtureColor } from '../dmx/channel-math'
import { serializeChart, parseChart } from '../io/chart-file'

const template: RibbonTemplate = {id:'synthetic',parts:[
  {sourceAddress:4,type:'line',points:[{x:0,y:0},{x:10,y:20}]},
  {sourceAddress:1,type:'line',points:[{x:-20,y:0},{x:0,y:-10}]},
  {sourceAddress:1,type:'line',points:[{x:20,y:0},{x:0,y:-10}]},
  {sourceAddress:7,type:'ellipse',points:[{x:-2,y:-2},{x:2,y:2}]}
]}
const placements: RibbonPlacement[] = Array.from({length:4},(_,i)=>({id:`bow-${i}`,templateId:template.id,
  universe:100+Math.floor(i/2),start:1+(i%2)*9,rect:{x:i*100,y:0,w:90,h:100}}))
describe('ribbon motifs',()=>{
  it('preserves multipatch links, source order and RGB dimming in two universes',()=>{
    const input=createChart({w:500,h:200});const before=JSON.stringify(input)
    const result=appendRibbonMotifs(input,[template],placements)
    expect(JSON.stringify(input)).toBe(before)
    expect(result.fixtures).toHaveLength(16)
    expect(result.fixtures.slice(0,4).map((f)=>f.start)).toEqual([1,1,4,7])
    for(const u of [100,101])expect(new Set(result.fixtures.filter((f)=>f.universe===u).map((f)=>f.start)).size).toBe(6)
    const frame=Uint8Array.of(96,48,24,0,0,0,0,0,0)
    expect(result.fixtures.slice(0,2).map((f)=>fixtureColor(f,frame,false))).toEqual([[96,48,24],[96,48,24]])
    expect(fixtureColor(result.fixtures[2],frame,false)).toEqual([0,0,0])
    expect(parseChart(serializeChart(result))).toEqual(result)
  })
  it('keeps source proportions, ellipses, 2px lines and LED margins',()=>{
    const result=appendRibbonMotifs(createChart({w:500,h:200}),[template],placements)
    for(let i=0;i<4;i++)for(const s of result.shapes.slice(i*4,i*4+4)){
      expect(s.strokeWidth).toBe(2)
      for(const p of s.points){expect(p.x).toBeGreaterThanOrEqual(i*100+6);expect(p.x).toBeLessThanOrEqual(i*100+84);expect(p.y).toBeGreaterThanOrEqual(6);expect(p.y).toBeLessThanOrEqual(94)}
    }
    const circle=result.shapes[3]
    expect(circle.type).toBe('ellipse')
    expect(circle.points[1].x-circle.points[0].x).toBeCloseTo(circle.points[1].y-circle.points[0].y)
  })
  it('leaves the first chart geometry and patch unchanged',()=>{
    const input=createChart({w:500,h:200});const oldLayer=input.activeLayerId
    input.shapes.push({id:'old',type:'line',layerId:oldLayer,points:[{x:1,y:1},{x:20,y:1}],display:'stroke',strokeWidth:2})
    input.fixtures.push({id:'old',shapeId:'old',universe:22,start:1,mode:'rgb'})
    input.layers.push({id:'ribbon',name:'Ribbons',underlay:null,visible:true});input.activeLayerId='ribbon'
    const result=appendRibbonMotifs(input,[template],placements)
    expect(result.shapes[0]).toBe(input.shapes[0]);expect(result.fixtures[0]).toBe(input.fixtures[0])
    expect(result.shapes.slice(1).every((s)=>s.layerId==='ribbon')).toBe(true)
  })
  it('rejects existing or overlapping patch and out-of-range coordinates',()=>{
    const input=createChart({w:500,h:200});input.fixtures.push({id:'old',shapeId:'old',universe:100,start:512,mode:'dim'})
    expect(()=>appendRibbonMotifs(input,[template],placements)).toThrow(/occupied/)
    expect(()=>appendRibbonMotifs(createChart({w:500,h:200}),[template],placements.map((p)=>({...p,start:1})))).toThrow(/Overlapping ribbon/)
    expect(()=>appendRibbonMotifs(createChart({w:500,h:200}),[template],[{...placements[0],start:510},...placements.slice(1)])).toThrow(/overflowing/)
    expect(()=>appendRibbonMotifs(createChart({w:500,h:200}),[template],[{...placements[0],rect:{x:-1,y:0,w:90,h:100}},...placements.slice(1)])).toThrow(/rectangle/)
  })
})
