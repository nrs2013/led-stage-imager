import { app, shell, BrowserWindow, ipcMain, dialog, screen, Menu, session } from 'electron'
import { join, extname } from 'path'
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, renameSync, statSync } from 'fs'
import {
  writeFile as writeFileAsync,
  rename as renameAsync,
  unlink as unlinkAsync,
  readdir as readdirAsync,
  mkdir as mkdirAsync,
  stat as statAsync
} from 'fs/promises'
import { networkInterfaces } from 'os'
import { createServer } from 'http'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { ArtNetReceiver } from './artnet/artnet-receiver'
import type { ArtDmxPacket } from './artnet/artdmx-parser'
import { OutputPublisher } from './output/syphon-publisher'
import { startNdiBridge, stopNdiBridge, restartNdiBridge, getNdiStatus } from './output/ndi-bridge'
import {
  startNdiDirect,
  stopNdiDirect,
  sendNdiFrame,
  getNdiDirectStatus,
  resolveNdiLibPath
} from './output/ndi-direct'
import { startMidiInput, stopMidiInput, getMidiPorts } from './midi/midi-input'
import {
  startGpuChartOutput,
  stopGpuOutput,
  setGpuOutputMode,
  getGpuOutputMode,
  isGpuOutputActive,
  resizeGpuOutput,
  sendToGpuOutput
} from './output/gpu-output'

// Engine: Art-Net in (UDP 6454) is forwarded to the renderer, which renders the chart and
// sends frames back to be published on the "LED STAGE IMAGER" Syphon source.
const receiver = new ArtNetReceiver()
const publisher = new OutputPublisher()
let mainWindow: BrowserWindow | null = null
let previewWindow: BrowserWindow | null = null
let lastChart: unknown = null
let lastManual: unknown = null // TESTフェーダー状態（GPU出力窓へ初期同期するため保持）
let midiInputs: string[] = [] // renderer が検出した MIDI 入力ポート名（ステータスバー表示用）
let currentChartPath: string | null = null // 今開いている .ledimager のパス（⌘Sの上書き先）
// .ledshow の上書き先は renderer（実際に開けた公演を知っている側）が保存のたびに渡してくる。
// main が覚える方式は「開くのをキャンセルしたのに保存先だけ切り替わる」事故になるためやめた。
let pendingOpenPath: string | null = null // 起動直後などで、画面が出来たら開くべきファイル
let closeConfirmed = false // 「保存しますか？」確認が済んだら true＝そのまま閉じてよい
let lastArtnetStatus: { ok: boolean; detail: string } | null = null // 受信機の最終状態（画面へ再送用）

/**
 * 開発用「のぞき窓」（のむさん 2026-06-20）。127.0.0.1:7331 にローカル限定の小さなHTTPを立て、
 * renderer の window.__debug*（src/renderer/src/io/debug-bridge.ts）を executeJavaScript で呼んで返す：
 *   GET /state         … 今のデータ(JSON)            GET /snapshot.png … 今のキャンバスの絵(PNG)
 *   GET /logs          … 直近のコンソールログ
 * 画面を乗っ取らず内部を読むための窓口。localhost限定なので本番/友達配布でも無害（外から到達不可）。
 */
const DEBUG_PORT = 7331
function startDebugBridge(): void {
  try {
    const server = createServer((req, res) => {
      void (async (): Promise<void> => {
        const url = (req.url || '/').split('?')[0]
        res.setHeader('Access-Control-Allow-Origin', '*')
        const win = mainWindow
        if (!win || win.isDestroyed() || win.webContents.isLoading()) {
          res.writeHead(503)
          res.end('app window not ready')
          return
        }
        try {
          if (url.startsWith('/state')) {
            const s = await win.webContents.executeJavaScript(
              'window.__debugState ? window.__debugState() : "{}"'
            )
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
            res.end(typeof s === 'string' ? s : JSON.stringify(s))
          } else if (url.startsWith('/snapshot')) {
            const dataUrl: string = await win.webContents.executeJavaScript(
              'window.__debugSnapshot ? window.__debugSnapshot() : ""'
            )
            const m = /^data:image\/png;base64,(.+)$/.exec(dataUrl || '')
            if (!m) {
              res.writeHead(204)
              res.end()
              return
            }
            const buf = Buffer.from(m[1], 'base64')
            res.writeHead(200, { 'content-type': 'image/png', 'content-length': buf.length })
            res.end(buf)
          } else if (url.startsWith('/logs')) {
            const logs = await win.webContents.executeJavaScript(
              'window.__debugLogs ? window.__debugLogs() : ""'
            )
            res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
            res.end(String(logs))
          } else {
            res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
            res.end('LED STAGE IMAGER debug bridge\n/state\n/snapshot.png\n/logs')
          }
        } catch (e) {
          res.writeHead(500)
          res.end(String(e))
        }
      })()
    })
    server.on('error', (e) => console.log('[debug-bridge] not started:', String(e)))
    server.listen(DEBUG_PORT, '127.0.0.1', () =>
      console.log(`[debug-bridge] http://127.0.0.1:${DEBUG_PORT}  (/state /snapshot.png /logs)`)
    )
  } catch (e) {
    console.log('[debug-bridge] error:', String(e))
  }
}

