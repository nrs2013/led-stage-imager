import { useEffect, useState } from 'react'
import { useStore } from '../state/store'
import type { Chart } from '../model/types'
import { C, F, buttonStyle } from '../ui/tokens'

type Pattern = 'none' | 'chase' | 'address'

function shapeName(chart: Chart, shapeId: string): string {
  const sh = chart.shapes.find((s) => s.id === shapeId)
  return sh ? `${sh.type} ${sh.id.slice(-4)}` : shapeId.slice(-4)
}

export function ManualFaders({ onClose }: { onClose: () => void }): React.JSX.Element {
  const chart = useStore((s) => s.chart)
  const manualMode = useStore((s) => s.manualMode)
  const manualByFixture = useStore((s) => s.manualByFixture)
  const setManualMode = useStore((s) => s.setManualMode)
  const setManualColor = useStore((s) => s.setManualColor)
  const setManualAll = useStore((s) => s.setManualAll)

  const [pattern, setPattern] = useState<Pattern>('none')
  const [step, setStep] = useState(0)
  const fixtures = chart.fixtures
  const count = fixtures.length

  // Run chase / address-check patterns: light one fixture at a time.
  useEffect(() => {
    if (pattern === 'none' || count === 0) return
    setManualMode(true)
    const speed = pattern === 'address' ? 1200 : 320
    let i = 0
    const apply = (): void => {
      const fx = useStore.getState().chart.fixtures
      fx.forEach((f, idx) => setManualColor(f.id, idx === i ? [255, 255, 255] : [0, 0, 0]))
      setStep(i)
      i = (i + 1) % fx.length
    }
    apply()
    const iv = setInterval(apply, speed)
    return () => clearInterval(iv)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pattern, count])

  const allOn = (): void => {
    setPattern('none')
    setManualMode(true)
    setManualAll([255, 255, 255])
  }
  const off = (): void => {
    setPattern('none')
    setManualAll(null)
  }

  return (
    <aside style={drawer}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
        <div style={{ fontFamily: F.display, fontSize: 16, letterSpacing: '0.1em', color: C.white }}>
          テスト卓
        </div>
        <div style={{ flex: 1 }} />
        <button style={{ ...buttonStyle({}), padding: '4px 10px' }} onClick={onClose}>
          閉じる
        </button>
      </div>
      <div style={{ fontSize: 11, color: C.faint, fontFamily: F.ui, marginBottom: 12 }}>
        卓が無くても手動で点灯確認できます。
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        <button
          style={{ ...buttonStyle({ active: manualMode }), flex: 1 }}
          onClick={() => setManualMode(true)}
        >
          手動
        </button>
        <button
          style={{ ...buttonStyle({ active: !manualMode }), flex: 1 }}
          onClick={() => {
            setManualMode(false)
            setPattern('none')
          }}
        >
          ライブ
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 8 }}>
        <button style={buttonStyle({})} onClick={allOn}>
          全点灯
        </button>
        <button
          style={buttonStyle({ active: pattern === 'chase', accent: C.green, accentRGB: '168,232,120' })}
          onClick={() => setPattern((p) => (p === 'chase' ? 'none' : 'chase'))}
        >
          チェイス
        </button>
        <button
          style={buttonStyle({ active: pattern === 'address', accent: C.amber, accentRGB: '245,200,120' })}
          onClick={() => setPattern((p) => (p === 'address' ? 'none' : 'address'))}
        >
          番地確認
        </button>
        <button
          style={buttonStyle({ accent: '#e0726a', accentRGB: '224,114,106' })}
          onClick={off}
        >
          消灯
        </button>
      </div>

      {pattern === 'address' && fixtures[step] && (
        <div
          style={{
            fontFamily: F.mono,
            fontSize: 12,
            color: C.amber,
            marginBottom: 10,
            border: `0.5px solid ${C.border}`,
            borderRadius: 4,
            padding: '6px 8px'
          }}
        >
          確認中: {shapeName(chart, fixtures[step].shapeId)} → U{fixtures[step].universe}/
          {fixtures[step].start}
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {count === 0 && (
          <div style={{ fontSize: 11, color: C.faint, fontFamily: F.ui }}>
            番地を割り当てた図形がありません。Inspectorで番地を付けてください。
          </div>
        )}
        {fixtures.map((f) => {
          const rgb = manualByFixture[f.id] ?? [0, 0, 0]
          const setCh = (ch: 0 | 1 | 2, v: number): void => {
            setManualMode(true)
            const next: [number, number, number] = [rgb[0], rgb[1], rgb[2]]
            next[ch] = v
            setManualColor(f.id, next)
          }
          return (
            <div key={f.id} style={{ border: `0.5px solid ${C.border}`, borderRadius: 4, padding: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <span
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: 2,
                    background: `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`,
                    border: `0.5px solid ${C.border}`
                  }}
                />
                <span style={{ fontFamily: F.mono, fontSize: 11, color: C.text }}>
                  {shapeName(chart, f.shapeId)} · U{f.universe}/{f.start}
                </span>
              </div>
              {(['R', 'G', 'B'] as const).map((label, ch) => (
                <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 12, fontSize: 10, color: C.label, fontFamily: F.mono }}>
                    {label}
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={255}
                    value={rgb[ch]}
                    style={{ flex: 1, accentColor: ['#e0726a', C.green, '#7bc5e8'][ch] }}
                    onChange={(e) => setCh(ch as 0 | 1 | 2, Number(e.target.value))}
                  />
                  <span style={{ width: 26, fontSize: 10, color: C.hint, fontFamily: F.mono }}>
                    {rgb[ch]}
                  </span>
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </aside>
  )
}

const drawer: React.CSSProperties = {
  position: 'fixed',
  top: 52,
  right: 0,
  bottom: 0,
  width: 340,
  background: C.panel,
  borderLeft: `0.5px solid ${C.border}`,
  padding: 16,
  display: 'flex',
  flexDirection: 'column',
  zIndex: 50,
  boxShadow: '-8px 0 24px rgba(0,0,0,0.4)'
}
