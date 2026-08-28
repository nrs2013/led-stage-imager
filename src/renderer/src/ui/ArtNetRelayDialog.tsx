import { useEffect, useMemo, useState } from 'react'
import { NumberField } from './NumberField'
import { C, F, buttonStyle, inputStyle } from './tokens'

interface RelayRoute {
  enabled: boolean
  inputUniverse: number
  targetIp: string
  outputUniverse: number
  delayFrames: number
  outputMode: 'unicast' | 'broadcast'
  mergeMode: 'none' | 'htp' | 'ltp'
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
  routes: Array.from({ length: 256 }, (_, i) => ({
    enabled: false,
    inputUniverse: i,
    targetIp: '',
    outputUniverse: i,
    delayFrames: 0,
    outputMode: 'unicast',
    mergeMode: 'none'
  }))
})

const normalize = (value: unknown): RelayConfig => {
  const raw = (value && typeof value === 'object' ? value : {}) as Partial<RelayConfig>
  const rows = Array.isArray(raw.routes) ? raw.routes : []
  return {
    enabled: raw.enabled === true,
    routes: Array.from({ length: 256 }, (_, i) => {
      const row = (rows[i] && typeof rows[i] === 'object' ? rows[i] : {}) as Partial<RelayRoute>
      return {
        enabled: row.enabled === true,
        inputUniverse: integer(row.inputUniverse, 0, 32767, i),
        targetIp: typeof row.targetIp === 'string' ? row.targetIp : '',
        outputUniverse: integer(row.outputUniverse, 0, 32767, i),
        delayFrames: integer(row.delayFrames, 0, 30, 0),
        outputMode: row.outputMode === 'broadcast' ? 'broadcast' : 'unicast',
        mergeMode: row.mergeMode === 'htp' || row.mergeMode === 'ltp' ? row.mergeMode : 'none'
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

const validBroadcastIp = (ip: string): boolean => {
  const parts = ip.trim().split('.')
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return false
  const nums = parts.map(Number)
  if (nums.some((n) => n < 0 || n > 255)) return false
  return ip.trim() === '255.255.255.255' || (nums[0] > 0 && nums[0] < 224 && nums[3] === 255)
}

const validTarget = (route: RelayRoute): boolean => route.outputMode === 'broadcast'
  ? validBroadcastIp(route.targetIp)
  : validUnicastIp(route.targetIp)

const relayApi = (): RelayApi | undefined => (window as unknown as { api?: RelayApi }).api

export function ArtNetRelayDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [config, setConfig] = useState<RelayConfig>(defaultConfig)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [rangeAnchor, setRangeAnchor] = useState<number | null>(null)
  const [dragging, setDragging] = useState(false)
  const [bulkInput, setBulkInput] = useState(1)
  const [bulkOutput, setBulkOutput] = useState(1)
  const [bulkIp, setBulkIp] = useState('')
  const [bulkOutputMode, setBulkOutputMode] = useState<'unicast' | 'broadcast'>('unicast')
  const [bulkMerge, setBulkMerge] = useState<'none' | 'htp' | 'ltp'>('none')
  const [bulkDelay, setBulkDelay] = useState(0)

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

  useEffect(() => {
    const up = (): void => setDragging(false)
    window.addEventListener('pointerup', up)
    return () => window.removeEventListener('pointerup', up)
  }, [])

  const invalidRows = useMemo(
    () => config.routes.map((route, i) => route.enabled && !validTarget(route) ? i : -1).filter((i) => i >= 0),
    [config]
  )

  const updateRoute = (index: number, patch: Partial<RelayRoute>): void => {
    setMessage('')
    setConfig((current) => ({
      ...current,
      routes: current.routes.map((route, i) => i === index ? { ...route, ...patch } : route)
    }))
  }

  const selectRange = (from: number, to: number): void => {
    const first = Math.min(from, to)
    const last = Math.max(from, to)
    setSelected(new Set(Array.from({ length: last - first + 1 }, (_, offset) => first + offset)))
  }

  const beginRange = (index: number, shift: boolean): void => {
    const anchor = shift && rangeAnchor != null ? rangeAnchor : index
    setRangeAnchor(anchor)
    selectRange(anchor, index)
    setDragging(true)
  }

  const applySelected = (makePatch: (route: RelayRoute, order: number) => Partial<RelayRoute>): void => {
    const ordered = [...selected].sort((a, b) => a - b)
    if (!ordered.length) {
      setMessage('先に左端の番号をドラッグして範囲を指定してください。')
      return
    }
    const orderOf = new Map(ordered.map((index, order) => [index, order]))
    setMessage('選んだ範囲へ反映しました。「保存して適用」で確定します。')
    setConfig((current) => ({
      ...current,
      routes: current.routes.map((route, index) => {
        const order = orderOf.get(index)
        return order == null ? route : { ...route, ...makePatch(route, order) }
      })
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

        <div style={bulkPanel}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <strong style={{ color: C.white, fontFamily: F.ui, fontSize: 11, minWidth: 120 }}>
              範囲：{selected.size ? `${selected.size} Universe` : '未指定'}
            </strong>
            <button style={smallButton} onClick={() => setSelected(new Set(config.routes.map((_, i) => i)))}>全256</button>
            <button style={smallButton} onClick={() => setSelected(new Set())}>解除</button>
            <span style={{ color: C.hint, fontFamily: F.ui, fontSize: 10 }}>
              一覧の左端の番号を押し、そのまま上下へドラッグ。Shift＋クリックでも範囲指定できます。
            </span>
          </div>
          <div style={bulkRow}>
            <span style={bulkLabel}>入力開始</span>
            <NumberField compact value={bulkInput} min={1} max={32768} onChange={setBulkInput} style={{ width: 105 }} />
            <button style={smallButton} onClick={() => applySelected((_route, order) => ({ inputUniverse: Math.min(32767, bulkInput - 1 + order) }))}>入力を連番</button>
            <span style={bulkLabel}>送信方式</span>
            <select style={selectStyle} value={bulkOutputMode} onChange={(e) => setBulkOutputMode(e.target.value as 'unicast' | 'broadcast')}>
              <option value="unicast">ユニキャスト</option><option value="broadcast">ブロードキャスト</option>
            </select>
            <input value={bulkIp} placeholder={bulkOutputMode === 'broadcast' ? '例 2.0.0.255' : '例 2.0.0.101'} style={{ ...inputStyle, width: 145, minHeight: 30 }} onFocus={(e) => e.currentTarget.select()} onChange={(e) => setBulkIp(e.target.value)} />
            <button style={smallButton} onClick={() => applySelected(() => ({ outputMode: bulkOutputMode, targetIp: bulkIp }))}>方式・IPを反映</button>
          </div>
          <div style={bulkRow}>
            <span style={bulkLabel}>出力開始</span>
            <NumberField compact value={bulkOutput} min={1} max={32768} onChange={setBulkOutput} style={{ width: 105 }} />
            <button style={smallButton} onClick={() => applySelected((_route, order) => ({ outputUniverse: Math.min(32767, bulkOutput - 1 + order) }))}>出力を連番</button>
            <span style={bulkLabel}>マージ</span>
            <select style={selectStyle} value={bulkMerge} onChange={(e) => setBulkMerge(e.target.value as 'none' | 'htp' | 'ltp')}>
              <option value="none">なし</option><option value="htp">HTP</option><option value="ltp">LTP</option>
            </select>
            <button style={smallButton} onClick={() => applySelected(() => ({ mergeMode: bulkMerge }))}>マージを反映</button>
            <span style={bulkLabel}>遅延</span>
            <NumberField compact value={bulkDelay} min={0} max={30} onChange={setBulkDelay} style={{ width: 90 }} />
            <button style={smallButton} onClick={() => applySelected(() => ({ delayFrames: bulkDelay }))}>遅延を反映</button>
            <button style={smallButton} onClick={() => applySelected(() => ({ enabled: true }))}>使用ON</button>
            <button style={smallButton} onClick={() => applySelected(() => ({ enabled: false }))}>使用OFF</button>
          </div>
        </div>

        <div style={tableHeader}>
          <span>範囲</span><span>使用</span><span>入力 U</span><span>方式</span><span>送信先 IP</span><span>出力 U</span><span>マージ</span><span>遅延</span><span>時間</span>
        </div>
        <div style={{ maxHeight: 'calc(100vh - 470px)', overflowY: 'auto', border: `0.5px solid ${C.border}` }}>
          {config.routes.map((route, i) => {
            const invalid = route.enabled && !validTarget(route)
            const isSelected = selected.has(i)
            return (
              <div key={i} style={{ ...tableRow, opacity: route.enabled || isSelected ? 1 : 0.58, background: isSelected ? 'rgba(123,197,232,0.09)' : 'transparent' }}>
                <button
                  aria-label={`範囲 ${i + 1}`}
                  title="ここを押して上下へドラッグすると範囲指定"
                  style={{ ...rangeButton, ...(isSelected ? { borderColor: C.accent, color: C.accent } : {}) }}
                  onPointerDown={(e) => { e.preventDefault(); beginRange(i, e.shiftKey) }}
                  onPointerEnter={() => { if (dragging && rangeAnchor != null) selectRange(rangeAnchor, i) }}
                >{i + 1}</button>
                <button
                  style={{ ...buttonStyle({ active: route.enabled }), padding: '8px 6px', minWidth: 46 }}
                  onClick={() => updateRoute(i, { enabled: !route.enabled })}
                >{route.enabled ? 'ON' : 'OFF'}</button>
                <NumberField compact value={route.inputUniverse + 1} min={1} max={32768} onChange={(v) => updateRoute(i, { inputUniverse: v - 1 })} />
                <select style={selectStyle} value={route.outputMode} onChange={(e) => updateRoute(i, { outputMode: e.target.value as 'unicast' | 'broadcast' })}>
                  <option value="unicast">UNI</option><option value="broadcast">BROAD</option>
                </select>
                <input
                  value={route.targetIp}
                  placeholder={route.outputMode === 'broadcast' ? '例 2.0.0.255' : '例 2.0.0.101'}
                  style={{ ...inputStyle, minHeight: 30, borderColor: invalid ? '#e87878' : '#3b3631' }}
                  onFocus={(e) => e.currentTarget.select()}
                  onChange={(e) => updateRoute(i, { targetIp: e.target.value })}
                />
                <NumberField compact value={route.outputUniverse + 1} min={1} max={32768} onChange={(v) => updateRoute(i, { outputUniverse: v - 1 })} />
                <select style={selectStyle} value={route.mergeMode} onChange={(e) => updateRoute(i, { mergeMode: e.target.value as 'none' | 'htp' | 'ltp' })}>
                  <option value="none">なし</option><option value="htp">HTP</option><option value="ltp">LTP</option>
                </select>
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
  width: 'calc(100vw - 28px)', maxWidth: 1000, maxHeight: 'calc(100vh - 28px)',
  background: C.surface, border: `0.5px solid ${C.border}`, borderRadius: 8, padding: 18,
  boxSizing: 'border-box'
}
const warning: React.CSSProperties = {
  color: C.amber, background: 'rgba(245,200,120,0.06)', border: '0.5px solid rgba(245,200,120,0.32)',
  borderRadius: 4, padding: '9px 11px', fontFamily: F.ui, fontSize: 11, lineHeight: 1.65, margin: '12px 0'
}
const gridColumns = '42px 48px 102px 80px minmax(140px,1fr) 102px 78px 92px 58px'
const tableHeader: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: gridColumns, gap: 8, alignItems: 'center',
  color: C.label, fontFamily: F.ui, fontSize: 10, padding: '0 9px 5px'
}
const tableRow: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: gridColumns, gap: 8, alignItems: 'center',
  padding: '5px 8px', borderBottom: `0.5px solid ${C.borderFaint}`
}
const bulkPanel: React.CSSProperties = {
  border: `0.5px solid ${C.border}`, background: C.surface2, borderRadius: 4,
  padding: 9, marginBottom: 10, display: 'flex', flexDirection: 'column', gap: 7
}
const bulkRow: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap'
}
const bulkLabel: React.CSSProperties = {
  color: C.label, fontFamily: F.ui, fontSize: 10, marginLeft: 4
}
const smallButton: React.CSSProperties = {
  ...buttonStyle({}), padding: '8px 9px', fontSize: 10
}
const selectStyle: React.CSSProperties = {
  ...inputStyle, minHeight: 30, padding: '5px 7px', width: 'auto'
}
const rangeButton: React.CSSProperties = {
  background: 'transparent', border: `0.5px solid ${C.border}`, color: C.hint,
  borderRadius: 3, height: 30, cursor: 'ns-resize', fontFamily: F.mono, fontSize: 10,
  padding: 0, userSelect: 'none', touchAction: 'none'
}
