import { useStore } from '../state/store'
import type { ChannelMode, DisplayMode } from '../model/types'
import { C, F, buttonStyle, inputStyle, fieldLabel } from '../ui/tokens'
import { channelCount } from '../dmx/channel-math'

const DISPLAY_MODES: DisplayMode[] = ['stroke', 'fill', 'both']
const CHANNEL_MODES: { id: ChannelMode; label: string }[] = [
  { id: 'rgb', label: 'RGB (3ch)' },
  { id: 'rgbdim', label: 'RGB+Dim (4ch)' },
  { id: 'dim', label: 'Dim (1ch)' },
  { id: 'rgbw', label: 'RGBW (5ch)' }
]

const rowGap = 14

export function Inspector(): React.JSX.Element {
  const chart = useStore((s) => s.chart)
  const selectedId = useStore((s) => s.selectedId)
  const updateShape = useStore((s) => s.updateShape)
  const upsertFixture = useStore((s) => s.upsertFixture)
  const removeShape = useStore((s) => s.removeShape)

  const shape = chart.shapes.find((s) => s.id === selectedId)
  const fixture = chart.fixtures.find((f) => f.shapeId === selectedId)
  const open = shape && (shape.type === 'line' || shape.type === 'polyline' || shape.type === 'freehand')

  if (!shape) {
    return (
      <aside style={asideStyle}>
        <SectionTitle>Inspector</SectionTitle>
        <div style={{ color: C.faint, fontSize: 12, fontFamily: F.ui, marginTop: 8 }}>
          図形を選択すると、ここで形と番地（DMXアドレス）を編集できます。
        </div>
      </aside>
    )
  }

  return (
    <aside style={asideStyle}>
      <SectionTitle>Inspector</SectionTitle>
      <div style={{ fontFamily: F.mono, fontSize: 11, color: C.hint, marginBottom: rowGap }}>
        {shape.type.toUpperCase()} · {shape.id.slice(-6)}
      </div>

      {/* display mode */}
      {!open && (
        <Field label="表示モード">
          <div style={{ display: 'flex', gap: 6 }}>
            {DISPLAY_MODES.map((m) => (
              <button
                key={m}
                style={{ ...buttonStyle({ active: shape.display === m }), flex: 1, padding: '6px 0' }}
                onClick={() => updateShape(shape.id, { display: m })}
              >
                {m === 'stroke' ? '線' : m === 'fill' ? '塗り' : '両方'}
              </button>
            ))}
          </div>
        </Field>
      )}

      <Field label="線の太さ">
        <input
          type="number"
          min={1}
          max={200}
          value={shape.strokeWidth}
          style={inputStyle}
          onChange={(e) => updateShape(shape.id, { strokeWidth: Number(e.target.value) })}
        />
      </Field>

      <Field label={`グロー半径  ${shape.glowRadius}px`}>
        <input
          type="range"
          min={0}
          max={80}
          value={shape.glowRadius}
          style={{ width: '100%', accentColor: C.accent }}
          onChange={(e) => updateShape(shape.id, { glowRadius: Number(e.target.value) })}
        />
      </Field>

      <Field label={`グロー強度  ${Math.round(shape.glowIntensity * 100)}%`}>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(shape.glowIntensity * 100)}
          style={{ width: '100%', accentColor: C.accent }}
          onChange={(e) => updateShape(shape.id, { glowIntensity: Number(e.target.value) / 100 })}
        />
      </Field>

      <div style={{ height: 1, background: C.border, margin: `${rowGap}px 0` }} />

      {/* DMX address */}
      <SectionTitle>番地（DMX）</SectionTitle>
      {!fixture ? (
        <button
          style={{ ...buttonStyle({}), width: '100%', marginTop: 8 }}
          onClick={() => upsertFixture(shape.id, {})}
        >
          + 番地を割り当てる
        </button>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <Field label="ユニバース">
              <input
                type="number"
                min={0}
                max={32767}
                value={fixture.universe}
                style={inputStyle}
                onChange={(e) => upsertFixture(shape.id, { universe: Number(e.target.value) })}
              />
            </Field>
            <Field label="開始番地">
              <input
                type="number"
                min={1}
                max={512}
                value={fixture.start}
                style={inputStyle}
                onChange={(e) =>
                  upsertFixture(shape.id, {
                    start: Math.min(512, Math.max(1, Number(e.target.value)))
                  })
                }
              />
            </Field>
          </div>

          <Field label="構成">
            <select
              value={fixture.mode}
              style={{ ...inputStyle, fontFamily: F.ui }}
              onChange={(e) => upsertFixture(shape.id, { mode: e.target.value as ChannelMode })}
            >
              {CHANNEL_MODES.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </Field>

          {fixture.mode === 'dim' && (
            <Field label="固定色">
              <input
                type="color"
                value={rgbToHex(fixture.fixedColor ?? [255, 255, 255])}
                style={{ width: '100%', height: 30, background: C.inputBg, border: `0.5px solid ${C.border}`, borderRadius: 4 }}
                onChange={(e) => upsertFixture(shape.id, { fixedColor: hexToRgb(e.target.value) })}
              />
            </Field>
          )}

          <div
            style={{
              fontFamily: F.mono,
              fontSize: 12,
              color: C.accent,
              marginTop: 4,
              letterSpacing: '0.04em'
            }}
          >
            U{fixture.universe} / {fixture.start}–{fixture.start + channelCount(fixture.mode) - 1}
          </div>
        </>
      )}

      <div style={{ flex: 1 }} />
      <button
        style={{
          ...buttonStyle({ accent: '#e0726a', accentRGB: '224,114,106' }),
          width: '100%',
          marginTop: rowGap
        }}
        onClick={() => removeShape(shape.id)}
      >
        図形を削除
      </button>
    </aside>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div
      style={{
        fontFamily: F.display,
        fontSize: 15,
        letterSpacing: '0.1em',
        color: C.white,
        marginBottom: 6
      }}
    >
      {children}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div style={{ marginBottom: rowGap, flex: 1 }}>
      <label style={fieldLabel}>{label}</label>
      {children}
    </div>
  )
}

const asideStyle: React.CSSProperties = {
  width: 280,
  flexShrink: 0,
  background: C.panel,
  borderLeft: `0.5px solid ${C.border}`,
  padding: 16,
  display: 'flex',
  flexDirection: 'column',
  overflowY: 'auto'
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  const h = (n: number): string => n.toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`
}
function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
