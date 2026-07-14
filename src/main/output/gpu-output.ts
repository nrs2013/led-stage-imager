// GPU直結出力（2026-07-14 設計書: docs/superpowers/specs/2026-07-14-gpu-output-design.md）。
// 見えない offscreen ウィンドウ(?syphon-output)が出力の絵だけを描き、Chromium の paint が渡すフレームを
// 従来の「毎コマ getImageData→IPC」のCPUコピー(3840で毎秒約2GB)なしで送る＝高精細でも高fpsが可能。
//  - Mac: useSharedTexture=true＝IOSurface をゼロコピーで Syphon へ（最速）。
//  - Windows/Linux: NDI は CPU の BGRA が要る＝useSharedTexture=false（ソフトOSR）で paint の
//    NativeImage(toBitmap=BGRA)を sendNdiFrame へ。隠し窓はpaintを間引くので invalidate で毎コマ促す。
//    実測(Mac代理): 3840で56fps・toBitmap 4ms＝従来Windows経路(3840で約22fps)を大きく上回る。
// 死んだら自動で従来(互換)経路へ戻る（editor が publishFrame を再開する）。
import { BrowserWindow, screen } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import type { OutputPublisher, PaintTextureInfo } from './syphon-publisher'
import { sendNdiFrame, getNdiDirectStatus } from './ndi-direct'

// ソフトウェアOSR経路を使うか。Mac は Syphon ゼロコピー、それ以外(Windows/Linux)は NDI へCPU送出。
// GPU_OSR_SOFT=1 で Mac でも強制（代理実測用）。
const SOFT_OSR = process.platform !== 'darwin' || process.env.GPU_OSR_SOFT === '1'
let softInvalidate: ReturnType<typeof setInterval> | null = null // ソフトOSRの paint 強制発火タイマー

let win: BrowserWindow | null = null
// 出力窓が今どちらの絵を描くか。chart=電飾チャート（自走）／imagelight=画像照明（編集側が
// il:sync-frame で駆動）。フェーズ2で「IL中はチャートを黙らせる(paused)」から置き換え。
let mode: 'chart' | 'imagelight' = 'chart'
let active = false
// 画像照明モードで出力窓が「実絵を1枚描いた」か。false の間は Syphon へ publish せず、編集側の
// 従来(CPU)フレームを本番にする＝モード切替/公演読込中に出力が黒く落ちない（レビュー指摘 finding14）。
// chart モードは自走で即座に絵が出るので ready 判定は使わない（常に publish）。
let outputReady = false
let onActiveChange: ((active: boolean) => void) | null = null
let onReadyChange: ((ready: boolean) => void) | null = null
let publishErrors = 0 // 連続失敗カウント。ネイティブ側の異常で無限にログを吐かないため
let sizeLogged = false
let desiredW = 1920 // 出力解像度＝チャートのキャンバスサイズ（renderer から追従要求が来る）
let desiredH = 1080
let lastPaintAt = 0 // 見張り番: paint が黙って止まる故障（出力凍結）を検知する起点
let watchdog: ReturnType<typeof setInterval> | null = null

/** Retina 補正: OSR は主ディスプレイの倍率(例:2)で描く＝窓1920に対して絵が3840になる。
 *  enableDeviceEmulation では変わらない（実測）。窓を「出力解像度÷倍率」で作り、ページズームを
 *  1/倍率にする＝レイアウトは元の大きさのまま・絵のピクセル数がぴったり出力解像度になる。 */
function applySize(): void {
  if (!win || win.isDestroyed()) return
  const dsf = screen.getPrimaryDisplay()?.scaleFactor || 1
  const cw = Math.round(desiredW / dsf)
  const ch = Math.round(desiredH / dsf)
  if (cw * dsf !== desiredW || ch * dsf !== desiredH)
    console.warn(
      `[gpu-output] 出力 ${desiredW}x${desiredH} は画面倍率 ${dsf} で割り切れない＝±1px の誤差が出る`
    )
  sizeLogged = false // サイズ変更後の paint サイズをもう一度記録
  win.setContentSize(cw, ch)
  win.webContents.setZoomFactor(1 / dsf)
}

export function isGpuOutputActive(): boolean {
  return active
}

export function getGpuOutputMode(): 'chart' | 'imagelight' {
  return mode
}

export function setGpuOutputMode(m: 'chart' | 'imagelight'): void {
  if (mode === m) return
  mode = m
  setReady(false) // 新モードはまだ実絵を描いていない＝readyまでCPUを本番に
  // 窓側はモードに応じて描き手を切替（チャート描画とIL描画を同時に走らせない＝資源の奪い合い防止）
  sendToGpuOutput('output:mode', m)
  // 切替直後の paint 空白は正常＝見張り番の起点をリセットして誤発火を防ぐ
  lastPaintAt = Date.now()
}

