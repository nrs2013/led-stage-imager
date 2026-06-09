import { useState } from 'react'
import { useStore } from '../state/store'
import { createChart, newId } from '../model/chart-model'
import { saveChartToFile, openChartFromFile } from '../io/file-ops'
import { SettingsDialog } from '../ui/SettingsDialog'
import { C, F, buttonStyle } from '../ui/tokens'

interface DecorApi {
  openImage?: () => Promise<string | null>
}

async function pickImage(): Promise<string | null> {
  const api = (window as unknown as { api?: DecorApi }).api
  if (api?.openImage) return api.openImage()
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.onchange = (): void => {
      const file = input.files?.[0]
      if (!file) return resolve(null)
      const reader = new FileReader()
      reader.onload = (): void => resolve(reader.result as string)
      reader.onerror = (): void => resolve(null)
      reader.readAsDataURL(file)
    }
    input.click()
  })
}

const fileBtn = { ...buttonStyle({}), padding: '6px 11px', fontSize: 11 }

export function SubBar(): React.JSX.Element {
  const chart = useStore((s) => s.chart)
  const setChart = useStore((s) => s.setChart)
  const setUnderlay = useStore((s) => s.setUnderlay)
  const setUnderlayOpacity = useStore((s) => s.setUnderlayOpacity)
  const setUnderlayVisible = useStore((s) => s.setUnderlayVisible)
  const setUnderlayMask = useStore((s) => s.setUnderlayMask)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const u = chart.underlay

  const loadUnderlay = async (): Promise<void> => {
    const dataUrl = await pickImage()
    if (dataUrl) setUnderlay({ dataUrl, opacity: 0.5, visible: true })
  }
  const newChart = (): void => setChart(createChart({ w: chart.canvas.w, h: chart.canvas.h }))
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
        新規
      </button>
      <button style={fileBtn} onClick={openChart}>
        開く
      </button>
      <button style={fileBtn} onClick={saveChart}>
        保存
      </button>
      <button style={fileBtn} onClick={duplicate}>
        複製
      </button>
      <button style={fileBtn} onClick={() => setSettingsOpen(true)}>
        設定
      </button>

      <div style={sep} />

      <button style={{ ...buttonStyle({}), padding: '6px 12px' }} onClick={loadUnderlay}>
        下絵を読み込む
      </button>

      {u && (
        <>
          <span style={lbl}>不透明度</span>
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
            表示
          </label>
          <div style={sep} />
          <button
            style={{ ...buttonStyle({ active: u.mask?.enabled ?? false }), padding: '5px 10px' }}
            onClick={() => setUnderlayMask({ enabled: !(u.mask?.enabled ?? false) })}
            title="アルファPNGの透明部を描画領域にする（はみ出し禁止）"
          >
            マスク
          </button>
          {u.mask?.enabled && (
            <button
              style={{ ...buttonStyle({ active: u.mask?.invert ?? false }), padding: '5px 10px' }}
              onClick={() => setUnderlayMask({ invert: !(u.mask?.invert ?? false) })}
              title="描画領域を反転（不透明部を描画領域に）"
            >
              反転
            </button>
          )}
          <div style={sep} />
          <button
            style={{ ...buttonStyle({ accent: '#e0726a', accentRGB: '224,114,106' }), padding: '5px 10px' }}
            onClick={() => setUnderlay(null)}
          >
            外す
          </button>
        </>
      )}

      <div style={{ flex: 1 }} />
      <span style={{ ...lbl, fontFamily: F.mono }}>
        canvas {chart.canvas.w} × {chart.canvas.h}
      </span>

      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
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
