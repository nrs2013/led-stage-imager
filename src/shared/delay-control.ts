/** Universe is zero-based on the wire; channel is the operator's 1..512. */
export interface DelayControl {
  enabled: boolean
  universe: number
  channel: number
  onThreshold: number
  timeoutMs: number
  signalLoss: 'hold' | 'bypass' | 'delay'
}

/** Proposed values only: old configurations keep DMX switching disabled. */
export function normalizeDelayControl(value: unknown): DelayControl {
  const raw = (value && typeof value === 'object' ? value : {}) as Partial<DelayControl>
  const integer = (v: unknown, min: number, max: number, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v)
      ? Math.max(min, Math.min(max, Math.floor(v))) : fallback
  const validAddress = Number.isInteger(raw.universe) && Number(raw.universe) >= 0 &&
    Number(raw.universe) <= 32767 && Number.isInteger(raw.channel) &&
    Number(raw.channel) >= 1 && Number(raw.channel) <= 512
  return {
    enabled: raw.enabled === true && validAddress,
    universe: integer(raw.universe, 0, 32767, 0),
    channel: integer(raw.channel, 1, 512, 1),
    onThreshold: integer(raw.onThreshold, 1, 255, 128),
    timeoutMs: integer(raw.timeoutMs, 100, 60000, 5500),
    signalLoss: raw.signalLoss === 'bypass' || raw.signalLoss === 'delay' ? raw.signalLoss : 'hold'
  }
}
