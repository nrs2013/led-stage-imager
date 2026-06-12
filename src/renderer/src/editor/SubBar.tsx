import { useEffect, useState } from 'react'
import { useStore, activeLayerOf } from '../state/store'
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
  const maskEmpty = useStore((s) => s.maskEmpty)
  const showDims = useStore((s) => s.showDims)
  const setShowDims = useStore((s) => s.setShowDims)
  const stepPatch = useStore((s) => s.stepPatch)
  const setStepPatch = useStore((s) => s.setStepPatch)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [fillOpen, setFillOpen] = useState(false)
  const [savedFlash, setSavedFlash] = useState<string | null>(null)
  const u = activeLayerOf(chart).underlay

  // "Saved: name" flash — fired by the Save button AND ⌘S (EditorCanvas)
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null
    const onSaved = (e: Event): void => {
      setSavedFlash(String((e as CustomEvent).detail))
      if (t) clearTimeout(t)
      t = setTimeout(() => setSavedFlash(null), 2500)
    }
    window.addEventListener('decor:saved', onSaved)
    return () => {
      if (t) clearTimeout(t)
      window.removeEventListener('decor:saved', onSaved)
    }
  }, [])

  const loadUnderlay = async (): Promise<void> => {
    const dataUrl = await pickImage()
    if (!dataUrl) return
    const { w, h } = await imageSize(dataUrl)
    applyChartImage(dataUrl, w, h)
  }
  const newChart = (): void => {
    if (
      chart.shapes.length > 0 &&
      !window.confirm('現在の作品を閉じて新規にしますか？（保存していない変更は消えます）')
    ) {
      return
    }
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
  const saveChart = async (): Promise<void> => {
    const label = await saveChartToFile(chart)
    if (label) window.dispatchEvent(new CustomEvent('decor:saved', { detail: label }))
  }
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
      <button style={fileBtn} onClick={saveChart} title="ファイルに保存（⌘S）">
        Save
      </button>
      {savedFlash && (
        <span style={{ fontSize: 11, color: C.green, fontFamily: F.mono, whiteSpace: 'nowrap' }}>
          Saved: {savedFlash}
        </span>
      )}
      <button style={fileBtn} onClick={duplicate}>
        Copy
      </button>
      <button style={fileBtn} onClick={() => setSettingsOpen(true)}>
        Setup
      </button>

      <div style={sep} />

      <button
        style={{
          ...buttonStyle({ active: stepPatch, accent: C.green, accentRGB: '168,232,120' }),
          padding: '6px 12px'
        }}
        onClick={() => setStepPatch(!stepPatch)}
        title="ステップアップモード：描く（置く・スタンプする）たびに、次の空き番地へ自動でパッチされます"
      >
        Step Patch
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
            title="チャートの透明にくり抜かれた所だけ描けるようにする（はみ出し禁止）"
          >
            Mask
          </button>
          {u.mask?.enabled && (
            <button
              style={{ ...buttonStyle({ active: u.mask?.invert ?? false }), padding: '5px 10px' }}
              onClick={() => setUnderlayMask({ invert: !(u.mask?.invert ?? false) })}
              title="描画領域を反転（ONにすると絵がある所が描画領域になります）"
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
          <button
            style={{ ...buttonStyle({ active: showDims }), padding: '5px 10px' }}
            onClick={() => setShowDims(!showDims)}
            title="くり抜きの寸法線（X/Yのピクセル数）を表示"
          >
            Sizes
          </button>
          {u.mask?.enabled && maskEmpty && (
            <span style={{ ...lbl, color: C.amber }}>
              この画像では描ける所が0 → 制限を解除中（Invert で反転を試して）
            </span>
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
