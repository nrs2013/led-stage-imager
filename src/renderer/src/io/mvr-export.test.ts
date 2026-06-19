import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import { buildMvr, patchRows, buildGdtfXml } from './mvr-export'
import { createChart } from '../model/chart-model'
import type { Chart, Shape, Fixture } from '../model/types'

const cc = (x: number, y: number): { x: number; y: number } => ({ x: x + 0.5, y: y + 0.5 })

function testChart(): Chart {
  const c = createChart({ w: 400, h: 300 })
  const bar: Shape = {
    id: 'shape_bar111',
    type: 'freehand',
    points: [cc(10, 20), cc(11, 20), cc(12, 20)],
    display: 'stroke',
    strokeWidth: 1,
    fixtureId: 'fx1'
  }
  const arr: Shape = {
    id: 'shape_arr222',
    type: 'rect',
    points: [
      { x: 100, y: 100 },
      { x: 110, y: 110 }
    ],
    display: 'fill',
    strokeWidth: 1,
    repeat: { count: 3, dx: 20, dy: 0 },
    fixtureId: 'fx2'
  }
  const fx1: Fixture = { id: 'fx1', shapeId: 'shape_bar111', universe: 2, start: 33, mode: 'rgb' }
  const fx2: Fixture = { id: 'fx2', shapeId: 'shape_arr222', universe: 0, start: 510, mode: 'rgb' }
  return { ...c, shapes: [bar, arr], fixtures: [fx1, fx2] }
}

describe('MVR export', () => {
  it('patchRows: 反復アレイは1灯ずつ展開され、512跨ぎも正しい絶対番地になる', () => {
    const rows = patchRows(testChart())
    expect(rows).toHaveLength(4) // 1 + 3reps
    expect(rows[0].absAddress).toBe(2 * 512 + 33) // U2.33 → 1057
    // U0.510 から 3ch 刻み: 510 → 0*512+510, 次は512跨ぎで U1.1 → 513, U1.4 → 516
    expect(rows.slice(1).map((r) => r.absAddress)).toEqual([510, 513, 516])
    expect(rows[1].x).toBe(100 * 10) // px → mm
    expect(rows[2].x).toBe(120 * 10) // 反復オフセット込み
  })

  it('buildMvr: 解凍すると Scene XML と GDTF が入っていて、番地とモードが書かれている', async () => {
    const data = await buildMvr(testChart())
    const mvr = await JSZip.loadAsync(data)
    const sceneFile = mvr.file('GeneralSceneDescription.xml')
    const gdtfFile = mvr.file('DECOR Cell.gdtf')
    expect(sceneFile).toBeTruthy()
    expect(gdtfFile).toBeTruthy()
    const scene = await sceneFile!.async('string')
    expect(scene).toContain('<Address break="0">1057</Address>')
    expect(scene).toContain('<GDTFMode>RGB</GDTFMode>')
    expect(scene).toContain('<GDTFSpec>DECOR Cell.gdtf</GDTFSpec>')
    expect((scene.match(/<Fixture /g) || []).length).toBe(4)
    const gdtf = await JSZip.loadAsync(await gdtfFile!.async('uint8array'))
    const desc = await gdtf.file('description.xml')!.async('string')
    expect(desc).toContain('FixtureType Name="DECOR Cell"')
    expect((desc.match(/<DMXMode /g) || []).length).toBe(6) // RGB / RGB Dim / Dim / RGBW Dim / Beam 6ch / Beam 8ch
    expect(desc).toContain('Attribute="ColorAdd_R"')
  })

  it('buildGdtfXml: RGBW Dim は5ch構成', () => {
    const xml = buildGdtfXml('{TEST}')
    const start = xml.indexOf('Name="RGBW Dim"')
    const end = xml.indexOf('<DMXMode', start)
    const rgbw = xml.slice(start, end === -1 ? undefined : end)
    expect((rgbw.match(/<DMXChannel /g) || []).length).toBe(5)
  })

  it('buildGdtfXml: Beam 6ch は R,G,B,Pan,Tilt,Zoom — Pan/Tilt/Zoom は 128 ホーム', () => {
    const xml = buildGdtfXml('{TEST}')
    const start = xml.indexOf('Name="Beam 6ch"')
    const end = xml.indexOf('<DMXMode', start) // 次のモード(Beam 8ch)の手前まで＝6ch分だけ
    const beam = xml.slice(start, end === -1 ? undefined : end)
    expect((beam.match(/<DMXChannel /g) || []).length).toBe(6)
    expect(beam).toContain('Attribute="Pan"')
    expect(beam).toContain('Attribute="Tilt"')
    expect(beam).toContain('Attribute="Zoom"')
    expect(beam).toContain('Default="128/1"')
  })

  it('buildGdtfXml: Beam 8ch は P/T/Dim/Shut/RGB/Zoom の8ch', () => {
    const xml = buildGdtfXml('{TEST}')
    const beam = xml.slice(xml.indexOf('Name="Beam 8ch"')) // 最後のモードなので末尾までで良い
    expect((beam.match(/<DMXChannel /g) || []).length).toBe(8)
    expect(beam).toContain('Attribute="Dimmer"')
    expect(beam).toContain('Attribute="Shutter"')
    expect(beam).toContain('Attribute="Pan"')
    expect(beam).toContain('Attribute="Zoom"')
  })
})
