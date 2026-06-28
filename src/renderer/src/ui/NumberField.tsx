import { useEffect, useRef, useState } from 'react'
import { inputStyle, C } from './tokens'

/**
 * Console-style number field made easy to use:
 *  - ▲▼ spinner (right): click to step, press-and-hold to ramp up fast (big ranges).
 *  - Drag the field left/right to scrub (accelerates the farther you drag).
 *  - Click to focus + select-all and type an exact value; scroll wheel nudges while focused.
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
  const scrub = useRef<{ x: number; v: number; active: boolean } | null>(null)
  const valRef = useRef(value)
  valRef.current = value
  const holdRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // 入力中だけ生の打ち込み文字を保持（null=非編集中は value を表示）。これで「1文字ごとに
  // 丸まる/空にできず元へ戻る」を解消し、確定(blur/Enter)時にだけ clamp する（のむさん 2026-06-20）。
  const [draft, setDraft] = useState<string | null>(null)

  const clamp = (n: number): number => {
    let r = n
    if (min != null && r < min) r = min
    if (max != null && r > max) r = max
    return r
  }

  // press-and-hold on a spinner: step once, then repeat with acceleration so big
  // ranges (e.g. line width 1–500) don't need a hundred clicks.
  const startHold = (dir: number): void => {
    endHold()
    setDraft(null) // ▲▼で変えた値が表示に反映されるよう、編集中のドラフトは解除
    let v = valRef.current
    const apply = (mult: number): void => {
      v = clamp(v + dir * step * mult)
      onChange(v)
    }
    apply(1)
    let n = 0
    holdRef.current = setInterval(() => {
      n++
      apply(n > 26 ? 12 : n > 12 ? 4 : 1)
    }, 55)
  }
  const endHold = (): void => {
    if (holdRef.current) {
      clearInterval(holdRef.current)
      holdRef.current = null
    }
  }
  // 押しっぱなしの最中にこのフィールドが消えても（Inspector の作り替え等）タイマーを必ず止める。
  useEffect(() => () => endHold(), [])

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
      title="▲▼で増減（長押しで加速）／欄を左右ドラッグでも増減／クリックで直接入力（入力中はスクロールも可）"
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
        onPointerDown={(e) => {
          scrub.current = { x: e.clientX, v: value, active: false }
        }}
        onPointerMove={(e) => {
          const s = scrub.current
          if (!s) return
          const dx = e.clientX - s.x
          if (!s.active) {
            // クリックして打つ時の指のわずかな揺れでドラッグ化しないよう、はっきり横に
            // 動かした時だけスクラブ開始（トラックパッドでも入力できるように・のむさん 2026-06-20）
            if (Math.abs(dx) < 8) return
            s.active = true
            ref.current?.blur()
            ref.current?.setPointerCapture(e.pointerId)
          }
          // accelerate: fine near the start, fast the farther you drag (covers big ranges)
          const accel = 1 + Math.abs(dx) / 120
          onChange(clamp(s.v + Math.round((dx / 4) * accel) * step))
        }}
        onPointerUp={(e) => {
          if (scrub.current?.active) ref.current?.releasePointerCapture(e.pointerId)
          scrub.current = null
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
            startHold(1)
          }}
          onPointerUp={endHold}
          onPointerLeave={endHold}
          onPointerCancel={endHold}
        >
          ▲
        </button>
        <button
          type="button"
          aria-label="減らす"
          style={{ ...spinBtn, borderTop: 'none', borderRadius: '0 0 4px 0' }}
          onPointerDown={(e) => {
            e.preventDefault()
            startHold(-1)
          }}
          onPointerUp={endHold}
          onPointerLeave={endHold}
          onPointerCancel={endHold}
        >
          ▼
        </button>
      </div>
    </div>
  )
}
