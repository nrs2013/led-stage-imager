import { describe, expect, it } from 'vitest'
import { createChart } from './chart-model'
import { appendProjectedCubes, type CubeTemplate, type CubePlacement } from './projected-cubes'
import { fixtureColor } from '../dmx/channel-math'
import { parseChart, serializeChart } from '../io/chart-file'

// Synthetic geometry only; no production coordinates or patch are fixtures.
function template(id: string, mirror = false): CubeTemplate {
  const corners = [[0, 0], [100, 0], [100, 100], [0, 100], [30, -30], [130, -30], [130, 70], [30, 70]]
  const edges = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]
  return { id, segments: edges.flatMap(([a, b], edge) => Array.from({ length: 6 }, (_, i) => {
    const point = (t: number) => ({
      x: (corners[a][0] + (corners[b][0] - corners[a][0]) * t) * (mirror ? -1 : 1),
      y: corners[a][1] + (corners[b][1] - corners[a][1]) * t
    })
    return { sourceAddress: 1 + (edge * 6 + i) * 3, from: point(i / 6), to: point((i + 1) / 6) }
  })).reverse() }
}
const templates = [template('a'), template('b'), template('c', true), template('d', true)]
const patches = templates.map((t, i) => ({ templateId: t.id, universe: 100 + Math.floor(i / 2), start: 1 + (i % 2) * 216 }))
const placements: CubePlacement[] = templates.map((t, i) => ({ id: `p${i}`, templateId: t.id,
  rect: { x: 200 * i, y: 0, w: 190, h: 160 } }))

