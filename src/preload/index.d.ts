import { ElectronAPI } from '@electron-toolkit/preload'

export interface DecorApi {
  /** Opens a native file dialog and returns the chosen image as a data URL (or null). */
  openImage: () => Promise<string | null>
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: DecorApi
  }
}
