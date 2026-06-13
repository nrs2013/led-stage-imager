import { describe, it, expect } from 'vitest'
import { createChart, addShape } from './chart-model'

describe('chart-model', () => {
  it('createChart sets defaults', () => {
    const c = createChart({ w: 1920, h: 1080 })
    expect(c.version).toBe(1)
    expect(c.canvas).toEqual({ w: 1920, h: 1080 })
    expect(c.shapes).toEqual([])
    expect(c.fixtures).toEqual([])
    expect(c.syphon.name).toBe('LED STAGE IMAGER')
  })
  it('addShape appends a shape with an id', () => {
    const c = createChart({ w: 100, h: 100 })
    const c2 = addShape(c, {
      type: 'line',
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 }
      ]
    })
    expect(c2.shapes).toHaveLength(1)
    expect(c2.shapes[0].id).toBeTruthy()
    expect(c2.shapes[0].display).toBe('stroke')
  })
})
