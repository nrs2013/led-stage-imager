import { useEffect, useMemo, useRef } from 'react'
import { ImageLightEngine, type LiveFrame } from '../imagelight/engine'

interface DecorApi {
  onIlSyncShow?: (
    cb: (p: { json: string; media: { file: string; dataUrl: string }[] | null }) => void
  ) => (() => void) | void
  onIlSyncFrame?: (cb: (f: unknown) => void) => (() => void) | void
  gpuOutputResize?: (w: number, h: number) => void
}
const getApi = (): DecorApi | undefined => (window as unknown as { api?: DecorApi }).api

/** GPU直結出力の見えない窓の「画像照明モード」側。編集ウィンドウから
 *  公演（il:sync-show＝重い・変化時だけ）と LiveFrame（il:sync-frame＝毎フレーム）を受け、
 *  自前の ImageLightEngine で同じ絵を描く。Syphon への送出は main が paint をゼロコピーで行う。
 *  readOutputRGBA は一切呼ばない＝これがフェーズ2の眼目（設計書 2026-07-14-gpu-output-design.md）。 */
export function GpuILOutputView(): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const engine = useMemo(() => {
    const e = new ImageLightEngine()
    // この窓は絵を吸い出さない（paintのIOSurfaceがそのままSyphonへ行く）＝出力合成をGPUに
    // 任せる。CPUキャンバスだと3840は1コマ30-45ms＝22fps上限（実測）。最初の描画前に設定必須。
    e.outReadback = false
    return e
  }, [])

  useEffect(() => {
    const cv = canvasRef.current
    if (!cv) return
    const ctx = cv.getContext('2d')!
    const api = getApi()
    // 公演のメディア（写真/動画のdataURL）は「変わった時だけ」届く＝届かない間はこれを使い回す
    let mediaCache: Record<string, string> = {}
    let lastW = 0
    let lastH = 0
    const blit = (): void => {
      // 出力の絵(outCv)を窓のキャンバスへ1:1で転写（GPU間コピー・読み出しなし）
      const w = engine.outW
      const h = engine.outH
      if (w <= 16 || h <= 16) return // 写真なし/無灯の退化フレームは窓サイズを触らない
      if (cv.width !== w) cv.width = w
      if (cv.height !== h) cv.height = h
      if (w !== lastW || h !== lastH) {
        lastW = w
        lastH = h
        api?.gpuOutputResize?.(w, h) // 窓の絵のピクセル数＝出力解像度に追従
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, w, h)
      ctx.drawImage(engine.outCv, 0, 0)
    }
    const offShow = api?.onIlSyncShow?.((p) => {
      if (p.media) {
        mediaCache = {}
        for (const m of p.media) mediaCache[m.file] = m.dataUrl
      }
      void engine.restoreShow(p.json, mediaCache).then(() => blit())
    })
    // 最新コマだけ描く（コアレッシング）: 着信が処理より速い時、全コマを律儀に描くと
    // 行列が無限に伸びて遅延が増え続ける。pending に最新を上書きし、処理は常に最新1コマ＝
    // 追いつける時は全コマ描き（60fps素通し）、追いつけない時は自然に間引く。
    let pending: LiveFrame | null = null
    let draining = false
    // 常設の性能診断（5秒ごと・console.error→mainのログに出る＝現場での切り分け用）
    let perfN = 0
    let perfIn = 0
    let perfMs = 0
    let perfAt = performance.now()
    const drain = (): void => {
      const f = pending
      pending = null
      if (f) {
        try {
          const t0 = performance.now()
          engine.applyLiveFrame(f)
          blit()
          perfMs += performance.now() - t0
          perfN++
          if (performance.now() - perfAt > 5000) {
            console.error(
              `[gpu-il perf] 着信${(perfIn / ((performance.now() - perfAt) / 1000)).toFixed(1)}fps 描画${(perfN / ((performance.now() - perfAt) / 1000)).toFixed(1)}fps apply+blit平均${(perfMs / Math.max(1, perfN)).toFixed(1)}ms`
            )
            perfN = 0
            perfIn = 0
            perfMs = 0
            perfAt = performance.now()
          }
        } catch (err) {
          console.error('[gpu-il-output] frame apply failed', err)
        }
      }
      // apply 中に届いた分（キュー済みIPCが先に走って pending を更新している）を続けて描く
      if (pending) setTimeout(drain, 0)
      else draining = false
    }
    const offFrame = api?.onIlSyncFrame?.((f) => {
      perfIn++
      pending = f as LiveFrame
      if (!draining) {
        draining = true
        setTimeout(drain, 0)
      }
    })
    return () => {
      offShow?.()
      offFrame?.()
    }
  }, [engine])

  // 背景は塗らない: outCv のアルファ（従来 readOutputRGBA が事前乗算で運んでいた透明度）を
  // そのまま Chromium の合成に通す＝互換経路とピクセル一致させる
  return <canvas ref={canvasRef} style={{ display: 'block' }} />
}
