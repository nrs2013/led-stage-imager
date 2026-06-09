import { useEffect, useRef, useState } from 'react'
import { Toolbar } from './editor/Toolbar'
import { SubBar } from './editor/SubBar'
import { EditorCanvas } from './editor/EditorCanvas'
import { Inspector } from './editor/Inspector'
import { PatchTable } from './editor/PatchTable'
import { LiveView } from './output/LiveView'
import { StatusBar } from './ui/StatusBar'
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

function EditorApp(): React.JSX.Element {
  const mode = useStore((s) => s.mode)
  const [testOpen, setTestOpen] = useState(false)
  useDmxBridge()
  useMask()
  usePreviewMirror()
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: C.canvas }}>
      <Toolbar testOpen={testOpen} onToggleTest={() => setTestOpen((v) => !v)} />
      {mode === 'edit' ? (
        <>
          <SubBar />
          <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
            <EditorCanvas />
            <Inspector />
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
