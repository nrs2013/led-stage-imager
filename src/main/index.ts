import { app, shell, BrowserWindow, ipcMain, dialog, screen, Menu, session } from 'electron'
import { join, extname } from 'path'
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, statSync, unlinkSync } from 'fs'
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
import { runDepth } from './depth/depth-engine'

// Engine: Art-Net in (UDP 6454) is forwarded to the renderer, which renders the chart and
// sends frames back to be published on the "LED STAGE IMAGER" Syphon source.
const receiver = new ArtNetReceiver()
const publisher = new OutputPublisher()
let mainWindow: BrowserWindow | null = null
let previewWindow: BrowserWindow | null = null
let lastChart: unknown = null
let midiInputs: string[] = [] // renderer が検出した MIDI 入力ポート名（ステータスバー表示用）
let currentChartPath: string | null = null // 今開いている .ledimager のパス（⌘Sの上書き先）
let pendingOpenPath: string | null = null // 起動直後などで、画面が出来たら開くべきファイル

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
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send('artnet:dmx', msg)
  })
  // CoreMIDI 直読みの MIDI 入力（Web MIDI が効かないため）。受信を renderer(engine) へ転送。
  startMidiInput((s, d1, d2) => {
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send('midi:message', [s, d1, d2])
  })
  receiver.on('error', (err) => console.error('[artnet] receiver error:', err))
  receiver.start('0.0.0.0')
  console.log('[engine] Art-Net receiver (UDP 6454) + Syphon/NDI "LED STAGE IMAGER" started')
}

function stopEngine(): void {
  receiver.stop()
  publisher.stop()
  stopNdiBridge()
  stopNdiDirect()
  stopMidiInput()
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
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    previewWindow.loadURL(process.env['ELECTRON_RENDERER_URL'] + '?output&live')
  } else {
    previewWindow.loadFile(join(__dirname, '../renderer/index.html'), { search: 'output&live' })
  }
  previewWindow.webContents.on('did-finish-load', () => {
    if (lastChart) previewWindow?.webContents.send('chart:update', lastChart)
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

/** ダブルクリックで開かれた .ledimager を読み込み、画面へ渡す（⌘S の上書き先にも設定）。
 *  画面がまだ無い起動直後は pendingOpenPath に積み、did-finish-load で流す。 */
function deliverOpenFile(p: string): void {
  currentChartPath = p
  const w = mainWindow
  if (w && !w.isDestroyed() && !w.webContents.isLoading()) {
    try {
      w.webContents.send('chart:open-path', readFileSync(p, 'utf8'))
      if (w.isMinimized()) w.restore()
      w.focus()
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
  const arg = process.argv.find((a) => a.toLowerCase().endsWith('.ledimager'))
  if (arg && existsSync(arg)) pendingOpenPath = arg
}

function createWindow(): void {
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
  })
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

  // 画像照明モード: 前処理済みテンソル(1x3xHxW float32) → 生深度(float32 H*W)。
  // 完全同梱の onnxruntime-node(Depth Anything V2 Small)で推論。Python/ComfyUI 不要。
  ipcMain.handle('depth:run', async (_e, input: Float32Array, w: number, h: number) => {
    return await runDepth(input, w, h)
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
    previewWindow?.webContents.send('chart:update', chart)
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
    receiver.start(ip || '0.0.0.0')
    return true
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
      midiIn: getMidiPorts().length // CoreMIDI で検出した入力ポート数
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
  ipcMain.handle('imagelight:open-show', async () => {
    const res = await dialog.showOpenDialog({
      title: '公演フォルダを開く',
      properties: ['openDirectory']
    })
    if (res.canceled || res.filePaths.length === 0) return null
    const dir = res.filePaths[0]
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
      writeFileSync(autosavePath(), json, 'utf8')
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
    (_e, json: string, media: { file: string; dataUrl: string }[]) => {
      try {
        const dir = ilAutoDir()
        mkdirSync(join(dir, 'media'), { recursive: true })
        writeFileSync(join(dir, 'show.json'), json, 'utf8')
        const keep = new Set((media ?? []).map((m) => m.file.replace(/^media\//, '')))
        try {
          for (const f of readdirSync(join(dir, 'media'))) {
            if (!keep.has(f)) unlinkSync(join(dir, 'media', f)) // 使われなくなった素材を掃除
          }
        } catch {
          /* noop */
        }
        for (const m of media ?? []) {
          const b64 = m.dataUrl.slice(m.dataUrl.indexOf(',') + 1)
          const buf = Buffer.from(b64, 'base64')
          const p = join(dir, m.file)
          // 同名・同サイズなら書き直さない（写真の無駄な再書き込み＝ディスク負荷を避ける）
          try {
            if (existsSync(p) && statSync(p).size === buf.length) continue
          } catch {
            /* noop */
          }
          writeFileSync(p, buf)
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

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  stopEngine()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