function startEngine(): void {
  publisher.start('LED STAGE IMAGER')
  if (process.platform === 'darwin') {
    startNdiBridge('LED STAGE IMAGER') // Mac: 同梱 Syphon→NDI ブリッジを自動起動（実績経路）
  } else {
    // Windows 等: Syphon が無いので RGBA を直接 NDI 送信。NDIランタイムを探して使う。
    const ndiDir = join(process.resourcesPath, 'app.asar.unpacked', 'resources', 'ndi')
    const lib = resolveNdiLibPath(ndiDir)
    if (lib) startNdiDirect('LED STAGE IMAGER', lib)
    else console.warn('[ndi-direct] NDIランタイム未検出。NDI Tools か Resolume を入れると有効になります。')
  }
  receiver.on('dmx', (pkt: ArtDmxPacket) => {
    const msg = { universe: pkt.universe, sequence: pkt.sequence, data: pkt.data }
    broadcast('artnet:dmx', msg)
  })
  // CoreMIDI 直読みの MIDI 入力（Web MIDI が効かないため）。受信を renderer(engine) へ転送。
  startMidiInput((s, d1, d2) => {
    broadcast('midi:message', [s, d1, d2])
  })
  // 受信機の生死を画面へ通知（bind失敗＝ポート使用中などは今まで無言で死んでいた）。
  // 🔴 起動直後のエラーは画面がまだ無い時に起きる＝最後の状態を覚えておき、
  // 画面ができた時（did-finish-load）にも送り直す（下の createWindow 参照）。
  receiver.on('error', (err) => {
    console.error('[artnet] receiver error:', err)
    const msg = String((err as NodeJS.ErrnoException)?.code ?? err)
    lastArtnetStatus = { ok: false, detail: msg }
    broadcast('artnet:status', lastArtnetStatus)
  })
  receiver.on('listening', () => {
    lastArtnetStatus = { ok: true, detail: '' }
    broadcast('artnet:status', lastArtnetStatus)
  })
  receiver.start()
  console.log('[engine] Art-Net receiver (UDP 6454) + Syphon/NDI "LED STAGE IMAGER" started')
}

function stopEngine(): void {
  stopGpuOutput() // publisher より先に（破棄後の publish を出さない）
  receiver.stop()
  publisher.stop()
  stopNdiBridge()
  stopNdiDirect()
  stopMidiInput()
}

/** GPU直結出力を開始（Mac + Syphon 可の時だけ動く）。窓の準備ができたら最新状態を流し込み、
 *  生死は全画面へ通知＝editor 側の互換経路が自動で止まる/再開する。 */
function startGpu(): void {
  startGpuChartOutput(publisher, {
    onReady: (wc) => {
      if (lastChart) wc.send('chart:update', lastChart)
      if (lastManual) wc.send('manual:update', lastManual)
      // 画像照明モード中に出力窓が（再）起動した＝公演の再送を編集側へ頼む
      if (getGpuOutputMode() === 'imagelight' && mainWindow && !mainWindow.isDestroyed())
        mainWindow.webContents.send('il:resync')
    },
    onActive: (active) => broadcast('gpu-output:active', active)
  })
}

/** Fullscreen output preview on a second display (mirrors the editor's chart, no re-publish). */
function openPreview(): void {
  if (previewWindow && !previewWindow.isDestroyed()) {
    previewWindow.focus()
    return
  }
  const displays = screen.getAllDisplays()
  const target = displays[displays.length - 1]
  const b = target.bounds
  previewWindow = new BrowserWindow({
    x: b.x,
    y: b.y,
    width: b.width,
    height: b.height,
    frame: false,
    fullscreen: displays.length > 1,
    backgroundColor: '#000',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      backgroundThrottling: false
    }
  })
  // 本番出力ウィンドウでも window.open / target=_blank は新規ウィンドウを作らせず外部ブラウザへ。
  previewWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    previewWindow.loadURL(process.env['ELECTRON_RENDERER_URL'] + '?output&live')
  } else {
    previewWindow.loadFile(join(__dirname, '../renderer/index.html'), { search: 'output&live' })
  }
  previewWindow.webContents.on('did-finish-load', () => {
    if (lastChart && previewWindow && !previewWindow.isDestroyed() && !previewWindow.webContents.isDestroyed())
      previewWindow.webContents.send('chart:update', lastChart)
  })
  previewWindow.on('closed', () => {
    previewWindow = null
    mainWindow?.webContents.send('preview:active', false)
  })
  mainWindow?.webContents.send('preview:active', true)
}

function closePreview(): void {
  if (previewWindow && !previewWindow.isDestroyed()) previewWindow.close()
  previewWindow = null
}

/** ダブルクリックで開かれたファイルを読み込み、画面へ渡す。
 *  .ledimager（チャート・JSON）→ chart:open-path（⌘S の上書き先にも設定）。
 *  .ledshow（画像照明の公演・ZIP）→ imagelight:open-path（バイト列を渡す）。
 *  画面がまだ無い起動直後は pendingOpenPath に積み、did-finish-load で流す。 */
/** 全ウィンドウへ IPC 送信（破棄済みは飛ばす）。出力用の別窓を本番中に閉じた瞬間に届いた通知を、
 *  破棄済みの webContents に send して main プロセスごと落とす事故を防ぐ。 */
function broadcast(channel: string, ...args: unknown[]): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed() && !w.webContents.isDestroyed()) w.webContents.send(channel, ...args)
  }
}

