import { ElectronAPI } from '@electron-toolkit/preload'

export interface DecorApi {
  /** Opens a native file dialog and returns the chosen image as a data URL (or null). */
  openImage: () => Promise<string | null>
  /** Subscribe to Art-Net DMX packets forwarded from the main process. Returns an unsubscribe. */
  onDmx: (
    cb: (pkt: { universe: number; sequence: number; data: Uint8Array }) => void
  ) => () => void
  /** Publish an RGBA frame to the Syphon server. */
  publishFrame: (width: number, height: number, buffer: Uint8ClampedArray) => void
  /** Toggle the fullscreen preview window; resolves to the new open state. */
  togglePreview: () => Promise<boolean>
  /** Notified when the preview window opens (true) or closes (false). Returns an unsubscribe. */
  onPreviewActive: (cb: (active: boolean) => void) => () => void
  /** Push the current chart to the preview window. */
  sendChart: (chart: unknown) => void
  /** Receive chart updates (preview window). Returns an unsubscribe. */
  onChartUpdate: (cb: (chart: unknown) => void) => () => void
  /** GPU直結出力窓が生きているか。 */
  gpuOutputStatus: () => Promise<boolean>
  /** GPU直結出力窓の生死通知。Returns an unsubscribe. */
  onGpuOutputActive: (cb: (active: boolean) => void) => () => void
  /** 出力窓→main: 窓サイズ＝出力解像度の変更要求。 */
  gpuOutputResize: (w: number, h: number) => void
  /** TESTフェーダー状態を出力窓へ同期。 */
  sendManual: (m: unknown) => void
  /** TESTフェーダー状態を受け取る（出力窓側）。Returns an unsubscribe. */
  onManualUpdate: (cb: (m: unknown) => void) => () => void
  /** 画像照明モードの入退場を main へ通知。 */
  sendImageLightActive: (on: boolean) => void
  /** 出力窓（?syphon-output）が受けるモード切替通知。Returns an unsubscribe. */
  onOutputMode: (cb: (mode: 'chart' | 'imagelight') => void) => () => void
  /** 出力窓の準備完了ハンドシェイク（現在モードが返る）。 */
  gpuOutputHello: () => Promise<'chart' | 'imagelight'>
  /** 画像照明: 公演まるごと同期（media=null は前回のメディア使い回し）。 */
  ilSyncShow: (json: string, media: { file: string; dataUrl: string }[] | null) => void
  /** 画像照明: 毎フレームの軽い動的状態を送る。 */
  ilSyncFrame: (frame: unknown) => void
  /** 画像照明: 公演同期を受ける（出力窓側）。Returns an unsubscribe. */
  onIlSyncShow: (
    cb: (p: { json: string; media: { file: string; dataUrl: string }[] | null }) => void
  ) => () => void
  /** 画像照明: 毎フレーム同期を受ける（出力窓側）。Returns an unsubscribe. */
  onIlSyncFrame: (cb: (f: unknown) => void) => () => void
  /** 公演の再送依頼を受ける（編集側）。Returns an unsubscribe. */
  onIlResync: (cb: () => void) => () => void
  /** 出力方式: fast=GPU直結（既定）／compat=従来のCPU経路。 */
  setGpuOutputMethod: (m: 'fast' | 'compat') => void
  /** List bindable IPv4 network interfaces. */
  listInterfaces: () => Promise<{ name: string; address: string }[]>
  /** Re-bind the Art-Net receiver to a NIC address. */
  setBind: (ip: string) => Promise<boolean>
  /** Engine status (Syphon client connected, etc). */
  getStatus: () => Promise<{ hasClients: boolean }>
  /** Save chart JSON via a native dialog; resolves to the path or null. */
  saveChart: (json: string, name: string) => Promise<string | null>
  /** Open a chart file via a native dialog; resolves to its JSON or null. */
  openChartFile: () => Promise<string | null>
  /** Crash net: mirror the chart to userData/autosave.decor.json (no dialog). */
  autosaveWrite: (json: string) => Promise<boolean>
  /** Read the crash-net mirror back (null if none). */
  autosaveRead: () => Promise<string | null>
  /** Rename (restart) the Syphon source. */
  renameSyphon: (name: string) => Promise<boolean>
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: DecorApi
  }
}
