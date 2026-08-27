import { useRef, useState } from 'react'
import { inputStyle, C } from './tokens'

/**
 * Console-style number field made easy to use:
 *  - ▲▼ spinner (right): one click always changes exactly one step.
 *  - Click anywhere in the number to select-all and type an exact value.
 * Fits both full-width rows and tight 3-column rows (spinner is only 18px).
 */
export function NumberField({
  value,
  onChange,
  min,
  max,
  step = 1,
  style
}: {
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
  style?: React.CSSProperties
}): React.JSX.Element {
  const ref = useRef<HTMLInputElement>(null)
  const valRef = useRef(value)
  valRef.current = value
  // 入力中だけ生の打ち込み文字を保持（null=非編集中は value を表示）。これで「1文字ごとに
  // 丸まる/空にできず元へ戻る」を解消し、確定(blur/Enter)時にだけ clamp する（のむさん 2026-06-20）。
  const [draft, setDraft] = useState<string | null>(null)

  const clamp = (n: number): number => {
    let r = n
    if (min != null && r < min) r = min
    if (max != null && r > max) r = max
    return r
  }

  const stepOnce = (dir: number): void => {
    setDraft(null) // ▲▼で変えた値が表示に反映されるよう、編集中のドラフトは解除
    onChange(clamp(valRef.current + dir * step))
  }

  const spinBtn: React.CSSProperties = {
    flex: 1,
    minHeight: 0,
    border: '1px solid #3b3631',
    borderLeft: 'none',
    background: C.inputBg,
    color: C.white,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 9,
    lineHeight: 1,
    padding: 0,
    userSelect: 'none'
  }

  return (
    <div
      style={{ display: 'flex', width: '100%', alignItems: 'stretch', ...style }}
      title="▲▼は1回で1目盛り増減／数字をクリックすると全選択（入力中はスクロールも可）"
    >
      <input
        ref={ref}
        type="text"
        inputMode="numeric"
        value={draft ?? String(value)}
        onFocus={(e) => {
          setDraft(String(value))
          e.currentTarget.select()
        }}
        onClick={(e) => e.currentTarget.select()}
        onChange={(e) => {
          // 入力中は打った文字をそのまま表示（途中で空/範囲外でもOK）。有効な数なら即反映。
          const raw = e.target.value
          setDraft(raw)
          const t = raw.trim()
          if (t === '' || t === '-') return
          const n = Number(t)
          if (Number.isFinite(n)) onChange(clamp(n))
        }}
        onBlur={(e) => {
          // 確定：打ち終わった値を clamp して反映。空/不正なら直前の値を維持。
          const t = e.currentTarget.value.trim()
          const n = Number(t)
          if (t !== '' && t !== '-' && Number.isFinite(n)) onChange(clamp(n))
          setDraft(null)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          else if (e.key === 'Escape') {
            e.currentTarget.value = String(value) // 確定値へ戻す＝Escで取り消し
            setDraft(null)
            e.currentTarget.blur()
          }
        }}
        onWheel={(e) => {
          // only while focused, so scrolling the panel doesn't change values by accident
          if (document.activeElement !== ref.current) return
          e.preventDefault()
          setDraft(null)
          onChange(clamp(valRef.current + (e.deltaY < 0 ? 1 : -1) * step * (e.shiftKey ? 10 : 1)))
        }}
        style={{
          ...inputStyle,
          flex: 1,
          minWidth: 0,
          width: 'auto',
          minHeight: 44,
          borderRadius: '4px 0 0 4px',
          cursor: 'text'
        }}
      />
      <div style={{ display: 'flex', flexDirection: 'column', flex: '0 0 30px' }}>
        <button
          type="button"
          aria-label="増やす"
          style={{ ...spinBtn, borderRadius: '0 4px 0 0' }}
          onPointerDown={(e) => {
            e.preventDefault()
            stepOnce(1)
          }}
          onClick={(e) => {
            if (e.detail === 0) stepOnce(1) // キーボードの Enter / Space
          }}
        >
          ▲
        </button>
        <button
          type="button"
          aria-label="減らす"
          style={{ ...spinBtn, borderTop: 'none', borderRadius: '0 0 4px 0' }}
          onPointerDown={(e) => {
            e.preventDefault()
            stepOnce(-1)
          }}
          onClick={(e) => {
            if (e.detail === 0) stepOnce(-1) // キーボードの Enter / Space
          }}
        >
          ▼
        </button>
      </div>
    </div>
  )
}
