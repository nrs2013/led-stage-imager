import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../state/store'
import type { ChannelMode } from '../model/types'
import { channelCount } from '../dmx/channel-math'
import { addressAt, formatDmx } from '../dmx/address'
import { C, F, buttonStyle, inputStyle, fieldLabel } from '../ui/tokens'
import { NumberField } from './NumberField'

const CAP = 4000
const MODES: { id: ChannelMode; label: string }[] = [
  { id: 'rgb', label: 'RGB (3ch)' },
  { id: 'rgbdim', label: 'RGB+Dim (4ch)' },
  { id: 'dim', label: 'Dim (1ch)' },
  { id: 'rgbw', label: 'RGBW (5ch)' }
]

export function FillDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const mask = useStore((s) => s.mask)
  const autoFill = useStore((s) => s.autoFill)

  const [pitchX, setPitchX] = useState(20)
  const [pitchY, setPitchY] = useState(20)
  const [cellW, setCellW] = useState(6)
  const [cellH, setCellH] = useState(6)
  const [universe, setUniverse] = useState(0)
  const [start, setStart] = useState(1)
  const [mode, setMode] = useState<ChannelMode>('rgb')
  const [step, setStep] = useState(channelCount('rgb'))
  const [done, setDone] = useState<number | null>(null)
  const [busy, setBusy] = useState(false) // 実行直後の二度押しを一拍ふさぐ

  // Esc closes the dialog (matches HelpPanel / StartScreen).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.code === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const estimate = useMemo(() => {
    if (!mask) return 0
    const px = Math.max(1, Math.round(pitchX))
    const py = Math.max(1, Math.round(pitchY))
    let n = 0
    for (let y = Math.floor(py / 2); y < mask.h; y += py) {
      for (let x = Math.floor(px / 2); x < mask.w; x += px) {
        if (mask.bitmap[y * mask.w + x] === 1) n++
      }
    }
    return n
  }, [mask, pitchX, pitchY])

  const capped = Math.min(estimate, CAP)
  const lastAddr = capped > 0 ? addressAt(universe, start, mode, step, capped - 1) : null

  const generate = (): void => {
    if (busy) return // 二度押し防止＝同じ場所に重ねて置くのを防ぐ
    setBusy(true)
    setDone(autoFill({ pitchX, pitchY, cellW, cellH, universe, start, mode, step }))
    window.setTimeout(() => setBusy(false), 600)
  }

  return (
    <div style={backdrop} onClick={onClose}>
      <div style={modal} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontFamily: F.display, fontSize: 18, letterSpacing: '0.1em', color: C.white }}>
            Fill Mask
          </div>
          <div style={{ flex: 1 }} />
          <button style={{ ...buttonStyle({}), padding: '8px 12px', minWidth: 56 }} onClick={onClose}>
            Close
          </button>
        </div>

        {!mask ? (
          <div style={{ color: C.amber, fontSize: 12, fontFamily: F.ui }}>
            Load a background and enable Mask first.
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 10 }}>
              <Field label="Pitch X">
                <NumberField value={pitchX} min={1}
                  onChange={(v) => { setDone(null); setPitchX(Math.max(1, v)) }} />
              </Field>
              <Field label="Pitch Y">
                <NumberField value={pitchY} min={1}
                  onChange={(v) => { setDone(null); setPitchY(Math.max(1, v)) }} />
              </Field>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <Field label="Cell W">
                <NumberField value={cellW} min={1}
                  onChange={(v) => { setDone(null); setCellW(Math.max(1, v)) }} />
              </Field>
              <Field label="Cell H">
                <NumberField value={cellH} min={1}
                  onChange={(v) => { setDone(null); setCellH(Math.max(1, v)) }} />
              </Field>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <Field label="Universe">
                <NumberField value={universe} min={0}
                  onChange={(v) => { setDone(null); setUniverse(Math.max(0, v)) }} />
              </Field>
              <Field label="DMX Addr">
                <NumberField value={start} min={1} max={512}
                  onChange={(v) => { setDone(null); setStart(Math.min(512, Math.max(1, v))) }} />
              </Field>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <Field label="Type">
                <select value={mode} style={{ ...inputStyle, fontFamily: F.ui }}
                  onChange={(e) => {
                    const m = e.target.value as ChannelMode
                    setDone(null)
                    setMode(m)
                    setStep(channelCount(m))
                  }}>
                  {MODES.map((m) => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Offset">
                <NumberField value={step} min={1}
                  onChange={(v) => { setDone(null); setStep(Math.max(1, v)) }} />
              </Field>
            </div>

            <div style={{ fontFamily: F.mono, fontSize: 12, color: C.accent, margin: '4px 0 12px' }}>
              Cells: {capped}
              {estimate > CAP && <span style={{ color: C.amber }}>(capped at {CAP} — increase pitch)</span>}
              {lastAddr && (
                <span style={{ color: C.hint }}>
                  {'  '}DMX {formatDmx(universe, start)} … {formatDmx(lastAddr.universe, lastAddr.start)}
                </span>
              )}
            </div>

            {done !== null && (
              <div style={{ fontFamily: F.ui, fontSize: 12, color: C.green, marginBottom: 10 }}>
                Filled {done} cells.
              </div>
            )}

            <button
              style={{ ...buttonStyle({}), width: '100%', opacity: busy ? 0.5 : 1 }}
              disabled={busy}
              onClick={generate}
            >
              {done !== null ? 'もう一度 Fill（追加で置きます）' : 'Fill + Patch'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div style={{ marginBottom: 12, flex: 1 }}>
      <label style={fieldLabel}>{label}</label>
      {children}
    </div>
  )
}

const backdrop: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.55)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 100
}
const modal: React.CSSProperties = {
  width: 460,
  background: C.surface,
  border: `0.5px solid ${C.border}`,
  borderRadius: 8,
  padding: 20
}
