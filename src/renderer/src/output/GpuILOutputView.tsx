import { useEffect, useMemo, useRef } from 'react'
import { ImageLightEngine, type LiveFrame } from '../imagelight/engine'

interface DecorApi {
  onIlSyncShow?: (
    cb: (p: { json: string; media: { file: string; dataUrl: string }[] | null }) => void
  ) => (() => void) | void
  onIlSyncFrame?: (cb: (f: unknown) => void) => (() => void) | void
  gpuOutputResize?: (w: number, h: number) => void
  ilOutputReady?: () => void // 初回の実絵を描いた＝main へ「Syphon 送出を本番へ切替してよい」合図
  ilRequestShow?: () => void // pull型ハンドシェイク: マウント直後に「公演をもう一度くれ」
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
    let contentReady = false // 初回の実絵を描くまで false（それまで main は CPU を本番にする）
    const blit = (): void => {
      const w = engine.outW
      const h = engine.outH
      if (w <= 16 || h <= 16) {
        // 退化フレーム（暗転・写真なし・無灯）: キャンバスを透明化して paint を必ず起こす。
        // 互換経路が 16x9 透明を publish していたのと同じ＝Resolume では何も出ない（暗転）。
        // ここで早期 return して描かないと、暗転しても直前の明るい絵が Syphon に残り、
        // paint も止まって main の見張り番（6秒無paint）が誤発火して GPU 経路を殺す（レビュー指摘）。
        if (cv.width > 0 && cv.height > 0) ctx.clearRect(0, 0, cv.width, cv.height)
        return
      }
      if (cv.width !== w) cv.width = w
      if (cv.height !== h) cv.height = h
      if (w !== lastW || h !== lastH) {
        lastW = w
        lastH = h
        api?.gpuOutputResize?.(w, h) // 窓の絵のピクセル数＝出力解像度に追従
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, w, h)
      ctx.drawImage(engine.outCv, 0, 0) // 出力の絵(outCv)を1:1で転写（GPU間コピー・読み出しなし）
      if (!contentReady) {
        contentReady = true
        api?.ilOutputReady?.() // 実絵が出た＝main は Syphon 送出を CPU からこの窓へ切替してよい
      }
    }

    // --- 公演同期（il:sync-show）を直列化 ---
    // restoreShow は写真/動画のデコードで数秒かかることがある。前の復元が終わる前に次が来ると
    // 両方が scenes=[] してから交互に push＝シーン棚が壊れる（レビュー指摘）。実行中は最新1件だけ
    // 待たせて完了後に流す。
    let restorePending: string | null = null
    const runRestore = (json: string): void => {
      void engine
        .restoreShow(json, mediaCache)
        .catch((err) => console.error('[gpu-il-output] restore failed', err))
        .finally(() => {
          if (restorePending !== null) {
            const j = restorePending
            restorePending = null
            runRestore(j)
          } else {
            blit() // 復元後の絵を出す。溜まった LiveFrame は次の着信で反映される
            if (pending && !draining) {
              draining = true
              setTimeout(drain, 0)
            }
          }
        })
    }
    const offShow = api?.onIlSyncShow?.((p) => {
      if (p.media) {
        mediaCache = {}
        for (const m of p.media) mediaCache[m.file] = m.dataUrl
      }
      if (engine.restoring) restorePending = p.json // 進行中の復元と交錯させない
      else runRestore(p.json)
    })

    // --- LiveFrame: 最新1コマだけ描く（コアレッシング）。ただし events は落とさない ---
    // 着信＞処理の時に全コマ律儀に描くと行列が伸びて遅延が増え続けるので pending を上書き。
    // ただし単発発射イベント（炎など）は「状態」でなく「呼び出し」なので上書きで捨ててはいけない
    //（捨てると出力の炎が上がらない/消えない）＝新旧フレームの events を連結して持ち越す。
    let pending: LiveFrame | null = null
    let draining = false
    // 常設の性能診断（5秒ごと・console.error→mainのログに出る＝現場での切り分け用）
    let perfN = 0
    let perfIn = 0
    let perfMs = 0
    let perfAt = performance.now()
    const drain = (): void => {
      draining = false
      // 公演の復元中は applyLiveFrame が no-op（events を消す）＝適用せず、最後の絵を保持して
      // paint だけ起こす（見張り番の誤発火防止）。events は pending に貯めたまま復元後に反映。
      if (engine.restoring) {
        blit()
        return
      }
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
      if (pending) setTimeout(drain, 0)
    }
    const offFrame = api?.onIlSyncFrame?.((raw) => {
      perfIn++
      const f = raw as LiveFrame
      if (pending && pending.events.length) f.events = pending.events.concat(f.events) // events は捨てない
      pending = f
      if (!draining) {
        draining = true
        setTimeout(drain, 0)
      }
    })

    // pull型ハンドシェイク: 購読を張り終えた「後」に公演をくれと頼む＝マウントと初回同期が
    // レースして公演データが消えても回復する（chart 側の gpuOutputHello と同型）。
    api?.ilRequestShow?.()

    return () => {
      offShow?.()
      offFrame?.()
      // 🔴 出力窓は長寿命（chart⇄imagelight の往復ごとに new される）。dispose しないと WebGL
      //   コンテキスト(炎/煙)が溜まって上限で特効が描けなくなり、動画が裏で再生し続け、
      //   ObjectURL が永久リークする（レビュー指摘・編集側と同じ後始末をする）。
      engine.disposeMedia()
    }
  }, [engine])

  // 背景は塗らない: outCv のアルファ（従来 readOutputRGBA が事前乗算で運んでいた透明度）を
  // そのまま Chromium の合成に通す＝互換経路とピクセル一致させる
  return <canvas ref={canvasRef} style={{ display: 'block' }} />
}
