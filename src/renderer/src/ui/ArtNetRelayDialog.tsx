import { useEffect, useMemo, useState } from 'react'
import { NumberField } from './NumberField'
import { C, F, buttonStyle, inputStyle } from './tokens'

interface RelayRoute {
  enabled: boolean
  inputUniverse: number
  targetIp: string
  outputUniverse: number
  delayFrames: number
}

interface RelayConfig {
  enabled: boolean
  routes: RelayRoute[]
}

interface RelayApi {
  getArtNetRelayConfig?: () => Promise<unknown>
  setArtNetRelayConfig?: (config: unknown) => Promise<unknown>
}

const defaultConfig = (): RelayConfig => ({
  enabled: false,
  routes: Array.from({ length: 32 }, (_, i) => ({
    enabled: false,
    inputUniverse: i,
    targetIp: '',
    outputUniverse: i,
    delayFrames: 0
  }))
})

const normalize = (value: unknown): RelayConfig => {
  const raw = (value && typeof value === 'object' ? value : {}) as Partial<RelayConfig>
  const rows = Array.isArray(raw.routes) ? raw.routes : []
  return {
    enabled: raw.enabled === true,
    routes: Array.from({ length: 32 }, (_, i) => {
      const row = (rows[i] && typeof rows[i] === 'object' ? rows[i] : {}) as Partial<RelayRoute>
      return {
        enabled: row.enabled === true,
        inputUniverse: integer(row.inputUniverse, 0, 32767, i),
        targetIp: typeof row.targetIp === 'string' ? row.targetIp : '',
        outputUniverse: integer(row.outputUniverse, 0, 32767, i),
        delayFrames: integer(row.delayFrames, 0, 30, 0)
      }
    })
  }
}

const integer = (v: unknown, min: number, max: number, fallback: number): number => {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : fallback
  return Math.max(min, Math.min(max, n))
}

const validUnicastIp = (ip: string): boolean => {
  const parts = ip.trim().split('.')
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return false
  const nums = parts.map(Number)
  return !nums.some((n) => n < 0 || n > 255) && nums[0] !== 0 && nums[0] !== 127 && nums[0] < 224 && nums[3] !== 255
}

const relayApi = (): RelayApi | undefined => (window as unknown as { api?: RelayApi }).api

