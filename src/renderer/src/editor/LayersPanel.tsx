import { useState } from 'react'
import { useStore } from '../state/store'
import { pickImage } from '../io/image-pick'
import { C, F, buttonStyle } from '../ui/tokens'

const smallBtn = { ...buttonStyle({}), padding: '6px 8px', fontSize: 10, minHeight: 24 }

/** Song pages. One layer = one chart image + its decorations. The console "calls up"
 *  a song by raising that song's addresses — the output always carries every layer,
 *  so this panel only drives what the EDITOR shows. */
export function LayersPanel(): React.JSX.Element {
  const layers = useStore((s) => s.chart.layers)
  const activeLayerId = useStore((s) => s.chart.activeLayerId)
  const shapes = useStore((s) => s.chart.shapes)
  const addLayer = useStore((s) => s.addLayer)
  const removeLayer = useStore((s) => s.removeLayer)
  const setActiveLayer = useStore((s) => s.setActiveLayer)
  const setLayerVisible = useStore((s) => s.setLayerVisible)
  const renameLayer = useStore((s) => s.renameLayer)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  const addWithImage = async (): Promise<void> => {
    const dataUrl = await pickImage()
    if (!dataUrl) return
    addLayer({
      underlay: { dataUrl, opacity: 0.5, visible: true, mask: { enabled: true, invert: false } }
    })
  }

  const commitRename = (id: string): void => {
    const name = draft.trim()
    if (name) renameLayer(id, name)
    setEditingId(null)
  }

  return (
    <div style={panel}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <span style={title}>Layers</span>
        <span style={{ fontSize: 10, color: C.faint, fontFamily: F.ui }}>1曲=1枚</span>
        <div style={{ flex: 1 }} />
        <button style={smallBtn} onClick={addWithImage} title="チャート画像を選んで新しい曲ページを追加">
          + Image
        </button>
        <button style={smallBtn} onClick={() => addLayer()} title="下絵なしの空ページを追加">
          + Blank
        </button>
      </div>
      <div style={{ maxHeight: 168, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 3 }}>
        {layers.map((l) => {
          const active = l.id === activeLayerId
          const count = shapes.filter((sh) => (sh.layerId ?? layers[0]?.id) === l.id).length
          return (
            <div
              key={l.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 6px',
                borderRadius: 3,
                border: `0.5px solid ${active ? C.accent : C.border}`,
                background: active ? `rgba(${C.accentRGB},0.10)` : 'transparent',
                cursor: 'pointer'
              }}
              onClick={() => setActiveLayer(l.id)}
            >
              {editingId === l.id ? (
                <input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => commitRename(l.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename(l.id)
                    if (e.key === 'Escape') setEditingId(null)
                  }}
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    background: C.inputBg,
                    border: `1px solid ${C.accent}`,
                    borderRadius: 3,
                    color: C.white,
                    fontSize: 11,
                    fontFamily: F.ui,
                    padding: '2px 5px',
                    outline: 'none'
                  }}
                />
              ) : (
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    fontSize: 11,
                    fontFamily: F.ui,
                    fontWeight: active ? 600 : 400,
                    color: active ? C.white : C.text
                  }}
                  title="ダブルクリックで名前変更（曲名を入れる）"
                  onDoubleClick={(e) => {
                    e.stopPropagation()
                    setEditingId(l.id)
                    setDraft(l.name)
                  }}
                >
                  {l.name}
                </span>
              )}
              <span
                style={{ fontSize: 10, color: C.faint, fontFamily: F.mono }}
                title="このページの電飾の数"
              >
                {count}
              </span>
              <button
                style={{
                  ...smallBtn,
                  padding: '6px 8px',
                  fontSize: 9,
                  minHeight: 24,
                  minWidth: 40,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  lineHeight: 1,
                  ...(l.visible
                    ? { background: 'transparent', border: `0.5px solid ${C.border}`, color: C.label }
                    : { background: 'transparent', border: `0.5px solid ${C.borderFaint}`, color: C.faint })
                }}
                title={active ? '編集中のページは常に表示' : '他ページをうっすら重ねて表示/隠す'}
                disabled={active}
                onClick={(e) => {
                  e.stopPropagation()
                  setLayerVisible(l.id, !l.visible)
                }}
              >
                {l.visible ? 'Show' : 'Hide'}
              </button>
              <button
                style={{
                  ...smallBtn,
                  padding: '6px 8px',
                  fontSize: 10,
                  minWidth: 24,
                  minHeight: 24,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  lineHeight: 1,
                  color: layers.length <= 1 ? C.faint : C.text
                }}
                disabled={layers.length <= 1}
                title="このページを削除（電飾ごと消えます）"
                onClick={(e) => {
                  e.stopPropagation()
                  if (window.confirm(`「${l.name}」とそのページの電飾 ${count} 個を削除しますか？`)) {
                    removeLayer(l.id)
                  }
                }}
              >
                ×
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const panel: React.CSSProperties = {
  padding: '10px 12px',
  borderBottom: `0.5px solid ${C.border}`,
  flexShrink: 0
}

const title: React.CSSProperties = {
  fontFamily: F.display,
  fontSize: 13,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: C.white
}
