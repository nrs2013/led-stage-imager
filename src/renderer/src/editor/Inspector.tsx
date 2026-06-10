import { useStore } from '../state/store'
import type { ChannelMode, DisplayMode, Shape } from '../model/types'
import { C, F, buttonStyle, inputStyle, fieldLabel } from '../ui/tokens'
import { channelCount } from '../dmx/channel-math'
import { addressAt, formatDmx } from '../dmx/address'
import { NumberField } from '../ui/NumberField'
import { shapeBounds } from './geometry'

/** Human-readable size of a shape: spans, dot counts, lengths — diagonals included. */
function sizeText(shape: Shape): string {
  const b = shapeBounds(shape)
  if (shape.type === 'freehand') {
    const single =
      shape.points.length === 2 &&
      shape.points[0].x === shape.points[1].x &&
      shape.points[0].y === shape.points[1].y
    const dots = single ? 1 : shape.points.length
    return `X ${Math.round(b.w) + 1} px · Y ${Math.round(b.h) + 1} px · ${dots} dots`
  }
  if (shape.type === 'line' || shape.type === 'polyline') {
    const L = Math.round(Math.hypot(b.w, b.h))
    return `X ${Math.round(b.w)} px · Y ${Math.round(b.h)} px · L ${L} px`
  }
  return `W ${Math.round(b.w)} × H ${Math.round(b.h)} px`
}

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
        <SectionTitle>Fixture</SectionTitle>
        <div style={{ color: C.faint, fontSize: 12, fontFamily: F.ui, marginTop: 8 }}>
          Select a fixture to edit its shape and DMX patch.
        </div>
      </aside>
    )
  }

  const hasRepeat = (shape.repeat?.count ?? 1) > 1
  const setRepeat = (patch: Partial<{ count: number; dx: number; dy: number }>): void => {
    const cur = shape.repeat ?? { count: 1, dx: 10, dy: 0 }
    const next = { ...cur, ...patch }
    updateShape(shape.id, {
      repeat: next.count > 1 ? { count: next.count, dx: next.dx, dy: next.dy } : undefined
    })
  }

  return (
    <aside style={asideStyle}>
      <SectionTitle>Fixture</SectionTitle>
      <div style={{ fontFamily: F.mono, fontSize: 11, color: C.hint, marginBottom: 6 }}>
        {shape.type.toUpperCase()} · {shape.id.slice(-6)}
      </div>
      <div style={{ fontFamily: F.mono, fontSize: 12, color: C.accent, marginBottom: rowGap }}>
        {sizeText(shape)}
      </div>

      {/* display mode */}
      {!open && (
        <Field label="Display">
          <div style={{ display: 'flex', gap: 6 }}>
            {DISPLAY_MODES.map((m) => (
              <button
                key={m}
                style={{ ...buttonStyle({ active: shape.display === m }), flex: 1, padding: '6px 0' }}
                onClick={() => updateShape(shape.id, { display: m })}
              >
                {m === 'stroke' ? 'Stroke' : m === 'fill' ? 'Fill' : 'Both'}
              </button>
            ))}
          </div>
        </Field>
      )}

      <Field label="Width">
        <NumberField
          value={shape.strokeWidth}
          min={1}
          max={500}
          onChange={(v) => updateShape(shape.id, { strokeWidth: v })}
        />
      </Field>

      {/* repeat / array */}
      <div style={{ marginBottom: rowGap }}>
        <label style={fieldLabel}>Array{hasRepeat ? `  ×${shape.repeat!.count}` : ''}</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <label style={fieldLabel}>Count</label>
            <NumberField
              value={shape.repeat?.count ?? 1}
              min={1}
              max={4096}
              onChange={(v) => setRepeat({ count: v })}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={fieldLabel}>Pitch X</label>
            <NumberField value={shape.repeat?.dx ?? 10} onChange={(v) => setRepeat({ dx: v })} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={fieldLabel}>Pitch Y</label>
            <NumberField value={shape.repeat?.dy ?? 0} onChange={(v) => setRepeat({ dy: v })} />
          </div>
        </div>
      </div>

      <div style={{ height: 1, background: C.border, margin: `${rowGap}px 0` }} />

      {/* DMX address */}
      <SectionTitle>Patch</SectionTitle>
      {!fixture ? (
        <button
          style={{ ...buttonStyle({}), width: '100%', marginTop: 8 }}
          onClick={() => upsertFixture(shape.id, {})}
        >
          + Patch
        </button>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <Field label="Universe">
              <NumberField
                value={fixture.universe}
                min={0}
                max={32767}
                onChange={(v) => upsertFixture(shape.id, { universe: v })}
              />
            </Field>
            <Field label="DMX Addr">
              <NumberField
                value={fixture.start}
                min={1}
                max={512}
                onChange={(v) => upsertFixture(shape.id, { start: v })}
              />
            </Field>
          </div>

          <Field label="Type">
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
            <Field label="Color">
              <input
                type="color"
                value={rgbToHex(fixture.fixedColor ?? [255, 255, 255])}
                style={{ width: '100%', height: 30, background: C.inputBg, border: `0.5px solid ${C.border}`, borderRadius: 4 }}
                onChange={(e) => upsertFixture(shape.id, { fixedColor: hexToRgb(e.target.value) })}
              />
            </Field>
          )}

          {hasRepeat && (
            <Field label={`Offset (default ${channelCount(fixture.mode)})`}>
              <NumberField
                value={fixture.addressStep ?? channelCount(fixture.mode)}
                min={1}
                max={512}
                onChange={(v) => upsertFixture(shape.id, { addressStep: v })}
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
            {!hasRepeat
              ? `${formatDmx(fixture.universe, fixture.start)} – ${formatDmx(fixture.universe, fixture.start + channelCount(fixture.mode) - 1)}`
              : (() => {
                  const last = addressAt(
                    fixture.universe,
                    fixture.start,
                    fixture.mode,
                    fixture.addressStep,
                    shape.repeat!.count - 1
                  )
                  return `${formatDmx(fixture.universe, fixture.start)} … ${formatDmx(last.universe, last.start)} ×${shape.repeat!.count}`
                })()}
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
        Delete
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
