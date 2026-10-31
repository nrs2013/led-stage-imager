import { expect, it } from 'vitest'
import { parseDxfVectors, placeVectors } from './dxf-vectors'

const dxf = (entities: string, blocks = ''): string =>
  `0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n4\n0\nENDSEC\n${blocks}0\nSECTION\n2\nENTITIES\n${entities}0\nENDSEC\n0\nEOF\n`
const line = '0\nLINE\n8\n0\n10\n100\n20\n100\n11\n300\n21\n200\n'
it('preserves dimensions, flips CAD Y once, fits proportionally and centres', () => {
  const drawing = parseDxfVectors(dxf(line))
  expect(drawing.bounds).toEqual({ x: 0, y: 0, w: 200, h: 100 })
  expect(drawing.unit).toBe('mm')
  expect(drawing.paths[0]).toEqual([
    { x: 0, y: 100 },
    { x: 200, y: 0 }
  ])
  const shapes = placeVectors(drawing, { x: 1000, y: 0, w: 400, h: 400 }, 1)
  expect(shapes[0].points).toEqual([
    { x: 1000, y: 300 },
    { x: 1400, y: 100 }
  ])
})
it('supports rotated, scaled blocks and their base point', () => {
  const blocks = `0\nSECTION\n2\nBLOCKS\n0\nBLOCK\n2\nMOTIF\n70\n0\n10\n100\n20\n100\n${line}0\nENDBLK\n0\nENDSEC\n`
  const insert = '0\nINSERT\n2\nMOTIF\n10\n1000\n20\n500\n41\n2\n42\n2\n50\n90\n'
  const drawing = parseDxfVectors(dxf(insert, blocks))
  expect(drawing.bounds.w).toBeCloseTo(200)
  expect(drawing.bounds.h).toBeCloseTo(400)
})
it('keeps closed polyline endpoints and tessellates arcs', () => {
  const poly = '0\nLWPOLYLINE\n90\n3\n70\n1\n10\n0\n20\n0\n10\n100\n20\n0\n10\n100\n20\n100\n'
  const drawing = parseDxfVectors(dxf(poly))
  expect(drawing.paths[0][0]).toEqual(drawing.paths[0].at(-1))
  const circle = parseDxfVectors(dxf('0\nCIRCLE\n10\n0\n20\n0\n40\n100\n'))
  expect(circle.bounds.w).toBeCloseTo(200)
  expect(circle.bounds.h).toBeCloseTo(200)
  expect(circle.paths[0].length).toBeGreaterThan(100)
})
it('rejects invalid input and reports unsupported text rather than inventing contours', () => {
  expect(() => parseDxfVectors('not dxf')).toThrow()
  const drawing = parseDxfVectors(dxf(line + '0\nTEXT\n10\n0\n20\n0\n40\n10\n1\nlabel\n'))
  expect(drawing.warnings).toContain('TEXTは未対応のため省略')
})
