import { useEffect, useId, useRef } from 'react'
import { C, F, buttonStyle } from './tokens'

/** Native dialog keeps focus inside and handles Escape without blocking Electron. */
export function ChartDeleteDialog({ name, count, onCancel, onDelete }: {
  name: string; count: number; onCancel: () => void; onDelete: () => void
}): React.JSX.Element {
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId(), descriptionId = useId()
  useEffect(() => {
    const node = dialog.current
    node?.showModal()
    return () => node?.close()
  }, [])
  return <dialog ref={dialog} aria-labelledby={titleId} aria-describedby={descriptionId}
    onCancel={(e) => { e.preventDefault(); onCancel() }}
    style={{ background: C.surface, color: C.text, border: `0.5px solid ${C.border}`, borderRadius: 6,
      padding: 20, maxWidth: 440, width: 'calc(100vw - 48px)', fontFamily: F.ui }}>
    <div id={titleId} style={{ fontSize: 13, marginBottom: 12 }}>チャート削除の確認</div>
    <div id={descriptionId} style={{ fontSize: 11, lineHeight: 1.8 }}>
      「{name}」と、このチャートの電飾 {count} 本・Patchを削除します。<br />
      削除後は ⌘Z／Ctrl+Z で戻せます。元の画像ファイルは削除しません。
    </div>
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
      <button autoFocus style={{ ...buttonStyle({}), minHeight: 36 }} onClick={onCancel}>キャンセル</button>
      <button style={{ ...buttonStyle({}), minHeight: 36, borderColor: C.amber }} onClick={onDelete}>このチャートを削除</button>
    </div>
  </dialog>
}
