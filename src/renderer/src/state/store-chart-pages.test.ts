import { expect, it } from 'vitest'
import { useStore } from './store'
import { createChart } from '../model/chart-model'
import { outputLayerIndex, outputShapes } from '../output/page-switch'

it('removes a chart with its geometry and patch, keeps the on-air page and supports Undo/Redo',()=>{
  const initial=createChart({w:300,h:200})
  initial.shapes.push({id:'shape',type:'line',points:[{x:0,y:0},{x:10,y:0}],display:'stroke',strokeWidth:2})
  initial.fixtures.push({id:'fixture',shapeId:'shape',universe:22,start:1,mode:'rgb'})
  useStore.getState().setChart(initial)
  const ribbon=useStore.getState().addLayer({name:'Ribbon'})
  useStore.getState().setPageSwitchManual(1)
  useStore.getState().removeLayer(initial.layers[0].id)
  let s=useStore.getState()
  expect(s.chart.layers.map((l)=>l.id)).toEqual([ribbon])
  expect(s.chart.shapes).toHaveLength(0);expect(s.chart.fixtures).toHaveLength(0)
  expect(s.pageSwitchManual).toBe(0)
  s.undo();s=useStore.getState()
  expect(s.chart.layers).toHaveLength(2)
  expect(s.chart.shapes).toEqual(initial.shapes);expect(s.chart.fixtures).toEqual(initial.fixtures)
  expect(s.pageSwitchManual).toBe(1)
  s.redo();expect(useStore.getState().pageSwitchManual).toBe(0)
})

it('adds an empty chart with the same background and saves the selected-page output mode',()=>{
  const initial=createChart({w:300,h:200})
  initial.layers[0].underlay={dataUrl:'background',visible:true,opacity:1}
  useStore.getState().setChart(initial)
  const id=useStore.getState().addLayer({name:'New chart'})
  let s=useStore.getState()
  expect(s.chart.layers[1].underlay).toEqual(initial.layers[0].underlay)
  expect(s.chart.activeLayerId).toBe(id)
  expect(s.chart.shapes).toHaveLength(0);expect(s.chart.fixtures).toHaveLength(0)
  expect(outputLayerIndex(s.chart,{})).toBeNull()
  s.setChartOutput('selected');s=useStore.getState()
  expect(s.chart.settings.chartOutput).toBe('selected')
  expect(outputLayerIndex(s.chart,{})).toBe(1)
  expect(outputShapes(s.chart,{})).toHaveLength(0)
  s.undo();expect(useStore.getState().chart.settings.chartOutput).toBeUndefined()
})

it('never removes the final chart or creates history for an unknown chart',()=>{
  const initial=createChart({w:300,h:200});useStore.getState().setChart(initial)
  const before=useStore.getState().history.length
  useStore.getState().removeLayer(initial.layers[0].id)
  useStore.getState().removeLayer('missing')
  expect(useStore.getState().chart).toEqual(initial)
  expect(useStore.getState().history.length).toBe(before)
})
