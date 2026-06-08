import { Toolbar } from './editor/Toolbar'
import { SubBar } from './editor/SubBar'
import { EditorCanvas } from './editor/EditorCanvas'
import { Inspector } from './editor/Inspector'
import { PatchTable } from './editor/PatchTable'
import { useStore } from './state/store'
import { C, F } from './ui/tokens'

function LivePlaceholder(): React.JSX.Element {
  const chart = useStore((s) => s.chart)
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        background: C.canvas
      }}
    >
      <div style={{ fontFamily: F.display, fontSize: 44, letterSpacing: '0.12em', color: C.amber }}>
        LIVE MODE
      </div>
      <div style={{ fontFamily: F.mono, fontSize: 12, color: C.hint }}>
        {chart.canvas.w} × {chart.canvas.h}
      </div>
      <div style={{ fontFamily: F.ui, fontSize: 11, color: C.faint }}>
        本番描画＋Syphon出力は Milestone 3 で実装します
      </div>
    </div>
  )
}

function App(): React.JSX.Element {
  const mode = useStore((s) => s.mode)
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: C.canvas }}>
      <Toolbar />
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
        <main style={{ flex: 1, position: 'relative', overflow: 'hidden', display: 'flex' }}>
          <LivePlaceholder />
        </main>
      )}
    </div>
  )
}

export default App
