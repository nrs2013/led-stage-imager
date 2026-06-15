import { useEffect, useState } from 'react'
import { useStore } from '../state/store'
import { C, F } from '../ui/tokens'

interface NetApi {
  listInterfaces?: () => Promise<{ name: string; address: string }[]>
  setBind?: (ip: string) => Promise<boolean>
  getStatus?: () => Promise<{ hasClients: boolean; syphonAvailable: boolean; platform: string }>
}
const netApi = (): NetApi | undefined => (window as unknown as { api?: NetApi }).api

export function StatusBar(): React.JSX.Element {
  const lastSeen = useStore((s) => s.lastSeenByUniverse)
  const [now, setNow] = useState(() => Date.now())
  const [nics, setNics] = useState<{ name: string; address: string }[]>([])
  const [nic, setNic] = useState('0.0.0.0')
  const [syphon, setSyphon] = useState(false)
  const [platform, setPlatform] = useState<string>('darwin')
  const [syphonAvailable, setSyphonAvailable] = useState(true)

  useEffect(() => {
    netApi()
      ?.listInterfaces?.()
      .then(setNics)
      .catch(() => {})
    const tick = setInterval(() => setNow(Date.now()), 500)
    const poll = setInterval(() => {
      netApi()
        ?.getStatus?.()
        .then((r) => {
          setSyphon(r.hasClients)
          setSyphonAvailable(r.syphonAvailable)
          setPlatform(r.platform)
        })
        .catch(() => {})
    }, 1000)
    return () => {
      clearInterval(tick)
      clearInterval(poll)
    }
  }, [])

  const universes = Object.keys(lastSeen)
    .map(Number)
    .sort((a, b) => a - b)
  const hasNet = !!netApi()?.listInterfaces

  return (
    <div style={bar}>
      <span style={lbl}>Art-Net In</span>
      {universes.length === 0 ? (
        <span style={{ ...chip, color: C.faint, borderColor: C.border }}>No Signal</span>
      ) : (
        universes.map((u) => {
          const live = now - (lastSeen[u] || 0) < 2000
          const col = live ? C.green : '#e0726a'
          return (
            <span key={u} style={{ ...chip, color: col, borderColor: col }}>
              U{u} ●
            </span>
          )
        })
      )}

      <div style={sep} />
      {syphonAvailable ? (
        <span
          style={{
            ...chip,
            color: syphon ? C.green : C.faint,
            borderColor: syphon ? C.green : C.border
          }}
        >
          Syphon Out {syphon ? '● Linked' : '○ —'}
        </span>
      ) : (
        <span style={{ ...chip, color: C.faint, borderColor: C.border }}>
          {platform === 'win32' ? 'Spout Out ○ 準備中' : 'Output ○ —'}
        </span>
      )}

      <div style={{ flex: 1 }} />

      {hasNet && (
        <>
          <span style={lbl}>Interface</span>
          <select
            value={nic}
            onChange={(e) => {
              setNic(e.target.value)
              netApi()?.setBind?.(e.target.value)
            }}
            style={sel}
          >
            {nics.map((n) => (
              <option key={n.address} value={n.address}>
                {n.name}
              </option>
            ))}
          </select>
        </>
      )}
    </div>
  )
}

const bar: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  height: 34,
  padding: '0 14px',
  background: C.panel,
  borderTop: `0.5px solid ${C.border}`,
  flexShrink: 0
}
const lbl: React.CSSProperties = {
  fontSize: 10,
  color: C.label,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  fontFamily: F.ui
}
const chip: React.CSSProperties = {
  fontFamily: F.mono,
  fontSize: 11,
  border: `0.5px solid ${C.border}`,
  borderRadius: 3,
  padding: '2px 7px'
}
const sep: React.CSSProperties = { width: '0.5px', height: 18, background: C.border, margin: '0 4px' }
const sel: React.CSSProperties = {
  background: C.inputBg,
  border: `0.5px solid ${C.border}`,
  color: C.white,
  borderRadius: 4,
  padding: '4px 8px',
  fontSize: 11,
  fontFamily: F.ui,
  outline: 'none'
}
