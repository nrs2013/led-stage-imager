import { useEffect, useRef, useState } from 'react'
import { inputStyle, C } from './tokens'

/**
 * Console-style number field made easy to use:
 *  - ▲▼ spinner (right): one click changes one step; press-and-hold repeats.
 *  - Click anywhere in the number to select-all and type an exact value.
 * Fits both full-width rows and tight 3-column rows (spinner is only 18px).
 */
export function NumberField({
  value,
  onChange,
  min,
  max,
  step = 1,
  style,
  compact = false
}: {
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
  style?: React.CSSProperties
  /** 上部ツールバー等の狭い1行へ収める。通常の入力欄の大きな当たり判定は変えない。 */
  compact?: boolean
}): React.JSX.Element {
  const ref = useRef<HTMLInputElement>(null)
  const valRef = useRef(value)
  const repeatDelayRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const repeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
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
    const next = clamp(valRef.current + dir * step)
    valRef.current = next // 連続中もReactの再描画を待たず、必ず1目盛りずつ進める
    onChange(next)
  }

  const stopRepeat = (): void => {
    if (repeatDelayRef.current) clearTimeout(repeatDelayRef.current)
    if (repeatTimerRef.current) clearInterval(repeatTimerRef.current)
    repeatDelayRef.current = null
    repeatTimerRef.current = null
  }

  const startRepeat = (dir: number): void => {
    stopRepeat()
    stepOnce(dir) // 短いクリックは従来どおり、正確に1回だけ
    repeatDelayRef.current = setTimeout(() => {
      repeatTimerRef.current = setInterval(() => stepOnce(dir), 80)
    }, 450)
  }

  useEffect(() => stopRepeat, [])

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
      title="▲▼は1回で1目盛り、押し続けると連続増減／数字をクリックすると全選択"
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
          minHeight: compact ? 30 : 44,
          borderRadius: '4px 0 0 4px',
          cursor: 'text'
        }}
      />
      <div style={{ display: 'flex', flexDirection: 'column', flex: compact ? '0 0 22px' : '0 0 30px' }}>
        <button
          type="button"
          aria-label="増やす"
          style={{ ...spinBtn, borderRadius: '0 4px 0 0' }}
          onPointerDown={(e) => {
            e.preventDefault()
            startRepeat(1)
          }}
          onPointerUp={stopRepeat}
          onPointerCancel={stopRepeat}
          onPointerLeave={stopRepeat}
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
            startRepeat(-1)
          }}
          onPointerUp={stopRepeat}
          onPointerCancel={stopRepeat}
          onPointerLeave={stopRepeat}
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