function deliverOpenFile(p: string): void {
  const w = mainWindow
  const ready = w && !w.isDestroyed() && !w.webContents.isLoading()
  const isShow = p.toLowerCase().endsWith('.ledshow')
  // チャートの ⌘S 上書き先(currentChartPath)はここで eager に覚えない。renderer が「実際に開けた」時だけ
  // 'chart:opened' で確定する。ここで覚えると、開くのをキャンセル/読込失敗した後の ⌘S が、開こうと
  // した別ファイルを黙って上書きする事故になる（path を第2引数で渡す＝開けた時だけ確定に使う）。
  if (ready) {
    try {
      if (isShow) {
        w!.webContents.send('imagelight:open-path', { bytes: readFileSync(p), path: p })
      } else {
        w!.webContents.send('chart:open-path', readFileSync(p, 'utf8'), p)
      }
      if (w!.isMinimized()) w!.restore()
      w!.focus()
    } catch (err) {
      console.error('[open-file] 読み込み失敗:', err)
    }
    pendingOpenPath = null
  } else {
    pendingOpenPath = p
  }
}

// macOS: Finder でダブルクリック／Dock にドロップされたファイルはこのイベントで来る（起動前でも）。
app.on('open-file', (e, p) => {
  e.preventDefault()
  deliverOpenFile(p)
})
// Windows/Linux: ダブルクリック起動時はファイルパスが引数で来る（macOS は open-file 経由）。
if (process.platform !== 'darwin') {
  const arg = process.argv.find(
    (a) => a.toLowerCase().endsWith('.ledimager') || a.toLowerCase().endsWith('.ledshow')
  )
  if (arg && existsSync(arg)) pendingOpenPath = arg
}

// 二重起動防止：Windows では関連付けファイルのダブルクリックが「新しいプロセスの起動」で
// 届くため、ロックが無いとアプリが2個立ち上がる（6454二重bind＝DMXがどちらに届くか不定・
// NDI送信が2本・自動保存の潰し合い）。2個目は既存へファイルを回して即終了する。
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', (_e, argv) => {
    const p = argv.find(
      (a) => a.toLowerCase().endsWith('.ledimager') || a.toLowerCase().endsWith('.ledshow')
    )
    if (p && existsSync(p)) deliverOpenFile(p)
    const w = mainWindow
    if (w && !w.isDestroyed()) {
      if (w.isMinimized()) w.restore()
      w.focus()
    }
  })
}

/** 閉じる/終了の前に「保存されていない変更」を確認する（画像照明モードのみ対象）。
 *  renderer の window.__ilDirty / __ilSaveForClose を呼んで判断。1.5秒応答が無い時は
 *  安全側＝「未保存あり」とみなして確認ダイアログを出す（黙って閉じてデータを落とさない）。 */
let confirmRunning = false
let upgradeToQuit = false // 確認ダイアログ中に ⌘Q が来たら「閉じる」を「終了」に格上げする
async function confirmAndClose(kind: 'quit' | 'window'): Promise<void> {
  if (confirmRunning) {
    if (kind === 'quit') upgradeToQuit = true // ダイアログ応答後にちゃんと終了まで進める
    return
  }
  confirmRunning = true
  try {
    const w = mainWindow
    const finish = (): void => {
      closeConfirmed = true
      const doQuit = kind === 'quit' || upgradeToQuit
      upgradeToQuit = false
      if (doQuit) app.quit()
      else w?.close()
    }
    if (!w || w.isDestroyed()) return finish()
    // 無応答（固まり・確認中）は安全側＝「未保存あり」として扱う。勝手に閉じてデータを
    // 落とすより、ダイアログを1枚多く出す方がマシ（のむさんの最優先＝データ消失防止）。
    const dirty = await Promise.race([
      w.webContents.executeJavaScript('window.__ilDirty ? !!window.__ilDirty() : false', true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 1500))
    ]).catch(() => true)
    if (!dirty) return finish()
    if (w.isMinimized()) w.restore() // 最小化中はシートが見えず「終了できない」ように見えるため
    w.focus()
    let response = 1 // ダイアログ自体が出せない異常時は「保存せずに閉じる」（自動バックアップは有る）
    try {
      response = (
        await dialog.showMessageBox(w, {
          type: 'question',
          buttons: ['保存して閉じる', '保存せずに閉じる', 'キャンセル'],
          defaultId: 0,
          cancelId: 2,
          message: '保存されていない変更があります',
          detail:
            '公演ファイル(.ledshow)に保存してから閉じますか？\n（保存しなくても自動バックアップは残っています）'
        })
      ).response
    } catch {
      /* ウィンドウ破棄などでダイアログが出せない → 上の既定(保存せず閉じる)で進む */
    }
    if (response === 2) {
      upgradeToQuit = false // やめた＝格上げ予約も破棄
      return
    }
    if (response === 0) {
      // 保存ダイアログでのむさんが考える時間は待つが、画面が固まったままだと
      // confirmRunning が永遠に立ちっぱなしで二度と閉じられなくなるので上限10分。
      const ok = await Promise.race([
        w.webContents.executeJavaScript(
          'window.__ilSaveForClose ? window.__ilSaveForClose() : true',
          true
        ),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 10 * 60 * 1000))
      ]).catch(() => false)
      if (!ok) {
        upgradeToQuit = false // 中止＝⌘Q格上げの予約も破棄（次の「閉じる」で勝手に終了しない）
        return // 保存ダイアログでキャンセルした＝閉じるのも中止
      }
    }
    finish()
  } finally {
    confirmRunning = false
  }
}

