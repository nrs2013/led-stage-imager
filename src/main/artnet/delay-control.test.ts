import { afterEach, describe, expect, it, vi } from 'vitest'
import { ArtNetRelay, normalizeDelayControl, normalizeRelayConfig } from './artnet-relay'

afterEach(() => vi.useRealTimers())

function setup(signalLoss = 'hold', timeoutMs = 2500) {
  vi.useFakeTimers()
  const sent: Buffer[] = []
  const relay = new ArtNetRelay((data) => sent.push(data))
  const config = {
    enabled: true,
    delayControl: { enabled: true, universe: 99, channel: 2, onThreshold: 128, timeoutMs, signalLoss },
    routes: [0, 1].map((u) => ({ enabled: true, inputUniverse: u, outputUniverse: u + 10, targetIp: '10.0.0.2', delayFrames: 3 }))
  }
  relay.setConfig(config, ['10.0.0.1'])
  const control = (value: number) => relay.handle({ universe: 99, sequence: 1, data: Uint8Array.of(0, value) })
  const frame = (value: number, universe = 0) => relay.handle({ universe, sequence: value, data: Uint8Array.of(value, 0) })
  return { relay, sent, control, frame, config }
}

describe('DMX delay bypass', () => {
  it('keeps old settings disabled and rejects an invalid control address', () => {
    expect(normalizeRelayConfig({ enabled: true }).delayControl.enabled).toBe(false)
    expect(normalizeDelayControl(undefined).timeoutMs).toBe(5500)
    expect(normalizeDelayControl({ timeoutMs: 2500 }).timeoutMs).toBe(2500)
    expect(normalizeDelayControl({ enabled: true, universe: -1, channel: 1 }).enabled).toBe(false)
    expect(normalizeDelayControl({ enabled: true, universe: 32767, channel: 512 }).enabled).toBe(true)
  })

  it('preserves delay before first control; OFF cancels queued frames across universes', () => {
    const { sent, control, frame, relay } = setup()
    frame(1); frame(2, 1)
    expect(sent).toHaveLength(0)
    control(127)
    frame(3); frame(4, 1)
    expect(sent.map((b) => b[18])).toEqual([3, 4])
    vi.advanceTimersByTime(1000)
    expect(sent.map((b) => b[18])).toEqual([3, 4])
    control(128)
    frame(5)
    vi.advanceTimersByTime(99)
    expect(sent).toHaveLength(2)
    vi.advanceTimersByTime(2)
    expect(sent.map((b) => b[18])).toEqual([3, 4, 5])
    relay.stop()
  })

  it('reads a control channel in the same packet before scheduling that packet', () => {
    const { relay, sent, config } = setup()
    relay.setConfig({ ...config, delayControl: { ...config.delayControl, universe: 0 } })
    relay.handle({ universe: 0, sequence: 1, data: Uint8Array.of(10, 128) })
    relay.handle({ universe: 0, sequence: 2, data: Uint8Array.of(20, 0) })
    vi.advanceTimersByTime(500)
    expect(sent.map((b) => b[18])).toEqual([20])
    relay.stop()
  })

  it('holds OFF on control loss and ignores short, unrelated and self-originated packets', () => {
    const { relay, sent, control, frame } = setup()
    control(0)
    relay.handle({ universe: 99, sequence: 1, data: Uint8Array.of(255) })
    relay.handle({ universe: 98, sequence: 1, data: Uint8Array.of(0, 255) })
    relay.handle({ universe: 99, sourceIp: '10.0.0.1', sequence: 1, data: Uint8Array.of(0, 255) })
    vi.advanceTimersByTime(3000)
    frame(7)
    expect(sent[0][18]).toBe(7)
    relay.stop()
  })

  it('uses a timer for signal loss even with no subsequent incoming packets', () => {
    const { relay, sent, control, frame } = setup('bypass', 100)
    control(255)
    frame(1)
    vi.advanceTimersByTime(101)
    expect(sent).toHaveLength(0) // timeout discards the queued old frame
    frame(2)
    expect(sent[0][18]).toBe(2)
    control(255) // recovered control enables delay again
    frame(3)
    expect(sent).toHaveLength(1)
    relay.stop()
    vi.runAllTimers()
    expect(sent).toHaveLength(1)
  })

  it('refreshes the control timeout and supports delay-on after loss', () => {
    const { relay, sent, control, frame } = setup('delay', 200)
    control(0)
    vi.advanceTimersByTime(150)
    control(0)
    vi.advanceTimersByTime(100)
    frame(1)
    expect(sent).toHaveLength(1)
    vi.advanceTimersByTime(101)
    frame(2)
    expect(sent).toHaveLength(1)
    vi.advanceTimersByTime(101)
    expect(sent.map((b) => b[18])).toEqual([1, 2])
    relay.stop()
  })

  it('cancels signal-loss state on config replacement', () => {
    const { relay, sent, config, control, frame } = setup('bypass', 100)
    control(255)
    relay.setConfig({ ...config, delayControl: { enabled: false } })
    vi.advanceTimersByTime(101)
    frame(1)
    expect(sent).toHaveLength(0)
    vi.advanceTimersByTime(101)
    expect(sent).toHaveLength(1)
    relay.stop()
  })
})
