import JSZip from 'jszip'
import type { Chart, Fixture, Shape } from '../model/types'
import { addressAt, repeatCount } from '../dmx/address'
import { neonGlyphCenter } from '../render/neon'
import { marqueeBulbs } from '../render/marquee'
import { festoonBulbs } from '../render/festoon'
import { blinderCells, pixelPattCells } from '../render/fixtures'

// MVR export: one .mvr (ZIP) containing GeneralSceneDescription.xml (every patched
// DECOR fixture with its absolute DMX address and stage position) plus an embedded
// .gdtf fixture-type ("DECOR Cell") with one DMX mode per ChannelMode. grandMA3:
// Menu → ... → Import MVR → the whole patch lands on the console in one go.

const GDTF_FILE = 'DECOR Cell.gdtf'
/** 1 editor pixel = 10 mm on stage (typical LED pixel pitch). */
const MM_PER_PX = 10

const MODE_NAMES: Record<Fixture['mode'], string> = {
  rgb: 'RGB',
  rgbdim: 'RGB Dim',
  dim: 'Dim',
  rgbw: 'RGBW Dim',
  rgbw4: 'RGBW',
  beam9: 'Beam RGBW Zoom',
  beam6: 'Beam 6ch',
  beam8: 'Beam 8ch'
}

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const uuid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
      })

function dmxChannel(offset: number, attribute: string, geometry: string): string {
  // Pan/Tilt/Zoom home at 128 = exactly the pose placed in DECOR (beamPose centre)
  const def = attribute === 'Pan' || attribute === 'Tilt' || attribute === 'Zoom' ? '128/1' : '0/1'
  const phys =
    attribute === 'Pan' || attribute === 'Tilt'
      ? 'PhysicalFrom="-1" PhysicalTo="1"'
      : 'PhysicalFrom="0" PhysicalTo="1"'
  return (
    `<DMXChannel DMXBreak="1" Offset="${offset}" Geometry="${geometry}" Highlight="255/1">` +
    `<LogicalChannel Attribute="${attribute}" Snap="No" Master="None">` +
    `<ChannelFunction Name="${attribute} 1" Attribute="${attribute}" DMXFrom="0/1" Default="${def}" ${phys}/>` +
    `</LogicalChannel></DMXChannel>`
  )
}

function dmxMode(name: string, attrs: string[]): string {
  const chans = attrs.map((a, i) => dmxChannel(i + 1, a, 'Cell')).join('')
  return `<DMXMode Name="${name}" Geometry="Cell"><DMXChannels>${chans}</DMXChannels><Relations/><FTMacros/></DMXMode>`
}

