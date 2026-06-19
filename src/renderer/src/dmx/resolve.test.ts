import { describe, it, expect } from 'vitest'
import { effectiveDmxByUniverse, SIGNAL_TIMEOUT_MS } from './resolve'

describe('effectiveDmxByUniverse (On Signal Loss)', () => {
  const u1 = new Uint8Array([10, 20, 30])

  it('Hold Last(true): 信号断でも最後の値を保持＝同じ参照をそのまま返す', () => {
    const dmx = { 0: u1 }
    const seen = { 0: 0 } // ずっと前に受信したきり
    expect(effectiveDmxByUniverse(dmx, seen, true, 999999)).toBe(dmx)
  })

  it('Zero(false)・受信が新しい: 値を保持', () => {
    const now = 100000
    const out = effectiveDmxByUniverse({ 0: u1 }, { 0: now }, false, now)
    expect(out[0]).toBe(u1)
  })

  it('Zero(false)・信号断: そのユニバースを黒(全0)に落とす', () => {
    const now = 100000
    const out = effectiveDmxByUniverse({ 0: u1 }, { 0: now - SIGNAL_TIMEOUT_MS - 1 }, false, now)
    expect(Array.from(out[0]).every((v) => v === 0)).toBe(true)
  })
})
