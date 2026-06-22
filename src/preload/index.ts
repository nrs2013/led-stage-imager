import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api = {
  openImage: (): Promise<string | null> => ipcRenderer.invoke('dialog:openImage'),
  // 画像照明モード: 前処理済みテンソル(1x3xHxW float32) → 生深度(float32 H*W)。立体ライティング用。
  runDepth: (
    input: Float32Array,
    w: number,
    h: number
  ): Promise<{ depth?: Float32Array; w?: number; h?: number; error?: string }> =>
    ipcRenderer.invoke('depth:run', input, w, h),
  onDmx: (cb: (pkt: { universe: number; sequence: number; data: Uint8Array }) => void): void => {
    ipcRenderer.on('artnet:dmx', (_e, pkt) => cb(pkt))
  },
  publishFrame: (width: number, height: number, buffer: Uint8ClampedArray): void => {
    ipcRenderer.send('syphon:frame', { width, height, buffer })
  },
  // Fullscreen preview window (output on a second display).
  togglePreview: (): Promise<boolean> => ipcRenderer.invoke('preview:toggle'),
  onPreviewActive: (cb: (active: boolean) => void): void => {
    ipcRenderer.on('preview:active', (_e, v) => cb(v))
  },
  sendChart: (chart: unknown): void => ipcRenderer.send('chart:sync', chart),
  onChartUpdate: (cb: (chart: unknown) => void): void => {
    ipcRenderer.on('chart:update', (_e, c) => cb(c))
  },
  // Status / network
  listInterfaces: (): Promise<{ name: string; address: string }[]> =>
    ipcRenderer.invoke('net:interfaces'),
  setBind: (ip: string): Promise<boolean> => ipcRenderer.invoke('net:bind', ip),
  getStatus: (): Promise<{ hasClients: boolean; syphonAvailable: boolean; platform: string }> =>
    ipcRenderer.invoke('engine:status'),
  // renderer が検出した MIDI 入力ポート名をメインへ通知（ステータスバー表示用・Web MIDI 用の名残）
  reportMidiInputs: (names: string[]): void => ipcRenderer.send('midi:inputs', names),
  // CoreMIDI(ネイティブ)からの MIDI メッセージ受信 [status, data1, data2]
  onMidiMessage: (cb: (msg: [number, number, number]) => void): void => {
    ipcRenderer.on('midi:message', (_e, msg) => cb(msg))
  },
  // Edit menu (Cmd+Z/C/V routed from the app menu so the canvas gets them)
  onEditUndo: (cb: () => void): void => {
    ipcRenderer.on('edit:undo', () => cb())
  },
  onEditRedo: (cb: () => void): void => {
    ipcRenderer.on('edit:redo', () => cb())
  },
  onEditCopy: (cb: () => void): void => {
    ipcRenderer.on('edit:copy', () => cb())
  },
  onEditPaste: (cb: () => void): void => {
    ipcRenderer.on('edit:paste', () => cb())
  },
  nativeCopy: (): void => ipcRenderer.send('edit:native-copy'),
  nativePaste: (): void => ipcRenderer.send('edit:native-paste'),
  // Files
  saveChart: (json: string, name: string): Promise<string | null> =>
    ipcRenderer.invoke('chart:save', json, name),
  saveChartAs: (json: string, name: string): Promise<string | null> =>
    ipcRenderer.invoke('chart:saveAs', json, name),
  chartNew: (): Promise<boolean> => ipcRenderer.invoke('chart:new'),
  openChartFile: (): Promise<string | null> => ipcRenderer.invoke('chart:open'),
  // ダブルクリックで開かれたファイルの中身(JSON)がメインから届く
  onOpenChartPath: (cb: (json: string) => void): void => {
    ipcRenderer.on('chart:open-path', (_e, json) => cb(json))
  },
  autosaveWrite: (json: string): Promise<boolean> =>
    ipcRenderer.invoke('chart:autosave-write', json),
  autosaveRead: (): Promise<string | null> => ipcRenderer.invoke('chart:autosave-read'),
  saveMvr: (name: string, data: Uint8Array): Promise<string | null> =>
    ipcRenderer.invoke('mvr:save', name, data),
  renameSyphon: (name: string): Promise<boolean> => ipcRenderer.invoke('syphon:rename', name),
  // 画像照明モード「公演まるごと保存/開く」（フォルダ＋写真/動画）
  saveImageLightShow: (
    json: string,
    media: { file: string; dataUrl: string }[],
    name: string
  ): Promise<string | null> => ipcRenderer.invoke('imagelight:save-show', json, media, name),
  openImageLightShow: (): Promise<
    { json: string; media: Record<string, string> } | { error: string } | null
  > => ipcRenderer.invoke('imagelight:open-show'),
  // 全自動保存（シーン・配置・明かり・設定を丸ごと userData に常時保存／起動時に復元）
  autosaveImageLightWrite: (
    json: string,
    media: { file: string; dataUrl: string }[]
  ): Promise<boolean> => ipcRenderer.invoke('imagelight:autosave-write', json, media),
  autosaveImageLightRead: (): Promise<{ json: string; media: Record<string, string> } | null> =>
    ipcRenderer.invoke('imagelight:autosave-read')
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
