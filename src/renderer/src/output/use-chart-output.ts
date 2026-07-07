import { useEffect } from 'react'
import { useStore } from '../state/store'
import { OutputRenderer } from './OutputRenderer'
import { effectiveDmxByUniverse } from '../dmx/resolve'

interface DecorApi {
  publishFrame?: (width: number, height: number, buffer: Uint8ClampedArray) => void
}

const FPS = 30
const INTERVAL = 1000 / FPS

/** 電飾（チャート）の Syphon/NDI 出力を常時流す（2026-07-07 のむさん決定＝Live廃止）。
 *  以前は「Live」画面を開いている間だけ出力していたが、照明モードと同じ
 *  「アプリが動いていれば常に出力」に統一。編集中の絵もそのまま外へ出る＝
 *  会場で隠したい時は Resolume 側でレイヤーを落とす運用。
 *  画像照明モード中は ImageLightingMode が自前で publish するため、こちらは黙る。 */
export function useChartOutput(): void {
  useEffect(() => {
    const canvas = document.createElement('canvas') // 表示しない出力専用キャンバス
    const renderer = new OutputRenderer(canvas)
    const api = (window as unknown as { api?: DecorApi }).api
    if (!api?.publishFrame) return // ブラウザ(UI確認用)では何もしない
    let lastErrLog = 0
    const tick = (): void => {
      // 1フレームの例外で出力が本番中ずっと固まらないよう、毎フレーム握って次へ進む。
      try {
        const st = useStore.getState()
        if (st.imageLight) return // 画像照明モードが publish 中＝二重出力しない
        const { chart, dmxByUniverse } = st
        if (chart.canvas.w <= 0 || chart.canvas.h <= 0) return // 退化フレームはスキップ
        // On Signal Loss: 信号が切れたユニバースを「保持」か「黒」かに（chart.settings.holdOnTimeout）
        const dmx = effectiveDmxByUniverse(
          dmxByUniverse,
          st.lastSeenByUniverse,
          chart.settings.holdOnTimeout,
          Date.now()
        )
        renderer.render(chart, dmx, chart.settings.gamma, st.manualMode ? st.manualByFixture : null)
        api.publishFrame!(chart.canvas.w, chart.canvas.h, renderer.readRGBA())
      } catch (err) {
        const now = Date.now()
        if (now - lastErrLog > 2000) {
          lastErrLog = now
          console.error('[chart-output] render tick failed, skipping frame', err)
        }
      }
    }
    // setInterval (rAFでなく)＝ウィンドウが裏や最小化でも出力が止まらない
    const iv = setInterval(tick, INTERVAL)
    tick()
    return () => clearInterval(iv)
  }, [])
}
