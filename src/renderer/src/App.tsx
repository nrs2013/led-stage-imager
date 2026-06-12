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
import { useStore } from './state/store'
import { useDmxBridge } from './state/dmx-bridge'
import { useMask } from './state/use-mask'
import type { Chart } from './model/types'
import { C } from './ui/tokens'

const isOutput = typeof window !== 'undefined' && window.location.search.includes('output')

interface DecorApi {
  onPreviewActive?: (cb: (active: boolean) => void) => void
  sendChart?: (chart: unknown) => void
  onChartUpdate?: (cb: (chart: unknown) => void) => void
  onEditUndo?: (cb: () => void) => void
  onEditRedo?: (cb: () => void) => void
  onEditCopy?: (cb: () => void) => void
  onEditPaste?: (cb: () => void) => void
  nativeCopy?: () => void
  nativePaste?: () => void
}
const getApi = (): DecorApi | undefined => (window as unknown as { api?: DecorApi }).api

/** Editor side: while the preview window is open, mirror chart changes to it. */
function usePreviewMirror(): void {
  const activeRef = useRef(false)
  useEffect(() => {
    const a = getApi()
    if (!a?.onPreviewActive) return
    a.onPreviewActive((active) => {
      activeRef.current = active
      if (active) a.sendChart?.(useStore.getState().chart)
    })
    return useStore.subscribe((state, prev) => {
      if (activeRef.current && state.chart !== prev.chart) a.sendChart?.(state.chart)
    })
  }, [])
}

/** Output window: receive chart updates from the editor, Esc to close. */
function useOutputReceiver(): void {
  useEffect(() => {
    getApi()?.onChartUpdate?.((chart) => useStore.getState().setChart(chart as Chart))
    const onKey = (e: KeyboardEvent): void => {
      if (e.code === 'Escape') window.close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
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
    a?.onEditUndo?.(() => {
      if (inText()) document.execCommand('undo')
      else useStore.getState().undo()
    })
    a?.onEditRedo?.(() => {
      if (inText()) document.execCommand('redo')
      else useStore.getState().redo()
    })
    a?.onEditCopy?.(() => {
      if (inText()) a?.nativeCopy?.()
      else useStore.getState().copySelection()
    })
    a?.onEditPaste?.(() => {
      if (inText()) {
        a?.nativePaste?.()
      } else {
        const st = useStore.getState()
        if (!st.clipboard) return
        if (st.pasteMark) {
          st.pasteAt(st.pasteMark) // paste exactly at the marked spot
          st.setPasteMark(null)
        } else {
          st.setTool('select')
          st.setPasteArmed(true) // no mark: ghost-follow stamp mode
        }
      }
    })
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
  const [testOpen, setTestOpen] = useState(false)
  useDmxBridge()
  useMask()
  usePreviewMirror()
  useDropGuard()
  useMenuUndo()
  if (mode === 'edit' && !started) {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: C.canvas }}>
        <StartScreen />
        <StatusBar />
      </div>
    )
  }
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: C.canvas }}>
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
                background: C.panel,
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
        <main style={{ flex: 1, position: 'relative', overflow: 'hidden', display: 'flex', minHeight: 0 }}>
          <LiveView />
        </main>
      )}
      <StatusBar />
      {testOpen && <ManualFaders onClose={() => setTestOpen(false)} />}
    </div>
  )
}

function App(): React.JSX.Element {
  return isOutput ? <OutputApp /> : <EditorApp />
}

export default App
