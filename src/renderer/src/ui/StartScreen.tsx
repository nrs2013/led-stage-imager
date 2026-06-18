import { useEffect, useState } from 'react'
import { useStore } from '../state/store'
import { createChart } from '../model/chart-model'
import { openChartFromFile } from '../io/file-ops'
import { parseChart } from '../io/chart-file'
import { readBackup } from '../io/autosave'
import { pickImage, fileToDataUrl, imageSize } from '../io/image-pick'
import type { Chart } from '../model/types'
import { C, F, buttonStyle } from './tokens'

/**
 * The doorway: a chart image (LED layout) is the primary way in — the canvas takes the
 * image's exact pixel size and decorations are drawn on its opaque (LED) areas. A blank
 * 16:9 canvas is the escape hatch for shows without a chart.
 */
export function StartScreen(): React.JSX.Element {
  const setStarted = useStore((s) => s.setStarted)
  const setChart = useStore((s) => s.setChart)
  const setTool = useStore((s) => s.setTool)
  const setImageLight = useStore((s) => s.setImageLight)
  const applyChartImage = useStore((s) => s.applyChartImage)
  const [over, setOver] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [backup, setBackup] = useState<Chart | null>(null)

  // crash net: offer the autosaved chart from the last session
  useEffect(() => {
    void readBackup().then(setBackup)
  }, [])

  const resume = (): void => {
    if (!backup) return
    setChart(backup)
    setStarted(true)
  }

  const startWithImage = async (dataUrl: string): Promise<void> => {
    try {
      const { w, h } = await imageSize(dataUrl)
      if (w <= 0 || h <= 0) throw new Error('画像サイズを読めませんでした')
      applyChartImage(dataUrl, w, h)
      setTool('pixelpen') // start painting right away
      setStarted(true)
    } catch (err) {
      setError('チャート画像を読み込めませんでした: ' + (err as Error).message)
    }
  }

  const onDrop = async (e: React.DragEvent): Promise<void> => {
    e.preventDefault()
    setOver(false)
    setError(null)
    const file = e.dataTransfer.files?.[0]
    if (!file) return
    if (file.name.endsWith('.json')) {
      try {
        const c = parseChart(await file.text())
        setChart(c)
        setStarted(true)
      } catch (err) {
        setError('保存ファイルを開けませんでした: ' + (err as Error).message)
      }
      return
    }
    if (!file.type.startsWith('image/')) {
      setError('画像ファイル（PNG / JPG）か保存ファイル（.decor.json）をドロップしてください')
      return
    }
    const dataUrl = await fileToDataUrl(file)
    if (dataUrl) await startWithImage(dataUrl)
  }

  const openImage = async (): Promise<void> => {
    setError(null)
    const dataUrl = await pickImage()
    if (dataUrl) await startWithImage(dataUrl)
  }

  const loadSaved = async (): Promise<void> => {
    setError(null)
    try {
      const c = await openChartFromFile()
      if (c) {
        setChart(c)
        setStarted(true)
      }
    } catch (err) {
      setError('保存ファイルを開けませんでした: ' + (err as Error).message)
    }
  }

  const startBlank = (w: number, h: number): void => {
    setChart(createChart({ w, h }))
    setTool('pixelpen')
    setStarted(true)
  }

  // Esc clears a stale error message.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.code === 'Escape') setError(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <main style={wrap}>
      <div style={{ textAlign: 'center' }}>
        <h1 style={title}>LED STAGE IMAGER</h1>
        <div style={subtitle}>CHART-BASED LED DECORATION</div>
      </div>

      <div
        data-testid="chart-drop-zone"
        style={{
          ...dropZone,
          borderColor: over ? C.accent : C.border,
          background: over ? `rgba(${C.accentRGB},0.08)` : C.surface
        }}
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        onClick={openImage}
        title="クリックでファイル選択もできます"
      >
        <div style={{ fontSize: 15, fontWeight: 600, color: C.white, fontFamily: F.ui }}>
          DROP CHART IMAGE
        </div>
        <div style={{ fontSize: 12, color: C.label, fontFamily: F.ui }}>
          チャート画像（PNG / JPG）をここにドロップ — キャンバスは画像と同じピクセル数になります
        </div>
        <div style={{ fontSize: 11, color: C.hint, fontFamily: F.ui }}>
          透明にくり抜かれた所＝電飾を描く場所です（絵がある所は対象外・Invertで反転可）
        </div>
      </div>

      {backup && (
        <button
          style={{
            ...buttonStyle({ accent: C.green, accentRGB: '168,232,120' }),
            padding: '10px 18px',
            fontSize: 13
          }}
          onClick={resume}
          title="自動バックアップ（5秒ごと）から復元します。落ちても消えません"
        >
          前回の続きから — {backup.name || 'Untitled'}（{backup.layers.length}枚・電飾
          {backup.shapes.length}個）
        </button>
      )}

      <div style={row}>
        <button style={buttonStyle({})} onClick={openImage}>
          画像を開く…
        </button>
        <button style={buttonStyle({})} onClick={loadSaved}>
          保存ファイルを開く…
        </button>
        <div style={{ width: '0.5px', height: 22, background: C.border, margin: '0 6px' }} />
        <button
          style={smallBtn}
          onClick={() => startBlank(1920, 1080)}
          title="チャート無しの素のキャンバス（FHD＝フルHD・1920×1080）"
        >
          Blank 1920×1080 (FHD)
        </button>
        <button
          style={smallBtn}
          onClick={() => startBlank(3840, 2160)}
          title="チャート無しの素のキャンバス（4K UHD＝3840×2160）"
        >
          Blank 3840×2160 (4K UHD)
        </button>
      </div>

      <button
        style={imageLightBtn}
        onClick={() => setImageLight(true)}
        title="セット写真を背景に、灯体で写真を照らす本番モード（卓・Art-Net不要）"
      >
        <span
          style={{ fontFamily: F.display, fontSize: 17, letterSpacing: '0.08em', color: C.canvas }}
        >
          IMAGE LIGHTING
        </span>
        <span style={{ fontSize: 11.5, color: 'rgba(10,10,10,0.72)', fontFamily: F.ui }}>
          画像照明モード — 写真を灯体で照らす本番モード（卓なしでOK）
        </span>
      </button>

      {error && (
        <div style={errBox} data-testid="start-error">
          {error}
        </div>
      )}

    </main>
  )
}

