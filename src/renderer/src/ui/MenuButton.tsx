import { useEffect, useRef, useState } from 'react'
import { C, F, buttonStyle } from './tokens'

/** 上のバーの「まとめボタン」。押すと中身が出る（Esc / 外側クリックで閉じる）。
 *  ボタンが常時20個以上並んで探せない状態を、使う場面ごとに畳むための部品
 *  （のむさん 2026-07-25「ボタンが沢山あって全然わかりづらい」）。 */
export function MenuButton({
  label,
  title,
  width = 230,
  children
}: {
  label: string
  title?: string
  width?: number
  /** close を呼ぶと閉じる＝項目を押したら閉じられる。 */
  children: (close: () => void) => React.ReactNode
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.code === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        style={{ ...buttonStyle({ active: open }), padding: '8px 11px', whiteSpace: 'nowrap' }}
        onClick={() => setOpen((v) => !v)}
        title={title}
      >
        {label} <span style={{ color: C.hint, fontSize: 9 }}>▼</span>
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            width,
            padding: 6,
            background: C.panel,
            border: `0.5px solid ${C.border}`,
            borderRadius: 6,
            boxShadow: '0 12px 40px rgba(0,0,0,0.55)',
            zIndex: 95
          }}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}

/** メニューの1行。当たり判定は大きめ（文字と線はそのまま）。 */
export function MenuItem({
  label,
  hint,
  title,
  active,
  danger,
  onClick
}: {
  label: string
  /** 右端の薄い字（ショートカットなど） */
  hint?: string
  title?: string
  active?: boolean
  danger?: boolean
  onClick: () => void
}): React.JSX.Element {
  const [hover, setHover] = useState(false)
  return (
    <button
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
        width: '100%',
        padding: '9px 10px',
        background: hover || active ? 'rgba(255,255,255,0.06)' : 'transparent',
        border: `0.5px solid ${active ? C.accent : 'transparent'}`,
        borderRadius: 4,
        color: danger ? '#e0726a' : C.text,
        fontFamily: F.ui,
        fontSize: 12,
        textAlign: 'left',
        cursor: 'pointer'
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onClick}
      title={title}
    >
      <span>{label}</span>
      {hint && <span style={{ color: C.faint, fontFamily: F.mono, fontSize: 10 }}>{hint}</span>}
    </button>
  )
}

export function MenuSep(): React.JSX.Element {
  return <div style={{ height: '0.5px', background: C.border, margin: '5px 4px' }} />
}

/** メニューの中の見出し（スライダー等の説明用）。 */
export function MenuLabel({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div style={{ fontFamily: F.ui, fontSize: 10, color: C.hint, padding: '6px 10px 2px' }}>
      {children}
    </div>
  )
}
