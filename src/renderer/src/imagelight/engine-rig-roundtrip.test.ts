import { describe, it, expect } from 'vitest'
import { ImageLightEngine } from './engine'
import type { RigPayload } from './engine'

/** のむさん 2026-07-26「保存したものを立ち上げ直したら、保存した時の設定がすべて残る」。
 *  rigData()（書き出し）と applyRig()（戻す）の往復を、prototype 直呼びで検証する。
 *  ShowFile.rig は RigPayload そのものなので、ここが通れば保存ファイル経由でも戻る。 */

type Any = Record<string, unknown>
const rigData = (self: Any): RigPayload =>
  (ImageLightEngine.prototype as unknown as { rigData: () => RigPayload }).rigData.call(self as never)
const applyRig = (self: Any, d: RigPayload): void =>
  (
    ImageLightEngine.prototype as unknown as { applyRig: (d: RigPayload) => void }
  ).applyRig.call(self as never, d)

/** 「設定を作り込んだ」状態のエンジン（rigData が読むフィールドだけ持つ） */
const configured = (): Any => ({
  st: {
    master: 0.8,
    smoke: 30,
    chase: true,
    search: true,
    searchRandom: true,
    strobe: 'rnd',
    colorChase: true,
    breath: true,
    fire: false,
    wave: true,
    bolt: false,
    rainbow: true,
    zoompulse: true
  },
  fxp: { search: { speed: 0.4, width: 30 } },
  patterns: [null],
  userColors: [[255, 0, 0]],
  chasePalette: [[0, 255, 0]],
  paramMidi: { 'fx.search.speed': 21 },
  masterMidi: 7,
  fxMidi: { chase: 36 },
  fxKey: { chase: 'KeyQ' },
  colorMidi: { '#ff0000': 40 },
  colorKey: { '#ff0000': 'Digit1' },
  falloffPow: 2.5,
  outCap: 1920,
  sceneFadeMode: 'fade',
  sceneFadeMs: 900,
  strobeMidi: 50,
  strobeRate: 0.7,
  motifChaseMidi: 51,
  lightOnly: true,
  relief: 0.42,
  lumReliefStrength: 0.31
})

/** 起動直後のまっさらなエンジン（applyRig の受け皿） */
const fresh = (): Any => ({
  st: {
    master: 1,
    smoke: 12,
    chase: false,
    search: false,
    searchRandom: false,
    strobe: 'off',
    colorChase: false,
    breath: false,
    fire: false,
    wave: false,
    bolt: false,
    rainbow: false,
    zoompulse: false
  },
  fxp: {},
  patterns: [],
  userColors: [],
  chasePalette: [],
  paramMidi: {},
  masterMidi: null,
  fxMidi: {},
  fxKey: {},
  falloffPow: 2.5,
  outCap: 1920,
  sceneFadeMode: 'cut',
  sceneFadeMs: 1500,
  strobeMidi: null,
  strobeRate: 0.55,
  motifChaseMidi: null,
  lightOnly: false,
  relief: 0,
  lumReliefStrength: 0
})

describe('保存→開き直しで設定が全部戻る（rigData → applyRig）', () => {
  it('FX の入り切り12個が戻る（今までここが丸ごと消えていた）', () => {
    const saved = rigData(configured())
    const e = fresh()
    applyRig(e, saved)
    const st = e.st as Record<string, unknown>
    expect(st.chase).toBe(true)
    expect(st.search).toBe(true)
    expect(st.searchRandom).toBe(true)
    expect(st.strobe).toBe('rnd')
    expect(st.colorChase).toBe(true)
    expect(st.breath).toBe(true)
    expect(st.wave).toBe(true)
    expect(st.rainbow).toBe(true)
    expect(st.zoompulse).toBe(true)
    expect(st.fire).toBe(false) // 切っていた物は切ったまま
    expect(st.bolt).toBe(false)
  })

  it('見え方（光だけ出力・立体強調・方向の立体）が戻る', () => {
    const e = fresh()
    applyRig(e, rigData(configured()))
    expect(e.lightOnly).toBe(true)
    expect(e.relief).toBeCloseTo(0.42)
    expect(e.lumReliefStrength).toBeCloseTo(0.31)
  })

  it('MASTER/SMOKE・MIDI・キー・フェード設定も戻る（従来分の回帰）', () => {
    const e = fresh()
    applyRig(e, rigData(configured()))
    expect((e.st as Record<string, number>).master).toBeCloseTo(0.8)
    expect(e.masterMidi).toBe(7)
    expect(e.fxMidi).toEqual({ chase: 36 })
    expect(e.fxKey).toEqual({ chase: 'KeyQ' })
    expect(e.colorMidi).toEqual({ '#ff0000': 40 })
    expect(e.sceneFadeMode).toBe('fade')
    expect(e.sceneFadeMs).toBe(900)
    expect(e.strobeMidi).toBe(50)
    expect(e.motifChaseMidi).toBe(51)
  })

  it('古い保存（新しい項目が無い）を開いても、今の見え方を壊さない', () => {
    const e = fresh()
    e.relief = 0.5
    e.lightOnly = true
    applyRig(e, { st: { master: 0.5, smoke: 10 } } as RigPayload) // fxst/relief 等が無い古い形
    expect(e.relief).toBe(0.5) // 触らない
    expect(e.lightOnly).toBe(true)
    expect((e.st as Record<string, number>).master).toBeCloseTo(0.5)
  })

  it('立体強調は 0..1 に収める（壊れた保存で見え方が飛ばない）', () => {
    const e = fresh()
    applyRig(e, { relief: 5, lumReliefStrength: -2 } as RigPayload)
    expect(e.relief).toBe(1)
    expect(e.lumReliefStrength).toBe(0)
  })
})
