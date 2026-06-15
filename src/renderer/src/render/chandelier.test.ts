import { describe, it, expect } from 'vitest'
import { chandelierDiameter, CHANDELIER_DEFAULT_DIAMETER } from './chandelier'

describe('chandelierDiameter', () => {
  it('falls back to the 1m default when unset', () => {
    expect(chandelierDiameter({})).toBe(CHANDELIER_DEFAULT_DIAMETER)
    expect(CHANDELIER_DEFAULT_DIAMETER).toBe(1000)
  })
  it('uses the shape diameter when set', () => {
    expect(chandelierDiameter({ diameter: 240 })).toBe(240)
  })
})
