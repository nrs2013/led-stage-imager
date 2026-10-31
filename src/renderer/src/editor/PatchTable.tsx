import { useEffect, useMemo, useRef } from 'react'
import { useStore } from '../state/store'
import { C, F, chrome, buttonStyle } from '../ui/tokens'
import { channelRange, detectOverlaps } from '../dmx/patch'
import { formatDmx, repeatCount } from '../dmx/address'
import { resolveColor } from '../dmx/resolve'

export function PatchTable({ onClose }: { onClose?: () => void } = {}): React.JSX.Element {
  const chart = useStore((s) => s.chart)
  const dmxByUniverse = useStore((s) => s.dmxByUniverse)
  const manualMode = useStore((s) => s.manualMode)
  const manualByFixture = useStore((s) => s.manualByFixture)
  const selectedId = useStore((s) => s.selectedId)
  const selectedIds = useStore((s) => s.selectedIds)
  const select = useStore((s) => s.select)
  const toggleSelect = useStore((s) => s.toggleSelect)
  const selectMany = useStore((s) => s.selectMany)
  const showIds = useStore((s) => s.showIds)
  const setShowIds = useStore((s) => s.setShowIds)
  const activeShapeIds = useMemo(
    () => new Set(
      chart.shapes
        .filter((shape) => (shape.layerId ?? chart.layers[0]?.id) === chart.activeLayerId)
        .map((shape) => shape.id)
    ),
    [chart.shapes, chart.layers, chart.activeLayerId]
  )
  const activeFixtures = useMemo(
    () => chart.fixtures.filter((fixture) => activeShapeIds.has(fixture.shapeId)),
    [chart.fixtures, activeShapeIds]
  )

  // when a shape is picked on the canvas, bring its chip into view
  const listRef = useRef<HTMLDivElement>(null)
  const dragStart = useRef<number | null>(null)
  useEffect(() => {
    if (!selectedId) return
    const el = listRef.current?.querySelector(`[data-shape="${selectedId}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [selectedId])

  // 個数（ネオンの文字数・連続複製）まで含めて重なりを見る。
  // 🔴 卓(Art-Net)は毎フレーム dmxByUniverse を更新するので、ここを素で書くと
  // 図形数×灯体数の総当たりが毎フレーム走って出力がガクつく。番地と図形が変わった時だけ計算する。
  const { overlaps, flagged } = useMemo(() => {
    const repsOf = (fx: { shapeId: string }): number => {
      const sh = chart.shapes.find((x) => x.id === fx.shapeId)
      return sh ? repeatCount(sh) : 1
    }
    const ov = detectOverlaps(activeFixtures, repsOf)
    return { overlaps: ov, flagged: new Set(ov.flat()) }
  }, [activeFixtures, chart.shapes])

  const shapeName = (shapeId: string): string => {
    const sh = chart.shapes.find((s) => s.id === shapeId)
    return sh ? `${sh.type} ${sh.id.slice(-4)}` : shapeId.slice(-4)
  }



  return (
    <div style={wrapStyle}>
      <div style={headerRow}>
        <div style={{ fontFamily: F.display, fontSize: 15, letterSpacing: '0.1em', color: C.white }}>
          番地一覧 <span style={{ color: C.hint, fontSize: 12 }}>({activeFixtures.length})</span>
        </div>
        {overlaps.length > 0 && (
          <div style={{ color: '#e0726a', fontSize: 11, fontFamily: F.ui }}>
            番地の重なり {overlaps.length} 件
          </div>
        )}
        <div style={{ flex: 1 }} />
        {onClose && <button style={{ ...buttonStyle({}), padding: '5px 11px' }} onClick={onClose}>閉じる</button>}
        {/* 書き出し（MVR/CSV）は「ファイル」メニューへ移動。ここは番地の作業に要る物だけ。 */}
        <span style={{ fontSize: 11, color: C.label, fontFamily: F.mono }}>
          キャンバス {chart.canvas.w} × {chart.canvas.h}
        </span>
        <button
          style={{ ...buttonStyle({ active: showIds }), padding: '7px 12px', minHeight: 30 }}
          onClick={() => setShowIds(!showIds)}
          title="キャンバスに #番号 ラベルを表示（下の札と同じ番号）"
        >
          番号を出す
        </button>
      </div>

      <div ref={listRef} style={{ overflow: 'auto', flex: 1 }}>
        {activeFixtures.length === 0 && (
          <div style={{ color: C.faint, fontFamily: F.ui, fontSize: 12, padding: '8px 2px' }}>
            まだ番地がありません。電飾を選んで、右のパネルで番地をふってください。
          </div>
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignContent: 'flex-start' }}>
          {activeFixtures.map((f, activeIndex) => {
            const i = chart.fixtures.findIndex((fixture) => fixture.id === f.id)
            const [s, e] = channelRange(f)
            const sh = chart.shapes.find((x) => x.id === f.shapeId)
            const cnt = sh ? repeatCount(sh) : 1
            const isFlagged = flagged.has(f.id)
            const isSel = selectedIds.includes(f.shapeId)
            const [r, g, b] = resolveColor(
              f,
              dmxByUniverse,
              chart.settings.gamma,
              manualMode ? manualByFixture : null
            )
            return (
              <button
                key={f.id}
                data-shape={f.shapeId}
                onPointerDown={(e) => {
                  if (e.shiftKey || e.metaKey || e.ctrlKey) toggleSelect(f.shapeId)
                  else { dragStart.current = activeIndex; select(f.shapeId) }
                }}
                onPointerEnter={(e) => {
                  if (dragStart.current == null || e.buttons !== 1) return
                  const a = Math.min(dragStart.current, activeIndex)
                  const b = Math.max(dragStart.current, activeIndex)
                  const ids = activeFixtures.slice(a, b + 1).map((fixture) => fixture.shapeId)
                  // Preserve the actual drag direction so 「選択順」 can run either
                  // left-to-right or right-to-left as the operator traced the list.
                  selectMany(activeIndex >= dragStart.current ? ids : ids.reverse())
                }}
                onPointerUp={() => { dragStart.current = null }}
                title={`#${i + 1}  ${shapeName(f.shapeId)}${cnt > 1 ? ` ×${cnt}` : ''} · ${f.mode} · ch ${s}–${e}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  padding: '7px 8px',
                  minHeight: 30,
                  borderRadius: 3,
                  cursor: 'pointer',
                  fontFamily: F.mono,
                  fontSize: 10.5,
                  lineHeight: 1,
                  background: isSel ? 'rgba(123,197,232,0.18)' : '#1a1918',
                  border: `1px solid ${isFlagged ? '#e0726a' : isSel ? C.accent : '#2c2a27'}`,
                  color: isSel ? C.white : C.text
                }}
              >
                <span style={{ color: isSel ? C.accent : C.hint, fontWeight: 700 }}>#{i + 1}</span>
                {sh?.locked && (
                  <span
                    title="ロック中（解除：このチップ→右パネル、またはキャンバスで右クリック）"
                    style={{
                      fontSize: 8,
                      letterSpacing: '0.08em',
                      color: C.amber,
                      border: `0.5px solid ${C.amber}`,
                      borderRadius: 2,
                      padding: '0 3px'
                    }}
                  >
                    ロック
                  </span>
                )}
                <span>{formatDmx(f.universe, f.start)}</span>
                {cnt > 1 && <span style={{ color: C.hint }}>×{cnt}</span>}
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 2,
                    background: `rgb(${r},${g},${b})`,
                    border: `0.5px solid ${C.border}`
                  }}
                />
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

const wrapStyle: React.CSSProperties = {
  height: 190,
  flexShrink: 0,
  background: chrome.bar,
  borderTop: `0.5px solid ${C.border}`,
  boxShadow: chrome.topHi,
  padding: '10px 14px',
  display: 'flex',
  flexDirection: 'column'
}
const headerRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  marginBottom: 8
}
