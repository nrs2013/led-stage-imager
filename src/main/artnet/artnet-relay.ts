import { createSocket, type Socket } from 'node:dgram'
import type { ArtDmxPacket } from './artdmx-parser'

export interface ArtNetRelayRoute {
  enabled: boolean
  inputUniverse: number
  targetIp: string
  outputUniverse: number
  delayFrames: number
}

export interface ArtNetRelayConfig {
  enabled: boolean
  routes: ArtNetRelayRoute[]
}

const PORT = 6454
const FRAME_MS = 1000 / 30

export const defaultRelayConfig = (): ArtNetRelayConfig => ({
  enabled: false,
  routes: Array.from({ length: 32 }, (_, universe) => ({
    enabled: false,
    inputUniverse: universe,
    targetIp: '',
    outputUniverse: universe,
    delayFrames: 0
  }))
})

export function normalizeRelayConfig(value: unknown): ArtNetRelayConfig {
  const raw = (value && typeof value === 'object' ? value : {}) as Partial<ArtNetRelayConfig>
  const rows = Array.isArray(raw.routes) ? raw.routes.slice(0, 32) : []
  const routes = Array.from({ length: 32 }, (_, i): ArtNetRelayRoute => {
    const r = (rows[i] && typeof rows[i] === 'object' ? rows[i] : {}) as Partial<ArtNetRelayRoute>
    return {
      enabled: r.enabled === true,
      inputUniverse: clampInt(r.inputUniverse, 0, 32767, i),
      targetIp: typeof r.targetIp === 'string' ? r.targetIp.trim() : '',
      outputUniverse: clampInt(r.outputUniverse, 0, 32767, i),
      delayFrames: clampInt(r.delayFrames, 0, 30, 0)
    }
  })
  return { enabled: raw.enabled === true, routes }
}

const clampInt = (v: unknown, min: number, max: number, fallback: number): number => {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : fallback
  return Math.max(min, Math.min(max, n))
}

export const isUnicastIPv4 = (ip: string): boolean => {
  const parts = ip.split('.')
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return false
  const nums = parts.map(Number)
  if (nums.some((n) => n < 0 || n > 255)) return false
  if (nums[0] === 0 || nums[0] === 127 || nums[0] >= 224) return false
  if (nums[3] === 255) return false
  return true
}

export function buildArtDmx(packet: ArtDmxPacket, outputUniverse: number): Buffer {
  const length = Math.max(2, Math.min(512, packet.data.length + (packet.data.length % 2)))
  const out = Buffer.alloc(18 + length)
  out.write('Art-Net\0', 0, 'latin1')
  out.writeUInt16LE(0x5000, 8)
  out.writeUInt16BE(14, 10)
  out.writeUInt8(packet.sequence & 0xff, 12)
  out.writeUInt8(0, 13)
  out.writeUInt8(outputUniverse & 0xff, 14)
  out.writeUInt8((outputUniverse >> 8) & 0x7f, 15)
  out.writeUInt16BE(length, 16)
  Buffer.from(packet.data.subarray(0, length)).copy(out, 18)
  return out
}

/** GrandMA3から受けたArtDMXを、Universeごとの時間だけ保持してノードへユニキャストする。 */
export class ArtNetRelay {
  private socket: Socket | null = null
  private config: ArtNetRelayConfig = defaultRelayConfig()
  private timers = new Set<ReturnType<typeof setTimeout>>()
  private localIps = new Set<string>()

  constructor(private readonly sendDatagram?: (data: Buffer, ip: string) => void) {}

  setConfig(config: unknown, localIps: string[] = []): ArtNetRelayConfig {
    // 設定変更前の宛先へ、待機中の古いフレームが後から飛ばないよう全て破棄する。
    this.cancelPending()
    this.config = normalizeRelayConfig(config)
    this.localIps = new Set(localIps)
    return this.config
  }

  handle(packet: ArtDmxPacket): void {
    if (!this.config.enabled) return
    for (const route of this.config.routes) {
      if (!route.enabled || route.inputUniverse !== packet.universe) continue
      if (!isUnicastIPv4(route.targetIp) || this.localIps.has(route.targetIp)) continue
      const data = buildArtDmx(packet, route.outputUniverse)
      const send = (): void => {
        if (this.sendDatagram) this.sendDatagram(data, route.targetIp)
        else this.ensureSocket().send(data, PORT, route.targetIp, (error) => {
          if (error) console.error(`[Art-Net relay] ${route.targetIp}: ${error.message}`)
        })
      }
      const delay = route.delayFrames * FRAME_MS
      if (delay <= 0) send()
      else {
        const timer = setTimeout(() => {
          this.timers.delete(timer)
          send()
        }, delay)
        this.timers.add(timer)
      }
    }
  }

  stop(): void {
    this.cancelPending()
    this.socket?.close()
    this.socket = null
  }

  private cancelPending(): void {
    for (const timer of this.timers) clearTimeout(timer)
    this.timers.clear()
  }

  private ensureSocket(): Socket {
    if (!this.socket) {
      this.socket = createSocket('udp4')
      // dgram の error を未処理にすると main process 全体が終了するため、必ず受け止める。
      this.socket.on('error', (error) => console.error(`[Art-Net relay] ${error.message}`))
    }
    return this.socket
  }
}
