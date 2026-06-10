import { useEffect, useState } from 'react'
import { useStore, type Tool } from '../state/store'
import { C, F, buttonStyle } from '../ui/tokens'

/** Tool icons: the shape you click is the shape you draw next. */
function ToolIcon({ id }: { id: Tool }): React.JSX.Element {
  const s = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6 } as const
  const body = ((): React.JSX.Element => {
    switch (id) {
      case 'select':
        return <polygon points="4,2 12.5,8.7 8.1,9.4 10.3,13.8 8.4,14.7 6.3,10.3 4,12.6" fill="currentColor" stroke="none" />
      case 'line':
        return <line x1="2.5" y1="13.5" x2="13.5" y2="2.5" {...s} strokeLinecap="round" />
      case 'polyline':
        return <polyline points="2,13 5.5,4.5 9.5,10 14,3" {...s} strokeLinejoin="round" strokeLinecap="round" />
      case 'freehand':
        return <path d="M2 12 C 4.5 3.5, 8 14.5, 14 4.5" {...s} strokeLinecap="round" />
      case 'pixelpen':
        return (
          <g fill="currentColor" stroke="none">
            <rect x="1.5" y="11" width="3.4" height="3.4" />
            <rect x="4.9" y="7.6" width="3.4" height="3.4" />
            <rect x="8.3" y="4.2" width="3.4" height="3.4" />
            <rect x="11.7" y="0.8" width="3.4" height="3.4" />
          </g>
        )
      case 'ellipse':
        return <circle cx="8" cy="8" r="5.6" {...s} />
      case 'triangle':
        return <polygon points="8,2.6 14,13.4 2,13.4" {...s} strokeLinejoin="round" />
      case 'rect':
        return <rect x="2.6" y="3.6" width="10.8" height="8.8" {...s} />
      case 'star':
        return (
          <polygon
            points="8,1.6 9.8,5.9 14.4,6.3 10.9,9.3 12,13.9 8,11.4 4,13.9 5.1,9.3 1.6,6.3 6.2,5.9"
            {...s}
            strokeWidth={1.3}
            strokeLinejoin="round"
          />
        )
      case 'polygon':
        return <polygon points="8,1.9 13.3,5 13.3,11 8,14.1 2.7,11 2.7,5" {...s} strokeLinejoin="round" />
    }
  })()
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" style={{ display: 'block' }}>
      {body}
    </svg>
  )
}

const TOOLS: { id: Tool; label: string; hint: string }[] = [
  { id: 'select', label: 'Select', hint: '選択 / 移動 / 変形（四隅・点をドラッグ）' },
  { id: 'line', label: 'Line', hint: '直線' },
  { id: 'polyline', label: 'Poly Line', hint: '折れ線（クリックで角・ダブルクリックで確定）' },
  { id: 'freehand', label: 'Pen', hint: 'なめらかな手描き' },
  { id: 'pixelpen', label: 'Paint', hint: '1pxドット塗り（ドラッグで塗る）' },
  { id: 'ellipse', label: 'Bulb', hint: '丸・電球' },
  { id: 'triangle', label: 'Triangle', hint: '三角' },
  { id: 'rect', label: 'Rect', hint: '四角' },
  { id: 'star', label: 'Star', hint: '星' },
  { id: 'polygon', label: 'Polygon', hint: '六角形' }
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
            style={{
              ...buttonStyle({ active: tool === t.id }),
              width: 36,
              height: 32,
              padding: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
            onClick={() => setTool(t.id)}
            title={`${t.label} — ${t.hint}`}
            aria-label={t.label}
          >
            <ToolIcon id={t.id} />
          </button>
        ))}
      </div>

      <div style={{ flex: 1 }} />

      <button
        style={buttonStyle({ active: testOpen, accent: C.fuchsia, accentRGB: '193,134,200' })}
        onClick={onToggleTest}
      >
        Programmer
      </button>
      <div style={{ width: '0.5px', height: 26, background: C.border, margin: '0 4px' }} />

      {hasPreview && (
        <>
          <button
            style={buttonStyle({ active: previewOpen, accent: C.green, accentRGB: '168,232,120' })}
            onClick={() => previewApi()?.togglePreview?.()}
          >
            Fullscreen
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
