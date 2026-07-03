import { useEffect } from 'react'
import { useStore } from './store'

interface DmxPacket {
  universe: number
  sequence: number
  data: Uint8Array | number[]
}
interface DecorApi {
  onDmx?: (cb: (pkt: DmxPacket) => void) => (() => void) | void
  onArtnetStatus?: (cb: (st: { ok: boolean; detail: string }) => void) => (() => void) | void
}

/** Subscribes to Art-Net packets forwarded from the main process and feeds the store.
 *  No-op in a plain browser (window.api absent).
 *  🔴 反映は描画1フレームに1回へまとめる：実際の卓は無変化でも全ユニバースを約44回/秒
 *  流し続けるので、パケット毎に setState すると（各IPC＝別タスクで React のまとめ描きも
 *  効かず）パッチ表など画面全体が毎パケット再描画されて固まる。 */
export function useDmxBridge(): void {
  useEffect(() => {
    const api = (window as unknown as { api?: DecorApi }).api
    if (!api?.onDmx) return
    const pending = new Map<number, Uint8Array>() // universe → 最新データ（同フレーム内は最後勝ち）
    let raf = 0
    const flush = (): void => {
      raf = 0
      if (pending.size === 0) return
      const entries = Array.from(pending.entries())
      pending.clear()
      useStore.getState().setUniverseDataBatch(entries)
    }
    const off = api.onDmx((pkt) => {
      const data = pkt.data instanceof Uint8Array ? pkt.data : Uint8Array.from(pkt.data)
      pending.set(pkt.universe, data)
      if (!raf) raf = requestAnimationFrame(flush)
    })
    const offStatus = api.onArtnetStatus?.((st) =>
      useStore.getState().setArtnetError(st.ok ? null : st.detail)
    )
    return () => {
      off?.() // StrictMode/HMR で二重登録されないよう購読を解除
      offStatus?.()
      if (raf) cancelAnimationFrame(raf)
    }
  }, [])
}
