import { afterEach, describe, expect, it, vi } from 'vitest'
import { ArtNetRelay, buildArtDmx, defaultRelayConfig, isUnicastIPv4, normalizeRelayConfig } from './artnet-relay'

afterEach(() => vi.useRealTimers())

describe('Art-Net delay relay', () => {
  it('32 universes default to safe OFF and same-number routing', () => {
    const c = defaultRelayConfig()
    expect(c.enabled).toBe(false)
    expect(c.routes).toHaveLength(32)
    expect(c.routes[31]).toMatchObject({ inputUniverse: 31, outputUniverse: 31, delayFrames: 0 })
  })

  it('clamps delay to 0..30 frames and universes to Art-Net range', () => {
    const c = normalizeRelayConfig({
      enabled: true,
      routes: [{ enabled: true, inputUniverse: -2, outputUniverse: 99999, delayFrames: 88, targetIp: '10.0.0.2' }]
    })
    expect(c.routes[0]).toMatchObject({ inputUniverse: 0, outputUniverse: 32767, delayFrames: 30 })
  })

  it('accepts unicast node IPs but rejects loop/multicast/broadcast addresses', () => {
    expect(isUnicastIPv4('10.0.0.20')).toBe(true)
    expect(isUnicastIPv4('127.0.0.1')).toBe(false)
    expect(isUnicastIPv4('239.1.1.1')).toBe(false)
    expect(isUnicastIPv4('255.255.255.255')).toBe(false)
  })

  it('builds an ArtDMX packet with remapped universe and even payload length', () => {
    const b = buildArtDmx({ universe: 0, sequence: 9, data: Uint8Array.from([1, 2, 3]) }, 513)
    expect(b.toString('latin1', 0, 8)).toBe('Art-Net\0')
    expect(b.readUInt16LE(8)).toBe(0x5000)
    expect(b.readUInt8(12)).toBe(9)
    expect(b.readUInt8(14)).toBe(1)
    expect(b.readUInt8(15)).toBe(2)
    expect(b.readUInt16BE(16)).toBe(4)
    expect(Array.from(b.subarray(18))).toEqual([1, 2, 3, 0])
  })

  it('sends each universe after its own 30fps frame delay', () => {
    vi.useFakeTimers()
    const sent: { data: Buffer; ip: string }[] = []
    const relay = new ArtNetRelay((data, ip) => sent.push({ data, ip }))
    relay.setConfig({
      enabled: true,
      routes: [{
        enabled: true,
        inputUniverse: 3,
        targetIp: '10.0.0.20',
        outputUniverse: 8,
        delayFrames: 4
      }]
    })
    relay.handle({ universe: 3, sequence: 1, data: Uint8Array.from([255, 0]) })
    vi.advanceTimersByTime(132)
    expect(sent).toHaveLength(0)
    vi.advanceTimersByTime(2)
    expect(sent).toHaveLength(1)
    expect(sent[0].ip).toBe('10.0.0.20')
    expect(sent[0].data.readUInt16LE(14)).toBe(8)
  })

  it('cancels delayed output as soon as the master output is switched off', () => {
    vi.useFakeTimers()
    const sent: Buffer[] = []
    const relay = new ArtNetRelay((data) => sent.push(data))
    relay.setConfig({ enabled: true, routes: [{ enabled: true, inputUniverse: 0, targetIp: '10.0.0.2', outputUniverse: 0, delayFrames: 30 }] })
    relay.handle({ universe: 0, sequence: 1, data: Uint8Array.from([1, 2]) })
    relay.setConfig({ enabled: false, routes: [] })
    vi.runAllTimers()
    expect(sent).toHaveLength(0)
  })
})
