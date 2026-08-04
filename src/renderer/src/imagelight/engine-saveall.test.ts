import { describe, it, expect } from 'vitest'
import { ImageLightEngine } from './engine'

/** のむさん 2026-07-26「一度設定したものを保存して、立ち上げ直したら保存時の設定が全部残る」。
 *  エンジン全体はキャンバスが要り node では作れないので、prototype のメソッドを
 *  「必要なフィールドだけ持つ this」に .call して実ロジックを直接走らせる（既存テストと同じ作法）。 */

type Any = Record<string, unknown>
const call = <T>(self: Any, method: string): T =>
  (ImageLightEngine.prototype as unknown as Record<string, () => T>)[method].call(self as never)

/** hasSaveableContent が「中身なし」と見なす、まっさらな状態。 */
const empty = (): Any => ({
  scenes: [],
  maskImage: null,
  rigCustomized: false,
  masterMidi: null,
  strobeMidi: null,
  motifChaseMidi: null,
  paramMidi: {},
  fxMidi: {},
  fxKey: {},
  colorMidi: {},
  colorKey: {},
  fireMidiMap: {},
  fireKeyMap: {},
  goMidiMap: {},
  goKeyMap: {},
  patterns: [null, null],
  sfxScenes: [null, null],
  cueSheet: [],
  userColors: []
})

describe('hasSaveableContent（自動保存してよい“中身”の判定）', () => {
  it('本当にまっさらなら保存しない（前回データを潰さないため）', () => {
    expect(call<boolean>(empty(), 'hasSaveableContent')).toBe(false)
  })

  it('写真がある / マスクがある / 灯体を動かした は従来どおり保存する', () => {
    expect(call<boolean>({ ...empty(), scenes: [{}] }, 'hasSaveableContent')).toBe(true)
    expect(call<boolean>({ ...empty(), maskImage: {} }, 'hasSaveableContent')).toBe(true)
    expect(call<boolean>({ ...empty(), rigCustomized: true }, 'hasSaveableContent')).toBe(true)
  })

  // ここが今回の本題：写真も配置編集も無い「仕込みだけ」の状態
  it('MASTER に MIDI を覚えさせただけでも保存する', () => {
    expect(call<boolean>({ ...empty(), masterMidi: 7 }, 'hasSaveableContent')).toBe(true)
  })
  it('FX に MIDI を覚えさせただけでも保存する', () => {
    expect(call<boolean>({ ...empty(), fxMidi: { chase: 36 } }, 'hasSaveableContent')).toBe(true)
  })
  it('FX にキーを覚えさせただけでも保存する', () => {
    expect(call<boolean>({ ...empty(), fxKey: { chase: 'KeyQ' } }, 'hasSaveableContent')).toBe(true)
  })
  it('色プリセットに割当てただけでも保存する', () => {
    expect(call<boolean>({ ...empty(), colorMidi: { '#ff0000': 40 } }, 'hasSaveableContent')).toBe(true)
  })
  it('発射ボタン・GO の割当だけでも保存する', () => {
    expect(call<boolean>({ ...empty(), fireMidiMap: { flame: 50 } }, 'hasSaveableContent')).toBe(true)
    expect(call<boolean>({ ...empty(), goMidiMap: { go: 60 } }, 'hasSaveableContent')).toBe(true)
  })
  it('つまみ(CC)の割当だけでも保存する', () => {
    expect(call<boolean>({ ...empty(), paramMidi: { 'fx.chase.ms': 21 } }, 'hasSaveableContent')).toBe(
      true
    )
  })
  it('シーン棚 / SFXシーン / 進行表 / 色プリセットを作っただけでも保存する', () => {
    expect(call<boolean>({ ...empty(), patterns: [{ name: 'A' }, null] }, 'hasSaveableContent')).toBe(true)
    expect(call<boolean>({ ...empty(), sfxScenes: [{ name: 'S' }, null] }, 'hasSaveableContent')).toBe(true)
    expect(call<boolean>({ ...empty(), cueSheet: [{}] }, 'hasSaveableContent')).toBe(true)
    expect(call<boolean>({ ...empty(), userColors: [[255, 0, 0]] }, 'hasSaveableContent')).toBe(true)
  })
})
