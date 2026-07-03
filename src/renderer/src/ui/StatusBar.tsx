import { useEffect, useState } from 'react'
import { useStore } from '../state/store'
import { C, F, chrome } from '../ui/tokens'
import { SIGNAL_TIMEOUT_MS } from '../dmx/resolve'

interface NetApi {
  listInterfaces?: () => Promise<{ name: string; address: string }[]>
  setBind?: (ip: string) => Promise<boolean>
  getStatus?: () => Promise<{
    hasClients: boolean
    syphonAvailable: boolean
    platform: string
    ndiActive?: boolean
    ndiRx?: number
    midiIn?: number
  }>
}
const netApi = (): NetApi | undefined => (window as unknown as { api?: NetApi }).api

export function StatusBar(): React.JSX.Element {
  const lastSeen = useStore((s) => s.lastSeenByUniverse)
  const artnetError = useStore((s) => s.artnetError)
  const fixtures = useStore((s) => s.chart.fixtures)
  const [now, setNow] = useState(() => Date.now())
  const [nics, setNics] = useState<{ name: string; address: string }[]>([])
  const [nic, setNic] = useState('0.0.0.0')
  const [platform, setPlatform] = useState<string>('darwin')
  const [ndiActive, setNdiActive] = useState(false)
  const [ndiRx, setNdiRx] = useState(0)
  const [midiIn, setMidiIn] = useState(0)

  const refreshNics = (): void => {
    netApi()
      ?.listInterfaces?.()
      .then((list) => {
        setNics(list)
        // 表示同期: 現在選択中の nic が一覧に無ければ、表示だけを実態に寄せる。
        // 絞り込みの実呼び出し(setBind)はユーザー操作時のみのままにし、通信ロジックは変えない。
        setNic((prev) => {
          if (list.length === 0) return prev
          if (list.some((n) => n.address === prev)) return prev
          const allAny = list.find((n) => n.address === '0.0.0.0')
          return allAny ? allAny.address : list[0].address
        })
      })
      .catch(() => {})
  }
  useEffect(() => {
    refreshNics()
    const tick = setInterval(() => setNow(Date.now()), 500)
    const poll = setInterval(() => {
      netApi()
        ?.getStatus?.()
        .then((r) => {
          setPlatform(r.platform)
          setNdiActive(!!r.ndiActive)
          setNdiRx(typeof r.ndiRx === 'number' ? r.ndiRx : 0)
          setMidiIn(typeof r.midiIn === 'number' ? r.midiIn : 0)
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
  // パッチ済みユニバース＝灯体が待っている回線番号。受信と突き合わせて「違う番号が来ている」を見せる
  const patched = Array.from(new Set(fixtures.map((f) => f.universe))).sort((a, b) => a - b)
  const liveSet = new Set(universes.filter((u) => now - (lastSeen[u] ?? 0) < SIGNAL_TIMEOUT_MS))
  const waiting = patched.filter((u) => !liveSet.has(u)) // パッチ済みなのに受信が無いユニバース

  return (
    <div style={bar}>
      <span style={lbl}>Art-Net In</span>
      {artnetError && (
        <span
          style={{ ...chip, color: '#e0726a', borderColor: '#e0726a' }}
          title={`Art-Net の受信口が開けませんでした（${artnetError}）。他の Art-Net アプリが同じポート6454を使っていないか確認して、アプリを再起動してください。`}
        >
          受信エラー {artnetError}
        </span>
      )}
      {universes.length === 0 ? (
        <span style={{ ...chip, color: C.faint, borderColor: C.border }}>No Signal</span>
      ) : (
        universes.map((u) => {
          const live = liveSet.has(u)
          // 受信していてもパッチ側と番号が合っていなければ琥珀色＝「届いてるけど宛先違い」
          const mismatch = live && patched.length > 0 && !patched.includes(u)
          const col = live ? (mismatch ? '#fbbf24' : C.green) : '#e0726a'
          return (
            // 表示は1始まりに統一（formatDmx/Inspector/FillDialog と同じ）。内部キー u は0始まりのまま。
            <span
              key={u}
              style={{ ...chip, color: col, borderColor: col }}
              title={
                mismatch
                  ? `U${u + 1} を受信していますが、この番号にパッチされた灯体がありません（灯体側は ${patched.map((p) => `U${p + 1}`).join(',')}）。卓のユニバース設定を確認してください（0始まり表示の卓では「アプリの番号−1」）`
                  : `U${u + 1} 受信中`
              }
            >
              U{u + 1} ●
            </span>
          )
        })
      )}
      {waiting.length > 0 && (
        <span
          style={{ ...chip, color: C.faint, borderColor: C.border }}
          title="灯体がパッチされているのに、このユニバースの信号がまだ届いていません（卓の出力設定・回線を確認）"
        >
          待ち: {waiting.map((u) => `U${u + 1}`).join(' ')}
        </span>
      )}

      <div style={sep} />
      <span style={lbl}>MIDI In</span>
      <span
        style={{
          ...chip,
          color: midiIn > 0 ? C.green : C.faint,
          borderColor: midiIn > 0 ? C.green : C.border
        }}
      >
        {midiIn > 0 ? `● ${midiIn}` : '○ —'}
      </span>

      <div style={sep} />
      {ndiActive ? (
        <>
          <span style={{ ...chip, color: C.green, borderColor: C.green }}>NDI OUT ● LIVE</span>
          {ndiRx >= 0 && (
            <span
              style={{
                ...chip,
                color: ndiRx > 0 ? C.green : C.faint,
                borderColor: ndiRx > 0 ? C.green : C.border
              }}
            >
              RX {ndiRx > 0 ? '●' : '○'} {ndiRx}
            </span>
          )}
        </>
      ) : (
        <span style={{ ...chip, color: C.faint, borderColor: C.border }}>
          {platform === 'win32' ? 'NDI OUT ○ No Runtime' : 'NDI OUT ○ —'}
        </span>
      )}

      <div style={{ flex: 1 }} />

      {hasNet && (
        <>
          <span style={lbl}>Interface</span>
          <select
            value={nic}
            onFocus={refreshNics} // 起動後に挿したLANケーブルも、開いた時に一覧へ出す
            onChange={(e) => {
              setNic(e.target.value)
              netApi()?.setBind?.(e.target.value)
            }}
            style={sel}
            title="Art-Net をどの回線の送り主から受けるかの絞り込み。迷ったら「すべて (0.0.0.0)」のまま（どれを選んでも受信が止まることはありません）"
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
  background: chrome.bar,
  borderTop: `0.5px solid ${C.border}`,
  boxShadow: chrome.topHi,
  flexShrink: 0
}
const lbl: React.CSSProperties = {
  fontSize: 10,
  color: C.hint,
  letterSpacing: '0.2em',
  textTransform: 'uppercase',
  fontFamily: F.mono
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
  padding: '7px 10px',
  minHeight: 28,
  cursor: 'pointer',
  fontSize: 11,
  fontFamily: F.ui,
  outline: 'none'
}
