import { useEffect, useRef, useState } from 'react'
import { Toolbar } from './editor/Toolbar'
import { SubBar } from './editor/SubBar'
import { EditorCanvas } from './editor/EditorCanvas'
import { Inspector } from './editor/Inspector'
import { PartsPalette } from './editor/PartsPalette'
import { LayersPanel } from './editor/LayersPanel'
import { PatchTable } from './editor/PatchTable'
import { LiveView } from './output/LiveView'
import { GpuOutputView } from './output/GpuOutputView'
import { GpuILOutputView } from './output/GpuILOutputView'
import { useChartOutput } from './output/use-chart-output'
import { StatusBar } from './ui/StatusBar'
import { StartScreen } from './ui/StartScreen'
import { ManualFaders } from './test/ManualFaders'
import { ImageLightingMode } from './imagelight/ImageLightingMode'
import { HelpPanel } from './ui/HelpPanel'
import { useStore } from './state/store'
import { useDmxBridge } from './state/dmx-bridge'
import { useMask } from './state/use-mask'
import { useAutosave } from './io/autosave'
import type { Chart } from './model/types'
import { parseChart } from './io/chart-file'
import { C, chrome } from './ui/tokens'

// GPU直結出力の見えない窓（?syphon-output）。'output' を部分一致で含むので先に判定する。
const isGpuOutput =
  typeof window !== 'undefined' && window.location.search.includes('syphon-output')
const isOutput =
  !isGpuOutput && typeof window !== 'undefined' && window.location.search.includes('output')

interface DecorApi {
  onPreviewActive?: (cb: (active: boolean) => void) => (() => void) | void
  sendChart?: (chart: unknown) => void
  onChartUpdate?: (cb: (chart: unknown) => void) => (() => void) | void
  gpuOutputStatus?: () => Promise<boolean>
  onGpuOutputActive?: (cb: (active: boolean) => void) => (() => void) | void
  sendManual?: (m: unknown) => void
  onEditUndo?: (cb: () => void) => (() => void) | void
  onEditRedo?: (cb: () => void) => (() => void) | void
  onEditCopy?: (cb: () => void) => (() => void) | void
  onEditPaste?: (cb: () => void) => (() => void) | void
  nativeCopy?: () => void
  nativePaste?: () => void
  onOpenChartPath?: (cb: (json: string, path?: string) => void) => (() => void) | void
  chartOpened?: (path: string) => void
  onOpenShowPath?: (cb: (p: { bytes: Uint8Array; path: string }) => void) => (() => void) | void
}
const getApi = (): DecorApi | undefined => (window as unknown as { api?: DecorApi }).api

/** Editor side: mirror chart changes to the preview window and to the invisible
 *  GPU output window (?syphon-output). The GPU window also needs the TEST fader state
 *  so its picture matches the editor's.
 *  🔴 started（実チャートを持っている）時だけ送る: 編集ウィンドウの開き直し/リロード直後の
 *  空チャートを送ると、GPU出力窓が持っている本番チャートを上書きして出力が消灯する（レビュー指摘）。 */
function usePreviewMirror(): void {
  const activeRef = useRef(false) // fullscreen preview
  const gpuRef = useRef(false) // GPU直結出力の見えない窓
  useEffect(() => {
    const a = getApi()
    if (!a?.onPreviewActive) return
    // チャートは全量IPC（写真データURL込みだと重い）＝ドラッグ中の連射は100msに間引く。
    // 末尾で必ず最新を送るので取りこぼしはない。
    let chartTimer: ReturnType<typeof setTimeout> | null = null
    const sendChartNow = (): void => {
      a.sendChart?.(useStore.getState().chart)
    }
    const queueChart = (): void => {
      if (chartTimer) return
      chartTimer = setTimeout(() => {
        chartTimer = null
        sendChartNow()
      }, 100)
    }
    const sendAll = (): void => {
      const st = useStore.getState()
      if (!st.started) return // 空チャートで本番出力を上書きしない
      sendChartNow()
      a.sendManual?.({ on: st.manualMode, byFixture: st.manualByFixture })
    }
    const off = a.onPreviewActive((active) => {
      activeRef.current = active
      if (active) sendAll()
    })
    // GPU出力窓は編集画面より先に生まれていることがある＝現状を一度聞いてから通知を購読
    void a.gpuOutputStatus?.().then((v) => {
      gpuRef.current = !!v
      if (v) sendAll()
    })
    const offGpu = a.onGpuOutputActive?.((v) => {
      gpuRef.current = v
      if (v) sendAll()
    })
    const unsub = useStore.subscribe((state, prev) => {
      const on = activeRef.current || gpuRef.current
      if (!on || !state.started) return
      if (state.started !== prev.started) {
        // StartScreen から復元/開始した瞬間＝全量を即同期（チャート変更イベントより確実）
        sendAll()
        return
      }
      if (state.chart !== prev.chart) queueChart()
      if (
        gpuRef.current &&
        (state.manualMode !== prev.manualMode || state.manualByFixture !== prev.manualByFixture)
      )
        a.sendManual?.({ on: state.manualMode, byFixture: state.manualByFixture })
    })
    return () => {
      off?.()
      offGpu?.()
      unsub()
      if (chartTimer) clearTimeout(chartTimer)
    }
  }, [])
}

