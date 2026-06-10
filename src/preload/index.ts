import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api = {
  openImage: (): Promise<string | null> => ipcRenderer.invoke('dialog:openImage'),
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
  getStatus: (): Promise<{ hasClients: boolean }> => ipcRenderer.invoke('engine:status'),
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
  openChartFile: (): Promise<string | null> => ipcRenderer.invoke('chart:open'),
  renameSyphon: (name: string): Promise<boolean> => ipcRenderer.invoke('syphon:rename', name)
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
