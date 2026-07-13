import { useEffect, useRef } from 'react'
import { useStore } from '../state/store'
import { OutputRenderer } from './OutputRenderer'
import { effectiveDmxByUniverse } from '../dmx/resolve'
import type { Chart } from '../model/types'

interface DecorApi {
  onChartUpdate?: (cb: (chart: unknown) => void) => (() => void) | void
  onManualUpdate?: (cb: (m: unknown) => void) => (() => void) | void
  gpuOutputResize?: (w: number, h: number) => void
}
const getApi = (): DecorApi | undefined => (window as unknown as { api?: DecorApi }).api

const FPS = 30
const INTERVAL = 1000 / FPS

/** GPU直結出力の「見えない出力専用窓」（?syphon-output）の中身。チャートの出力の絵だけを
 *  1:1ピクセルで描く。Syphon への送出はここではなく main が paint(IOSurface) を
 *  publishSurfaceHandle へゼロコピーで渡す（設計書: 2026-07-14-gpu-output-design.md）。
 *  描画の作法は use-chart-output と同じ（30fpsハートビート＋卓の値変化で最短60fps）。
 *  getImageData / publishFrame は一切しない＝これがこの工事の眼目。 */
export function GpuOutputView(): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // 透過が命: チャート出力は透過黒＋加算。背景が黒で塗られるとアルファが死ぬ。
  useEffect(() => {
    document.documentElement.style.background = 'transparent'
    document.body.style.background = 'transparent'
  }, [])

  // 編集ウィンドウから状態を受け取る（chart:update は LiveView と同じ・manual は TESTフェーダー）
  useEffect(() => {
    const api = getApi()
    const offChart = api?.onChartUpdate?.((chart) => useStore.getState().setChart(chart as Chart))
    const offManual = api?.onManualUpdate?.((m) => {
      const v = m as { on?: boolean; byFixture?: Record<string, [number, number, number]> } | null
      useStore.setState({ manualMode: !!v?.on, manualByFixture: v?.byFixture ?? {} })
    })
    return () => {
      offChart?.()
      offManual?.()
    }
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const renderer = new OutputRenderer(canvas)
    let lastErrLog = 0
    let lastTickAt = 0
    let lastW = 0
    let lastH = 0
    const tick = (): void => {
      lastTickAt = performance.now()
      // 1フレームの例外で出力が本番中ずっと固まらないよう、毎フレーム握って次へ進む。
      try {
        const st = useStore.getState()
        const { chart, dmxByUniverse } = st
        if (chart.canvas.w <= 0 || chart.canvas.h <= 0) return // 退化フレームはスキップ
        // 窓サイズ＝出力解像度。チャートのキャンバスサイズに追従させる（mainが窓をリサイズ）。
        if (chart.canvas.w !== lastW || chart.canvas.h !== lastH) {
          lastW = chart.canvas.w
          lastH = chart.canvas.h
          getApi()?.gpuOutputResize?.(lastW, lastH)
        }
        const dmx = effectiveDmxByUniverse(
          dmxByUniverse,
          st.lastSeenByUniverse,
          chart.settings.holdOnTimeout,
          Date.now()
        )
        renderer.render(chart, dmx, chart.settings.gamma, st.manualMode ? st.manualByFixture : null)
      } catch (err) {
        const now = Date.now()
        if (now - lastErrLog > 2000) {
          lastErrLog = now
          console.error('[gpu-output-view] render tick failed, skipping frame', err)
        }
      }
    }
    // setInterval（rAFでなく）＝見えない窓でも確実に回る（30fpsハートビート・信号ロス処理）。
    const iv = setInterval(() => {
      if (performance.now() - lastTickAt >= INTERVAL) tick()
    }, INTERVAL)
    // 卓の値が変わったら次の33ms枠を待たず即描画（最短~60fpsに制限）。
    // -4ms＝しきい値が1コマぴったりだと60Hz到着の揺らぎで拍がぶつかり実測40fps台に落ちる
    // （ImageLightingMode の描画ループで実証済みの対策・2026-07-08診断）。
    const unsub = useStore.subscribe((s, prev) => {
      if (s.dmxRev !== prev.dmxRev && performance.now() - lastTickAt >= 1000 / 60 - 4) tick()
    })
    tick()
    return () => {
      clearInterval(iv)
      unsub()
    }
  }, [])

  // 1:1ピクセル表示（キャンバスの実サイズは OutputRenderer.render が chart.canvas に合わせる）。
  return <canvas ref={canvasRef} style={{ display: 'block' }} />
}
