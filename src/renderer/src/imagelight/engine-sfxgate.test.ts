import { describe, it, expect } from 'vitest'
import { sfxGateAllows } from './engine'

/** 発射ゲート＝誤発防止の要。OFFなら絶対に撃たない・シーン絞り込み中はID一致だけ撃つ。 */
describe('sfxGateAllows（発射ゲート＋SFXシーン絞り込み）', () => {
  it('ゲートON・絞り込み無し＝撃てる（従来どおり）', () => {
    expect(sfxGateAllows('flame', true, true, null, 1)).toBe(true)
    expect(sfxGateAllows('sparkler', true, true, null, undefined)).toBe(true)
  })

  it('ゲートOFFのSFXは、何があっても撃たない', () => {
    expect(sfxGateAllows('flame', false, true, null, 1)).toBe(false)
    expect(sfxGateAllows('sparkler', true, false, null, 2)).toBe(false)
    // シーンに入っていてもゲートOFFなら撃たない
    expect(sfxGateAllows('flame', false, true, new Set([1]), 1)).toBe(false)
  })

  it('ゲートは種類ごとに独立（炎OFFでも火花は撃てる）', () => {
    expect(sfxGateAllows('sparkler', false, true, null, 1)).toBe(true)
    expect(sfxGateAllows('flame', true, false, null, 1)).toBe(true)
  })

  it('シーン絞り込み中は、入っているマークだけ撃つ', () => {
    const armed = new Set([1, 3])
    expect(sfxGateAllows('flame', true, true, armed, 1)).toBe(true)
    expect(sfxGateAllows('flame', true, true, armed, 2)).toBe(false)
    expect(sfxGateAllows('sparkler', true, true, armed, 3)).toBe(true)
  })

  it('絞り込み中、ID未割当のマークは撃たない（安全側）', () => {
    expect(sfxGateAllows('flame', true, true, new Set([1]), undefined)).toBe(false)
  })
})
