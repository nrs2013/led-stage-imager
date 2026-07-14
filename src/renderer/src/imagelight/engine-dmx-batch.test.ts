import { describe, it, expect } from 'vitest'
import { ImageLightEngine } from './engine'
import type { ChannelMode } from '../model/types'

// 一括モード/ユニバース変更（setAllPatchedMode / setAllPatchedUniverse）の中身だけを検証する。
// エンジン全体はキャンバス(DOM)が要り node 環境では作れないので、prototype のメソッドを
// 「beams と副作用スタブだけ持つ this」に .call して実ロジックを直接走らせる。
type Patch = { universe: number; start: number; mode: ChannelMode }
function fakeEngine(beams: { dmx?: Patch }[]): { beams: { dmx?: Patch }[] } {
  return { beams, pushHistory: (): void => {}, bump: (): void => {} } as never
}
const call = (self: unknown, method: 'setAllPatchedMode' | 'setAllPatchedUniverse', arg: unknown): void =>
  (ImageLightEngine.prototype[method] as (a: unknown) => void).call(self, arg)

describe('setAllPatchedMode（全パッチ灯体のモードを一括）', () => {
  it('パッチ済みだけモードが変わり、未パッチは触らない', () => {
    const beams = [
      { dmx: { universe: 0, start: 1, mode: 'beam8' as ChannelMode } },
      { dmx: { universe: 0, start: 9, mode: 'beam8' as ChannelMode } },
      {} // 未パッチ
    ]
    const e = fakeEngine(beams)
    call(e, 'setAllPatchedMode', 'beam9')
    expect(beams[0].dmx!.mode).toBe('beam9')
    expect(beams[1].dmx!.mode).toBe('beam9')
    expect(beams[2].dmx).toBeUndefined()
  })

  it('モード変更で 512 をはみ出す位置は収まる番地にクランプ（beam9=9ch なら最大 504）', () => {
    const beams = [{ dmx: { universe: 0, start: 510, mode: 'rgb' as ChannelMode } }]
    call(fakeEngine(beams), 'setAllPatchedMode', 'beam9')
    expect(beams[0].dmx!.start).toBe(504) // 513 - 9
    expect(beams[0].dmx!.mode).toBe('beam9')
  })

  it('収まっている番地はそのまま維持', () => {
    const beams = [{ dmx: { universe: 2, start: 100, mode: 'beam8' as ChannelMode } }]
    call(fakeEngine(beams), 'setAllPatchedMode', 'beam9')
    expect(beams[0].dmx!.start).toBe(100)
    expect(beams[0].dmx!.universe).toBe(2) // ユニバースは触らない
  })
})

describe('setAllPatchedUniverse（全パッチ灯体のユニバースを一括）', () => {
  it('パッチ済みだけユニバースが変わり、アドレス・モードは維持', () => {
    const beams = [
      { dmx: { universe: 0, start: 5, mode: 'beam9' as ChannelMode } },
      { dmx: { universe: 1, start: 20, mode: 'beam8' as ChannelMode } },
      {} // 未パッチ
    ]
    call(fakeEngine(beams), 'setAllPatchedUniverse', 3)
    expect(beams[0].dmx!.universe).toBe(3)
    expect(beams[1].dmx!.universe).toBe(3)
    expect(beams[0].dmx!.start).toBe(5) // アドレスは動かさない
    expect(beams[0].dmx!.mode).toBe('beam9')
    expect(beams[2].dmx).toBeUndefined()
  })

  it('ユニバースは 0..32767 にクランプ（負や巨大値でも壊れない）', () => {
    const beams = [{ dmx: { universe: 0, start: 1, mode: 'beam8' as ChannelMode } }]
    call(fakeEngine(beams), 'setAllPatchedUniverse', -5)
    expect(beams[0].dmx!.universe).toBe(0)
    call(fakeEngine([{ dmx: { universe: 0, start: 1, mode: 'beam8' as ChannelMode } }]), 'setAllPatchedUniverse', 999999)
  })
})
