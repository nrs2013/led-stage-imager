import { app, shell, BrowserWindow, ipcMain, dialog, screen, Menu } from 'electron'
import { join, extname } from 'path'
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs'
import { networkInterfaces } from 'os'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { ArtNetReceiver } from './artnet/artnet-receiver'
import type { ArtDmxPacket } from './artnet/artdmx-parser'
import { OutputPublisher } from './output/syphon-publisher'

// Engine: Art-Net in (UDP 6454) is forwarded to the renderer, which renders the chart and
// sends frames back to be published on the "LED STAGE IMAGER" Syphon source.
const receiver = new ArtNetReceiver()
const publisher = new OutputPublisher()
let mainWindow: BrowserWindow | null = null
let previewWindow: BrowserWindow | null = null
let lastChart: unknown = null

function startEngine(): void {
  publisher.start('LED STAGE IMAGER')
  receiver.on('dmx', (pkt: ArtDmxPacket) => {
    const msg = { universe: pkt.universe, sequence: pkt.sequence, data: pkt.data }
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send('artnet:dmx', msg)
  })
  receiver.on('error', (err) => console.error('[artnet] receiver error:', err))
  receiver.start('0.0.0.0')
  console.log('[engine] Art-Net receiver (UDP 6454) + Syphon "LED STAGE IMAGER" started')
}

function stopEngine(): void {
  receiver.stop()
  publisher.stop()
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

  // Live frames from the renderer -> Syphon.
  ipcMain.on(
    'syphon:frame',
    (_e, payload: { width: number; height: number; buffer: Uint8Array | Uint8ClampedArray }) => {
      publisher.publishRGBA(payload.width, payload.height, payload.buffer)
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
  ipcMain.handle('engine:status', () => ({
    hasClients: publisher.hasClients,
    syphonAvailable: publisher.available,
    platform: process.platform
  }))

  // Chart save / open + Syphon source rename.
  ipcMain.handle('chart:save', async (_e, json: string, name: string) => {
    const res = await dialog.showSaveDialog({
      defaultPath: `${name || 'chart'}.decor.json`,
      filters: [{ name: 'DECOR Chart', extensions: ['decor.json', 'json'] }]
    })
    if (res.canceled || !res.filePath) return null
    writeFileSync(res.filePath, json, 'utf8')
    return res.filePath
  })
  ipcMain.handle('chart:open', async () => {
    const res = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'DECOR Chart', extensions: ['decor.json', 'json'] }]
    })
    if (res.canceled || res.filePaths.length === 0) return null
    return readFileSync(res.filePaths[0], 'utf8')
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
