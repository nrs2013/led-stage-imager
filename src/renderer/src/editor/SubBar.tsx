import { useStore } from '../state/store'
import { C, F, buttonStyle } from '../ui/tokens'

interface DecorApi {
  openImage?: () => Promise<string | null>
}

/** Returns a data URL for a chosen image. Uses Electron's dialog when available,
 *  otherwise falls back to a browser file picker (so it also works in dev:web). */
async function pickImage(): Promise<string | null> {
  const api = (window as unknown as { api?: DecorApi }).api
  if (api?.openImage) return api.openImage()
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.onchange = (): void => {
      const file = input.files?.[0]
      if (!file) return resolve(null)
      const reader = new FileReader()
      reader.onload = (): void => resolve(reader.result as string)
      reader.onerror = (): void => resolve(null)
      reader.readAsDataURL(file)
    }
    input.click()
  })
}

export function SubBar(): React.JSX.Element {
  const chart = useStore((s) => s.chart)
  const setUnderlay = useStore((s) => s.setUnderlay)
  const setUnderlayOpacity = useStore((s) => s.setUnderlayOpacity)
  const setUnderlayVisible = useStore((s) => s.setUnderlayVisible)
  const u = chart.underlay

  const load = async (): Promise<void> => {
    const dataUrl = await pickImage()
    if (dataUrl) setUnderlay({ dataUrl, opacity: 0.5, visible: true })
  }

  return (
    <div style={subBar}>
      <button style={{ ...buttonStyle({}), padding: '6px 12px' }} onClick={load}>
        下絵を読み込む
      </button>

      {u && (
        <>
          <span style={lbl}>不透明度</span>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(u.opacity * 100)}
            style={{ width: 120, accentColor: C.accent }}
            onChange={(e) => setUnderlayOpacity(Number(e.target.value) / 100)}
          />
          <span style={{ ...lbl, fontFamily: F.mono, width: 34 }}>{Math.round(u.opacity * 100)}%</span>
          <label style={{ ...lbl, display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={u.visible}
              style={{ accentColor: C.accent }}
              onChange={(e) => setUnderlayVisible(e.target.checked)}
            />
            表示
          </label>
          <button
            style={{ ...buttonStyle({ accent: '#e0726a', accentRGB: '224,114,106' }), padding: '5px 10px' }}
            onClick={() => setUnderlay(null)}
          >
            外す
          </button>
        </>
      )}

      <div style={{ flex: 1 }} />
      <span style={{ ...lbl, fontFamily: F.mono }}>
        canvas {chart.canvas.w} × {chart.canvas.h}
      </span>
    </div>
  )
}

const subBar: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  height: 42,
  padding: '0 14px',
  background: C.panel,
  borderBottom: `0.5px solid ${C.border}`,
  flexShrink: 0
}
const lbl: React.CSSProperties = {
  fontSize: 11,
  color: C.label,
  fontFamily: "'Inter','Noto Sans JP',sans-serif"
}
