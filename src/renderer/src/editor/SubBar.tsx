import { useEffect, useState } from 'react'
import { useStore, activeLayerOf } from '../state/store'
import { createChart, newId } from '../model/chart-model'
import { saveChartToFile, saveChartAsToFile, openChartFromFile, markNewChart } from '../io/file-ops'
import { pickImage, imageSize } from '../io/image-pick'
import { SettingsDialog } from '../ui/SettingsDialog'
import { FillDialog } from '../ui/FillDialog'
import { C, F, chrome, buttonStyle } from '../ui/tokens'

const fileBtn = { ...buttonStyle({}), padding: '8px 11px', fontSize: 11 }

export function SubBar(): React.JSX.Element {
  const chart = useStore((s) => s.chart)
  const setChart = useStore((s) => s.setChart)
  const setUnderlay = useStore((s) => s.setUnderlay)
  const setUnderlayOpacity = useStore((s) => s.setUnderlayOpacity)
  const setUnderlayVisible = useStore((s) => s.setUnderlayVisible)
  const setUnderlayMask = useStore((s) => s.setUnderlayMask)
  const applyChartImage = useStore((s) => s.applyChartImage)
  const maskEmpty = useStore((s) => s.maskEmpty)
  const showDims = useStore((s) => s.showDims)
  const setShowDims = useStore((s) => s.setShowDims)
  const stepPatch = useStore((s) => s.stepPatch)
  const setStepPatch = useStore((s) => s.setStepPatch)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [fillOpen, setFillOpen] = useState(false)
  const [savedFlash, setSavedFlash] = useState<string | null>(null)
  const [newFlash, setNewFlash] = useState(false)
  const u = activeLayerOf(chart).underlay

  // "New chart" flash — New を押したら必ず目に見える反応を出す（空の時は見た目が変わらず
  // 「効いてない？」と誤解されるため・のむさん 2026-06-20）
  useEffect(() => {
    if (!newFlash) return
    const t = setTimeout(() => setNewFlash(false), 1800)
    return () => clearTimeout(t)
  }, [newFlash])

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
    markNewChart() // 新規＝ファイル未確定。次の保存で保存先を聞く
    setChart(createChart({ w: 1920, h: 1080 }))
    // 編集画面のまま空チャートにする。StartScreen へ戻すと SHOW MODE 再選択で
    // 「前回の続き(自動バックアップ)」が復活し、新規にならない不具合になるため戻さない。
    setSavedFlash(null)
    setNewFlash(true) // 目に見える反応（空の時でも「効いた」と分かる）
    window.dispatchEvent(new CustomEvent('decor:fit')) // ビューを全体表示にリセット
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
  const saveChartAs = async (): Promise<void> => {
    const label = await saveChartAsToFile(chart)
    if (label) window.dispatchEvent(new CustomEvent('decor:saved', { detail: label }))
  }
  const duplicate = (): void => {
    markNewChart() // 複製＝別作品。元ファイルに上書きしないよう保存先をリセット
    setChart({ ...chart, id: newId('chart'), name: `${chart.name || 'Untitled'} copy` })
  }

  return (
    <div style={subBar}>
      <button style={fileBtn} onClick={newChart}>
        New
      </button>
      <button style={fileBtn} onClick={openChart}>
        Open
      </button>
      <button style={fileBtn} onClick={saveChart} title="今のファイルに上書き保存（⌘S・初回だけ保存先を聞く）">
        Save
      </button>
      <button style={fileBtn} onClick={saveChartAs} title="別名で保存（新しいファイルとして保存し、以降はそちらに上書き）">
        Save As
      </button>
      {savedFlash && (
        <span style={{ fontSize: 11, color: C.green, fontFamily: F.mono, whiteSpace: 'nowrap' }}>
          Saved: {savedFlash}
        </span>
      )}
      {newFlash && (
        <span style={{ fontSize: 11, color: C.cyan, fontFamily: F.mono, whiteSpace: 'nowrap' }}>
          ● New chart
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
          padding: '8px 12px'
        }}
        onClick={() => setStepPatch(!stepPatch)}
        title="ステップアップモード：描く（置く・スタンプする）たびに、次の空き番地へ自動でパッチされます"
      >
        Step Patch
      </button>

      <div style={sep} />

      <button
        style={{ ...buttonStyle({}), padding: '8px 12px' }}
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
          <label style={{ ...lbl, display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', padding: '4px 2px' }}>
            <input
              type="checkbox"
              checked={u.visible}
              style={{ accentColor: C.accent, width: 16, height: 16 }}
              onChange={(e) => setUnderlayVisible(e.target.checked)}
            />
            Show
          </label>
          <div style={sep} />
          <button
            style={{ ...buttonStyle({ active: u.mask?.enabled ?? false }), padding: '8px 10px' }}
            onClick={() => setUnderlayMask({ enabled: !(u.mask?.enabled ?? false) })}
            title="チャートの透明にくり抜かれた所だけ描けるようにする（はみ出し禁止）"
          >
            Mask
          </button>
          {u.mask?.enabled && (
            <button
              style={{ ...buttonStyle({ active: u.mask?.invert ?? false }), padding: '8px 10px' }}
              onClick={() => setUnderlayMask({ invert: !(u.mask?.invert ?? false) })}
              title="描画領域を反転（ONにすると絵がある所が描画領域になります）"
            >
              Invert
            </button>
          )}
          {u.mask?.enabled && (
            <button
              style={{ ...buttonStyle({ accent: C.green, accentRGB: '168,232,120' }), padding: '8px 10px' }}
              onClick={() => setFillOpen(true)}
              title="マスク内に棒/ドットを自動敷き詰め＋連番採番"
            >
              Fill
            </button>
          )}
          <button
            style={{ ...buttonStyle({ active: showDims }), padding: '8px 10px' }}
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
            style={{ ...buttonStyle({ accent: '#e0726a', accentRGB: '224,114,106' }), padding: '8px 10px' }}
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
  background: chrome.bar,
  borderBottom: `0.5px solid ${C.border}`,
  flexShrink: 0
}
const lbl: React.CSSProperties = {
  fontSize: 11,
  color: C.label,
  fontFamily: "'Inter','Noto Sans JP',sans-serif"
}
const sep: React.CSSProperties = { width: '0.5px', height: 22, background: C.border, margin: '0 4px' }
