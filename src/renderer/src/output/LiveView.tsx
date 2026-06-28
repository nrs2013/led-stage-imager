import { useEffect, useRef } from 'react'
import { useStore } from '../state/store'
import { OutputRenderer } from './OutputRenderer'
import { effectiveDmxByUniverse } from '../dmx/resolve'
import { C, F } from '../ui/tokens'

interface DecorApi {
  publishFrame?: (width: number, height: number, buffer: Uint8ClampedArray) => void
}

const FPS = 30
const INTERVAL = 1000 / FPS

/** Live output view. `publish` controls whether frames go to Syphon (the editor window
 *  publishes; the fullscreen preview window mirrors with publish=false). `bare` hides chrome. */
export function LiveView({
  publish = true,
  bare = false
}: {
  publish?: boolean
  bare?: boolean
} = {}): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const renderer = new OutputRenderer(canvas)
    const api = (window as unknown as { api?: DecorApi }).api
    let lastErrLog = 0
    const tick = (): void => {
      // 1フレームの例外で出力(Syphon)が本番中ずっと固まらないよう、毎フレーム握って次へ進む。
      try {
        const st = useStore.getState()
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
        if (publish && api?.publishFrame) {
          api.publishFrame(chart.canvas.w, chart.canvas.h, renderer.readRGBA())
        }
      } catch (err) {
        const now = Date.now()
        if (now - lastErrLog > 2000) {
          lastErrLog = now
          console.error('[LiveView] render tick failed, skipping frame', err)
        }
      }
    }
    // setInterval (not requestAnimationFrame) so the Syphon output keeps publishing even
    // when the window is backgrounded / on a second display (rAF would be throttled/paused).
    const iv = setInterval(tick, INTERVAL)
    tick()
    return () => clearInterval(iv)
  }, [publish])

  return (
    <div
      style={{
        flex: 1,
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: C.canvas,
        overflow: 'hidden'
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          maxWidth: '100%',
          maxHeight: '100%',
          border: bare ? 'none' : `0.5px solid ${C.border}`
        }}
      />
      {!bare && (
        <div
          style={{
            position: 'absolute',
            top: 12,
            left: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            fontFamily: F.ui,
            fontSize: 11,
            color: C.label,
            background: 'rgba(15,14,13,0.85)',
            border: `0.5px solid ${C.border}`,
            borderRadius: 4,
            padding: '5px 10px'
          }}
        >
          <span style={{ color: C.amber }}>●</span>
          LIVE — Syphon Out: LED STAGE IMAGER
        </div>
      )}
    </div>
  )
}
