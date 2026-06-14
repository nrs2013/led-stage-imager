import { useEffect, useState } from 'react'
import { useStore } from '../state/store'
import type { Chart } from '../model/types'
import { formatDmx } from '../dmx/address'
import { C, F, buttonStyle } from '../ui/tokens'

type Pattern = 'none' | 'chase' | 'address'

function shapeName(chart: Chart, shapeId: string): string {
  const sh = chart.shapes.find((s) => s.id === shapeId)
  return sh ? `${sh.type} ${sh.id.slice(-4)}` : shapeId.slice(-4)
}

/** Stage colour swatches — console-feel presets, splashed with one click. */
const SWATCHES: { name: string; rgb: [number, number, number] }[] = [
  { name: '白', rgb: [255, 255, 255] },
  { name: '電球色', rgb: [255, 170, 90] },
  { name: '赤', rgb: [255, 0, 0] },
  { name: 'アンバー', rgb: [255, 96, 0] },
  { name: '黄', rgb: [255, 210, 0] },
  { name: '緑', rgb: [0, 255, 60] },
  { name: '水', rgb: [0, 220, 255] },
  { name: '青', rgb: [0, 60, 255] },
  { name: 'ラベンダー', rgb: [170, 130, 255] },
  { name: 'マゼンタ', rgb: [255, 0, 255] },
  { name: 'ピンク', rgb: [255, 105, 180] }
]

const hexToRgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16)
]

type Target = 'all' | 'layer' | 'sel'