export function ArtNetRelayDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [config, setConfig] = useState<RelayConfig>(defaultConfig)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const saved = await relayApi()?.getArtNetRelayConfig?.()
        if (alive) setConfig(normalize(saved))
      } catch {
        if (alive) setMessage('設定を読み込めませんでした。全体出力はOFFのままです。')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [])

  useEffect(() => {
    const key = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])

  const invalidRows = useMemo(
    () => config.routes.map((route, i) => route.enabled && !validUnicastIp(route.targetIp) ? i : -1).filter((i) => i >= 0),
    [config]
  )

  const updateRoute = (index: number, patch: Partial<RelayRoute>): void => {
    setMessage('')
    setConfig((current) => ({
      ...current,
      routes: current.routes.map((route, i) => i === index ? { ...route, ...patch } : route)
    }))
  }

  const save = async (): Promise<void> => {
    if (invalidRows.length) {
      setMessage(`送信先IPを確認してください（行 ${invalidRows.map((i) => i + 1).join(', ')}）`)
      return
    }
    try {
      const saved = await relayApi()?.setArtNetRelayConfig?.(config)
      setConfig(normalize(saved ?? config))
      setMessage(config.enabled ? '保存しました。Art-Netを送出中です。' : '保存しました。全体出力はOFFです。')
    } catch {
      setMessage('保存できませんでした。全体出力は変更されていません。')
    }
  }

  return (
    <div style={backdrop} onClick={onClose}>
      <div style={modal} onClick={(event) => event.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ fontFamily: F.display, fontSize: 18, letterSpacing: '0.1em', color: C.white }}>
            ART-NET 遅延出力
          </div>
          <div style={{ flex: 1 }} />
          <button style={buttonStyle({})} onClick={onClose}>閉じる</button>
        </div>

        <div style={warning}>
          全体出力をONにすると、このMacが実電飾への送信元になります。アプリ終了・Mac停止・ネットワーク切断で、電飾への出力も止まります。本番前に必ずDMXノード実機で確認してください。
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <span style={{ color: C.label, fontFamily: F.ui, fontSize: 11 }}>全体出力</span>
          <button
            style={{ ...buttonStyle({ active: config.enabled }), minWidth: 90 }}
            disabled={loading}
            onClick={() => { setMessage(''); setConfig((c) => ({ ...c, enabled: !c.enabled })) }}
          >
            {config.enabled ? 'ON' : 'OFF'}
          </button>
          <span style={{ color: C.hint, fontFamily: F.ui, fontSize: 10 }}>
            変更は右下の「保存して適用」を押した時に反映します。遅延は30fps基準です。
          </span>
        </div>

        <div style={tableHeader}>
          <span>使用</span><span>入力 Universe</span><span>送信先ノード IP</span><span>出力 Universe</span><span>遅延 frame</span><span>遅延時間</span>
        </div>
        <div style={{ maxHeight: 'calc(100vh - 330px)', overflowY: 'auto', border: `0.5px solid ${C.border}` }}>
          {config.routes.map((route, i) => {
            const invalid = route.enabled && !validUnicastIp(route.targetIp)
            return (
              <div key={i} style={{ ...tableRow, opacity: route.enabled ? 1 : 0.58 }}>
                <button
                  style={{ ...buttonStyle({ active: route.enabled }), padding: '8px 9px', minWidth: 50 }}
                  onClick={() => updateRoute(i, { enabled: !route.enabled })}
                >{route.enabled ? 'ON' : 'OFF'}</button>
                <NumberField compact value={route.inputUniverse + 1} min={1} max={32768} onChange={(v) => updateRoute(i, { inputUniverse: v - 1 })} />
                <input
                  value={route.targetIp}
                  placeholder="例 2.0.0.101"
                  style={{ ...inputStyle, minHeight: 30, borderColor: invalid ? '#e87878' : '#3b3631' }}
                  onFocus={(e) => e.currentTarget.select()}
                  onChange={(e) => updateRoute(i, { targetIp: e.target.value })}
                />
                <NumberField compact value={route.outputUniverse + 1} min={1} max={32768} onChange={(v) => updateRoute(i, { outputUniverse: v - 1 })} />
                <NumberField compact value={route.delayFrames} min={0} max={30} onChange={(v) => updateRoute(i, { delayFrames: v })} />
                <span style={{ color: C.hint, fontFamily: F.mono, fontSize: 10, textAlign: 'right' }}>
                  {Math.round(route.delayFrames * 1000 / 30)} ms
                </span>
              </div>
            )
          })}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14 }}>
          <span style={{ color: invalidRows.length ? '#e87878' : C.green, fontFamily: F.ui, fontSize: 11, flex: 1 }}>
            {message}
          </span>
          <button style={buttonStyle({})} onClick={onClose}>キャンセル</button>
          <button style={buttonStyle({ active: true })} disabled={loading} onClick={() => void save()}>
            保存して適用
          </button>
        </div>
      </div>
    </div>
  )
}

const backdrop: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.62)', display: 'flex',
  alignItems: 'center', justifyContent: 'center', zIndex: 120
}
const modal: React.CSSProperties = {
  width: 860, maxWidth: 'calc(100vw - 36px)', maxHeight: 'calc(100vh - 36px)',
  background: C.surface, border: `0.5px solid ${C.border}`, borderRadius: 8, padding: 18,
  boxSizing: 'border-box'
}
const warning: React.CSSProperties = {
  color: C.amber, background: 'rgba(245,200,120,0.06)', border: '0.5px solid rgba(245,200,120,0.32)',
  borderRadius: 4, padding: '9px 11px', fontFamily: F.ui, fontSize: 11, lineHeight: 1.65, margin: '12px 0'
}
const gridColumns = '58px 126px minmax(170px,1fr) 126px 116px 70px'
const tableHeader: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: gridColumns, gap: 8, alignItems: 'center',
  color: C.label, fontFamily: F.ui, fontSize: 10, padding: '0 9px 5px'
}
const tableRow: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: gridColumns, gap: 8, alignItems: 'center',
  padding: '5px 8px', borderBottom: `0.5px solid ${C.borderFaint}`
}
