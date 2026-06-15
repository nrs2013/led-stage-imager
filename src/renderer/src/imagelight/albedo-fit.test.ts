import { describe, test, expect } from 'vitest'
import { albedoFitSize, ALBEDO_MAX } from './engine'

describe('albedoFitSize — photo albedo memory cap (OOM fix)', () => {
  test('default cap is 2560 on the longest side', () => {
    expect(ALBEDO_MAX).toBe(2560)
    expect(albedoFitSize(4032, 3024)).toEqual({ w: 2560, h: 1920 }) // 12MP landscape
    expect(albedoFitSize(3024, 4032)).toEqual({ w: 1920, h: 2560 }) // portrait
  })
  test('never upscales a photo already within the cap', () => {
    expect(albedoFitSize(1600, 900)).toEqual({ w: 1600, h: 900 })
    expect(albedoFitSize(2560, 1440)).toEqual({ w: 2560, h: 1440 })
  })
  test('very large photo scaled by its longest side, aspect kept', () => {
    expect(albedoFitSize(6000, 4000)).toEqual({ w: 2560, h: 1707 })
  })
})
