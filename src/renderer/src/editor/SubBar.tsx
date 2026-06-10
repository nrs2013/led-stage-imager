import { useState } from 'react'
import { useStore } from '../state/store'
import { createChart, newId } from '../model/chart-model'
import { saveChartToFile, openChartFromFile } from '../io/file-ops'
import { pickImage, imageSize } from '../io/image-pick'
import { SettingsDialog } from '../ui/SettingsDialog'
import { FillDialog } from '../ui/FillDialog'
import { C, F, buttonStyle } from '../ui/tokens'

const fileBtn = { ...buttonStyle({}), padding: '6px 11px', fontSize: 11 }

export function SubBar(): React.JSX.Element {
  const chart = useStore((s) => s.chart)
  const setChart = useStore((s) => s.setChart)
  const setUnderlay = useStore((s) => s.setUnderlay)
  const setUnderlayOpacity = useStore((s) => s.setUnderlayOpacity)
  const setUnderlayVisible = useStore((s) => s.setUnderlayVisible)
  const setUnderlayMask = useStore((s) => s.setUnderlayMask)
  const applyChartImage = useStore((s) => s.applyChartImage)
  const setStarted = useStore((s) => s.setStarted)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [fillOpen, setFillOpen] = useState(false)
  const u = chart.underlay

  const loadUnderlay = async (): Promise<void> => {
    const dataUrl = await pickImage()
    if (!dataUrl) return
    const { w, h } = await imageSize(dataUrl)
    applyChartImage(dataUrl, w, h)
  }
  const newChart = (): void => {
    setChart(createChart({ w: 1920, h: 1080 }))
    setStarted(false) // back to the doorway: drop a chart or pick a blank canvas
  }
  const openChart = async (): Promise<void> => {
    try {
      const c = await openChartFromFile()
      if (c) setChart(c)
    } catch (err) {
      // eslint-disable-next-line no-alert
      alert('チャートを開けませんでした: ' + (err as Error).message)
    }
  }
  const saveChart = (): Promise<string | null> => saveChartToFile(chart)
  const duplicate = (): void =>
    setChart({ ...chart, id: newId('chart'), name: `${chart.name || 'Untitled'} copy` })

  return (
    <div style={subBar}>
      <button style={fileBtn} onClick={newChart}>
        New
      </button>
      <button style={fileBtn} onClick={openChart}>
        Load
      </button>
      <button style={fileBtn} onClick={saveChart}>
        Save
      </button>
      <button style={fileBtn} onClick={duplicate}>
        Copy
      </button>
      <button style={fileBtn} onClick={() => setSettingsOpen(true)}>
        Setup
      </button>

      <div style={sep} />

      <button
        style={{ ...buttonStyle({}), padding: '6px 12px' }}
        onClick={loadUnderlay}
        title="チャート画像を読み込む（キャンバスは画像のピクセル数に合わせ直されます）"
      >
        Chart
      </button>

      {u && (
        <>
          <span style={lbl}>Opacity</span>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(u.opacity * 100)}
            style={{ width: 110, accentColor: C.accent }}
            onChange={(e) => setUnderlayOpacity(Number(e.target.value) / 100)}
          />
          <label style={{ ...lbl, display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={u.visible}
              style={{ accentColor: C.accent }}
              onChange={(e) => setUnderlayVisible(e.target.checked)}
            />
            Show
          </label>
          <div style={sep} />
          <button
            style={{ ...buttonStyle({ active: u.mask?.enabled ?? false }), padding: '5px 10px' }}
            onClick={() => setUnderlayMask({ enabled: !(u.mask?.enabled ?? false) })}
            title="チャートの絵がある所＝LED面だけ描けるようにする（はみ出し禁止）"
          >
            Mask
          </button>
          {u.mask?.enabled && (
            <button
              style={{ ...buttonStyle({ active: u.mask?.invert ?? false }), padding: '5px 10px' }}
              onClick={() => setUnderlayMask({ invert: !(u.mask?.invert ?? false) })}
              title="描画領域を反転（OFFにすると透明・黒い所が描画領域になります）"
            >
              Invert
            </button>
          )}
          {u.mask?.enabled && (
            <button
              style={{ ...buttonStyle({ accent: C.green, accentRGB: '168,232,120' }), padding: '5px 10px' }}
              onClick={() => setFillOpen(true)}
              title="マスク内に棒/ドットを自動敷き詰め＋連番採番"
            >
              Fill
            </button>
          )}
          <div style={sep} />
          <button
            style={{ ...buttonStyle({ accent: '#e0726a', accentRGB: '224,114,106' }), padding: '5px 10px' }}
            onClick={() => setUnderlay(null)}
          >
            Remove
          </button>
        </>
      )}

      <div style={{ flex: 1 }} />
      <span style={{ ...lbl, fontFamily: F.mono }}>
        Canvas {chart.canvas.w} × {chart.canvas.h}
      </span>

      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
      {fillOpen && <FillDialog onClose={() => setFillOpen(false)} />}
    </div>
  )
}

const subBar: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  height: 42,
  padding: '0 14px',
  background: C.panel,
  borderBottom: `0.5px solid ${C.border}`,
  flexShrink: 0
}
const lbl: React.CSSProperties = {
  fontSize: 11,
  color: C.label,
  fontFamily: "'Inter','Noto Sans JP',sans-serif"
}
const sep: React.CSSProperties = { width: '0.5px', height: 22, background: C.border, margin: '0 4px' }