/** Output window: receive chart updates from the editor, Esc to close. */
function useOutputReceiver(): void {
  useEffect(() => {
    const off = getApi()?.onChartUpdate?.((chart) => useStore.getState().setChart(chart as Chart))
    const onKey = (e: KeyboardEvent): void => {
      if (e.code === 'Escape') window.close()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      off?.()
      window.removeEventListener('keydown', onKey)
    }
  }, [])
}

function OutputApp(): React.JSX.Element {
  useDmxBridge()
  useOutputReceiver()
  return (
    <div style={{ height: '100%', background: '#000' }}>
      <LiveView bare />
    </div>
  )
}

/** GPU直結出力の見えない窓（?syphon-output）。DMXは自分で受け、チャート/TESTフェーダー/
 *  画像照明の状態は編集ウィンドウから IPC で届く。絵は mode に応じて GpuOutputView（電飾
 *  チャート・自走）か GpuILOutputView（画像照明・編集側駆動）が 1:1 で描き、main が paint を
 *  ゼロコピーで Syphon へ出す。 */
function GpuOutputApp(): React.JSX.Element {
  useDmxBridge()
  const [mode, setMode] = useState<'chart' | 'imagelight'>('chart')
  useEffect(() => {
    const a = getApi() as
      | {
          onOutputMode?: (cb: (m: 'chart' | 'imagelight') => void) => (() => void) | void
          gpuOutputHello?: () => Promise<'chart' | 'imagelight'>
        }
      | undefined
    const off = a?.onOutputMode?.((m) => setMode(m))
    // pull型ハンドシェイク: リスナー登録が済んだ「後」に現在モードを聞く＝ロード中に
    // 届いて消えたモード切替を取り戻す（push だけだと空チャートのまま固まる・実測）
    void a?.gpuOutputHello?.().then((m) => setMode(m))
    return () => off?.()
  }, [])
  return mode === 'imagelight' ? <GpuILOutputView /> : <GpuOutputView />
}

/** Cmd+Z / Shift+Cmd+Z arrive via the app menu (the default menu would swallow them).
 *  Text fields keep their native undo; everywhere else it's the chart history. */
function useMenuUndo(): void {
  useEffect(() => {
    const a = getApi()
    const inText = (): boolean => {
      const t = document.activeElement as HTMLElement | null
      return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')
    }
    const offUndo = a?.onEditUndo?.(() => {
      if (inText()) {
        document.execCommand('undo')
        return
      }
      const st = useStore.getState()
      if (st.imageLight && st.imageLightUndo) st.imageLightUndo()
      else st.undo()
    })
    const offRedo = a?.onEditRedo?.(() => {
      if (inText()) {
        document.execCommand('redo')
        return
      }
      const st = useStore.getState()
      if (st.imageLight && st.imageLightRedo) st.imageLightRedo()
      else st.redo()
    })
    const offCopy = a?.onEditCopy?.(() => {
      if (inText()) {
        a?.nativeCopy?.()
        return
      }
      const st = useStore.getState()
      if (st.imageLight && st.imageLightCopy) st.imageLightCopy()
      else st.copySelection()
    })
    const offPaste = a?.onEditPaste?.(() => {
      if (inText()) {
        a?.nativePaste?.()
        return
      }
      const st0 = useStore.getState()
      if (st0.imageLight && st0.imageLightPaste) {
        st0.imageLightPaste()
        return
      }
      {
        const st = useStore.getState()
        if (!st.clipboard) return
        if (st.pasteMark) {
          st.pasteAt(st.pasteMark) // クリックで印を付けた場所に貼る
          st.setPasteMark(null)
        } else {
          st.pasteOffset() // 印が無ければ少し横にずらして即1個（マウス追従の連続スタンプはしない）
        }
      }
    })
    return () => {
      offUndo?.()
      offRedo?.()
      offCopy?.()
      offPaste?.()
    }
  }, [])
}

