import { describe, it, expect } from 'vitest'
import { serializeChart, parseChart } from './chart-file'
import { createChart, addShape } from '../model/chart-model'

describe('chart-file', () => {
  it('round-trips a chart through serialize/parse', () => {
    let c = createChart({ w: 1920, h: 1080 })
    c = addShape(c, { type: 'ellipse', points: [{ x: 5, y: 5 }, { x: 15, y: 15 }] })
    c.underlay = { dataUrl: 'data:image/png;base64,AAAA', opacity: 0.5, visible: true }
    const parsed = parseChart(serializeChart(c))
    expect(parsed).toEqual(c)
  })
  it('throws a clear error on malformed json', () => {
    expect(() => parseChart('{not json')).toThrow(/invalid chart file/i)
  })
  it('rejects an unsupported version', () => {
    expect(() => parseChart(JSON.stringify({ version: 99 }))).toThrow(/version/i)
  })
})
