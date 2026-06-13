// PIPELINE CHOSEN IN SPIKE: B (CPU buffer) via node-syphon SyphonMetalServer.publishImageData.
//
// node-syphon is built with N-API (ABI-stable), so the single prebuilt binary loads in both
// plain node and Electron — no rebuild needed. Proven on this Mac during the Milestone-0 spike:
// publish -> SyphonServerDirectory announce -> SyphonMetalClient read-back was pixel-exact
// (256x144, px0 = published color). Resolume is just one more consumer of this same server.
//
// Stable interface used by later milestones: start() / publishRGBA() / stop().
import { SyphonMetalServer } from 'node-syphon'

export class OutputPublisher {
  private server: SyphonMetalServer | null = null

  start(name = 'LED STAGE IMAGER'): void {
    this.stop()
    this.server = new SyphonMetalServer(name)
  }

  /** Publish a tightly-packed RGBA frame (width*height*4 bytes). */
  publishRGBA(width: number, height: number, rgba: Uint8Array | Uint8ClampedArray): void {
    if (!this.server) return
    // node-syphon's typings want a Uint8ClampedArray; share the same backing buffer (no copy).
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
