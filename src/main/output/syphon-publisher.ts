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
  /** IOSurface のハンドルを渡す＝GPU の絵をコピーなしで Syphon へ出す（GPU直結出力用）。 */
  publishSurfaceHandle(
    handle: Buffer,
    srcRect: { x: number; y: number; width: number; height: number },
    size: { width: number; height: number },
    flipped: boolean
  ): void
  hasClients: boolean
  dispose(): void
}

/** Electron の offscreen paint イベントが渡す textureInfo のうち、送出に使う部分。 */
export interface PaintTextureInfo {
  codedSize: { width: number; height: number }
  contentRect: { x: number; y: number; width: number; height: number }
  handle: { ioSurface?: Buffer }
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

  /** GPU直結: offscreen ウィンドウの paint が渡す IOSurface をコピーなしで publish する。
   *  Chromium の IOSurface は BGRA・上端が先頭行＝publishImageData(本番実績・flipped=false)と
   *  同じ向き。ネイティブ側は MTLPixelFormatBGRA8Unorm で包むので色もそのまま正しい
   *  （vendor/node-syphon/MetalServer.mm.fixed 参照。flipped=true だと上下逆＝実測で確認済み）。
   *  失敗は例外で呼び出し側へ（連続失敗で互換経路へ落とす）。 */
  publishSurface(info: PaintTextureInfo, clipW?: number, clipH?: number): void {
    if (!this.server || !info.handle?.ioSurface) return
    // clipW/H: 奇数サイズ等で絵が要求より +1px 大きい時、受け手には要求サイズちょうどで見せる
    const region = {
      x: info.contentRect.x,
      y: info.contentRect.y,
      width: Math.min(info.contentRect.width, clipW ?? info.contentRect.width),
      height: Math.min(info.contentRect.height, clipH ?? info.contentRect.height)
    }
    this.server.publishSurfaceHandle(
      info.handle.ioSurface,
      region,
      { width: info.codedSize.width, height: info.codedSize.height },
      false
    )
  }

  get hasClients(): boolean {
    return this.server?.hasClients ?? false
  }

  stop(): void {
    this.server?.dispose()
    this.server = null
  }
}
