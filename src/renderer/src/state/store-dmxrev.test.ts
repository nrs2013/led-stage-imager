import { describe, it, expect, beforeEach } from 'vitest'
import { useStore } from './store'

/** dmxRev = 卓の値が「実際に変わった」フレームだけ進むカウンタ。
 *  描画ループはこれを見て「変化時だけ即描画・無変化は30fps維持」する。 */
describe('dmxRev（変化時だけ進む）', () => {
  beforeEach(() => {
    useStore.setState({ dmxByUniverse: {}, lastSeenByUniverse: {}, dmxRev: 0 })
  })

  it('初めて来た値は変化＝進む', () => {
    const r0 = useStore.getState().dmxRev
    useStore.getState().setUniverseDataBatch([[0, new Uint8Array([1, 2, 3])]])
    expect(useStore.getState().dmxRev).toBe(r0 + 1)
  })

  it('同じ値の再送では進まない（卓の44Hz keepalive で負荷を増やさない）', () => {
    useStore.getState().setUniverseDataBatch([[0, new Uint8Array([1, 2, 3])]])
    const r1 = useStore.getState().dmxRev
    useStore.getState().setUniverseDataBatch([[0, new Uint8Array([1, 2, 3])]])
    expect(useStore.getState().dmxRev).toBe(r1)
  })

  it('1バイトでも違えば進む', () => {
    useStore.getState().setUniverseDataBatch([[0, new Uint8Array([1, 2, 3])]])
    const r1 = useStore.getState().dmxRev
    useStore.getState().setUniverseDataBatch([[0, new Uint8Array([1, 2, 9])]])
    expect(useStore.getState().dmxRev).toBe(r1 + 1)
  })

  it('複数ユニバースのどれか1つでも変われば進む', () => {
    useStore.getState().setUniverseDataBatch([
      [0, new Uint8Array([1])],
      [1, new Uint8Array([2])]
    ])
    const r1 = useStore.getState().dmxRev
    useStore.getState().setUniverseDataBatch([
      [0, new Uint8Array([1])], // 据え置き
      [1, new Uint8Array([5])] // 変化
    ])
    expect(useStore.getState().dmxRev).toBe(r1 + 1)
  })

  it('全ユニバース据え置きなら進まない', () => {
    useStore.getState().setUniverseDataBatch([
      [0, new Uint8Array([1])],
      [1, new Uint8Array([2])]
    ])
    const r1 = useStore.getState().dmxRev
    useStore.getState().setUniverseDataBatch([
      [0, new Uint8Array([1])],
      [1, new Uint8Array([2])]
    ])
    expect(useStore.getState().dmxRev).toBe(r1)
  })
})
