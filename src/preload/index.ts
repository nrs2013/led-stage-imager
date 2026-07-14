import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api = {
  openImage: (): Promise<string | null> => ipcRenderer.invoke('dialog:openImage'),
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
  // ---- GPU直結出力（見えない出力専用窓・2026-07-14）
  // 窓が生きているか（生きている間は editor の CPU 読み出し経路が黙る）
  gpuOutputStatus: (): Promise<boolean> => ipcRenderer.invoke('gpu-output:status'),
  onGpuOutputActive: (cb: (active: boolean) => void): (() => void) => {
    const h = (_e: IpcRendererEvent, v: boolean): void => cb(v)
    ipcRenderer.on('gpu-output:active', h)
    return () => ipcRenderer.removeListener('gpu-output:active', h)
  },
  // 出力窓（?syphon-output）→ main: 窓サイズ＝出力解像度の変更要求
  gpuOutputResize: (w: number, h: number): void => ipcRenderer.send('gpu-output:resize', w, h),
  // TESTフェーダー状態の同期（editor → main → 出力窓）
  sendManual: (m: unknown): void => ipcRenderer.send('manual:sync', m),
  onManualUpdate: (cb: (m: unknown) => void): (() => void) => {
    const h = (_e: IpcRendererEvent, m: unknown): void => cb(m)
    ipcRenderer.on('manual:update', h)
    return () => ipcRenderer.removeListener('manual:update', h)
  },
  // 画像照明モードの入退場を main へ（GPU出力窓の描き手を chart⇄imagelight に切替）
  sendImageLightActive: (on: boolean): void => ipcRenderer.send('imagelight:active', on),
  // 出力窓（?syphon-output）が受けるモード切替通知
  onOutputMode: (cb: (mode: 'chart' | 'imagelight') => void): (() => void) => {
    const h = (_e: IpcRendererEvent, v: 'chart' | 'imagelight'): void => cb(v)
    ipcRenderer.on('output:mode', h)
    return () => ipcRenderer.removeListener('output:mode', h)
  },
  // 出力窓の準備完了ハンドシェイク: 現在モードが返り、main が最新状態を送り直す
  gpuOutputHello: (): Promise<'chart' | 'imagelight'> => ipcRenderer.invoke('gpu-output:hello'),
  // ---- 画像照明の状態同期（編集 → main → 出力窓）
  // 公演まるごと（重い・メディアが変わった時だけ。media=null は「前回のメディアを使い回す」）
  ilSyncShow: (json: string, media: { file: string; dataUrl: string }[] | null): void =>
    ipcRenderer.send('il:sync-show', { json, media }),
  // 毎フレームの軽い動的状態
  ilSyncFrame: (frame: unknown): void => ipcRenderer.send('il:sync-frame', frame),
  onIlSyncShow: (
    cb: (p: { json: string; media: { file: string; dataUrl: string }[] | null }) => void
  ): (() => void) => {
    const h = (
      _e: IpcRendererEvent,
      p: { json: string; media: { file: string; dataUrl: string }[] | null }
    ): void => cb(p)
    ipcRenderer.on('il:sync-show', h)
    return () => ipcRenderer.removeListener('il:sync-show', h)
  },
  onIlSyncFrame: (cb: (f: unknown) => void): (() => void) => {
    const h = (_e: IpcRendererEvent, f: unknown): void => cb(f)
    ipcRenderer.on('il:sync-frame', h)
    return () => ipcRenderer.removeListener('il:sync-frame', h)
  },
  // 出力窓が（再）起動した時に main から届く「公演を再送して」の合図（編集側が受ける）
  onIlResync: (cb: () => void): (() => void) => {
    const h = (): void => cb()
    ipcRenderer.on('il:resync', h)
    return () => ipcRenderer.removeListener('il:resync', h)
  },
  // 出力窓→main: 実絵を1枚描いた（ここから Syphon 送出を CPU から出力窓へ切替してよい）
  ilOutputReady: (): void => ipcRenderer.send('il:output-ready'),
  // 出力窓→main: マウント直後に公演の再送を頼む（pull型ハンドシェイク・レース回復）
  ilRequestShow: (): void => ipcRenderer.send('il:request-show'),
  // 編集側: 出力窓が実絵を出したか/まだかの変化を受ける（CPU本番を続けるか止めるか判断）
  onIlOutputReadyChanged: (cb: (ready: boolean) => void): (() => void) => {
    const h = (_e: IpcRendererEvent, v: boolean): void => cb(v)
    ipcRenderer.on('il:output-ready-changed', h)
    return () => ipcRenderer.removeListener('il:output-ready-changed', h)
  },
  // 出力方式（SETUPのトグル）: fast=GPU直結（既定）／compat=従来のCPU経路
  setGpuOutputMethod: (m: 'fast' | 'compat'): void => ipcRenderer.send('gpu-output:method', m),
  // Art-Net 受信機の生死通知（bind失敗＝ポート使用中など。今まで無言で死んでいた）
  onArtnetStatus: (cb: (st: { ok: boolean; detail: string }) => void): (() => void) => {
    const h = (_e: IpcRendererEvent, st: { ok: boolean; detail: string }): void => cb(st)
    ipcRenderer.on('artnet:status', h)
    return () => ipcRenderer.removeListener('artnet:status', h)
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
  // ダブルクリックで開かれたファイルの中身(JSON)＋パスがメインから届く
  onOpenChartPath: (cb: (json: string, path?: string) => void): (() => void) => {
    const h = (_e: IpcRendererEvent, json: string, path?: string): void => cb(json, path)
    ipcRenderer.on('chart:open-path', h)
    return () => ipcRenderer.removeListener('chart:open-path', h)
  },
  // 実際に開けた時だけ⌘S上書き先を確定（キャンセル/失敗時は呼ばない＝別ファイル誤上書き防止）
  chartOpened: (path: string): void => ipcRenderer.send('chart:opened', path),
  // ダブルクリックで開かれた .ledshow（画像照明の公演・ZIPのバイト列＋パス）がメインから届く
  onOpenShowPath: (cb: (p: { bytes: Uint8Array; path: string }) => void): (() => void) => {
    const h = (_e: IpcRendererEvent, p: { bytes: Uint8Array; path: string }): void => cb(p)
    ipcRenderer.on('imagelight:open-path', h)
    return () => ipcRenderer.removeListener('imagelight:open-path', h)
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
  // 1ファイル(.ledshow)で保存（写真/動画ごとZIP済みのバイト列を渡す）。
  // saveAs=false は上書き（初回だけ名前を聞く）、true は別名保存（毎回名前を聞く）。
  // targetPath＝上書き先（renderer が「実際に開けている公演」だけを渡す）。
  saveImageLightShowFile: (
    bytes: Uint8Array,
    name: string,
    saveAs = false,
    targetPath: string | null = null
  ): Promise<string | null> =>
    ipcRenderer.invoke('imagelight:save-show-file', bytes, name, saveAs, targetPath),
  // 「保存されていない変更があります」の三択（ネイティブのシートで出す）
  askSaveChoice: (situation: string): Promise<'save' | 'discard' | 'cancel'> =>
    ipcRenderer.invoke('imagelight:ask-save', situation),
  openImageLightShow: (): Promise<
    | { json: string; media: Record<string, string> }
    | { zip: Uint8Array; path: string }
    | { error: string }
    | null
  > => ipcRenderer.invoke('imagelight:open-show'),
  // 全自動保存（シーン・配置・明かり・設定を丸ごと userData に常時保存／起動時に復元）
  autosaveImageLightWrite: (
    json: string,
    media: { file: string; dataUrl: string }[]
  ): Promise<boolean> => ipcRenderer.invoke('imagelight:autosave-write', json, media),
  autosaveImageLightRead: (): Promise<{ json: string; media: Record<string, string> } | null> =>
    ipcRenderer.invoke('imagelight:autosave-read'),
  imageLightHistoryList: (): Promise<{ file: string; mtimeMs: number }[]> =>
    ipcRenderer.invoke('imagelight:history-list'),
  imageLightHistoryRead: (
    file: string
  ): Promise<{ json: string; media: Record<string, string> } | null> =>
    ipcRenderer.invoke('imagelight:history-read', file)
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