/** ダブルクリックで開かれた .ledimager（main から JSON が届く）を読み込んで表示する。 */
function useOpenFile(): void {
  useEffect(() => {
    const off = getApi()?.onOpenChartPath?.((json, path) => {
      try {
        const c = parseChart(json)
        const st = useStore.getState()
        // 未保存の作業があるなら開く前に確認（ダブルクリック展開で黙って消えるのを防ぐ）
        if (
          st.chart.shapes.length > 0 &&
          !window.confirm('現在の作品を閉じて開きますか？（保存していない変更は消えます）')
        ) {
          return
        }
        st.setImageLight(false)
        st.setChart(c)
        st.setStarted(true)
        // 実際に開けた時だけ ⌘S 上書き先を確定（キャンセル/失敗時はここに来ない＝別ファイル誤上書き防止）
        if (path) getApi()?.chartOpened?.(path)
      } catch (e) {
        console.error('[open-file] parse failed', e)
      }
    })
    return () => off?.()
  }, [])
}

/** ダブルクリックで開かれた .ledshow（画像照明の公演・ZIPバイト列）を受け取り、
 *  画像照明モードへ入って復元する。取り込みは ImageLightingMode 側（pendingShowFile）。 */
function useOpenShowFile(): void {
  useEffect(() => {
    const off = getApi()?.onOpenShowPath?.(({ bytes, path }) => {
      const st = useStore.getState()
      st.setPendingShowFile({
        bytes: bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes),
        path
      })
      st.setImageLight(true)
    })
    return () => off?.()
  }, [])
}

/** Dropping a file outside a drop zone must not navigate the window away. */
function useDropGuard(): void {
  useEffect(() => {
    const prevent = (e: DragEvent): void => e.preventDefault()
    window.addEventListener('dragover', prevent)
    window.addEventListener('drop', prevent)
    return () => {
      window.removeEventListener('dragover', prevent)
      window.removeEventListener('drop', prevent)
    }
  }, [])
}

function EditorApp(): React.JSX.Element {
  const mode = useStore((s) => s.mode)
  const started = useStore((s) => s.started)
  const imageLight = useStore((s) => s.imageLight)
  const setImageLight = useStore((s) => s.setImageLight)
  const helpOpen = useStore((s) => s.helpOpen)
  const [testOpen, setTestOpen] = useState(false)
  useDmxBridge()
  useMask()
  usePreviewMirror()
  useDropGuard()
  useMenuUndo()
  useAutosave()
  useOpenFile()
  useOpenShowFile()
  useChartOutput() // 電飾の Syphon/NDI 出力は常時（Live廃止・照明モードと同じ作法）
  // 出力方式（SETUPのトグル・localStorage永続）。互換を選んでいたら起動時に main へ伝えて
  // GPU出力窓を止める（既定は高速(GPU)＝何も送らなくても main が起動している）。
  useEffect(() => {
    if (localStorage.getItem('gpu-output-method') === 'compat')
      (getApi() as { setGpuOutputMethod?: (m: string) => void } | undefined)?.setGpuOutputMethod?.(
        'compat'
      )
  }, [])
  // 開発用フラグ: ?iltest で照明モードへ直行（性能実測用・通常起動では無効）
  useEffect(() => {
    if (window.location.search.includes('iltest')) setImageLight(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // 画像照明モード: エディタ/Liveに代えて全画面表示（自前でSyphonへpublish）。
  // hooks は全てこの分岐より前で呼ぶこと（条件付きreturnの後にhookは置けない）。
  if (imageLight) return <ImageLightingMode onExit={() => setImageLight(false)} />
  if (mode === 'edit' && !started) {
    return (
      <div
        style={{ height: '100%', display: 'flex', flexDirection: 'column', background: C.canvas }}
      >
        <StartScreen />
        <StatusBar />
      </div>
    )
  }
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: chrome.root }}>
      <Toolbar testOpen={testOpen} onToggleTest={() => setTestOpen((v) => !v)} />
      {mode === 'edit' ? (
        <>
          <SubBar />
          <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
            <EditorCanvas />
            <div
              style={{
                width: 340,
                flexShrink: 0,
                display: 'flex',
                flexDirection: 'column',
                minHeight: 0,
                background: chrome.panel,
                borderLeft: `0.5px solid ${C.border}`
              }}
            >
              <LayersPanel />
              <PartsPalette />
              <Inspector />
            </div>
          </div>
          <PatchTable />
        </>
      ) : (
        <main
          style={{
            flex: 1,
            position: 'relative',
            overflow: 'hidden',
            display: 'flex',
            minHeight: 0
          }}
        >
          <LiveView />
        </main>
      )}
      <StatusBar />
      {testOpen && <ManualFaders onClose={() => setTestOpen(false)} />}
      {helpOpen && <HelpPanel />}
    </div>
  )
}

function App(): React.JSX.Element {
  if (isGpuOutput) return <GpuOutputApp />
  return isOutput ? <OutputApp /> : <EditorApp />
}

export default App
