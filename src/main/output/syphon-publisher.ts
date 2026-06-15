// Syphon は Mac 専用（Metal/Syphon.framework）。Windows/Linux では起動時にモジュールが
// 存在しないため、プラットフォームを確認してから動的 require する。
// Windows では available=false の no-op スタブとして動作し、アプリ本体には影響しない。

type SyphonServer = {
  publishImageData(
    data: Uint8ClampedArray,
    srcRect: { x: number; y: number; width: number; height: number },
    size: { width: number; height: number },
    flipped: boolean
  ): void
  hasClients: boolean
  dispose(): void
}
type SyphonServerCtor = new (name: string) => SyphonServer

let SyphonMetalServer: SyphonServerCtor | null = null
if (process.platform === 'darwin') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    SyphonMetalServer = (require('node-syphon') as { SyphonMetalServer: SyphonServerCtor })
      .SyphonMetalServer
  } catch (e) {
    console.warn('[syphon] node-syphon not available:', e)
  }
}

export class OutputPublisher {
  private server: SyphonServer | null = null

  /** true on Mac (Syphon loaded); false on Windows/Linux. */
  readonly available = SyphonMetalServer !== null

  start(name = 'LED STAGE IMAGER'): void {
    if (!SyphonMetalServer) return
    this.stop()
    this.server = new SyphonMetalServer(name)
  }

  /** Publish a tightly-packed RGBA frame (width*height*4 bytes). */
  publishRGBA(width: number, height: number, rgba: Uint8Array | Uint8ClampedArray): void {
    if (!this.server) return
    const data =
      rgba instanceof Uint8ClampedArray
        ? rgba
        : new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.byteLength)
    this.server.publishImageData(data, { x: 0, y: 0, width, height }, { width, height }, false)
  }

  get hasClients(): boolean {
    return this.server?.hasClients ?? false
  }

  stop(): void {
    this.server?.dispose()
    this.server = null
  }
}
