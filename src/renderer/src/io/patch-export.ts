import type { Chart } from '../model/types'
import { channelRange } from '../dmx/patch'
import { buildMvr } from './mvr-export'

interface MvrApi {
  saveMvr?: (name: string, data: Uint8Array) => Promise<string | null>
}

function download(data: BlobPart, type: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([data], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/** パッチ表を CSV で書き出す（表計算で開く用）。 */
export function exportPatchCsv(chart: Chart): void {
  const shapeName = (shapeId: string): string => {
    const sh = chart.shapes.find((s) => s.id === shapeId)
    return sh ? `${sh.type} ${sh.id.slice(-4)}` : shapeId.slice(-4)
  }
  const header = ['shape', 'type', 'universe', 'start', 'end', 'mode']
  const rows = chart.fixtures.map((f) => {
    const [, e] = channelRange(f)
    return [shapeName(f.shapeId), f.mode, String(f.universe + 1), String(f.start), String(e), f.mode]
  })
  const csv = [header, ...rows].map((r) => r.join(',')).join('\n')
  download(csv, 'text/csv', `${chart.name || 'chart'}-patch.csv`)
}

/** grandMA3 用の MVR を書き出す（アプリ内では保存ダイアログ・ブラウザではダウンロード）。 */
export async function exportPatchMvr(chart: Chart): Promise<void> {
  const data = await buildMvr(chart)
  const api = (window as unknown as { api?: MvrApi }).api
  if (api?.saveMvr) {
    await api.saveMvr(chart.name || 'decor', data)
    return
  }
  download(data.buffer as ArrayBuffer, 'application/zip', `${chart.name || 'decor'}.mvr`)
}
