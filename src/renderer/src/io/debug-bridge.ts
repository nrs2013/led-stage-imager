import { useStore } from '../state/store'

/**
 * 開発用「のぞき窓」（のむさん 2026-06-20）。画面を乗っ取らずに、走っているアプリの内部を
 * 外から読めるようにする土台。ここ(renderer)は window に 3つの関数を生やすだけ：
 *   __debugState()    … 今のデータ(JSON文字列・重い画像dataURLは伏せる)
 *   __debugSnapshot() … 今のキャンバスの絵(PNG dataURL)
 *   __debugLogs()     … 直近のコンソールログ
 * これを main 側のローカルHTTP(127.0.0.1:7331 / src/main/index.ts)が executeJavaScript で
 * 呼び出して /state /snapshot.png /logs として返す。localhost限定なので本番/配布でも無害。
 */

const LOGS: string[] = []
function pushLog(kind: string, args: unknown[]): void {
  try {
    const line = args
      .map((a) => {
        if (typeof a === 'string') return a
        try {
          return JSON.stringify(a)
        } catch {
          return String(a)
        }
      })
      .join(' ')
    LOGS.push(`[${kind}] ${line}`)
    if (LOGS.length > 300) LOGS.shift()
  } catch {
    /* ログ取得失敗は無視（本番に影響させない） */
  }
}
;(['log', 'warn', 'error'] as const).forEach((k) => {
  const orig = console[k].bind(console)
  console[k] = (...args: unknown[]): void => {
    pushLog(k, args)
    orig(...args)
  }
})

/** 重い base64 dataURL は中身を伏せて「[data-url N chars]」に（/state を読めるサイズに保つ）。 */
function strip(v: unknown): unknown {
  if (typeof v === 'string') {
    return v.startsWith('data:') && v.length > 100 ? `[data-url ${v.length} chars]` : v
  }
  if (Array.isArray(v)) return v.map(strip)
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {}
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) o[k] = strip(val)
    return o
  }
  return v
}

interface DebugWin {
  __debugState?: () => string
  __debugSnapshot?: () => string
  __debugLogs?: () => string
}
const w = window as unknown as DebugWin

w.__debugState = (): string => {
  const s = useStore.getState()
  return JSON.stringify(
    strip({
      mode: s.mode,
      started: s.started,
      imageLight: s.imageLight,
      tool: s.tool,
      selectedId: s.selectedId,
      selectedIds: s.selectedIds,
      paletteFilter: s.paletteFilter,
      manualMode: s.manualMode,
      chart: s.chart
    }),
    null,
    2
  )
}

w.__debugSnapshot = (): string => {
  // DOM上の一番大きいキャンバス＝編集/出力の本画面。小さいサムネは無視。
  const canvases = Array.from(document.querySelectorAll('canvas')) as HTMLCanvasElement[]
  if (!canvases.length) return ''
  const main = canvases.reduce((a, b) => (a.width * a.height >= b.width * b.height ? a : b))
  try {
    return main.toDataURL('image/png')
  } catch {
    return ''
  }
}

w.__debugLogs = (): string => LOGS.join('\n')
