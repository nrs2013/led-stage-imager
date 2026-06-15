import { describe, it, expect } from 'vitest'
import { streetLampDiameter, STREETLAMP_DEFAULT_DIAMETER } from './streetlamp'

describe('streetLampDiameter', () => {
  it('falls back to the 60cm default when unset', () => {
    expect(streetLampDiameter({})).toBe(STREETLAMP_DEFAULT_DIAMETER)
    expect(STREETLAMP_DEFAULT_DIAMETER).toBe(600)
  })
  it('uses the shape diameter when set', () => {
    expect(streetLampDiameter({ diameter: 120 })).toBe(120)
  })
})
