import { describe, it, expect, beforeEach, vi } from 'vitest'

/** MIDI/キーの割当だけは「アプリを立ち上げ直しても残る」こと。
 *  明かり・色・シーンは従来どおり残らない（のむさん確定 2026-06-21）。
 *  engine 本体はキャンバスが必要で node では作れないので、保存先の約束だけを検証する。 */

const MAP_KEY = 'decor.imagelight.midimap.v1'
const RIG_KEY = 'decor.imagelight.rig.v3'

function fakeLocalStorage(): Storage {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() {
      return m.size
    }
  } as Storage
}

describe('MIDI割当の保存（再起動をまたぐ）', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', fakeLocalStorage())
    vi.resetModules()
  })

  it('engine を読み込むと、明かり/色の保存（rig）だけが消され、MIDI割当は消されない', async () => {
    localStorage.setItem(RIG_KEY, JSON.stringify({ st: { master: 0.5 } }))
    localStorage.setItem(MAP_KEY, JSON.stringify({ masterMidi: 7, fxMidi: { chase: 36 } }))
    await import('./engine')
    expect(localStorage.getItem(RIG_KEY)).toBeNull() // 明かりは引きずらない
    expect(localStorage.getItem(MAP_KEY)).not.toBeNull() // 割当は残る
    expect(JSON.parse(localStorage.getItem(MAP_KEY)!)).toEqual({
      masterMidi: 7,
      fxMidi: { chase: 36 }
    })
  })

  it('clearSavedMidiMap() で割当を消せる', async () => {
    localStorage.setItem(MAP_KEY, JSON.stringify({ masterMidi: 7 }))
    const { clearSavedMidiMap } = await import('./engine')
    clearSavedMidiMap()
    expect(localStorage.getItem(MAP_KEY)).toBeNull()
  })

  it('localStorage が使えない環境でも読み込みで落ちない', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('no storage')
      },
      setItem: () => {
        throw new Error('no storage')
      },
      removeItem: () => {
        throw new Error('no storage')
      }
    } as unknown as Storage)
    await expect(import('./engine')).resolves.toBeDefined()
  })
})
