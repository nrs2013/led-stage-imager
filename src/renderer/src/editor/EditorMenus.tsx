import { useEffect, useState } from 'react'
import { useStore, activeLayerOf } from '../state/store'
import { createChart, newId } from '../model/chart-model'
import { saveChartToFile, saveChartAsToFile, openChartFromFile, markNewChart, currentChartFileName } from '../io/file-ops'
import { pickImage, imageSize } from '../io/image-pick'
import { exportPatchCsv, exportPatchMvr } from '../io/patch-export'
import { SettingsDialog } from '../ui/SettingsDialog'
import { FillDialog } from '../ui/FillDialog'
import { ArtNetRelayDialog } from '../ui/ArtNetRelayDialog'
import { MenuButton, MenuItem, MenuSep, MenuLabel } from '../ui/MenuButton'
import { C, F } from '../ui/tokens'

const fileBaseName = (path: string): string => path.split(/[\\/]/).pop() || path

/** 上のバーの「ファイル」「チャート」＝以前は2段目に20個近く並んでいたボタンを、
 *  使う場面ごとに2つのまとめボタンへ畳んだもの（のむさん 2026-07-25）。
 *  ⌘S などのショートカットは従来どおり別経路で効く。 */
export function EditorMenus(): React.JSX.Element {
  // 🔴 chart を丸ごと購読しない。このメニューは Toolbar の中にいるので、購読すると
  // 電飾を1px動かすたびに上のバー全体（道具ボタン・太さ欄・図形メニュー）が作り直されて
  // 操作がもたつく。表示に要る所だけを細かく購読する（値は操作時に getState() で読む）。
  const setChart = useStore((s) => s.setChart)
  const setTool = useStore((s) => s.setTool)
  const setUnderlay = useStore((s) => s.setUnderlay)
  const setUnderlayOpacity = useStore((s) => s.setUnderlayOpacity)
  const setUnderlayVisible = useStore((s) => s.setUnderlayVisible)
  const setUnderlayMask = useStore((s) => s.setUnderlayMask)
  const applyChartImage = useStore((s) => s.applyChartImage)
  const maskEmpty = useStore((s) => s.maskEmpty)
  const showDims = useStore((s) => s.showDims)
  const setShowDims = useStore((s) => s.setShowDims)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [fillOpen, setFillOpen] = useState(false)
  const [relayOpen, setRelayOpen] = useState(false)
  const [savedFlash, setSavedFlash] = useState<string | null>(null)
  const [newFlash, setNewFlash] = useState(false)
  // 今どのファイルを触っているか＋保存済みかは store に置く（モードを往復しても消えない・
   // StartScreen やダブルクリックで開いた時も同じ表示になる）
  const fileName = useStore((s) => s.chartFileName)
  const chartName = useStore((s) => s.chart.name)
  const markChartFile = useStore((s) => s.markChartFile)
  // 真偽値だけを購読＝未保存の状態が変わった時しか作り直されない
  const dirty = useStore((s) => s.savedChart !== s.chart)
  const shownFileName = fileName ? fileBaseName(fileName) : `${chartName || 'chart'}.ledimager`
  // 下絵は「差し替えた時」だけ参照が変わる＝図形を動かしても作り直されない
  const u = useStore((s) => activeLayerOf(s.chart).underlay)

  // 「新規」の手応え — 空のチャートで押しても見た目が変わらず「効いてない？」になるため
  // 必ず目に見える反応を出す（のむさん 2026-06-20）
  useEffect(() => {
    if (!newFlash) return
    const t = setTimeout(() => setNewFlash(false), 1800)
    return () => clearTimeout(t)
  }, [newFlash])

  // 「保存しました」— 保存ボタンと ⌘S（EditorCanvas）の両方から飛んでくる
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null
    const onSaved = (e: Event): void => {
      const label = String((e as CustomEvent).detail)
      setSavedFlash(label)
      useStore.getState().markChartFile(label, useStore.getState().chart)
      if (t) clearTimeout(t)
      t = setTimeout(() => setSavedFlash(null), 2500)
    }
    window.addEventListener('decor:saved', onSaved)
    return () => {
      if (t) clearTimeout(t)
      window.removeEventListener('decor:saved', onSaved)
    }
  }, [])

  const loadUnderlay = async (): Promise<void> => {
    const dataUrl = await pickImage()
    if (!dataUrl) return
    const size = await imageSize(dataUrl)
    if (!size) {
      // eslint-disable-next-line no-alert
      alert('画像を読み込めませんでした（壊れているか、対応していない形式です）')
      return
    }
    applyChartImage(dataUrl, size.w, size.h)
  }
  const newChart = (): void => {
    if (
      useStore.getState().chart.shapes.length > 0 &&
      !window.confirm('現在の作品を閉じて新規にしますか？（保存していない変更は消えます）')
    ) {
      return
    }
    markNewChart() // 新規＝ファイル未確定。次の保存で保存先を聞く
    setChart(createChart({ w: 1920, h: 1080 }))
    setTool('select')
    // 編集画面のまま空チャートにする。StartScreen へ戻すと SHOW MODE 再選択で
    // 「前回の続き(自動バックアップ)」が復活し、新規にならない不具合になるため戻さない。
    setSavedFlash(null)
    markChartFile(null, null)
    setNewFlash(true)
    window.dispatchEvent(new CustomEvent('decor:fit')) // ビューを全体表示にリセット
  }
  const openChart = async (): Promise<void> => {
    // 新規と同じく、未保存の作業があるなら開く前に確認（Open で黙って消えるのを防ぐ）
    if (
      useStore.getState().chart.shapes.length > 0 &&
      !window.confirm('現在の作品を閉じて開きますか？（保存していない変更は消えます）')
    ) {
      return
    }
    try {
      const c = await openChartFromFile()
      if (c) {
        setChart(c)
        setTool('select')
        markChartFile((await currentChartFileName()) ?? (c.name || '名前なし'), c)
      }
    } catch (err) {
      // eslint-disable-next-line no-alert
      alert('チャートを開けませんでした: ' + (err as Error).message)
    }
  }
  const saveChart = async (): Promise<void> => {
    const label = await saveChartToFile(useStore.getState().chart)
    if (label) window.dispatchEvent(new CustomEvent('decor:saved', { detail: label }))
  }
  const saveChartAs = async (): Promise<void> => {
    const label = await saveChartAsToFile(useStore.getState().chart)
    if (label) window.dispatchEvent(new CustomEvent('decor:saved', { detail: label }))
  }
  const duplicate = (): void => {
    markNewChart() // 複製＝別作品。元ファイルに上書きしないよう保存先をリセット
    const cur = useStore.getState().chart
    setChart({ ...cur, id: newId('chart'), name: `${cur.name || 'Untitled'} copy` })
    markChartFile(null, null) // 表示も「まだファイルにしていない」に戻す
  }

  return (
    <>
      <MenuButton label="ファイル" title="新規・開く・保存・書き出し・設定">
        {(close) => (
          <>
            <MenuItem label="新規" onClick={() => { close(); newChart() }} />
            <MenuItem label="開く" onClick={() => { close(); void openChart() }} />
            <MenuItem
              label={`「${shownFileName}」で保存`}
              hint="⌘S"
              title="今のファイルに上書き保存（初回だけ保存先を聞きます）"
              onClick={() => { close(); void saveChart() }}
            />
            <MenuItem
              label="別名で保存…"
              hint="⇧⌘S"
              title="新しいファイルとして保存し、以降はそちらに上書きします"
              onClick={() => { close(); void saveChartAs() }}
            />
            <MenuItem
              label="複製"
              title="今のチャートを別作品としてコピーします（元のファイルには上書きしません）"
              onClick={() => { close(); duplicate() }}
            />
            <MenuSep />
            <MenuItem
              label="MVRで書き出す"
              title="grandMA3 用の MVR（パッチ＋配置＋DECOR Cell の GDTF 同梱）"
              onClick={() => { close(); void exportPatchMvr(useStore.getState().chart) }}
            />
            <MenuItem
              label="CSVで書き出す"
              title="パッチ表を表計算で開ける形にして書き出します"
              onClick={() => { close(); exportPatchCsv(useStore.getState().chart) }}
            />
            <MenuSep />
            <MenuItem
              label="Art-Net遅延出力…"
              title="GrandMA3から受けたArt-Netを、Universeごとに遅らせてDMXノードへ送ります"
              onClick={() => { close(); setRelayOpen(true) }}
            />
            <MenuItem label="設定" title="キャンバスの大きさ・出力名・にじみなど" onClick={() => { close(); setSettingsOpen(true) }} />
          </>
        )}
      </MenuButton>

      <MenuButton label="チャート" title="チャート画像の読み込みと、その見え方・はみ出し禁止" width={250}>
        {(close) => (
          <>
            <MenuItem
              label={u ? 'チャート画像を選び直す' : 'チャート画像を読む'}
              title="キャンバスは画像のピクセル数に合わせ直されます"
              onClick={() => { close(); void loadUnderlay() }}
            />
            {u && (
              <>
                <MenuSep />
                <MenuLabel>濃さ</MenuLabel>
                <div style={{ padding: '2px 10px 8px' }}>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={Math.round(u.opacity * 100)}
                    style={{ width: '100%', accentColor: C.accent }}
                    onChange={(e) => setUnderlayOpacity(Number(e.target.value) / 100)}
                  />
                </div>
                <MenuItem
                  label="下絵を表示"
                  active={u.visible}
                  onClick={() => setUnderlayVisible(!u.visible)}
                />
                <MenuSep />
                <MenuItem
                  label="はみ出し禁止"
                  active={u.mask?.enabled ?? false}
                  title="チャートの透明にくり抜かれた所だけ描けるようにする"
                  onClick={() => setUnderlayMask({ enabled: !(u.mask?.enabled ?? false) })}
                />
                {u.mask?.enabled && (
                  <MenuItem
                    label="描ける所を反転"
                    active={u.mask?.invert ?? false}
                    title="ONにすると絵がある所が描画領域になります"
                    onClick={() => setUnderlayMask({ invert: !(u.mask?.invert ?? false) })}
                  />
                )}
                {u.mask?.enabled && (
                  <MenuItem
                    label="自動で敷き詰める"
                    title="くり抜きの中に棒／ドットを自動で並べ、連番で番地もふります"
                    onClick={() => { close(); setFillOpen(true) }}
                  />
                )}
                <MenuItem
                  label="寸法を出す"
                  active={showDims}
                  title="くり抜きの寸法線（X/Yのピクセル数）を表示"
                  onClick={() => setShowDims(!showDims)}
                />
                <MenuSep />
                <MenuItem
                  label="チャート画像を外す"
                  danger
                  onClick={() => { close(); setUnderlay(null) }}
                />
              </>
            )}
          </>
        )}
      </MenuButton>

      <span
        style={{
          fontSize: 11,
          color: dirty ? C.amber : C.label,
          fontFamily: F.mono,
          whiteSpace: 'nowrap',
          maxWidth: 220,
          overflow: 'hidden',
          textOverflow: 'ellipsis'
        }}
        title={
          fileName
            ? dirty
              ? `${fileName} — 保存していない変更があります（⌘S で保存）`
              : `${fileName} — 保存済み`
            : 'まだファイルにしていません（⌘S で保存先を聞きます）'
        }
      >
        ファイル: {fileName ? `${dirty ? '● ' : ''}${shownFileName}` : `● ${shownFileName}（未保存）`}
      </span>
      {savedFlash && (
        <span style={{ fontSize: 11, color: C.green, fontFamily: F.mono, whiteSpace: 'nowrap' }}>
          保存しました
        </span>
      )}
      {newFlash && (
        <span style={{ fontSize: 11, color: C.cyan, fontFamily: F.mono, whiteSpace: 'nowrap' }}>
          ● 新規チャート
        </span>
      )}
      {u?.mask?.enabled && maskEmpty && (
        <span style={{ fontSize: 11, color: C.amber, fontFamily: F.ui, whiteSpace: 'nowrap' }}>
          この画像では描ける所が0 → 制限を解除中（「描ける所を反転」を試して）
        </span>
      )}

      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
      {fillOpen && <FillDialog onClose={() => setFillOpen(false)} />}
      {relayOpen && <ArtNetRelayDialog onClose={() => setRelayOpen(false)} />}
    </>
  )
}