export function ManualFaders({ onClose }: { onClose: () => void }): React.JSX.Element {
  const chart = useStore((s) => s.chart)
  const manualMode = useStore((s) => s.manualMode)
  const manualByFixture = useStore((s) => s.manualByFixture)
  const selectedIds = useStore((s) => s.selectedIds)
  const setManualMode = useStore((s) => s.setManualMode)
  const setManualColor = useStore((s) => s.setManualColor)
  const setManualAll = useStore((s) => s.setManualAll)
  const setManualMany = useStore((s) => s.setManualMany)

  const [pattern, setPattern] = useState<Pattern>('none')
  const [step, setStep] = useState(0)
  const [color, setColor] = useState<[number, number, number]>([255, 255, 255])
  const [brightness, setBrightness] = useState(100)
  const [target, setTarget] = useState<Target>('all')
  const fixtures = chart.fixtures
  const count = fixtures.length

  // Quick Light targets: every patched fixture / this song's page / canvas selection
  const homeLayer = chart.layers[0]?.id
  const layerShapeIds = new Set(
    chart.shapes.filter((s) => (s.layerId ?? homeLayer) === chart.activeLayerId).map((s) => s.id)
  )
  const selSet = new Set(selectedIds)
  const targetIds = (t: Target): string[] =>
    t === 'all'
      ? fixtures.map((f) => f.id)
      : fixtures
          .filter((f) => (t === 'layer' ? layerShapeIds : selSet).has(f.shapeId))
          .map((f) => f.id)

  const splash = (rgb: [number, number, number]): void => {
    setPattern('none')
    setManualMany(targetIds(target), rgb)
  }
  const lightUp = (): void => {
    const k = brightness / 100
    splash([Math.round(color[0] * k), Math.round(color[1] * k), Math.round(color[2] * k)])
  }

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
          Programmer
        </div>
        <div style={{ flex: 1 }} />
        <button style={{ ...buttonStyle({}), padding: '4px 10px' }} onClick={onClose}>
          Close
        </button>
      </div>
      <div style={{ fontSize: 11, color: C.faint, fontFamily: F.ui, marginBottom: 12 }}>
        Manual control — test fixtures without a console.
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        <button
          style={{ ...buttonStyle({ active: manualMode }), flex: 1 }}
          onClick={() => setManualMode(true)}
        >
          Manual
        </button>
        <button
          style={{ ...buttonStyle({ active: !manualMode }), flex: 1 }}
          onClick={() => {
            setManualMode(false)
            setPattern('none')
          }}
        >
          Live
        </button>
      </div>

      <div
        style={{
          border: `0.5px solid ${C.border}`,
          borderRadius: 5,
          padding: 10,
          marginBottom: 12
        }}
      >
        <div
          style={{
            fontSize: 10,
            color: C.label,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            fontFamily: F.ui,
            marginBottom: 8
          }}
        >
          Quick Light — 色を選んでポンと点ける
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 5, marginBottom: 8 }}>
          {SWATCHES.map((sw) => {
            const active = sw.rgb.join() === color.join()
            return (
              <button
                key={sw.name}
                title={sw.name}
                onClick={() => setColor(sw.rgb)}
                style={{
                  height: 24,
                  borderRadius: 3,
                  cursor: 'pointer',
                  background: `rgb(${sw.rgb[0]},${sw.rgb[1]},${sw.rgb[2]})`,
                  border: active ? `2px solid ${C.white}` : `0.5px solid ${C.border}`
                }}
              />
            )
          })}
          <input
            type="color"
            title="自由な色"
            onChange={(e) => setColor(hexToRgb(e.target.value))}
            style={{
              height: 24,
              width: '100%',
              padding: 0,
              borderRadius: 3,
              border: `0.5px solid ${C.border}`,
              background: 'transparent',
              cursor: 'pointer'
            }}
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
          <span style={{ fontSize: 10, color: C.label, fontFamily: F.mono, width: 50 }}>BRIGHT</span>
          <input
            type="range"
            min={0}
            max={100}
            value={brightness}
            style={{ flex: 1, accentColor: C.amber }}
            onChange={(e) => setBrightness(Number(e.target.value))}
          />
          <span style={{ width: 32, fontSize: 10, color: C.hint, fontFamily: F.mono }}>
            {brightness}%
          </span>
        </div>
        <div style={{ display: 'flex', gap: 5, marginBottom: 8 }}>
          {(
            [
              ['all', `全部 ${targetIds('all').length}`],
              ['layer', `今の曲 ${targetIds('layer').length}`],
              ['sel', `選択中 ${targetIds('sel').length}`]
            ] as [Target, string][]
          ).map(([t, label]) => (
            <button
              key={t}
              style={{ ...buttonStyle({ active: target === t }), flex: 1, padding: '5px 4px', fontSize: 10 }}
              onClick={() => setTarget(t)}
            >
              {label}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            style={{
              ...buttonStyle({ active: true, accent: C.green, accentRGB: '168,232,120' }),
              flex: 2
            }}
            onClick={lightUp}
            title="選んだ色×明るさで対象を点ける（キャンバスで電飾を選んでおけば「選択中」だけ点く）"
          >
            点ける
          </button>
          <button
            style={{ ...buttonStyle({}), flex: 1 }}
            onClick={() => splash([0, 0, 0])}
            title="対象を消灯"
          >
            消す
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 8 }}>
        <button style={buttonStyle({})} onClick={allOn}>
          Full
        </button>
        <button
          style={buttonStyle({ active: pattern === 'chase', accent: C.green, accentRGB: '168,232,120' })}
          onClick={() => setPattern((p) => (p === 'chase' ? 'none' : 'chase'))}
        >
          Chase
        </button>
        <button
          style={buttonStyle({ active: pattern === 'address', accent: C.amber, accentRGB: '245,200,120' })}
          onClick={() => setPattern((p) => (p === 'address' ? 'none' : 'address'))}
        >
          Check
        </button>
        <button
          style={buttonStyle({ accent: '#e0726a', accentRGB: '224,114,106' })}
          onClick={off}
        >
          Clear
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
          Check: {shapeName(chart, fixtures[step].shapeId)} →{' '}
          {formatDmx(fixtures[step].universe, fixtures[step].start)}
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {count === 0 && (
          <div style={{ fontSize: 11, color: C.faint, fontFamily: F.ui }}>
            No patched fixtures — patch a fixture in the Inspector.
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
                  {shapeName(chart, f.shapeId)} · {formatDmx(f.universe, f.start)}
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
