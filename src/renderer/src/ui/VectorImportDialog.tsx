import { useMemo, useState } from 'react'
import { activeLayerOf, useStore } from '../state/store'
import { scaledLedRegions } from '../model/led-layout'
import { parseDxfVectors, placeVectors, type VectorDrawing } from '../io/dxf-vectors'
import { C, F, buttonStyle, inputStyle } from './tokens'
import { NumberField } from './NumberField'

export function VectorImportDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const chart = useStore((s) => s.chart)
  const [drawing, setDrawing] = useState<VectorDrawing | null>(null)
  const [error, setError] = useState('')
  const [targetIndex, setTargetIndex] = useState(0)
  const [percent, setPercent] = useState(80)
  const panels = useMemo(
    () =>
      scaledLedRegions(activeLayerOf(chart).underlay?.ledLayout, chart.canvas.w, chart.canvas.h),
    [chart]
  )
  const targets = panels.length ? panels : [{ x: 0, y: 0, ...chart.canvas }]
  const target = targets[targetIndex] ?? targets[0]
  const placed = useMemo(
    () => (drawing ? placeVectors(drawing, target, percent / 100) : []),
    [drawing, target, percent]
  )
  const readFile = async (file: File): Promise<void> => {
    setError('')
    setDrawing(null)
    try {
      if (file.size > 20_000_000)
        throw new Error('必要な図形だけを20MB以内のDXFで書き出してください。')
      setDrawing(parseDxfVectors(await file.text()))
    } catch (e) {
      setError(e instanceof Error ? e.message : '読み込みに失敗しました')
    }
  }
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,.6)',
        zIndex: 110,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Vectorworks図形を取り込む"
        style={{
          width: 540,
          maxHeight: '90vh',
          overflowY: 'auto',
          background: C.surface,
          border: `0.5px solid ${C.border}`,
          borderRadius: 8,
          padding: 20,
          color: C.white,
          fontFamily: F.ui
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
          Vectorworks図形を取り込む
          <button style={buttonStyle({})} onClick={onClose}>
            閉じる
          </button>
        </div>
        <p style={{ fontSize: 11 }}>
          Vectorworksで電飾の図形を選び、テキスト形式のDXFで書き出してください。線・多角形・円・円弧を編集できる線として取り込みます。
        </p>
        <input
          aria-label="DXFファイル"
          type="file"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void readFile(f)
          }}
        />
        {error && (
          <p role="alert" style={{ color: C.amber }}>
            {error}
          </p>
        )}
        {drawing && (
          <>
            <p style={{ fontSize: 11 }}>
              元図形：{drawing.bounds.w.toFixed(2)} × {drawing.bounds.h.toFixed(2)} {drawing.unit}{' '}
              ／ {drawing.paths.length}本
            </p>
            {drawing.warnings.length > 0 && (
              <p role="alert" style={{ fontSize: 11, color: C.amber }}>
                {drawing.warnings.join('、')}。プレビューを確認してください。
              </p>
            )}
            <label style={{ fontSize: 11 }}>
              配置先
              <select
                aria-label="配置するLED面"
                style={{ ...inputStyle, marginBottom: 10 }}
                value={targetIndex}
                onChange={(e) => setTargetIndex(Number(e.target.value))}
              >
                {targets.map((r, i) => (
                  <option key={i} value={i}>
                    {panels.length ? `LED ${i + 1}` : 'キャンバス全体'}（{r.w} × {r.h} px）
                  </option>
                ))}
              </select>
            </label>
            <label style={{ fontSize: 11 }}>
              LED面に対する大きさ（%・縦横比を保持）
              <NumberField value={percent} min={1} max={100} onChange={setPercent} />
            </label>
            <svg
              role="img"
              aria-label="LED面への配置プレビュー"
              viewBox={`${target.x} ${target.y} ${target.w} ${target.h}`}
              style={{ width: '100%', height: 220, background: '#707070', marginTop: 10 }}
            >
              {placed.map((shape, i) => (
                <polyline
                  key={i}
                  points={shape.points.map((p) => `${p.x},${p.y}`).join(' ')}
                  fill="none"
                  stroke="black"
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </svg>
            <p style={{ fontSize: 11 }}>
              中央に配置します。取り込んだ後も移動・拡大縮小・Patchができます。⌘Zでまとめて取り消せます。
            </p>
            <button
              style={{ ...buttonStyle({}), width: '100%' }}
              onClick={() => {
                useStore.getState().importVectorShapes(placed)
                onClose()
                window.dispatchEvent(new CustomEvent('decor:fit'))
              }}
            >
              この配置で取り込む
            </button>
          </>
        )}
      </div>
    </div>
  )
}
