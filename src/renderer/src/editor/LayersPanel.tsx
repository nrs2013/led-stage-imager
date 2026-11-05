import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../state/store'
import { pickImage } from '../io/image-pick'
import { importChartImage } from '../io/import-chart-image'
import { C, F, buttonStyle } from '../ui/tokens'
import { ChartDeleteDialog } from '../ui/ChartDeleteDialog'
import { NumberField } from '../ui/NumberField'
import { outputLayerIndex } from '../output/page-switch'
import { parseChart } from '../io/chart-file'
import type { Chart } from '../model/types'

const smallBtn = { ...buttonStyle({}), padding: '6px 8px', fontSize: 10, minHeight: 24 }

/** Song pages. One layer = one chart image + its decorations. Ordinarily the output
 *  carries every layer; when DMX chart switching is enabled, its control value chooses
 *  the single layer sent to Syphon/NDI. Clicking here still chooses the editor page. */
export function LayersPanel(): React.JSX.Element {
  const importStatus = useStore((s) => s.chartImportStatus)
  const layers = useStore((s) => s.chart.layers)
  const activeLayerId = useStore((s) => s.chart.activeLayerId)
  const shapes = useStore((s) => s.chart.shapes)
  const addLayer = useStore((s) => s.addLayer)
  const removeLayer = useStore((s) => s.removeLayer)
  const chartOutput = useStore((s) => s.chart.settings.chartOutput)
  const setChartOutput = useStore((s) => s.setChartOutput)
  const setActiveLayer = useStore((s) => s.setActiveLayer)
  const renameLayer = useStore((s) => s.renameLayer)
  const pageSwitchManual = useStore((s) => s.pageSwitchManual)
  const setPageSwitchManual = useStore((s) => s.setPageSwitchManual)
  const setPageSwitch = useStore((s) => s.setPageSwitch)
  const pageSwitch = useStore((s) => s.chart.settings.pageSwitch)
  const dmxRev = useStore((s) => s.dmxRev) // DMX値が変わった時だけ「送出中」表示を更新
  const chart = useStore.getState().chart
  const pageIndex = outputLayerIndex(chart, useStore.getState().dmxByUniverse, pageSwitchManual)
  const pageSwitchOn = pageIndex != null
  const dmxSwitchOn = pageSwitch?.enabled === true
  const switchUniverse = (pageSwitch?.universe ?? 0) + 1
  const switchAddress = pageSwitch?.address ?? 1
  const switchValue = useStore.getState().dmxByUniverse[pageSwitch?.universe ?? 0]?.[switchAddress - 1]
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const deleteLayer = layers.find((layer) => layer.id === deleteId)
  const counts = useMemo(() => {
    const result = new Map<string, number>()
    for (const shape of shapes) {
      const id = shape.layerId ?? layers[0]?.id
      result.set(id, (result.get(id) ?? 0) + 1)
    }
    return result
  }, [shapes, layers])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const cancelRename = useRef(false) // Esc=取り消し。blur(commit)を1回だけ握り潰す

  useEffect(() => {
    // 手動確認中はそのページを守る。DMX連動中だけ中央画面も実際の送出ページへ追従する。
    if (!dmxSwitchOn || pageSwitchManual != null || pageIndex == null) return
    const onAirLayer = layers[pageIndex]
    if (onAirLayer && onAirLayer.id !== activeLayerId) setActiveLayer(onAirLayer.id)
  }, [activeLayerId, dmxRev, dmxSwitchOn, layers, pageIndex, pageSwitchManual, setActiveLayer])

  const addWithImage = async (): Promise<void> => {
    const dataUrl = await pickImage()
    if (!dataUrl) return
    await importChartImage(dataUrl, 'add')
  }

  const importPageFromFile = async (): Promise<void> => {
    const text = await new Promise<string | null>((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.ledimager,.json,application/json'
      input.onchange = () => {
        const file = input.files?.[0]
        if (!file) return resolve(null)
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result ?? ''))
        reader.onerror = () => resolve(null)
        reader.readAsText(file)
      }
      input.click()
    })
    if (!text) return
    let source: Chart
    try { source = parseChart(text) } catch (error) {
      useStore.setState({ chartImportStatus: `読込失敗: ${(error as Error).message}` })
      return
    }
    const state = useStore.getState()
    try {
      state.appendImportedChart(source)
      useStore.setState({ chartImportStatus: `${source.layers.length}ページ・図形${source.shapes.length}本を取り込みました（縦横比を維持）` })
    } catch (error) {
      useStore.setState({ chartImportStatus: `読込失敗: ${(error as Error).message}` })
      return
    }
    window.dispatchEvent(new CustomEvent('decor:fit'))
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
      {importStatus && <div role="status" style={{ fontSize: 11, color: C.hint, marginBottom: 6 }}>{importStatus}</div>}
      <details style={{ minHeight: 0, maxHeight: '35vh', overflowY: 'auto' }}>
      <summary style={{ ...title, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7, listStylePosition: 'inside' }}>
        チャート作成・送出設定 <span style={{ fontSize: 10, color: C.faint, fontFamily: F.ui }}>{layers.length}枚</span>
      </summary>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 6, marginBottom: 8 }}>
        <button style={{ ...smallBtn, minHeight: 34 }} disabled={layers.length >= 256}
          onClick={() => addLayer({ name: '新しいチャート' })}
          title="背景画像を引き継ぎ、電飾とPatchが空のチャートを追加">
          ＋ チャート追加
        </button>
        <button style={{ ...smallBtn, minHeight: 34 }} disabled={layers.length >= 256}
          onClick={addWithImage} title="画像を選んで新しいチャートを追加">
          画像から追加…
        </button>
        <button style={{ ...smallBtn, minHeight: 34, gridColumn: '1 / -1' }} disabled={layers.length >= 256}
          onClick={() => void importPageFromFile()} title="別の .ledimager から図形とPatchを新しいページへ追加">
          データからチャートを取り込む…
        </button>
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, color: C.label, fontFamily: F.ui, fontSize: 10 }}>
        通常の送出
        <select aria-label="通常のチャート送出" value={chartOutput ?? 'all'}
          onChange={(e) => setChartOutput(e.target.value as 'selected' | 'all')}
          style={{ background: C.inputBg, color: C.white, border: `0.5px solid ${C.border}`, borderRadius: 3, minHeight: 30, minWidth: 0, flex: 1 }}>
          <option value="selected">選択チャート1枚</option><option value="all">全チャート</option>
        </select>
      </label>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          marginBottom: 7,
          padding: '6px',
          border: `0.5px solid ${dmxSwitchOn ? C.accent : C.border}`,
          borderRadius: 4,
          background: dmxSwitchOn ? `rgba(${C.accentRGB},0.06)` : 'transparent'
        }}
      >
        <span style={{ fontSize: 10, color: C.label, fontFamily: F.ui, whiteSpace: 'nowrap' }}>
          DMX切替
        </span>
        <button
          style={{ ...smallBtn, minWidth: 38, color: dmxSwitchOn ? C.white : C.hint }}
          onClick={() => setPageSwitch({ enabled: !dmxSwitchOn })}
          title="DMXの値でCHARTを切り替える機能をON／OFFします"
        >
          {dmxSwitchOn ? 'ON' : 'OFF'}
        </button>
        <span style={{ fontSize: 9, color: C.hint, fontFamily: F.ui }}>Universe</span>
        <NumberField
          value={switchUniverse}
          min={1}
          max={32768}
          compact
          style={{ width: 54, flex: '0 0 54px' }}
          onChange={(universe) => setPageSwitch({ universe: universe - 1 })}
        />
        <span style={{ fontSize: 9, color: C.hint, fontFamily: F.ui }}>CH</span>
        <NumberField
          value={switchAddress}
          min={1}
          max={512}
          compact
          style={{ width: 54, flex: '0 0 54px' }}
          onChange={(address) => setPageSwitch({ address })}
        />
      </div>
      </details>
      <div style={{ ...title, margin: '7px 0' }}>チャート一覧</div>
      <div style={{ maxHeight: 226, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 3 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
          <span style={{ color: pageSwitchOn ? C.accent : C.hint, fontSize: 10, fontFamily: F.mono, flex: 1 }}>
            {pageSwitchOn
              ? `${pageSwitchManual != null ? '手動' : dmxSwitchOn ? `DMX値 ${switchValue ?? '未受信'}` : '選択'} → ${layers[pageIndex]?.name ?? `CHART ${pageIndex + 1}（未作成）`}`
              : '全チャートを送出中'}
          </span>
          <button
            style={{ ...smallBtn, minWidth: dmxSwitchOn ? 74 : 92 }}
            disabled={pageSwitchManual == null}
            onClick={() => setPageSwitchManual(null)}
            title={dmxSwitchOn
              ? '手動選択を解除して、設定したDMXチャンネルの値に連動します'
              : chartOutput === 'selected' ? '手動固定を解除して、選択したチャートに追従します' : '手動固定を解除して全チャートを送出します'}
          >
            {dmxSwitchOn ? 'DMXに戻す' : chartOutput === 'selected' ? '選択に戻す' : '全体送出に戻す'}
          </button>
        </div>
        {layers.map((l, layerIndex) => {
          const active = l.id === activeLayerId
          const onAir = pageSwitchOn && layerIndex === pageIndex
          const count = counts.get(l.id) ?? 0
          return (
            <div
              key={l.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                flexWrap: 'nowrap',
                flexShrink: 0,
                minHeight: 36,
                gap: 6,
                padding: '2px 4px',
                borderRadius: 3,
                border: `0.5px solid ${active ? C.accent : C.border}`,
                background: active ? `rgba(${C.accentRGB},0.10)` : 'transparent',
                cursor: 'pointer'
              }}
              onClick={() => setActiveLayer(l.id)}
            >
              <span style={{ fontSize: 10, fontFamily: F.mono, color: C.label }}>{layerIndex + 1}</span>
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
                {count}本
              </span>
              {onAir && (
                <span style={{ fontSize: 9, color: C.accent, fontFamily: F.ui, whiteSpace: 'nowrap' }}>
                  送出中
                </span>
              )}
              <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
              <button
                style={{
                  ...smallBtn,
                  flex: 1,
                  minHeight: 30,
                  minWidth: 48,
                  ...(pageSwitchManual === layerIndex
                    ? { border: `0.5px solid ${C.accent}`, color: C.white }
                    : {})
                }}
                onClick={(e) => {
                  e.stopPropagation()
                  setActiveLayer(l.id)
                  setPageSwitchManual(layerIndex)
                }}
                title={`${l.name}へ完全に切り替え、Syphon / NDIへ手動送出します`}
              >
                送出
              </button>
              <button
                style={{
                  ...smallBtn,
                  padding: '4px',
                  fontSize: 10,
                  minWidth: 38,
                  minHeight: 30,
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
                  setDeleteId(l.id)
                }}
              >
                削除…
              </button>
              </div>
            </div>
          )
        })}
      </div>
      {deleteLayer && layers.length > 1 && <ChartDeleteDialog
        name={`CHART ${layers.findIndex((layer) => layer.id === deleteLayer.id) + 1} ${deleteLayer.name}`}
        count={counts.get(deleteLayer.id) ?? 0}
        onCancel={() => setDeleteId(null)}
        onDelete={() => { removeLayer(deleteLayer.id); setDeleteId(null) }}
      />}
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
