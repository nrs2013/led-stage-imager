import type { Chart } from '../model/types'
import { serializeChart, parseChart } from './chart-file'

interface FileApi {
  saveChart?: (json: string, name: string) => Promise<string | null>
  saveChartAs?: (json: string, name: string) => Promise<string | null>
  chartNew?: () => Promise<boolean>
  openChartFile?: () => Promise<string | null>
}
const api = (): FileApi | undefined => (window as unknown as { api?: FileApi }).api

function downloadJson(chart: Chart, json: string): string {
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const el = document.createElement('a')
  el.href = url
  el.download = `${chart.name || 'chart'}.ledimager`
  el.click()
  URL.revokeObjectURL(url)
  return el.download
}

/** ⌘S 相当：今開いているファイルに上書き保存（初回だけ保存先を聞く）。Returns a label or null. */
export async function saveChartToFile(chart: Chart): Promise<string | null> {
  const json = serializeChart(chart)
  const a = api()
  if (a?.saveChart) return a.saveChart(json, chart.name)
  return downloadJson(chart, json)
}

/** 別名で保存：必ず保存先を聞き、以降の上書き先をそのファイルにする。 */
export async function saveChartAsToFile(chart: Chart): Promise<string | null> {
  const json = serializeChart(chart)
  const a = api()
  if (a?.saveChartAs) return a.saveChartAs(json, chart.name)
  return downloadJson(chart, json)
}

/** 新規/別作品に切り替えた合図：main 側の「今のファイル」記憶を消す（次の保存で保存先を聞く）。 */
export function markNewChart(): void {
  void api()?.chartNew?.()
}

/** Opens a chart from disk (Electron dialog) or a browser file picker. Returns the chart or null. */
export async function openChartFromFile(): Promise<Chart | null> {
  const a = api()
  let json: string | null = null
  if (a?.openChartFile) {
    json = await a.openChartFile()
  } else {
    json = await new Promise<string | null>((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.json,.decor.json,application/json'
      input.onchange = (): void => {
        const f = input.files?.[0]
        if (!f) return resolve(null)
        const r = new FileReader()
        r.onload = (): void => resolve(r.result as string)
        r.onerror = (): void => resolve(null)
        r.readAsText(f)
      }
      input.click()
    })
  }
  if (!json) return null
  return parseChart(json)
}
