import { useEffect, useRef } from 'react'
import { useStore } from '../state/store'
import { C, F, chrome, buttonStyle } from '../ui/tokens'
import { channelRange, detectOverlaps } from '../dmx/patch'
import { formatDmx, repeatCount } from '../dmx/address'
import { resolveColor } from '../dmx/resolve'

export function PatchTable(): React.JSX.Element {
  const chart = useStore((s) => s.chart)
  const dmxByUniverse = useStore((s) => s.dmxByUniverse)
  const manualMode = useStore((s) => s.manualMode)
  const manualByFixture = useStore((s) => s.manualByFixture)
  const selectedId = useStore((s) => s.selectedId)
  const selectedIds = useStore((s) => s.selectedIds)
  const select = useStore((s) => s.select)
  const showIds = useStore((s) => s.showIds)
  const setShowIds = useStore((s) => s.setShowIds)

  // when a shape is picked on the canvas, bring its chip into view
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!selectedId) return
    const el = listRef.current?.querySelector(`[data-shape="${selectedId}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [selectedId])

  const overlaps = detectOverlaps(chart.fixtures)
  const flagged = new Set(overlaps.flat())

  const shapeName = (shapeId: string): string => {
    const sh = chart.shapes.find((s) => s.id === shapeId)
    return sh ? `${sh.type} ${sh.id.slice(-4)}` : shapeId.slice(-4)
  }



  return (
    <div style={wrapStyle}>
      <div style={headerRow}>
        <div style={{ fontFamily: F.display, fontSize: 15, letterSpacing: '0.1em', color: C.white }}>
          番地一覧 <span style={{ color: C.hint, fontSize: 12 }}>({chart.fixtures.length})</span>
        </div>
        {overlaps.length > 0 && (
          <div style={{ color: '#e0726a', fontSize: 11, fontFamily: F.ui }}>
            番地の重なり {overlaps.length} 件
          </div>
        )}
        <div style={{ flex: 1 }} />
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
        {chart.fixtures.length === 0 && (
          <div style={{ color: C.faint, fontFamily: F.ui, fontSize: 12, padding: '8px 2px' }}>
            まだ番地がありません。電飾を選んで、右のパネルで番地をふってください。
          </div>
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignContent: 'flex-start' }}>
          {chart.fixtures.map((f, i) => {
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
                onClick={() => select(f.shapeId)}
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
