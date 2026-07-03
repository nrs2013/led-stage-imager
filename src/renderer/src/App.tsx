import { useEffect, useRef, useState } from 'react'
import { Toolbar } from './editor/Toolbar'
import { SubBar } from './editor/SubBar'
import { EditorCanvas } from './editor/EditorCanvas'
import { Inspector } from './editor/Inspector'
import { PartsPalette } from './editor/PartsPalette'
import { LayersPanel } from './editor/LayersPanel'
import { PatchTable } from './editor/PatchTable'
import { LiveView } from './output/LiveView'
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

const isOutput = typeof window !== 'undefined' && window.location.search.includes('output')

interface DecorApi {
  onPreviewActive?: (cb: (active: boolean) => void) => (() => void) | void
  sendChart?: (chart: unknown) => void
  onChartUpdate?: (cb: (chart: unknown) => void) => (() => void) | void
  onEditUndo?: (cb: () => void) => (() => void) | void
  onEditRedo?: (cb: () => void) => (() => void) | void
  onEditCopy?: (cb: () => void) => (() => void) | void
  onEditPaste?: (cb: () => void) => (() => void) | void
  nativeCopy?: () => void
  nativePaste?: () => void
  onOpenChartPath?: (cb: (json: string) => void) => (() => void) | void
  onOpenShowPath?: (cb: (p: { bytes: Uint8Array; path: string }) => void) => (() => void) | void
}
const getApi = (): DecorApi | undefined => (window as unknown as { api?: DecorApi }).api

/** Editor side: while the preview window is open, mirror chart changes to it. */
function usePreviewMirror(): void {
  const activeRef = useRef(false)
  useEffect(() => {
    const a = getApi()
    if (!a?.onPreviewActive) return
    const off = a.onPreviewActive((active) => {
      activeRef.current = active
      if (active) a.sendChart?.(useStore.getState().chart)
    })
    const unsub = useStore.subscribe((state, prev) => {
      if (activeRef.current && state.chart !== prev.chart) a.sendChart?.(state.chart)
    })
    return () => {
      off?.()
      unsub()
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
      <LiveView publish={false} bare />
    </div>
  )
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
    const off = getApi()?.onOpenChartPath?.((json) => {
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
  return isOutput ? <OutputApp /> : <EditorApp />
}

export default App