/** The embedded fixture type: "DECOR Cell" with a DMX mode per ChannelMode. */
export function buildGdtfXml(fixtureTypeId: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<GDTF DataVersion="1.2"><FixtureType Name="DECOR Cell" ShortName="DECOR" LongName="DECOR STUDIO Cell" ` +
    `Manufacturer="DECOR STUDIO" Description="1px LED decoration cell from DECOR STUDIO" ` +
    `FixtureTypeID="${fixtureTypeId}" RefFT="" CanHaveChildren="No">` +
    `<AttributeDefinitions>` +
    `<ActivationGroups><ActivationGroup Name="ColorRGB"/></ActivationGroups>` +
    `<FeatureGroups>` +
    `<FeatureGroup Name="Color" Pretty="Color"><Feature Name="RGB"/></FeatureGroup>` +
    `<FeatureGroup Name="Dimmer" Pretty="Dim"><Feature Name="Dimmer"/></FeatureGroup>` +
    `<FeatureGroup Name="Position" Pretty="Pos"><Feature Name="PanTilt"/></FeatureGroup>` +
    `<FeatureGroup Name="Beam" Pretty="Beam"><Feature Name="Beam"/></FeatureGroup>` +
    `</FeatureGroups>` +
    `<Attributes>` +
    `<Attribute Name="ColorAdd_R" Pretty="R" ActivationGroup="ColorRGB" Feature="Color.RGB" Color="0.640000,0.330000,21.222100"/>` +
    `<Attribute Name="ColorAdd_G" Pretty="G" ActivationGroup="ColorRGB" Feature="Color.RGB" Color="0.300000,0.600000,71.556200"/>` +
    `<Attribute Name="ColorAdd_B" Pretty="B" ActivationGroup="ColorRGB" Feature="Color.RGB" Color="0.150000,0.060000,7.221600"/>` +
    `<Attribute Name="ColorAdd_W" Pretty="W" ActivationGroup="ColorRGB" Feature="Color.RGB" Color="0.312700,0.329000,100.000000"/>` +
    `<Attribute Name="Dimmer" Pretty="Dim" Feature="Dimmer.Dimmer"/>` +
    `<Attribute Name="Pan" Pretty="P" Feature="Position.PanTilt"/>` +
    `<Attribute Name="Tilt" Pretty="T" Feature="Position.PanTilt"/>` +
    `<Attribute Name="Zoom" Pretty="Z" Feature="Beam.Beam"/>` +
    `<Attribute Name="Shutter" Pretty="Shut" Feature="Beam.Beam"/>` +
    `</Attributes>` +
    `</AttributeDefinitions>` +
    `<Wheels/><PhysicalDescriptions/><Models/>` +
    `<Geometries><Geometry Name="Cell" Matrix="{1,0,0}{0,1,0}{0,0,1}{0,0,0}"/></Geometries>` +
    `<DMXModes>` +
    dmxMode('RGB', ['ColorAdd_R', 'ColorAdd_G', 'ColorAdd_B']) +
    dmxMode('RGB Dim', ['ColorAdd_R', 'ColorAdd_G', 'ColorAdd_B', 'Dimmer']) +
    dmxMode('Dim', ['Dimmer']) +
    dmxMode('RGBW Dim', ['ColorAdd_R', 'ColorAdd_G', 'ColorAdd_B', 'ColorAdd_W', 'Dimmer']) +
    dmxMode('Beam 6ch', ['ColorAdd_R', 'ColorAdd_G', 'ColorAdd_B', 'Pan', 'Tilt', 'Zoom']) +
    dmxMode('Beam 8ch', ['Pan', 'Tilt', 'Dimmer', 'Shutter', 'ColorAdd_R', 'ColorAdd_G', 'ColorAdd_B', 'Zoom']) +
    `</DMXModes><Revisions/></FixtureType></GDTF>`
  )
}

export interface MvrFixtureRow {
  name: string
  mode: Fixture['mode']
  /** absolute DMX address: universe(0-based) * 512 + start(1..512) */
  absAddress: number
  /** stage position in mm (chart px * MM_PER_PX, y flipped) */
  x: number
  y: number
}

/** Flattens the chart's patch — repeat arrays become one row per repetition, using the
 *  same auto-addressing the renderer uses (dmx/address.ts addressAt). */
export function patchRows(chart: Chart): MvrFixtureRow[] {
  const byShape = new Map<string, Shape>()
  for (const sh of chart.shapes) byShape.set(sh.id, sh)
  const rows: MvrFixtureRow[] = []
  for (const fx of chart.fixtures) {
    const sh = byShape.get(fx.shapeId)
    if (!sh) continue
    const reps = repeatCount(sh)
    const p0 = sh.points[0] ?? { x: 0, y: 0 }
    for (let i = 0; i < reps; i++) {
      // reps===1 でも addressAt を通す＝範囲外の start を universe 跨ぎで正規化（i=0 は従来と同値）。
      const a = addressAt(fx.universe, fx.start, fx.mode, fx.addressStep, i)
      // neon: each tube (character) lands at its real glyph centre on the chart;
      // stars: both skies (White/Blue) sit at the field's centre;
      // festoon: each bulb at its true spot on the sagging wire
      const pos =
        sh.type === 'marquee'
          ? (marqueeBulbs(sh)[i] ?? p0)
          : sh.type === 'neon'
          ? neonGlyphCenter(sh, i)
          : sh.type === 'stars'
            ? {
                x: (p0.x + (sh.points[sh.points.length - 1]?.x ?? p0.x)) / 2,
                y: (p0.y + (sh.points[sh.points.length - 1]?.y ?? p0.y)) / 2
              }
            : sh.type === 'festoon'
              ? (festoonBulbs(sh)[i] ?? p0)
              : sh.type === 'blinder'
                ? (blinderCells(sh)[i] ?? p0)
                : sh.type === 'pixelpatt'
                  ? (pixelPattCells(sh)[i] ?? p0)
                  : { x: p0.x + (sh.repeat?.dx ?? 0) * i, y: p0.y + (sh.repeat?.dy ?? 0) * i }
      rows.push({
        name: reps > 1 ? `${sh.id.slice(-6)} #${i + 1}` : sh.id.slice(-6),
        mode: fx.mode,
        absAddress: a.universe * 512 + a.start,
        x: pos.x * MM_PER_PX,
        y: -pos.y * MM_PER_PX
      })
    }
  }
  return rows
}

export function buildSceneXml(rows: MvrFixtureRow[]): string {
  const fixtures = rows
    .map((r, i) => {
      const m = `{1.000000,0.000000,0.000000}{0.000000,1.000000,0.000000}{0.000000,0.000000,1.000000}{${r.x.toFixed(2)},${r.y.toFixed(2)},0.00}`
      return (
        `<Fixture Name="${esc(r.name)}" UUID="${uuid()}">` +
        `<Matrix>${m}</Matrix>` +
        `<GDTFSpec>${esc(GDTF_FILE)}</GDTFSpec>` +
        `<GDTFMode>${MODE_NAMES[r.mode]}</GDTFMode>` +
        `<Addresses><Address break="0">${r.absAddress}</Address></Addresses>` +
        `<FixtureID>${i + 1}</FixtureID><UnitNumber>${i + 1}</UnitNumber>` +
        `<FixtureTypeId>0</FixtureTypeId><CustomId>0</CustomId>` +
        `</Fixture>`
      )
    })
    .join('')
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<GeneralSceneDescription verMajor="1" verMinor="5"><UserData/><Scene><Layers>` +
    `<Layer Name="DECOR" UUID="${uuid()}"><ChildList>${fixtures}</ChildList></Layer>` +
    `</Layers></Scene></GeneralSceneDescription>`
  )
}

/** Builds the complete .mvr (ZIP, stored uncompressed per GDTF/MVR convention). */
export async function buildMvr(chart: Chart): Promise<Uint8Array> {
  const rows = patchRows(chart)
  const gdtf = new JSZip()
  gdtf.file('description.xml', buildGdtfXml(`{${uuid().toUpperCase()}}`))
  const gdtfBin = await gdtf.generateAsync({ type: 'uint8array', compression: 'STORE' })
  const mvr = new JSZip()
  mvr.file('GeneralSceneDescription.xml', buildSceneXml(rows))
  mvr.file(GDTF_FILE, gdtfBin)
  return mvr.generateAsync({ type: 'uint8array', compression: 'STORE' })
}
