import { useRef, useState } from 'react'
import { useStore } from '../state/store'
import { pickImage } from '../io/image-pick'
import { C, F, buttonStyle } from '../ui/tokens'
import { outputLayerIndex } from '../output/page-switch'

const smallBtn = { ...buttonStyle({}), padding: '6px 8px', fontSize: 10, minHeight: 24 }

/** Song pages. One layer = one chart image + its decorations. Ordinarily the output
 *  carries every layer; when DMX chart switching is enabled, its control value chooses
 *  the single layer sent to Syphon/NDI. Clicking here still chooses the editor page. */
export function LayersPanel(): React.JSX.Element {
  const layers = useStore((s) => s.chart.layers)
  const activeLayerId = useStore((s) => s.chart.activeLayerId)
  const shapes = useStore((s) => s.chart.shapes)
  const addLayer = useStore((s) => s.addLayer)
  const removeLayer = useStore((s) => s.removeLayer)
  const setActiveLayer = useStore((s) => s.setActiveLayer)
  const setLayerVisible = useStore((s) => s.setLayerVisible)
  const renameLayer = useStore((s) => s.renameLayer)
  const pageSwitchManual = useStore((s) => s.pageSwitchManual)
  const setPageSwitchManual = useStore((s) => s.setPageSwitchManual)
  useStore((s) => s.chart.settings.pageSwitch)
  useStore((s) => s.dmxRev) // DMX値が変わった時だけ「送出中」表示を更新
  const chart = useStore.getState().chart
  const pageIndex = outputLayerIndex(chart, useStore.getState().dmxByUniverse, pageSwitchManual)
  const pageSwitchOn = pageIndex != null
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const cancelRename = useRef(false) // Esc=取り消し。blur(commit)を1回だけ握り潰す

  const addWithImage = async (): Promise<void> => {
    const dataUrl = await pickImage()
    if (!dataUrl) return
    addLayer({
      underlay: { dataUrl, opacity: 0.5, visible: true, mask: { enabled: true, invert: false } }
    })
  }

  const commitRename = (id: string): void => {
    if (cancelRename.current) {
      cancelRename.current = false // Escで取り消し＝確定しない
      setEditingId(null)
      return
    }
    const name = draft.trim()
    if (name) renameLayer(id, name)
    setEditingId(null)
  }

  return (
    <div style={panel}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <span style={title}>レイヤー</span>
        <span style={{ fontSize: 10, color: C.faint, fontFamily: F.ui }}>1曲 = 1枚</span>
        <div style={{ flex: 1 }} />
        <button
          style={smallBtn}
          disabled={layers.length >= 256}
          onClick={addWithImage}
          title={layers.length >= 256 ? 'チャートは最大256枚です' : 'チャート画像を選んで新しい曲ページを追加'}
        >
          ＋画像
        </button>
        <button
          style={smallBtn}
          disabled={layers.length >= 256}
          onClick={() => addLayer()}
          title={layers.length >= 256 ? 'チャートは最大256枚です' : '現在のチャート画像を引き継ぎ、電飾・番地は空のページを追加'}
        >
          ＋空ページ
        </button>
      </div>
      <div style={{ maxHeight: 168, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 3 }}>
        {pageSwitchOn && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
            <span style={{ color: C.accent, fontSize: 10, fontFamily: F.mono, flex: 1 }}>
              {pageSwitchManual == null ? 'DMX' : '手動'} {pageIndex} →{' '}
              {layers[pageIndex]?.name ?? `CHART ${pageIndex + 1}（未作成）`}
            </span>
            <button
              style={{ ...smallBtn, minWidth: 74 }}
              disabled={pageSwitchManual == null}
              onClick={() => setPageSwitchManual(null)}
              title="手動選択を解除して、設定したDMXチャンネルの値に連動します"
            >
              DMXに戻す
            </button>
          </div>
        )}
        {layers.map((l, layerIndex) => {
          const active = l.id === activeLayerId
          const onAir = pageSwitchOn && layerIndex === pageIndex
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
                    if (e.key === 'Escape') {
                      cancelRename.current = true // blur(commit)を握り潰して取り消し
                      setEditingId(null)
                    }
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
              {onAir && (
                <span style={{ fontSize: 9, color: C.accent, fontFamily: F.ui, whiteSpace: 'nowrap' }}>
                  送出中
                </span>
              )}
              {pageSwitchOn && (
                <button
                  style={{
                    ...smallBtn,
                    minWidth: 48,
                    ...(pageSwitchManual === layerIndex
                      ? { border: `0.5px solid ${C.accent}`, color: C.white }
                      : {})
                  }}
                  onClick={(e) => {
                    e.stopPropagation()
                    setPageSwitchManual(layerIndex)
                  }}
                  title={`${l.name}を手動でSyphon / NDIへ送出します`}
                >
                  手動
                </button>
              )}
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
                {l.visible ? '表示' : '非表示'}
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
  fontFamily: F.ui,
  fontSize: 13,
  fontWeight: 300,
  letterSpacing: '0.24em',
  textTransform: 'uppercase',
  color: C.label
}
