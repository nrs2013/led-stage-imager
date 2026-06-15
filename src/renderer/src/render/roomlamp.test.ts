import { describe, it, expect } from 'vitest'
import { roomLampDiameter, ROOMLAMP_DEFAULT_DIAMETER } from './roomlamp'

describe('roomLampDiameter', () => {
  it('falls back to the 50cm default when unset', () => {
    expect(roomLampDiameter({})).toBe(ROOMLAMP_DEFAULT_DIAMETER)
    expect(ROOMLAMP_DEFAULT_DIAMETER).toBe(500)
  })
  it('uses the shape diameter when set (校正後の実寸px)', () => {
    expect(roomLampDiameter({ diameter: 67.2 })).toBe(67.2)
  })
})
