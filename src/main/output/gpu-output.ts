// GPU直結出力（2026-07-14 設計書: docs/superpowers/specs/2026-07-14-gpu-output-design.md）。
// 見えない offscreen ウィンドウ(?syphon-output)が出力の絵だけを描き、Chromium の paint が渡す
// IOSurface をコピーなしで Syphon へ publish する。従来の「毎コマ getImageData→IPC」の
// CPUコピー(3840で毎秒約2GB)が消える＝高精細でも60fpsが物理的に可能になる。
// Mac + Syphon が使える時だけ動く。死んだら自動で従来(互換)経路へ戻る（use-chart-output が再開）。
import { BrowserWindow, screen } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import type { OutputPublisher, PaintTextureInfo } from './syphon-publisher'

let win: BrowserWindow | null = null
let paused = false // 画像照明モード中＝編集側がCPU経路でILを出すのでチャートは黙る
let active = false
let onActiveChange: ((active: boolean) => void) | null = null
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

export function isGpuOutputPaused(): boolean {
  return paused
}

export function setGpuOutputPaused(v: boolean): void {
  if (paused === v) return
  paused = v
  // 一時停止中は出力窓の描画も止める（画像照明モード中にチャートを裏で60fps描いて
  // 本丸と資源を奪い合わない・レビュー指摘）。解除時は窓側が即1コマ描き直す。
  sendToGpuOutput('output:pause', v)
  // 一時停止中は paint が止まるのが正常＝見張り番の起点をリセットして誤発火を防ぐ
  lastPaintAt = Date.now()
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
  setActive(false)
  if (w && !w.isDestroyed()) w.destroy()
}

/** チャートの GPU 直結出力を開始する。Mac + Syphon 利用可の時だけ実際に動く。 */
export function startGpuChartOutput(
  publisher: OutputPublisher,
  opts: {
    /** 出力窓の準備ができた時に最新状態(チャート等)を流し込む。 */
    onReady: (wc: Electron.WebContents) => void
    onActive: (active: boolean) => void
  }
): void {
  if (process.platform !== 'darwin' || !publisher.available) return
  if (win && !win.isDestroyed()) return
  onActiveChange = opts.onActive
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
        offscreen: { useSharedTexture: true }
      }
    })
  } catch (e) {
    fallback('offscreen ウィンドウを作れない: ' + String(e))
    return
  }
  const wc = win.webContents
  wc.setFrameRate(60)
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
      if (!paused) {
        // 奇数サイズ等で絵が desired より +1px 大きい時は desired に切って出す（レビュー指摘）
        publisher.publishSurface(info, desiredW, desiredH)
        publishErrors = 0
      }
    } catch (err) {
      if (++publishErrors <= 3) console.error('[gpu-output] publish 失敗:', err)
      if (publishErrors >= 10) fallback('publishSurfaceHandle が連続失敗')
    } finally {
      tex.release() // 🔴 同時に持てる枚数に上限あり＝必ず即返す
    }
  })
  // 見張り番: 生きているはずなのに paint が来ない＝出力が黙って凍る故障（レビュー指摘・
  // 設計書の「paintが来なくなったら互換へ」）。出力窓は静止中も30fpsで描き直すので、
  // 健全なら paint は流れ続ける（一時停止中だけ止まるのが正常＝pausedでは見ない）。
  lastPaintAt = Date.now()
  watchdog = setInterval(() => {
    if (!win || win.isDestroyed() || paused || !active) return
    if (Date.now() - lastPaintAt > 6000) fallback('paint が6秒来ない（出力凍結の疑い）')
  }, 2000)
  wc.on('render-process-gone', (_e, d) => fallback('描画プロセス消滅: ' + d.reason))
  wc.on('did-fail-load', (_e, code, desc) => fallback(`読み込み失敗: ${code} ${desc}`))
  wc.on('did-finish-load', () => {
    applySize() // ズームはロードごとにリセットされるのでここで掛ける
    wc.send('output:pause', paused) // ロード中に届いた一時停止を取りこぼさない
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
  setActive(false)
  if (w && !w.isDestroyed()) w.destroy()
}
