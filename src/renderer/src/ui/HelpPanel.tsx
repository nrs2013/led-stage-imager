import { useEffect } from 'react'
import { useStore } from '../state/store'
import { C, F, buttonStyle } from './tokens'

/** The Keys cheat-sheet: every shortcut and hidden gesture, in one glance.
 *  Opened with "?" or the Toolbar's Keys button. */
export function HelpPanel(): React.JSX.Element {
  const setHelpOpen = useStore((s) => s.setHelpOpen)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.code === 'Escape') setHelpOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setHelpOpen])

  return (
    <div style={backdrop} onClick={() => setHelpOpen(false)}>
      <div style={modal} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontFamily: F.display, fontSize: 18, letterSpacing: '0.12em', color: C.white }}>
            Keys
          </div>
          <span style={{ fontSize: 11, color: C.faint, fontFamily: F.ui, marginLeft: 10 }}>
            ? キーでいつでも開閉
          </span>
          <div style={{ flex: 1 }} />
          <button style={{ ...buttonStyle({}), padding: '4px 10px' }} onClick={() => setHelpOpen(false)}>
            Close
          </button>
        </div>

        <div style={grid}>
          <Section title="ツール">
            <Row k="V" v="選択" />
            <Row k="P" v="ペン（ドット描き）" />
            <Row k="E" v="消しゴム" />
            <Row k="L" v="ライン" />
            <Row k="F" v="画面にフィット" />
          </Section>

          <Section title="Shift の魔法">
            <Row k="Shift+ドラッグ" v="線がまっすぐ（横・縦・45°）" />
            <Row k="Shift+ドラッグ" v="丸→正円・四角→正方形" />
            <Row k="Shift+ペン" v="直線モードで点を打つ" />
            <Row k="Shift+移動" v="縦横まっすぐスライド" />
            <Row k="Shift+角つかみ" v="軸固定で引っぱる" />
          </Section>

          <Section title="編集">
            <Row k="⌘Z / ⌘⇧Z" v="取り消し / やり直し（Zだけでも可）" />
            <Row k="⌘C → ⌘V" v="コピー → クリックでスタンプ連打（Escで終了）" />
            <Row k="⌘D 連打" v="複製 — 1個目を置いた間隔のまま等間隔に並ぶ" />
            <Row k="⌘A" v="今の曲ページを全選択" />
            <Row k="⌘G" v="選んだ線を1本に結合（同じフェーダー）" />
            <Row k="⌘L" v="ロック / 解除" />
            <Row k="⌘S" v="保存" />
            <Row k="Delete" v="削除" />
          </Section>

          <Section title="微調整">
            <Row k="矢印" v="1ドット動かす" />
            <Row k="Shift+矢印" v="10ドット動かす" />
            <Row k="[ ]" v="線を細く / 太く" />
          </Section>

          <Section title="吸着（Snap ON 時）">
            <Row k="自動" v="端・中心・等間隔でピタッと（ガイド線が出る）" />
            <Row k="⌘ or ⌥ 押しながら" v="吸着を一時オフ" />
          </Section>

          <Section title="キャンバス">
            <Row k="Space+ドラッグ" v="画面を動かす" />
            <Row k="ホイール" v="ズーム" />
            <Row k="右クリック" v="メニュー（ロック品の解除もここ）" />
            <Row k="右ドラッグ" v="掴んで移動" />
            <Row k="空白クリック" v="貼り付け位置をマーク（⌘Vでそこへ）" />
            <Row k="Esc" v="選択解除・キャンセル" />
          </Section>

          <Section title="レイヤー（曲ページ）">
            <Row k="ダブルクリック" v="レイヤー名（曲名）を変更" />
            <Row k="画像をドロップ" v="新しい曲ページとして追加" />
          </Section>
        </div>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div>
      <div
        style={{
          fontSize: 10,
          color: C.label,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          fontFamily: F.ui,
          borderBottom: `0.5px solid ${C.border}`,
          paddingBottom: 4,
          marginBottom: 6
        }}
      >
        {title}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>{children}</div>
    </div>
  )
}

function Row({ k, v }: { k: string; v: string }): React.JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
      <kbd
        style={{
          fontFamily: F.mono,
          fontSize: 10,
          color: C.white,
          background: '#242220',
          border: `0.5px solid ${C.border}`,
          borderRadius: 3,
          padding: '1px 6px',
          whiteSpace: 'nowrap',
          flexShrink: 0,
          minWidth: 86,
          textAlign: 'center'
        }}
      >
        {k}
      </kbd>
      <span style={{ fontSize: 11, color: C.text, fontFamily: F.ui }}>{v}</span>
    </div>
  )
}

const backdrop: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.55)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 80
}

const modal: React.CSSProperties = {
  width: 760,
  maxWidth: '92vw',
  maxHeight: '86vh',
  overflowY: 'auto',
  background: C.panel,
  border: `0.5px solid ${C.border}`,
  borderRadius: 6,
  padding: 18,
  boxShadow: '0 18px 60px rgba(0,0,0,0.5)'
}

const grid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: '14px 22px'
}
