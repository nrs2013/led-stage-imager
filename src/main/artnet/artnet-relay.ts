import { createSocket, type Socket } from 'node:dgram'
import type { ArtDmxPacket } from './artdmx-parser'

export interface ArtNetRelayRoute {
  enabled: boolean
  inputUniverse: number
  targetIp: string
  outputUniverse: number
  delayFrames: number
  outputMode: 'unicast' | 'broadcast'
  mergeMode: 'none' | 'htp' | 'ltp'
}

export interface ArtNetRelayConfig {
  enabled: boolean
  routes: ArtNetRelayRoute[]
}

const PORT = 6454
const FRAME_MS = 1000 / 30

export const defaultRelayConfig = (): ArtNetRelayConfig => ({
  enabled: false,
  routes: Array.from({ length: 256 }, (_, universe) => ({
    enabled: false,
    inputUniverse: universe,
    targetIp: '',
    outputUniverse: universe,
    delayFrames: 0,
    outputMode: 'unicast',
    mergeMode: 'none'
  }))
})

export function normalizeRelayConfig(value: unknown): ArtNetRelayConfig {
  const raw = (value && typeof value === 'object' ? value : {}) as Partial<ArtNetRelayConfig>
  const rows = Array.isArray(raw.routes) ? raw.routes.slice(0, 256) : []
  const routes = Array.from({ length: 256 }, (_, i): ArtNetRelayRoute => {
    const r = (rows[i] && typeof rows[i] === 'object' ? rows[i] : {}) as Partial<ArtNetRelayRoute>
    return {
      enabled: r.enabled === true,
      inputUniverse: clampInt(r.inputUniverse, 0, 32767, i),
      targetIp: typeof r.targetIp === 'string' ? r.targetIp.trim() : '',
      outputUniverse: clampInt(r.outputUniverse, 0, 32767, i),
      delayFrames: clampInt(r.delayFrames, 0, 30, 0),
      outputMode: r.outputMode === 'broadcast' ? 'broadcast' : 'unicast',
      mergeMode: r.mergeMode === 'htp' || r.mergeMode === 'ltp' ? r.mergeMode : 'none'
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

export const isBroadcastIPv4 = (ip: string): boolean => {
  const parts = ip.split('.')
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return false
  const nums = parts.map(Number)
  if (nums.some((n) => n < 0 || n > 255)) return false
  return ip === '255.255.255.255' || (nums[0] > 0 && nums[0] < 224 && nums[3] === 255)
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
  private sources = new Map<number, Map<string, SourceFrame>>()

  constructor(private readonly sendDatagram?: (data: Buffer, ip: string) => void) {}

  setConfig(config: unknown, localIps: string[] = []): ArtNetRelayConfig {
    // 設定変更前の宛先へ、待機中の古いフレームが後から飛ばないよう全て破棄する。
    this.cancelPending()
    this.config = normalizeRelayConfig(config)
    this.localIps = new Set(localIps)
    this.sources.clear()
    return this.config
  }

  handle(packet: ArtDmxPacket): void {
    if (!this.config.enabled) return
    // ブロードキャスト送出した自分自身のArtDMXを再受信して無限に送り直す事故を防ぐ。
    if (packet.sourceIp && this.localIps.has(packet.sourceIp)) return
    this.rememberSource(packet)
    for (const route of this.config.routes) {
      if (!route.enabled || route.inputUniverse !== packet.universe) continue
      const validTarget = route.outputMode === 'broadcast'
        ? isBroadcastIPv4(route.targetIp)
        : isUnicastIPv4(route.targetIp) && !this.localIps.has(route.targetIp)
      if (!validTarget) continue
      const merged = this.mergedPacket(packet, route.mergeMode)
      const data = buildArtDmx(merged, route.outputUniverse)
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
    this.sources.clear()
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
      this.socket.on('listening', () => this.socket?.setBroadcast(true))
      this.socket.bind(0)
    }
    return this.socket
  }

  private rememberSource(packet: ArtDmxPacket): void {
    const key = packet.sourceIp ?? 'unknown'
    const now = Date.now()
    let universe = this.sources.get(packet.universe)
    if (!universe) {
      universe = new Map()
      this.sources.set(packet.universe, universe)
    }
    const previous = universe.get(key)
    const changedAt = previous?.changedAt ?? new Float64Array(512)
    for (let channel = 0; channel < packet.data.length; channel++) {
      if (!previous || previous.data[channel] !== packet.data[channel]) changedAt[channel] = now
    }
    universe.set(key, { data: new Uint8Array(packet.data), sequence: packet.sequence, lastSeen: now, changedAt })
    for (const [source, frame] of universe) {
      if (now - frame.lastSeen > SOURCE_TIMEOUT_MS) universe.delete(source)
    }
  }

  private mergedPacket(packet: ArtDmxPacket, mode: ArtNetRelayRoute['mergeMode']): ArtDmxPacket {
    if (mode === 'none') return packet
    const frames = [...(this.sources.get(packet.universe)?.values() ?? [])]
    if (frames.length < 2) return packet
    const length = Math.max(...frames.map((frame) => frame.data.length))
    const data = new Uint8Array(length)
    if (mode === 'htp') {
      for (const frame of frames) {
        for (let channel = 0; channel < frame.data.length; channel++) {
          if (frame.data[channel] > data[channel]) data[channel] = frame.data[channel]
        }
      }
    } else {
      const newest = new Float64Array(length)
      for (const frame of frames) {
        for (let channel = 0; channel < frame.data.length; channel++) {
          if (frame.changedAt[channel] >= newest[channel]) {
            newest[channel] = frame.changedAt[channel]
            data[channel] = frame.data[channel]
          }
        }
      }
    }
    return { ...packet, data }
  }
}

const SOURCE_TIMEOUT_MS = 10_000
interface SourceFrame {
  data: Uint8Array
  sequence: number
  lastSeen: number
  changedAt: Float64Array
}
