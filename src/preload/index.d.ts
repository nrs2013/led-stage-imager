import { ElectronAPI } from '@electron-toolkit/preload'

export interface DecorApi {
  /** Opens a native file dialog and returns the chosen image as a data URL (or null). */
  openImage: () => Promise<string | null>
  /** Subscribe to Art-Net DMX packets forwarded from the main process. */
  onDmx: (cb: (pkt: { universe: number; sequence: number; data: Uint8Array }) => void) => void
  /** Publish an RGBA frame to the Syphon server. */
  publishFrame: (width: number, height: number, buffer: Uint8ClampedArray) => void
  /** Toggle the fullscreen preview window; resolves to the new open state. */
  togglePreview: () => Promise<boolean>
  /** Notified when the preview window opens (true) or closes (false). */
  onPreviewActive: (cb: (active: boolean) => void) => void
  /** Push the current chart to the preview window. */
  sendChart: (chart: unknown) => void
  /** Receive chart updates (preview window). */
  onChartUpdate: (cb: (chart: unknown) => void) => void
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
