import { useEffect, useState } from 'react'
import { useStore } from '../state/store'
import { C, F, buttonStyle, inputStyle, fieldLabel } from '../ui/tokens'
import { NumberField } from './NumberField'
import { mmPerPx, stageWidthMeters, countFittableFixtures } from '../model/scale'

const MAX_W = 4096
const MAX_H = 2160

interface SyphonApi {
  renameSyphon?: (name: string) => Promise<boolean>
}
const syphonApi = (): SyphonApi | undefined => (window as unknown as { api?: SyphonApi }).api

export function SettingsDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const chart = useStore((s) => s.chart)
  const setCanvasSize = useStore((s) => s.setCanvasSize)
  const setGamma = useStore((s) => s.setGamma)
  const setHoldOnTimeout = useStore((s) => s.setHoldOnTimeout)
  const setSyphonName = useStore((s) => s.setSyphonName)
  const setChartName = useStore((s) => s.setChartName)
  const setGlow = useStore((s) => s.setGlow)
  const setGlowAmount = useStore((s) => s.setGlowAmount)
  const setStageWidthMeters = useStore((s) => s.setStageWidthMeters)
  const fitFixturesToScale = useStore((s) => s.fitFixturesToScale)

  const tooBig = chart.canvas.w > MAX_W || chart.canvas.h > MAX_H
  const mmpp = mmPerPx(chart) // 校正済みなら mm/px、未校正は null
  const widthM = stageWidthMeters(chart) ?? ''
  const fitCount = countFittableFixtures(chart.shapes) // 実寸に直せる灯体の数
  const [fitArmed, setFitArmed] = useState(false) // 2回押しで実行（誤爆防止）
  const [widthDraft, setWidthDraft] = useState<string | null>(null) // 入力中だけ生文字を保持（打ちやすく）

  // Esc closes the dialog (matches HelpPanel / StartScreen).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.code === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div style={backdrop} onClick={onClose}>
      <div style={modal} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
          <div style={{ fontFamily: F.display, fontSize: 18, letterSpacing: '0.1em', color: C.white }}>
            Setup
          </div>
          <div style={{ flex: 1 }} />
          <button style={{ ...buttonStyle({}), padding: '8px 12px', minWidth: 56 }} onClick={onClose}>
            Close
          </button>
        </div>

        <Field label="Chart Name">
          <input
            type="text"
            value={chart.name}
            placeholder="公演名・現場名（保存ファイル名になります）"
            style={{ ...inputStyle, fontFamily: F.ui }}
            onChange={(e) => setChartName(e.target.value)}
          />
        </Field>

        <Field label="Stage Width (m)">
          <input
            type="number"
            min={0}
            step={0.1}
            value={widthDraft ?? (widthM === '' ? '' : String(widthM))}
            placeholder="未設定"
            style={inputStyle}
            onFocus={() => setWidthDraft(widthM === '' ? '' : String(widthM))}
            onChange={(e) => {
              // 入力中は打った文字をそのまま表示（空にもできる）。有効な正の値なら即反映。
              const raw = e.target.value
              setWidthDraft(raw)
              const v = Number(raw)
              if (raw.trim() !== '' && Number.isFinite(v) && v > 0) setStageWidthMeters(v)
            }}
            onBlur={(e) => {
              // 確定。0/空/NaN は未設定扱い（0でゼロ割・無限大になるのを防ぐ）
              const v = Number(e.currentTarget.value)
              setStageWidthMeters(Number.isFinite(v) && v > 0 ? v : 0)
              setWidthDraft(null)
            }}
          />
        </Field>
        {mmpp != null ? (
          <div style={{ color: C.accent, fontSize: 11, fontFamily: F.ui, marginTop: -6, marginBottom: 12 }}>
            実寸校正済み：1px = {mmpp.toFixed(mmpp < 10 ? 1 : 0)}mm ・ 1m ≈ {Math.round(1000 / mmpp)}px ・
            縦 ≈ {((chart.canvas.h * mmpp) / 1000).toFixed(1)}m
          </div>
        ) : (
          <div style={{ color: C.amber, fontSize: 11, fontFamily: F.ui, marginTop: -6, marginBottom: 12 }}>
            未校正：背景の横幅(m)を入れると置く部品が実物大になります（パッド70cm/パット50cm/パー30cm/ミニブル30cm/ボール球15cm）
          </div>
        )}
        {mmpp != null && fitCount > 0 && (
          <div style={{ marginBottom: 12 }}>
            <button
              style={{ ...buttonStyle({ active: fitArmed }), width: '100%' }}
              onClick={() => {
                if (fitArmed) {
                  fitFixturesToScale()
                  setFitArmed(false)
                } else {
                  setFitArmed(true)
                }
              }}
            >
              {fitArmed
                ? `もう一度押すと実行（${fitCount}個を実寸サイズに）`
                : `既にある部品を実寸に合わせる（${fitCount}個）`}
            </button>
            <div style={{ color: C.amber, fontSize: 10, fontFamily: F.ui, marginTop: 4 }}>
              校正前に置いた灯体の大きさを今の実寸スケールに直します。位置はそのまま・⌘Zで戻せます。
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 10 }}>
          <Field label="Canvas W">
            <NumberField
              value={chart.canvas.w}
              min={16}
              max={MAX_W}
              onChange={(v) => setCanvasSize(Math.max(16, v), chart.canvas.h)}
            />
          </Field>
          <Field label="Canvas H">
            <NumberField
              value={chart.canvas.h}
              min={16}
              max={MAX_H}
              onChange={(v) => setCanvasSize(chart.canvas.w, Math.max(16, v))}
            />
          </Field>
        </div>
        {tooBig && (
          <div style={{ color: C.amber, fontSize: 11, fontFamily: F.ui, marginBottom: 10 }}>
            over {MAX_W}×{MAX_H} — large canvas may be heavy.
          </div>
        )}

        <Field label="Syphon Name">
          <input
            type="text"
            value={chart.syphon.name}
            placeholder="LED STAGE IMAGER"
            style={{ ...inputStyle, fontFamily: F.ui }}
            onChange={(e) => {
              const v = e.target.value
              setSyphonName(v)
              // 空名のまま rename すると Resolume の Sources で見失うので、中身がある時だけ送る
              if (v.trim() !== '') syphonApi()?.renameSyphon?.(v)
            }}
          />
        </Field>

        <Toggle
          label="Gamma"
          on={chart.settings.gamma}
          onChange={setGamma}
          onText="ON"
          offText="OFF"
        />
        <Toggle
          label="On Signal Loss"
          on={chart.settings.holdOnTimeout}
          onChange={setHoldOnTimeout}
          onText="Hold Last"
          offText="Zero"
        />
        <Toggle
          label="Smoke — 会場のスモーク（全灯体のにじみが育つ）"
          on={chart.settings.glow}
          onChange={setGlow}
          onText="ON"
          offText="OFF"
        />
        {chart.settings.glow && (
          <div style={{ marginBottom: 12 }}>
            <label style={fieldLabel}>Smoke Amount {chart.settings.glowAmount}px</label>
            <input
              type="range"
              min={1}
              max={60}
              value={chart.settings.glowAmount}
              style={{ width: '100%', accentColor: C.accent }}
              onChange={(e) => setGlowAmount(Number(e.target.value))}
            />
          </div>
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

function Toggle({
  label,
  on,
  onChange,
  onText,
  offText
}: {
  label: string
  on: boolean
  onChange: (v: boolean) => void
  onText: string
  offText: string
}): React.JSX.Element {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={fieldLabel}>{label}</label>
      <div style={{ display: 'flex', gap: 6 }}>
        <button style={{ ...buttonStyle({ active: on }), flex: 1 }} onClick={() => onChange(true)}>
          {onText}
        </button>
        <button style={{ ...buttonStyle({ active: !on }), flex: 1 }} onClick={() => onChange(false)}>
          {offText}
        </button>
      </div>
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
  width: 420,
  background: C.surface,
  border: `0.5px solid ${C.border}`,
  borderRadius: 8,
  padding: 20
}
