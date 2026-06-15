import { describe, it, expect } from 'vitest'
import {
  marqueeChars,
  marqueeCharCount,
  marqueeText,
  marqueeSize,
  marqueePitch,
  MARQUEE_DEFAULT_TEXT,
  MARQUEE_DEFAULT_SIZE,
  MARQUEE_DEFAULT_PITCH
} from './marquee'

describe('marquee addressing (1 letter = 1 address, like neon)', () => {
  it('one address per non-space character', () => {
    expect(marqueeChars('ADD ICT')).toEqual(['A', 'D', 'D', 'I', 'C', 'T'])
    expect(marqueeCharCount('ADD ICT')).toBe(6)
  })
  it('count never 0 (patch maths stay sane)', () => {
    expect(marqueeCharCount('')).toBe(1)
    expect(marqueeCharCount('   ')).toBe(1)
  })
})

describe('marquee getters fall back to defaults', () => {
  it('text / size / pitch defaults', () => {
    expect(marqueeText({})).toBe(MARQUEE_DEFAULT_TEXT)
    expect(marqueeSize({})).toBe(MARQUEE_DEFAULT_SIZE)
    expect(marqueePitch({})).toBe(MARQUEE_DEFAULT_PITCH)
  })
  it('pitch clamps to a sane minimum', () => {
    expect(marqueePitch({ bulbPitch: 2 })).toBe(6)
  })
})
