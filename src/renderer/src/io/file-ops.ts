import type { Chart } from '../model/types'
import { serializeChart, parseChart } from './chart-file'

interface FileApi {
  saveChart?: (json: string, name: string) => Promise<string | null>
  openChartFile?: () => Promise<string | null>
}
const api = (): FileApi | undefined => (window as unknown as { api?: FileApi }).api

/** Saves the chart to disk (Electron dialog) or downloads it (browser). Returns a label or null. */
export async function saveChartToFile(chart: Chart): Promise<string | null> {
  const json = serializeChart(chart)
  const a = api()
  if (a?.saveChart) return a.saveChart(json, chart.name)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const el = document.createElement('a')
  el.href = url
  el.download = `${chart.name || 'chart'}.decor.json`
  el.click()
  URL.revokeObjectURL(url)
  return el.download
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
