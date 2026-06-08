import { useEffect, useRef } from 'react'
import { useStore } from '../state/store'
import { OutputRenderer } from './OutputRenderer'
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
    let raf = 0
    let last = 0
    const loop = (t: number): void => {
      raf = requestAnimationFrame(loop)
      if (t - last < INTERVAL) return
      last = t
      const st = useStore.getState()
      const { chart, dmxByUniverse } = st
      renderer.render(
        chart,
        dmxByUniverse,
        chart.settings.gamma,
        st.manualMode ? st.manualByFixture : null
      )
      if (publish && api?.publishFrame) {
        api.publishFrame(chart.canvas.w, chart.canvas.h, renderer.readRGBA())
      }
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
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
        style={{ maxWidth: '100%', maxHeight: '100%', border: bare ? 'none' : `0.5px solid ${C.border}` }}
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
          LIVE — Syphonソース「DECOR STUDIO」を出力中
        </div>
      )}
    </div>
  )
}
