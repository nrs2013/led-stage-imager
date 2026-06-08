import { useEffect, useState } from 'react'
import { useStore, type Tool } from '../state/store'
import { C, F, buttonStyle } from '../ui/tokens'

const TOOLS: { id: Tool; label: string }[] = [
  { id: 'select', label: 'Select' },
  { id: 'line', label: 'Line' },
  { id: 'polyline', label: 'Poly-L' },
  { id: 'freehand', label: 'Pen' },
  { id: 'ellipse', label: 'Bulb' },
  { id: 'triangle', label: 'Tri' },
  { id: 'rect', label: 'Rect' },
  { id: 'star', label: 'Star' },
  { id: 'polygon', label: 'Poly' }
]

interface PreviewApi {
  togglePreview?: () => Promise<boolean>
  onPreviewActive?: (cb: (active: boolean) => void) => void
}
const previewApi = (): PreviewApi | undefined =>
  (window as unknown as { api?: PreviewApi }).api

export function Toolbar({
  testOpen = false,
  onToggleTest
}: {
  testOpen?: boolean
  onToggleTest?: () => void
} = {}): React.JSX.Element {
  const mode = useStore((s) => s.mode)
  const setMode = useStore((s) => s.setMode)
  const tool = useStore((s) => s.tool)
  const setTool = useStore((s) => s.setTool)
  const editing = mode === 'edit'

  const [previewOpen, setPreviewOpen] = useState(false)
  const hasPreview = !!previewApi()?.togglePreview
  useEffect(() => {
    previewApi()?.onPreviewActive?.(setPreviewOpen)
  }, [])

  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        height: 52,
        padding: '0 14px',
        background: C.panel,
        borderBottom: `0.5px solid ${C.border}`,
        flexShrink: 0
      }}
    >
      <div style={{ fontFamily: F.display, fontSize: 22, letterSpacing: '0.12em', color: C.white }}>
        DECOR&nbsp;<span style={{ color: C.accent }}>STUDIO</span>
      </div>

      <div style={{ width: '0.5px', height: 26, background: C.border, margin: '0 4px' }} />

      <div
        style={{
          display: 'flex',
          gap: 6,
          opacity: editing ? 1 : 0.3,
          pointerEvents: editing ? 'auto' : 'none'
        }}
      >
        {TOOLS.map((t) => (
          <button
            key={t.id}
            style={buttonStyle({ active: tool === t.id })}
            onClick={() => setTool(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ flex: 1 }} />

      <button
        style={buttonStyle({ active: testOpen, accent: C.fuchsia, accentRGB: '193,134,200' })}
        onClick={onToggleTest}
      >
        テスト卓
      </button>
      <div style={{ width: '0.5px', height: 26, background: C.border, margin: '0 4px' }} />

      {hasPreview && (
        <>
          <button
            style={buttonStyle({ active: previewOpen, accent: C.green, accentRGB: '168,232,120' })}
            onClick={() => previewApi()?.togglePreview?.()}
          >
            プレビュー全画面
          </button>
          <div style={{ width: '0.5px', height: 26, background: C.border, margin: '0 4px' }} />
        </>
      )}

      <div style={{ display: 'flex', gap: 6 }}>
        <button style={buttonStyle({ active: mode === 'edit' })} onClick={() => setMode('edit')}>
          Edit
        </button>
        <button
          style={buttonStyle({ active: mode === 'live', accent: C.amber, accentRGB: '245,200,120' })}
          onClick={() => setMode('live')}
        >
          Live
        </button>
      </div>
    </header>
  )
}