describe('projected cube chart proposal', () => {
  it('keeps 288 independently addressable RGB segments in exactly two universes', () => {
    const input = createChart({ w: 800, h: 600 })
    const snapshot = JSON.stringify(input)
    const result = appendProjectedCubes(input, templates, patches, placements)
    expect(JSON.stringify(input)).toBe(snapshot)
    expect(result.fixtures).toHaveLength(288)
    expect([...new Set(result.fixtures.map((f) => f.universe))]).toEqual([100, 101])
    for (const u of [100, 101]) {
      const fixtures = result.fixtures.filter((f) => f.universe === u)
      expect(fixtures.map((f) => f.start)).toEqual(Array.from({ length: 144 }, (_, i) => 1 + i * 3))
      expect(fixtures.at(-1)!.start + 2).toBe(432)
    }
    for (let p = 0; p < placements.length; p++) {
      for (const s of result.shapes.slice(p * 72, (p + 1) * 72)) {
        expect(s.strokeWidth).toBe(2)
        expect(s.glowPx).toBe(0)
        for (const point of s.points) {
          expect(point.x).toBeGreaterThanOrEqual(placements[p].rect.x + 6)
          expect(point.x).toBeLessThanOrEqual(placements[p].rect.x + 184)
          expect(point.y).toBeGreaterThanOrEqual(6)
          expect(point.y).toBeLessThanOrEqual(154)
        }
      }
    }
    expect(parseChart(serializeChart(result))).toEqual(result)
  })

  it('preserves the mirrored source projection and uses uniform scale in a wide LED rectangle', () => {
    const result = appendProjectedCubes(createChart({ w: 800, h: 600 }), templates, patches, placements)
    // The first ordered edge advances right for the original, left for its mirror.
    expect(result.shapes[0].points[1].x).toBeGreaterThan(result.shapes[0].points[0].x)
    expect(result.shapes[144].points[1].x).toBeLessThan(result.shapes[144].points[0].x)
    const horizontal = result.shapes[0].points, vertical = result.shapes[6].points
    expect(Math.abs(horizontal[1].x - horizontal[0].x)).toBeCloseTo(Math.abs(vertical[1].y - vertical[0].y))
  })

  it('links explicitly repeated placements to the same new addresses and follows RGB dimming/chase order', () => {
    const linked = [...placements, { ...placements[0], id: 'linked', rect: { x: 0, y: 200, w: 190, h: 160 } }]
    const result = appendProjectedCubes(createChart({ w: 800, h: 600 }), templates, patches, linked)
    for (let i = 0; i < 72; i++) {
      const data = new Uint8Array(512)
      data.set([96, 48, 24], i * 3)
      expect(fixtureColor(result.fixtures[i], data, false)).toEqual([96, 48, 24])
      expect(fixtureColor(result.fixtures[288 + i], data, false)).toEqual([96, 48, 24])
      const other = i === 71 ? 0 : i + 1
      expect(fixtureColor(result.fixtures[other], data, false)).toEqual([0, 0, 0])
    }
  })

  it('preserves pre-existing shapes, fixtures, settings and every layer', () => {
    const input = createChart({ w: 800, h: 600 })
    input.shapes.push({ id: 'old', type: 'line', family: 'decor', points: [{ x: 1, y: 1 }, { x: 2, y: 2 }], display: 'stroke', strokeWidth: 1 })
    input.fixtures.push({ id: 'old', shapeId: 'old', universe: 2, start: 1, mode: 'rgb' })
    const result = appendProjectedCubes(input, templates, patches, placements)
    expect(result.shapes[0]).toBe(input.shapes[0])
    expect(result.fixtures[0]).toBe(input.fixtures[0])
    expect(result.settings).toBe(input.settings)
    expect(result.layers).toBe(input.layers)
  })

  it('rejects collisions, cross-universe overflow and invalid source order without changing input', () => {
    const input = createChart({ w: 800, h: 600 })
    input.fixtures.push({ id: 'old', shapeId: 'old', universe: 100, start: 500, mode: 'dim' })
    expect(() => appendProjectedCubes(input, templates, patches, placements)).toThrow(/occupied/)
    const empty = createChart({ w: 800, h: 600 })
    expect(() => appendProjectedCubes(empty, templates, patches.map((p) => ({ ...p, start: 400 })), placements)).toThrow(/exceeds/)
    expect(() => appendProjectedCubes(empty, templates, patches.map((p) => ({ ...p, universe: 100 })), placements)).toThrow(/Overlapping/)
    const bad = structuredClone(templates)
    bad[0].segments[0].sourceAddress = bad[0].segments[1].sourceAddress
    expect(() => appendProjectedCubes(empty, bad, patches, placements)).toThrow(/source/)
    expect(empty.shapes).toHaveLength(0)
  })

  it('rejects off-canvas placements, repeated IDs and new universes used for page control', () => {
    const input = createChart({ w: 800, h: 600 })
    expect(() => appendProjectedCubes(input, templates, patches, [...placements, placements[0]])).toThrow(/Duplicate/)
    expect(() => appendProjectedCubes(input, templates, patches, [{ ...placements[0], rect: { x: 790, y: 0, w: 100, h: 100 } }])).toThrow(/outside/)
    input.settings.pageSwitch = { enabled: true, universe: 101, address: 512 }
    expect(() => appendProjectedCubes(input, templates, patches, placements)).toThrow(/occupied/)
  })

  it('unfolds angled LED faces, clips real gaps and preserves the address of split segments', () => {
    const source: CubeTemplate = { id: 'diagonals', segments: [
      { sourceAddress: 1, from: { x: 0, y: 0 }, to: { x: 100, y: 100 } },
      { sourceAddress: 4, from: { x: 0, y: 100 }, to: { x: 100, y: 0 } }
    ] }
    const second = { ...source, id: 'second' }
    const input = createChart({ w: 800, h: 600 })
    const result = appendProjectedCubes(input, [source, second], [
      { templateId: source.id, universe: 100, start: 1 },
      { templateId: second.id, universe: 101, start: 1 }
    ], [{ id: 'folded', templateId: source.id, rect: { x: 0, y: 0, w: 200, h: 100 },
      surface: { width: 100, height: 100, panels: [
        { from: 0, to: 0.45, u0: 0, u1: 0.5 },
        { from: 0.55, to: 1, u0: 0.5, u1: 1 }
      ] } }])
    expect(result.fixtures.map((f) => f.start)).toEqual([1, 1, 4, 4])
    result.shapes.forEach((s, i) => {
      const rightPanel = i % 2 === 1
      for (const p of s.points) {
        const u = p.x / 200
        const x = rightPanel ? 0.55 + (u - 0.5) * 0.9 : u * 0.9
        expect(p.y / 100).toBeCloseTo(i < 2 ? x : 1 - x)
      }
    })
  })

  it('rejects overlapping physical panel intervals', () => {
    const source = template('a')
    const other = template('b')
    expect(() => appendProjectedCubes(createChart({ w: 800, h: 600 }), [source, other], [
      { templateId: 'a', universe: 100, start: 1 }, { templateId: 'b', universe: 101, start: 1 }
    ], [{ ...placements[0], surface: { width: 100, height: 100, panels: [
      { from: 0, to: 0.6, u0: 0, u1: 0.5 }, { from: 0.5, to: 1, u0: 0.5, u1: 1 }
    ] } }])).toThrow(/panel intervals/)
  })
})
