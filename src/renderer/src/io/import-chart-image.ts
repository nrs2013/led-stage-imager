import { useStore } from '../state/store'
import { prepareChartImage } from './prepare-chart-image'

let request = 0

export async function importChartImage(
  dataUrl: string,
  mode: 'replace' | 'add',
  name?: string
): Promise<void> {
  const currentRequest = ++request
  const initial = useStore.getState().chart
  useStore.getState().setChartImportStatus('LED面を解析中…')
  try {
    const prepared = await prepareChartImage(dataUrl)
    if (currentRequest !== request) return
    const st = useStore.getState()
    if (st.chart.id !== initial.id || st.chart.activeLayerId !== initial.activeLayerId) {
      st.setChartImportStatus('読み込み中にチャートが切り替わったため、画像の追加を中止しました。')
      return
    }
    if (mode === 'add' && st.chart.layers.length >= 256) {
      st.setChartImportStatus('チャートは最大256枚です。')
      return
    }
    if (mode === 'add')
      st.addLayer({ name, underlay: prepared.underlay, canvas: { w: prepared.w, h: prepared.h } })
    else st.applyChartImage(prepared.underlay.dataUrl, prepared.w, prepared.h, prepared.underlay)
    st.setChartImportStatus(
      prepared.underlay.ledLayout
        ? `LED ${prepared.underlay.ledLayout.regions.length}面を検出・範囲外を透明化`
        : 'LED面を自動判別できませんでした。元画像のまま読み込みました。'
    )
    window.dispatchEvent(new CustomEvent('decor:fit'))
  } catch {
    if (currentRequest !== request) return
    useStore
      .getState()
      .setChartImportStatus('画像を読み込めませんでした。元のチャートは変更していません。')
  }
}