function createWindow(): void {
  closeConfirmed = false // ウィンドウを作り直したら確認もやり直し（Dockから再表示など）
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0a0a0a',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      backgroundThrottling: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  // 赤ボタン等で閉じる前に、未保存の変更があれば「保存しますか？」を確認する。
  mainWindow.on('close', (e) => {
    if (closeConfirmed) return
    e.preventDefault()
    void confirmAndClose('window')
  })

  // 画像照明モード中に編集ウィンドウが閉じた/落ちた時、IL モードが残留すると
  // 出力窓の IL 描画が凍る（駆動役の編集側が居ない）＝チャート（自走）へ必ず戻す。
  mainWindow.on('closed', () => setGpuOutputMode('chart'))
  mainWindow.webContents.on('render-process-gone', () => setGpuOutputMode('chart'))

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // DECOR_QUERY appends a startup query string, e.g. 'live' (start in Live mode) or
  // 'live&demo' (Live + a sample chart). Handy for output-only machines and testing.
  const q = process.env['DECOR_QUERY'] ?? ''
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'] + (q ? '?' + q : ''))
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'), q ? { search: q } : undefined)
  }

  // ダブルクリックで開かれた（起動直後で保留中の）ファイルを、画面ができたら流し込む。
  mainWindow.webContents.on('did-finish-load', () => {
    if (pendingOpenPath) deliverOpenFile(pendingOpenPath)
    // 起動直後に起きた受信機のエラー（ポート使用中など）は画面が無い時に飛んで消えるので、
    // 画面ができたここで送り直す＝「無言のNo Signal」をなくす。
    if (lastArtnetStatus) mainWindow?.webContents.send('artnet:status', lastArtnetStatus)
  })
  // 編集画面のリロード＝残留した照明モードを一旦チャートへ戻す。
  // 🔴 did-finish-load でやってはいけない: onload は React の起動より遅く、先に照明モードへ
  // 入った直後の imagelight を chart に巻き戻す（実測でモード切替が消えた）。did-navigate は
  // 新しいページの実行前に必ず来る＝レースしない。
  mainWindow.webContents.on('did-navigate', () => setGpuOutputMode('chart'))
}

/** App menu: Cmd+Z/Shift+Cmd+Z go to the app's own chart undo (the default Electron
 *  menu would swallow them as text-editing undo and the editor would never see them).
 *  Cut/Copy/Paste stay native roles so text fields keep working. */
