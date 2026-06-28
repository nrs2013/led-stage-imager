import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
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
  onDmx: (
    cb: (pkt: { universe: number; sequence: number; data: Uint8Array }) => void
  ): (() => void) => {
    const h = (_e: IpcRendererEvent, pkt: { universe: number; sequence: number; data: Uint8Array }): void => cb(pkt)
    ipcRenderer.on('artnet:dmx', h)
    return () => ipcRenderer.removeListener('artnet:dmx', h)
  },
  publishFrame: (width: number, height: number, buffer: Uint8ClampedArray): void => {
    ipcRenderer.send('syphon:frame', { width, height, buffer })
  },
  // Fullscreen preview window (output on a second display).
  togglePreview: (): Promise<boolean> => ipcRenderer.invoke('preview:toggle'),
  onPreviewActive: (cb: (active: boolean) => void): (() => void) => {
    const h = (_e: IpcRendererEvent, v: boolean): void => cb(v)
    ipcRenderer.on('preview:active', h)
    return () => ipcRenderer.removeListener('preview:active', h)
  },
  sendChart: (chart: unknown): void => ipcRenderer.send('chart:sync', chart),
  onChartUpdate: (cb: (chart: unknown) => void): (() => void) => {
    const h = (_e: IpcRendererEvent, c: unknown): void => cb(c)
    ipcRenderer.on('chart:update', h)
    return () => ipcRenderer.removeListener('chart:update', h)
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
  onMidiMessage: (cb: (msg: [number, number, number]) => void): (() => void) => {
    const h = (_e: IpcRendererEvent, msg: [number, number, number]): void => cb(msg)
    ipcRenderer.on('midi:message', h)
    return () => ipcRenderer.removeListener('midi:message', h)
  },
  // Edit menu (Cmd+Z/C/V routed from the app menu so the canvas gets them)
  onEditUndo: (cb: () => void): (() => void) => {
    const h = (): void => cb()
    ipcRenderer.on('edit:undo', h)
    return () => ipcRenderer.removeListener('edit:undo', h)
  },
  onEditRedo: (cb: () => void): (() => void) => {
    const h = (): void => cb()
    ipcRenderer.on('edit:redo', h)
    return () => ipcRenderer.removeListener('edit:redo', h)
  },
  onEditCopy: (cb: () => void): (() => void) => {
    const h = (): void => cb()
    ipcRenderer.on('edit:copy', h)
    return () => ipcRenderer.removeListener('edit:copy', h)
  },
  onEditPaste: (cb: () => void): (() => void) => {
    const h = (): void => cb()
    ipcRenderer.on('edit:paste', h)
    return () => ipcRenderer.removeListener('edit:paste', h)
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
  onOpenChartPath: (cb: (json: string) => void): (() => void) => {
    const h = (_e: IpcRendererEvent, json: string): void => cb(json)
    ipcRenderer.on('chart:open-path', h)
    return () => ipcRenderer.removeListener('chart:open-path', h)
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
