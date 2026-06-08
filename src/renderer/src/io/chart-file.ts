import type { Chart } from '../model/types'

export function serializeChart(chart: Chart): string {
  return JSON.stringify(chart, null, 2)
}

export function parseChart(json: string): Chart {
  let obj: unknown
  try {
    obj = JSON.parse(json)
  } catch {
    throw new Error('Invalid chart file: not valid JSON')
  }
  const c = obj as Partial<Chart>
  if (c.version !== 1) throw new Error(`Unsupported chart version: ${(c as { version?: unknown })?.version}`)
  return c as Chart
}