const wrap: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 28,
  background: C.canvas
}
const title: React.CSSProperties = {
  margin: 0,
  fontFamily: F.display,
  fontSize: 44,
  letterSpacing: '0.08em',
  color: C.white,
  fontWeight: 400
}
const subtitle: React.CSSProperties = {
  marginTop: 2,
  fontSize: 10,
  letterSpacing: '0.3em',
  color: C.hint,
  fontFamily: F.ui
}
const dropZone: React.CSSProperties = {
  width: 'min(560px, 80vw)',
  padding: '46px 28px',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 9,
  border: `1.5px dashed ${C.border}`,
  borderRadius: 6,
  cursor: 'pointer',
  textAlign: 'center',
  transition: 'border-color 120ms, background 120ms'
}
const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8 }
const smallBtn: React.CSSProperties = {
  ...buttonStyle({}),
  padding: '8px 13px',
  fontSize: 11,
  fontWeight: 500,
  color: C.label
}
const imageLightBtn: React.CSSProperties = {
  width: 'min(560px, 80vw)',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 2,
  padding: '14px 20px',
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
  background: C.amber,
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.18)'
}
const errBox: React.CSSProperties = {
  maxWidth: 560,
  padding: '9px 14px',
  border: '1px solid #6a3531',
  borderRadius: 4,
  background: 'rgba(224,114,106,0.09)',
  color: '#e0726a',
  fontSize: 12,
  fontFamily: F.ui
}