function buildMenu(): void {
  const send = (ch: string): void => {
    BrowserWindow.getFocusedWindow()?.webContents.send(ch)
  }
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: 'appMenu' },
      {
        label: 'Edit',
        submenu: [
          { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: (): void => send('edit:undo') },
          {
            label: 'Redo',
            accelerator: 'Shift+CmdOrCtrl+Z',
            click: (): void => send('edit:redo')
          },
          { type: 'separator' },
          { role: 'cut' },
          { label: 'Copy', accelerator: 'CmdOrCtrl+C', click: (): void => send('edit:copy') },
          { label: 'Paste', accelerator: 'CmdOrCtrl+V', click: (): void => send('edit:paste') },
          { role: 'selectAll' }
        ]
      },
      { role: 'windowMenu' }
    ])
  )
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.decor.studio')
  buildMenu()
  startDebugBridge() // 開発用「のぞき窓」(127.0.0.1:7331)。画面を奪わず内部を読む窓口

  // Web MIDI を許可する。Electron は既定で midi 権限を付与しないため、これが無いと
  // renderer の navigator.requestMIDIAccess() が拒否され、MIDI 入力が一切来ない（LEARN も効かない）。
  // ローカルの自前アプリなので全許可で問題ない。
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    if (permission === 'midi' || permission === 'midiSysex') console.log('[midi] 権限要求:', permission)
    callback(true)
  })
  session.defaultSession.setPermissionCheckHandler(() => true)

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Underlay image picker: returns the chosen image as a data URL.
  ipcMain.handle('dialog:openImage', async () => {
    const res = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }]
    })
    if (res.canceled || res.filePaths.length === 0) return null
    const file = res.filePaths[0]
    const ext = extname(file).slice(1).toLowerCase()
    const mime = ext === 'jpg' ? 'jpeg' : ext
    return `data:image/${mime};base64,${readFileSync(file).toString('base64')}`
  })


  // Text fields need native clipboard ops (the menu items above are app-level).
  ipcMain.on('edit:native-copy', () => {
    BrowserWindow.getFocusedWindow()?.webContents.copy()
  })
  ipcMain.on('edit:native-paste', () => {
    BrowserWindow.getFocusedWindow()?.webContents.paste()
  })

  // renderer が検出した MIDI 入力ポート一覧を受け取る（ステータスバー表示＋疎通ログ）。
  ipcMain.on('midi:inputs', (_e, names: string[]) => {
    midiInputs = Array.isArray(names) ? names : []
    console.log('[midi] 検出した入力:', midiInputs.length ? midiInputs.join(', ') : '(なし)')
  })

  // Live frames from the renderer -> Syphon.
  ipcMain.on(
    'syphon:frame',
    (_e, payload: { width: number; height: number; buffer: Uint8Array | Uint8ClampedArray }) => {
      // GPU直結出力が生きている間、編集側からのCPUフレーム（マウント直後に gpuActive の
      // 取得が間に合わず出る迷いコマ等）は捨てる＝二重出力の点滅防止（レビュー指摘）。
      // フェーズ2からは画像照明も出力窓が描く＝GPUが生きていれば全部そちらが正。
      if (isGpuOutputActive()) return
      publisher.publishRGBA(payload.width, payload.height, payload.buffer) // Mac: Syphon（Winはno-op）
      // Windows 等: 同じ RGBA を直接 NDI 送信（Mac は Syphon→ブリッジ経路を使うので送らない）
      if (process.platform !== 'darwin') {
        sendNdiFrame(payload.width, payload.height, payload.buffer)
      }
    }
  )

  // Fullscreen preview window toggle + chart mirroring to it.
  ipcMain.handle('preview:toggle', () => {
    if (previewWindow && !previewWindow.isDestroyed()) {
      closePreview()
      return false
    }
    openPreview()
    return true
  })
  ipcMain.on('chart:sync', (_e, chart) => {
    lastChart = chart
    // Esc/ディスプレイ抜けで出力窓を閉じた直後、webContents は破棄済みでも previewWindow は
    // まだ非nullの瞬間がある。破棄済みへ send すると本番中に例外が飛ぶので二重ガード。
    if (previewWindow && !previewWindow.isDestroyed() && !previewWindow.webContents.isDestroyed())
      previewWindow.webContents.send('chart:update', chart)
    sendToGpuOutput('chart:update', chart)
  })
  // TESTフェーダー状態（GPU出力窓が編集側と同じ絵を出すため）
  ipcMain.on('manual:sync', (_e, m) => {
    lastManual = m
    sendToGpuOutput('manual:update', m)
  })
  // 画像照明モードの入退場＝GPU出力窓の描き手を切替（chart⇄imagelight）
  ipcMain.on('imagelight:active', (_e, on: boolean) =>
    setGpuOutputMode(on ? 'imagelight' : 'chart')
  )
  // 画像照明の状態同期を出力窓へ中継（重い公演データはキャッシュしない＝素通し）
  ipcMain.on('il:sync-show', (_e, p) => sendToGpuOutput('il:sync-show', p))
  ipcMain.on('il:sync-frame', (_e, f) => sendToGpuOutput('il:sync-frame', f))
  // 出力方式（SETUPのトグル）。compat=GPU出力窓を止めて従来のCPU経路に戻す。
  ipcMain.on('gpu-output:method', (_e, m: string) => {
    if (m === 'compat') stopGpuOutput()
    else startGpu()
  })
  // GPU出力窓（見えない出力専用窓）: 状態問い合わせ＋出力解像度の変更要求
  ipcMain.handle('gpu-output:status', () => isGpuOutputActive())
  ipcMain.on('gpu-output:resize', (_e, w: number, h: number) => resizeGpuOutput(w, h))
  // 出力窓の React が聞き耳を立て終えた合図（pull型ハンドシェイク）。
  // push だけだと「ロード完了→リスナー登録」の隙間に届いたモード切替/チャートが消える
  // （実測: 照明モードに切り替わらず空チャートを出し続けた）。ここで現在の全状態を返し直す。
  ipcMain.handle('gpu-output:hello', () => {
    if (lastChart) sendToGpuOutput('chart:update', lastChart)
    if (lastManual) sendToGpuOutput('manual:update', lastManual)
    // 照明モード中なら編集側へ公演の再送を依頼（メディアは編集側しか持っていない）
    if (getGpuOutputMode() === 'imagelight' && mainWindow && !mainWindow.isDestroyed())
      mainWindow.webContents.send('il:resync')
    return getGpuOutputMode()
  })

  // Network interface list + receiver re-bind + engine status (for the status lamps).
  ipcMain.handle('net:interfaces', () => {
    const out: { name: string; address: string }[] = [
      { name: 'すべて (0.0.0.0)', address: '0.0.0.0' }
    ]
    for (const [name, addrs] of Object.entries(networkInterfaces())) {
      for (const a of addrs ?? []) {
        if (a.family === 'IPv4' && !a.internal) {
          out.push({ name: `${name} (${a.address})`, address: a.address })
        }
      }
    }
    return out
  })
  ipcMain.handle('net:bind', (_e, ip: string) => {
    // 🔴 bind し直さない（NIC の IP に bind すると macOS ではブロードキャスト＝卓の既定の
    // 送り方が全滅する）。選択は「その回線の送り主だけ受ける絞り込み」として効かせる。
    return receiver.setSourceFilter(ip || '0.0.0.0')
  })
  ipcMain.handle('engine:status', () => {
    // Mac は Syphon→ブリッジ経路、Windows 等は直送(ndi-direct)から状態を取る。
    const ndi = process.platform === 'darwin' ? getNdiStatus() : getNdiDirectStatus()
    return {
      hasClients: publisher.hasClients,
      syphonAvailable: publisher.available,
      platform: process.platform,
      ndiActive: ndi.active, // NDI 配信中（ブリッジ or 直送が稼働）
      ndiRx: ndi.rx, // 受け手(Resolume 等)の接続数
      // Mac=CoreMIDI のポート数 / Windows=renderer の Web MIDI が検出した入力数
      //（CoreMIDI は Mac 専用なので、Windows で常に 0＝ランプ永久消灯になるのを防ぐ）
      midiIn: process.platform === 'darwin' ? getMidiPorts().length : midiInputs.length
    }
  })

  // Chart save / open. 普通の書類アプリと同じく「今開いているファイルのパス」(currentChartPath:
  // モジュール先頭で宣言) を憶えておき、⌘S(=chart:save) は黙ってそのファイルに上書きする（初回だけ保存先を聞く）。
  const CHART_FILTERS = [
    { name: 'LED STAGE IMAGER', extensions: ['ledimager'] },
    { name: 'DECOR Chart (旧)', extensions: ['decor.json', 'json'] }
  ]
  const askSavePath = async (name: string): Promise<string | null> => {
    const res = await dialog.showSaveDialog({
      defaultPath: `${name || 'chart'}.ledimager`,
      filters: CHART_FILTERS
    })
    return res.canceled || !res.filePath ? null : res.filePath
  }
  // renderer が「実際にチャートを開けた」時だけ ⌘S 上書き先を確定する（deliverOpenFile は覚えない）。
  // 開くのをキャンセル/読込失敗した時は呼ばれない＝別ファイルを黙って上書きする事故を防ぐ。
  ipcMain.on('chart:opened', (_e, path: string) => {
    if (typeof path === 'string' && path) currentChartPath = path
  })
  ipcMain.handle('chart:save', async (_e, json: string, name: string) => {
    if (!currentChartPath) {
      const p = await askSavePath(name)
      if (!p) return null
      currentChartPath = p
    }
    writeFileSync(currentChartPath, json, 'utf8')
    return currentChartPath
  })
  ipcMain.handle('chart:saveAs', async (_e, json: string, name: string) => {
    const p = await askSavePath(name)
    if (!p) return null
    currentChartPath = p
    writeFileSync(currentChartPath, json, 'utf8')
    return currentChartPath
  })
  ipcMain.handle('chart:open', async () => {
    const res = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: CHART_FILTERS
    })
    if (res.canceled || res.filePaths.length === 0) return null
    currentChartPath = res.filePaths[0]
    return readFileSync(currentChartPath, 'utf8')
  })
  // 新規/別作品に切り替えたら「今のファイル」を忘れる（次の⌘Sで保存先を聞く）。
  ipcMain.handle('chart:new', () => {
    currentChartPath = null
    return true
  })

  // 画像照明モード「公演まるごと保存/開く」: 1フォルダに show.json ＋ media/（写真・動画）。
  const mimeFromExt = (file: string): string => {
    const e = extname(file).toLowerCase()
    const m: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
      '.gif': 'image/gif',
      '.mp4': 'video/mp4',
      '.webm': 'video/webm',
      '.mov': 'video/quicktime'
    }
    return m[e] ?? 'application/octet-stream'
  }
  ipcMain.handle(
    'imagelight:save-show',
    async (_e, json: string, media: { file: string; dataUrl: string }[], name: string) => {
      const res = await dialog.showSaveDialog({
        title: '公演を保存（フォルダができます）',
        defaultPath: name || 'show',
        buttonLabel: '保存'
      })
      if (res.canceled || !res.filePath) return null
      const dir = res.filePath
      mkdirSync(join(dir, 'media'), { recursive: true })
      writeFileSync(join(dir, 'show.json'), json, 'utf8')
      for (const m of media) {
        const b64 = m.dataUrl.slice(m.dataUrl.indexOf(',') + 1)
        writeFileSync(join(dir, m.file), Buffer.from(b64, 'base64'))
      }
      return dir
    }
  )
  // .ledshow を壊さず書く：一時ファイルに書き切ってから置き換え（途中クラッシュでも元が残る）。
  const writeShowFileSafe = (p: string, bytes: Uint8Array): void => {
    const tmp = p + '.tmp'
    writeFileSync(tmp, Buffer.from(bytes))
    renameSync(tmp, p)
  }
  // 1ファイル(.ledshow)保存: renderer で ZIP 済みのバイト列を書き出す。
  // saveAs=false は普通の書類アプリの⌘S＝2回目からは同じファイルへ黙って上書き。
  // 上書き先(targetPath)は renderer が渡す＝「実際に開けている公演」以外を絶対に上書きしない。
  ipcMain.handle(
    'imagelight:save-show-file',
    async (_e, bytes: Uint8Array, name: string, saveAs?: boolean, targetPath?: string | null) => {
      if (!saveAs && targetPath) {
        try {
          writeShowFileSafe(targetPath, bytes)
          return targetPath
        } catch {
          /* 書けない（削除・権限・ボリューム外れ）→ 下の名前を付けて保存へ落とす */
        }
      }
      const w = mainWindow
      if (!w || w.isDestroyed()) return null
      // 親ウィンドウ付き(シート)＝ダイアログ中に裏の画面を触って編集が進む事故を防ぐ
      const res = await dialog.showSaveDialog(w, {
        title: saveAs ? '別名で保存' : '公演を1ファイルで保存',
        defaultPath: targetPath ?? `${name || 'show'}.ledshow`,
        filters: [{ name: 'LED STAGE IMAGER Show', extensions: ['ledshow'] }],
        buttonLabel: '保存'
      })
      if (res.canceled || !res.filePath) return null
      writeShowFileSafe(res.filePath, bytes)
      return res.filePath
    }
  )
  // 「保存されていない変更があります」の三択（保存する/保存しない/キャンセル）。
  // renderer の window.confirm はJSを止めて他の確認と衝突するため、ネイティブのシートで出す。
  ipcMain.handle('imagelight:ask-save', async (_e, situation: string) => {
    const w = mainWindow
    if (!w || w.isDestroyed()) return 'cancel' // 聞けない時は安全側＝何もしない
    if (w.isMinimized()) w.restore()
    const { response } = await dialog.showMessageBox(w, {
      type: 'question',
      buttons: ['保存する', '保存しない', 'キャンセル'],
      defaultId: 0,
      cancelId: 2,
      message: '保存されていない変更があります',
      detail: situation
    })
    return response === 0 ? 'save' : response === 1 ? 'discard' : 'cancel'
  })
  ipcMain.handle('imagelight:open-show', async () => {
    const w = mainWindow
    if (!w || w.isDestroyed()) return null
    // Mac: 1ファイル(.ledshow)も 旧フォルダ(show.json+media/)も、どちらも選べる。
    // Windows: openFile と openDirectory は併用不可（併用するとフォルダ専用になり
    // .ledshow が一切選べなくなる）→ ファイル選択のみ（旧フォルダ形式はMac時代の遺産）。
    const res = await dialog.showOpenDialog(w, {
      title: '公演を開く（1ファイル または フォルダ）',
      properties:
        process.platform === 'darwin' ? ['openFile', 'openDirectory'] : ['openFile'],
      filters: [{ name: 'LED STAGE IMAGER Show', extensions: ['ledshow'] }]
    })
    if (res.canceled || res.filePaths.length === 0) return null
    const p = res.filePaths[0]
    // ファイル(.ledshow)なら中身(バイト)を返す→renderer で解凍。フォルダなら従来どおり。
    // 上書き先の確定は renderer が「実際に開けた」後に行う（開けなかった/やめた時に切り替えない）。
    try {
      if (statSync(p).isFile()) return { zip: readFileSync(p), path: p }
    } catch {
      return { error: 'ファイルを読めませんでした' }
    }
    const dir = p
    let json: string
    try {
      json = readFileSync(join(dir, 'show.json'), 'utf8')
    } catch {
      return { error: 'このフォルダに show.json が見つかりません' }
    }
    const media: Record<string, string> = {}
    try {
      for (const f of readdirSync(join(dir, 'media'))) {
        const buf = readFileSync(join(dir, 'media', f))
        media['media/' + f] = `data:${mimeFromExt(f)};base64,${buf.toString('base64')}`
      }
    } catch {
      /* media フォルダが無くても json だけは返す */
    }
    return { json, media }
  })
  // Crash net: the editor mirrors its chart here (debounced) so a crash or an
  // accidental quit never loses the rig — the start screen offers it back as RESUME.
  const autosavePath = (): string => join(app.getPath('userData'), 'autosave.decor.json')
  ipcMain.handle('chart:autosave-write', (_e, json: string) => {
    try {
      // アトミック書き込み: tmp に書いてから rename（同一フォルダの rename は APFS で不可分）。
      // 直書きだと書き込み中にクラッシュ＝唯一のクラッシュ復元ファイルが壊れて復元不能になる。
      const p = autosavePath()
      const tmp = p + '.tmp'
      writeFileSync(tmp, json, 'utf8')
      renameSync(tmp, p)
      return true
    } catch {
      return false
    }
  })
  ipcMain.handle('chart:autosave-read', () => {
    try {
      return readFileSync(autosavePath(), 'utf8')
    } catch {
      return null
    }
  })

  // 画像照明モードの「全自動保存」: アプリで作ったもの（シーン・配置・明かり・設定）を丸ごと
  // userData に常時書き出し、起動時に自動で戻す。これで再起動しても何も失わない。
  // serializeShow の json+media をそのまま使う（公演保存と同じ中身＝全部入り）。
  const ilAutoDir = (): string => join(app.getPath('userData'), 'il-autosave')
  ipcMain.handle(
    'imagelight:autosave-write',
    async (_e, json: string, media: { file: string; dataUrl: string }[]) => {
      try {
        const dir = ilAutoDir()
        // すべて非同期(libuv threadpool)で書く＝大きな写真/動画の書き込みでメインスレッド(＝Syphon/NDI
        // 発行・Art-Net中継)を止めないようにする。順序は維持: ①新素材→②show.json確定→③旧素材掃除。
        await mkdirAsync(join(dir, 'media'), { recursive: true })
        // ① 新しい素材を書く
        for (const m of media ?? []) {
          const b64 = m.dataUrl.slice(m.dataUrl.indexOf(',') + 1)
          const buf = Buffer.from(b64, 'base64')
          const p = join(dir, m.file)
          // 同名・同サイズなら書き直さない（写真の無駄な再書き込み＝ディスク負荷を避ける）
          try {
            const st = await statAsync(p)
            if (st.size === buf.length) continue
          } catch {
            /* 無ければ新規書き込みへ */
          }
          await writeFileAsync(p, buf)
        }
        // ② show.json をアトミックに確定（tmp→rename）
        const tmp = join(dir, 'show.json.tmp')
        await writeFileAsync(tmp, json, 'utf8')
        await renameAsync(tmp, join(dir, 'show.json'))
        // ②' 世代バックアップ（データ保険）: show.json だけを history/ に最大20世代・5分に1つまで。
        //     写真/動画は容量が大きいので複製せず media/ を共有する。既存の保存パスは触らない＝安全。
        try {
          const histDir = join(dir, 'history')
          await mkdirAsync(histDir, { recursive: true })
          const list = (await readdirAsync(histDir)).filter((f) => f.endsWith('.json')).sort()
          const last = list[list.length - 1]
          let makeNew = true
          if (last) {
            const st = await statAsync(join(histDir, last))
            if (Date.now() - st.mtimeMs < 5 * 60 * 1000) makeNew = false // 5分に1世代まで＝編集中に溜まりすぎない
          }
          if (makeNew) {
            const stamp = new Date().toISOString().replace(/[:.]/g, '-')
            await writeFileAsync(join(histDir, `show-${stamp}.json`), json, 'utf8')
            const all = (await readdirAsync(histDir)).filter((f) => f.endsWith('.json')).sort()
            while (all.length > 20) {
              const drop = all.shift()
              if (drop) await unlinkAsync(join(histDir, drop))
            }
          }
        } catch {
          /* 世代保存の失敗は本体保存に影響させない（保険なので無音） */
        }
        // ③ 使われなくなった素材を掃除（確定後に行うので欠落リスク無し）
        const keep = new Set((media ?? []).map((m) => m.file.replace(/^media\//, '')))
        try {
          for (const f of await readdirAsync(join(dir, 'media'))) {
            if (!keep.has(f)) await unlinkAsync(join(dir, 'media', f))
          }
        } catch {
          /* noop */
        }
        return true
      } catch {
        return false
      }
    }
  )
  ipcMain.handle('imagelight:autosave-read', () => {
    try {
      const dir = ilAutoDir()
      const json = readFileSync(join(dir, 'show.json'), 'utf8')
      const media: Record<string, string> = {}
      try {
        for (const f of readdirSync(join(dir, 'media'))) {
          const buf = readFileSync(join(dir, 'media', f))
          media['media/' + f] = `data:${mimeFromExt(f)};base64,${buf.toString('base64')}`
        }
      } catch {
        /* media が無くても json だけ返す */
      }
      return { json, media }
    } catch {
      return null
    }
  })
  // 世代バックアップの一覧（新しい順・ファイル名と時刻ラベル）。
  ipcMain.handle('imagelight:history-list', async () => {
    try {
      const histDir = join(ilAutoDir(), 'history')
      const files = (await readdirAsync(histDir)).filter((f) => f.endsWith('.json'))
      const out: { file: string; mtimeMs: number }[] = []
      for (const f of files) {
        try {
          const st = await statAsync(join(histDir, f))
          out.push({ file: f, mtimeMs: st.mtimeMs })
        } catch {
          /* skip */
        }
      }
      out.sort((a, b) => b.mtimeMs - a.mtimeMs) // 新しい順
      return out
    } catch {
      return []
    }
  })
  // 指定の世代を読む（show.json はその世代・media は現在の il-autosave/media を共有）。
  ipcMain.handle('imagelight:history-read', (_e, file: string) => {
    try {
      // パス・トラバーサル防止: 単純なファイル名だけ許可
      if (!/^show-[\w.-]+\.json$/.test(file)) return null
      const dir = ilAutoDir()
      const json = readFileSync(join(dir, 'history', file), 'utf8')
      const media: Record<string, string> = {}
      try {
        for (const f of readdirSync(join(dir, 'media'))) {
          const buf = readFileSync(join(dir, 'media', f))
          media['media/' + f] = `data:${mimeFromExt(f)};base64,${buf.toString('base64')}`
        }
      } catch {
        /* media 無しでも json は返す */
      }
      return { json, media }
    } catch {
      return null
    }
  })
  // MVR export (grandMA3 patch + layout, GDTF embedded)
  ipcMain.handle('mvr:save', async (_e, name: string, data: Uint8Array) => {
    const res = await dialog.showSaveDialog({
      defaultPath: `${name || 'decor'}.mvr`,
      filters: [{ name: 'MVR Scene', extensions: ['mvr'] }]
    })
    if (res.canceled || !res.filePath) return null
    writeFileSync(res.filePath, Buffer.from(data))
    return res.filePath
  })

  ipcMain.handle('syphon:rename', (_e, name: string) => {
    publisher.start(name || 'LED STAGE IMAGER')
    restartNdiBridge(name || 'LED STAGE IMAGER')
    return true
  })

  createWindow()
  startEngine()
  startGpu()

  app.on('activate', function () {
    // 🔴 getAllWindows() は見えないGPU出力窓も数える＝0個判定だと Dock クリックで
    // 編集ウィンドウが二度と出ない。編集ウィンドウの有無で判定する。
    if (!mainWindow || mainWindow.isDestroyed()) createWindow()
  })
})

app.on('before-quit', (e) => {
  // ⌘Q でも未保存の確認を通す。確認済み（またはウィンドウ無し）ならそのまま終了。
  if (!closeConfirmed && mainWindow && !mainWindow.isDestroyed()) {
    e.preventDefault()
    void confirmAndClose('quit')
    return
  }
  stopEngine()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
