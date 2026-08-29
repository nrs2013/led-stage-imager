import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../state/store'
import type { Fixture } from '../model/types'
import { addressAt, formatDmx, repeatCount } from '../dmx/address'
import { C, F, buttonStyle } from '../ui/tokens'

type Order = 'tap' | 'number' | 'address'
type SequenceItem = { fixture: Fixture; rep: number; universe: number; start: number }
const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n))
const hexToRgb = (hex: string): [number, number, number] => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]
const rgbToHex = ([r, g, b]: [number, number, number]): string => `#${[r, g, b].map((v) => clamp(v, 0, 255).toString(16).padStart(2, '0')).join('')}`

export function ManualFaders({ onClose }: { onClose: () => void }): React.JSX.Element {
  const chart = useStore((s) => s.chart)
  const manualMode = useStore((s) => s.manualMode)
  const selectedIds = useStore((s) => s.selectedIds)
  const setManualMode = useStore((s) => s.setManualMode)
  const setManualMany = useStore((s) => s.setManualMany)
  const setManualAll = useStore((s) => s.setManualAll)
  const [color, setColor] = useState<[number, number, number]>([255, 255, 255])
  const [dimmer, setDimmer] = useState(100)
  const [order, setOrder] = useState<Order>('tap')
  const [tapOrder, setTapOrder] = useState<string[]>([])
  const [step, setStep] = useState(-1)
  const [running, setRunning] = useState(false)
  const [speed, setSpeed] = useState(500)
  const [startUniverse, setStartUniverse] = useState(1)
  const [startChannel, setStartChannel] = useState(1)
  const previousSelection = useRef<string[]>([])
  const litColor = (): [number, number, number] => {
    const k = dimmer / 100
    return [Math.round(color[0] * k), Math.round(color[1] * k), Math.round(color[2] * k)]
  }
  const fixtureByShape = useMemo(() => new Map(chart.fixtures.map((f) => [f.shapeId, f])), [chart.fixtures])
  const selectedFixtureIds = selectedIds.map((id) => fixtureByShape.get(id)?.id).filter((id): id is string => !!id)
  const shapeById = useMemo(() => new Map(chart.shapes.map((shape) => [shape.id, shape])), [chart.shapes])
  const sequence = useMemo((): SequenceItem[] => {
    const selected = new Set(selectedFixtureIds)
    let fixtures = selected.size ? chart.fixtures.filter((f) => selected.has(f.id)) : chart.fixtures.slice()
    const start = (Math.max(1, startUniverse) - 1) * 512 + Math.max(1, startChannel) - 1
    if (order === 'tap') {
      const rank = new Map(tapOrder.map((id, index) => [id, index]))
      fixtures = fixtures.sort((a, b) => (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER))
    }
    const items = fixtures.flatMap((fixture) => {
      const shape = shapeById.get(fixture.shapeId)
      const count = shape ? repeatCount(shape) : 1
      return Array.from({ length: count }, (_, rep) => {
        const address = addressAt(fixture.universe, fixture.start, fixture.mode, fixture.addressStep, rep)
        return { fixture, rep, universe: address.universe, start: address.start }
      })
    }).filter((item) => item.universe * 512 + item.start - 1 >= start)
    if (order === 'address') items.sort((a, b) => a.universe - b.universe || a.start - b.start || a.rep - b.rep)
    return items
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chart.fixtures, shapeById, selectedFixtureIds.join('|'), startUniverse, startChannel, order, tapOrder])
  const lightOnly = (index: number): void => {
    if (!sequence.length) return
    const next = ((index % sequence.length) + sequence.length) % sequence.length
    setManualMode(true)
    setManualAll([0, 0, 0])
    setManualMany([`${sequence[next].fixture.id}:${sequence[next].rep}`], litColor())
    setStep(next)
  }

  useEffect(() => {
    const before = new Set(previousSelection.current)
    const added = selectedIds.filter((id) => !before.has(id))
    previousSelection.current = selectedIds
    const ids = added.map((id) => fixtureByShape.get(id)?.id).filter((id): id is string => !!id)
    if (!ids.length) return
    setTapOrder((old) => [...old.filter((id) => !ids.includes(id)), ...ids])
    setManualMany(ids, litColor())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds.join('|')])
  useEffect(() => {
    if (!running || !sequence.length) return
    const iv = setInterval(() => setStep((current) => {
      const next = (current + 1) % sequence.length
      setManualMode(true)
      setManualAll([0, 0, 0])
      setManualMany([`${sequence[next].fixture.id}:${sequence[next].rep}`], litColor())
      return next
    }), Math.max(80, speed))
    return () => clearInterval(iv)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, sequence, speed, color, dimmer])
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight') lightOnly(step + 1)
      if (e.key === 'ArrowLeft') lightOnly(step - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  useEffect(() => () => useStore.getState().setManualMode(false), [])

  return <aside style={drawer}>
    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
      <div style={{ fontFamily: F.display, fontSize: 16, letterSpacing: '0.1em', color: C.white }}>卓なしで確認</div>
      <div style={{ flex: 1 }} /><button style={{ ...buttonStyle({}), padding: '5px 11px' }} onClick={onClose}>閉じる</button>
    </div>
    <div style={{ fontSize: 11, color: C.faint, fontFamily: F.ui, marginBottom: 10 }}>線をタップすると、現在の色とDimmerで点灯します。</div>
    <div style={box}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <label style={{ flex: 1, fontFamily: F.ui, fontSize: 11, color: C.label }}>COLOR
          <input type="color" value={rgbToHex(color)} onChange={(e) => setColor(hexToRgb(e.target.value))} style={{ display: 'block', width: '100%', height: 52, marginTop: 6, padding: 2, background: 'transparent', border: `0.5px solid ${C.border}`, borderRadius: 4 }} />
        </label>
        <div onWheel={(e) => { e.preventDefault(); setDimmer((v) => clamp(v + (e.deltaY < 0 ? 1 : -1), 0, 100)) }} title="マウスホイールでDimmerを変更" style={{ width: 82, height: 82, borderRadius: '50%', border: `0.5px solid ${C.border}`, background: `conic-gradient(${C.amber} ${dimmer * 3.6}deg, #24211e 0deg)`, display: 'grid', placeItems: 'center' }}>
          <div style={{ width: 62, height: 62, borderRadius: '50%', background: C.panel, display: 'grid', placeItems: 'center', fontFamily: F.mono, color: C.white, fontSize: 13 }}>{dimmer}%</div>
        </div>
      </div>
      <input type="range" min={0} max={100} value={dimmer} onChange={(e) => setDimmer(Number(e.target.value))} style={{ width: '100%', marginTop: 8, accentColor: C.amber }} />
      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
        <button style={{ ...buttonStyle({ active: manualMode }), flex: 1 }} onClick={() => setManualMode(true)}>手動</button>
        <button style={{ ...buttonStyle({ active: !manualMode }), flex: 1 }} onClick={() => { setManualMode(false); setRunning(false) }}>Art-Net</button>
        <button style={{ ...buttonStyle({}), flex: 1 }} onClick={() => { setRunning(false); setManualAll([0, 0, 0]); setManualMode(true) }}>暗転</button>
      </div>
      <button style={{ ...buttonStyle({ active: selectedFixtureIds.length > 0 }), width: '100%', marginTop: 8 }} onClick={() => { setRunning(false); setManualAll([0, 0, 0]); setManualMany(selectedFixtureIds, litColor()) }}>選択した全てを点灯</button>
    </div>
    <div style={box}>
      <div style={label}>順番</div>
      <div style={{ display: 'flex', gap: 5 }}>{([['tap', 'タップ順'], ['number', '#番号順'], ['address', 'DMX順']] as [Order, string][]).map(([v, text]) => <button key={v} style={{ ...buttonStyle({ active: order === v }), flex: 1, padding: '6px 3px' }} onClick={() => { setOrder(v); setStep(-1) }}>{text}</button>)}</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 8 }}>
        <label style={smallLabel}>開始 Universe<input type="number" min={1} value={startUniverse} onChange={(e) => setStartUniverse(Math.max(1, Number(e.target.value)))} style={numberInput} /></label>
        <label style={smallLabel}>開始 Channel<input type="number" min={1} max={512} value={startChannel} onChange={(e) => setStartChannel(clamp(Number(e.target.value), 1, 512))} style={numberInput} /></label>
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}><button style={{ ...buttonStyle({}), flex: 1 }} onClick={() => lightOnly(step - 1)}>前へ</button><button style={{ ...buttonStyle({ active: true, accent: C.amber, accentRGB: '245,200,120' }), flex: 1 }} onClick={() => lightOnly(step + 1)}>次へ</button></div>
      <div style={{ fontFamily: F.mono, fontSize: 11, color: C.hint, marginTop: 7, minHeight: 16 }}>{step >= 0 && sequence[step] ? `${step + 1}/${sequence.length}  ${formatDmx(sequence[step].universe, sequence[step].start)}  Fixture ${sequence[step].rep + 1}` : `対象 ${sequence.length} Fixture`}</div>
    </div>
    <div style={box}>
      <div style={label}>CHASE</div><input type="range" min={80} max={2000} step={20} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} style={{ width: '100%', accentColor: C.green }} /><div style={{ fontFamily: F.mono, fontSize: 11, color: C.hint, textAlign: 'right' }}>{speed} ms</div>
      <button style={{ ...buttonStyle({ active: running, accent: C.green, accentRGB: '168,232,120' }), width: '100%', marginTop: 7 }} onClick={() => { setManualMode(true); setRunning((v) => !v) }}>{running ? '停止' : 'チェイス開始'}</button>
    </div>
  </aside>
}

const drawer: React.CSSProperties = { position: 'fixed', top: 52, right: 0, bottom: 0, width: 340, background: C.panel, borderLeft: `0.5px solid ${C.border}`, padding: 16, display: 'flex', flexDirection: 'column', zIndex: 50, boxShadow: '-8px 0 24px rgba(0,0,0,0.4)', overflowY: 'auto' }
const box: React.CSSProperties = { border: `0.5px solid ${C.border}`, borderRadius: 5, padding: 10, marginBottom: 10 }
const label: React.CSSProperties = { fontSize: 10, color: C.label, letterSpacing: '0.1em', fontFamily: F.ui, marginBottom: 8 }
const smallLabel: React.CSSProperties = { fontSize: 9, color: C.label, fontFamily: F.ui }
const numberInput: React.CSSProperties = { display: 'block', width: '100%', marginTop: 4, boxSizing: 'border-box', background: '#171513', color: C.white, border: `0.5px solid ${C.border}`, borderRadius: 3, padding: '7px 8px', fontFamily: F.mono }