export function isGpuOutputReady(): boolean {
  return outputReady
}

/** 出力窓が実絵を1枚描いた合図（renderer の 'il:output-ready' 経由）。 */
export function markGpuOutputReady(): void {
  setReady(true)
}

function setReady(v: boolean): void {
  if (outputReady === v) return
  outputReady = v
  onReadyChange?.(v)
}

function setActive(v: boolean): void {
  if (active === v) return
  active = v
  onActiveChange?.(v)
}

/** 落ちた/作れなかった時＝GPU経路を諦めて互換経路へ（editor の use-chart-output が自動再開）。 */
function fallback(reason: string): void {
  console.warn('[gpu-output] 互換経路へフォールバック:', reason)
  const w = win
  win = null
  if (watchdog) {
    clearInterval(watchdog)
    watchdog = null
  }
  if (softInvalidate) {
    clearInterval(softInvalidate)
    softInvalidate = null
  }
  setActive(false)
  if (w && !w.isDestroyed()) w.destroy()
}

/** GPU 直結出力を開始する。Mac は Syphon 利用可の時、Windows/Linux は NDI 送信機がある時に動く。 */
export function startGpuChartOutput(
  publisher: OutputPublisher,
  opts: {
    /** 出力窓の準備ができた時に最新状態(チャート等)を流し込む。 */
    onReady: (wc: Electron.WebContents) => void
    onActive: (active: boolean) => void
    /** 画像照明の「実絵が出た/まだ」の変化を全画面へ通知（編集側のCPU本番切替に使う）。 */
    onReadyChange: (ready: boolean) => void
  }
): void {
  // Mac=Syphon が使えること。Windows/Linux=NDI 送信機が立っていること（無ければ出力窓を作らず
  // 従来の editor→publishFrame→sendNdiFrame 経路に任せる）。
  const macSyphon = process.platform === 'darwin' && publisher.available
  const softNdi = process.platform !== 'darwin' && getNdiDirectStatus().active
  if (!macSyphon && !softNdi) return
  if (win && !win.isDestroyed()) return
  onActiveChange = opts.onActive
  onReadyChange = opts.onReadyChange
  setReady(false) // 新しい窓＝まだ実絵なし
  try {
    win = new BrowserWindow({
      show: false,
      width: 1920,
      height: 1080,
      frame: false,
      transparent: true, // チャート出力は透過黒＋加算＝アルファを殺さない
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: false,
        backgroundThrottling: false,
        offscreen: SOFT_OSR ? { useSharedTexture: false } : { useSharedTexture: true }
      }
    })
  } catch (e) {
    fallback('offscreen ウィンドウを作れない: ' + String(e))
    return
  }
  const wc = win.webContents
  wc.setFrameRate(60)
  if (SOFT_OSR) {
    // ソフトOSR: paint が CPU ビットマップ(NativeImage・BGRA)を渡す＝そのまま NDI へ（並べ替え不要）。
    // Windows/Linux の本番経路。Mac では GPU_OSR_SOFT=1 の代理実測でのみここに来る。
    let pn = 0
    let pfps = Date.now()
    wc.on('paint', (_e, _dirty, image) => {
      lastPaintAt = Date.now()
      try {
        // 画像照明モードは実絵が出るまで（!ready）は編集側CPUが本番＝ここでは送らない（黒落ち防止）。
        if (mode !== 'imagelight' || outputReady) {
          const s = image.getSize()
          // desired と食い違う退化/過渡フレームは送らない（受け手の解像度が暴れないよう）。
          if (s.width === desiredW && s.height === desiredH) {
            sendNdiFrame(s.width, s.height, image.toBitmap(), true) // true=BGRA
          }
        }
        publishErrors = 0
      } catch (err) {
        if (++publishErrors <= 3) console.error('[gpu-output] NDI送出失敗:', err)
        if (publishErrors >= 10) fallback('NDI送出が連続失敗')
      }
      if (Date.now() - pfps > 5000) {
        console.log(`[gpu-output] NDI ${(pn / ((Date.now() - pfps) / 1000)).toFixed(1)}fps @${desiredW}x${desiredH}`)
        pn = 0
        pfps = Date.now()
      }
      pn++
    })
    // 隠し(show:false)のソフトOSRは damage があっても paint を大幅に間引く（実測1fps）。
    // invalidate() で毎コマ強制発火させて 60fps を引き出す（実測: これで 3840=56fps）。
    softInvalidate = setInterval(() => {
      if (win && !win.isDestroyed()) win.webContents.invalidate()
    }, 1000 / 60)
  } else {
    wc.on('paint', (e) => {
      const tex = (e as { texture?: Electron.OffscreenSharedTexture }).texture
      if (!tex) return
      lastPaintAt = Date.now()
      try {
        const info = tex.textureInfo as unknown as PaintTextureInfo
        if (!sizeLogged) {
          // Retina倍率の罠チェック: OSR が窓サイズと違う大きさで描いていないか一度だけ記録
          sizeLogged = true
          const [w, h] = win && !win.isDestroyed() ? win.getContentSize() : [0, 0]
          const fmt = (info as unknown as { pixelFormat?: string }).pixelFormat ?? '?'
          console.log(
            `[gpu-output] paint ${info.codedSize.width}x${info.codedSize.height} ${fmt} (窓 ${w}x${h})`
          )
        }
        // 画像照明モードで「まだ実絵が出ていない」間は publish しない＝この間は編集側のCPUフレームが
        // 本番（黒落ち防止・finding14）。ready後 or chartモードは常に publish。退化フレーム（暗転）は
        // ready後なら透明を出す＝正しく暗転する。
        if (mode !== 'imagelight' || outputReady) {
          // 奇数サイズ等で絵が desired より +1px 大きい時は desired に切って出す（レビュー指摘）
          publisher.publishSurface(info, desiredW, desiredH)
        }
        publishErrors = 0
      } catch (err) {
        if (++publishErrors <= 3) console.error('[gpu-output] publish 失敗:', err)
        if (publishErrors >= 10) fallback('publishSurfaceHandle が連続失敗')
      } finally {
        tex.release() // 🔴 同時に持てる枚数に上限あり＝必ず即返す
      }
    })
  }
  // 見張り番: 生きているはずなのに paint が来ない＝出力が黙って凍る故障（レビュー指摘・
  // 設計書の「paintが来なくなったら互換へ」）。チャートは30fps自走・画像照明は編集側の
  // 毎フレーム駆動＋静止中2Hz心拍＝健全なら paint は必ず流れ続ける（静止16.9fps実測）。
  lastPaintAt = Date.now()
  watchdog = setInterval(() => {
    if (!win || win.isDestroyed() || !active) return
    if (Date.now() - lastPaintAt > 6000) fallback('paint が6秒来ない（出力凍結の疑い）')
  }, 2000)
  wc.on('render-process-gone', (_e, d) => fallback('描画プロセス消滅: ' + d.reason))
  wc.on('did-fail-load', (_e, code, desc) => fallback(`読み込み失敗: ${code} ${desc}`))
  wc.on('did-finish-load', () => {
    applySize() // ズームはロードごとにリセットされるのでここで掛ける
    wc.send('output:mode', mode) // ロード中に届いたモード切替を取りこぼさない
    lastPaintAt = Date.now() // ロード直後の猶予（見張り番の誤発火防止）
    setActive(true)
    opts.onReady(wc)
  })
  // 出力窓のコンソールは main のログへ（見えない窓のエラーを黙らせない）
  wc.on('console-message', (ev) => {
    if (ev.level === 'error') console.error('[gpu-output/renderer]', ev.message)
  })
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'] + '?syphon-output')
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), { search: 'syphon-output' })
  }
}

/** 出力窓の絵のピクセル数＝出力解像度。チャートのキャンバスサイズに合わせて renderer から要求される。 */
export function resizeGpuOutput(w: number, h: number): void {
  if (!win || win.isDestroyed()) return
  if (!(w >= 1 && h >= 1 && w <= 16384 && h <= 16384)) {
    // 黙って無視すると左上クロップの絵を出し続ける（レビュー指摘）＝描ける互換経路へ譲る
    fallback(`出力サイズ ${w}x${h} は GPU 経路の上限外`)
    return
  }
  if (w === desiredW && h === desiredH) return
  desiredW = w
  desiredH = h
  applySize()
}

/** 出力窓へ IPC を送る（chart:update / manual:update 等の転送用）。 */
export function sendToGpuOutput(channel: string, ...args: unknown[]): void {
  if (win && !win.isDestroyed() && !win.webContents.isDestroyed())
    win.webContents.send(channel, ...args)
}

export function stopGpuOutput(): void {
  const w = win
  win = null
  if (watchdog) {
    clearInterval(watchdog)
    watchdog = null
  }
  if (softInvalidate) {
    clearInterval(softInvalidate)
    softInvalidate = null
  }
  setActive(false)
  if (w && !w.isDestroyed()) w.destroy()
}
