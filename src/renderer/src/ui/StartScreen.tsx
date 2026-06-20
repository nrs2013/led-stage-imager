import { useEffect, useState } from 'react'
import { useStore } from '../state/store'
import { createChart } from '../model/chart-model'
import { openChartFromFile, markNewChart } from '../io/file-ops'
import { readBackup } from '../io/autosave'
import type { Chart } from '../model/types'
import { C, F } from './tokens'

/**
 * The doorway: first choose a MODE, not a file.
 *  - SHOW MODE  … 本番。電飾・照明を配置図に置いて卓のDMXで可視化し Syphon/NDI 出力する。
 *  - LIGHT SKETCH … かんたん。写真を灯体で照らして見た目を作る簡易プレビュー（旧・画像照明モード）。
 * チャート画像（配置図）は SHOW MODE に入ってから上のバーの「チャート画像」で貼る
 * （= 起動時にチャート取り込みを強制しない・のむさん 2026-06-19）。
 */
export function StartScreen(): React.JSX.Element {
  const setStarted = useStore((s) => s.setStarted)
  const setChart = useStore((s) => s.setChart)
  const setTool = useStore((s) => s.setTool)
  const setImageLight = useStore((s) => s.setImageLight)
  const [error, setError] = useState<string | null>(null)
  const [backup, setBackup] = useState<Chart | null>(null)

  // crash net: offer the autosaved chart from the last session
  useEffect(() => {
    void readBackup().then(setBackup)
  }, [])

  const startBlank = (w: number, h: number): void => {
    markNewChart() // 空チャート＝まだファイル未確定（最初の保存で保存先を聞く）
    setChart(createChart({ w, h }))
    setTool('pixelpen')
    setStarted(true)
  }

  const resume = (): void => {
    if (!backup) return
    markNewChart() // 自動バックアップからの復元はユーザーのファイルに紐づかない
    setChart(backup)
    setStarted(true)
  }

  // SHOW MODE に入る：いつでも「新規（空チャート）」で始める＝普通のアプリ(Excel/PowerPoint)と同じ。
  // 前回の自動バックアップは下の「前回の続きから」ボタンでだけ復元する（保存し忘れの保険・のむさん 2026-06-20）。
  const enterShowMode = (): void => {
    startBlank(1920, 1080)
  }

  const loadSaved = async (): Promise<void> => {
    setError(null)
    try {
      const c = await openChartFromFile()
      if (c) {
        setChart(c)
        setStarted(true)
      }
    } catch (err) {
      setError('保存ファイルを開けませんでした: ' + (err as Error).message)
    }
  }

  // Esc clears a stale error message.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.code === 'Escape') setError(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <main style={wrap}>
      <div style={{ textAlign: 'center' }}>
        <h1 style={title}>LED STAGE IMAGER</h1>
        <div style={subtitle}>CHOOSE A MODE</div>
      </div>

      <div style={modeCol}>
        <button
          style={showModeBtn}
          onClick={enterShowMode}
          title="本番モード — 電飾・照明を配置図に置いて、卓のDMXで可視化し Syphon/NDI 出力する"
        >
          <span style={modeTitle}>SHOW MODE</span>
          <span style={modeSub}>
            本番 — 新規の配置図から始める。電飾・照明を置いて卓のDMXで可視化（Syphon/NDI出力）
          </span>
        </button>

        <button
          style={sketchModeBtn}
          onClick={() => setImageLight(true)}
          title="かんたんモード — セット写真を灯体で照らして見た目を作る（卓・Art-Net不要）"
        >
          <span style={{ ...modeTitle, color: C.canvas }}>LIGHT SKETCH</span>
          <span style={{ ...modeSub, color: 'rgba(10,10,10,0.72)' }}>
            かんたん — 写真を灯体で照らして見た目を作る（卓なしでOK）
          </span>
        </button>
      </div>

      <div style={row}>
        <button style={smallBtn} onClick={loadSaved} title="保存した公演ファイル(.ledimager)を開く">
          保存ファイルを開く…
        </button>
        {backup && (
          <button
            style={smallBtn}
            onClick={resume}
            title="保存し忘れの保険。前回いじっていた内容（5秒ごとの自動バックアップ）を呼び戻します"
          >
            前回の続きから復元 — {backup.name || 'Untitled'}（{backup.layers.length}枚・電飾
            {backup.shapes.length}個）
          </button>
        )}
      </div>

      <div style={hintLine}>
        チャート画像（配置図）は SHOW MODE に入ってから、上のバーの「チャート画像」で貼れます。
      </div>

      {error && (
        <div style={errBox} data-testid="start-error">
          {error}
        </div>
      )}
    </main>
  )
}

const wrap: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 26,
  background: C.canvas
}
const title: React.CSSProperties = {
  margin: 0,
  fontFamily: F.display,
  fontSize: 44,
  letterSpacing: '0.08em',
  color: C.white,
  fontWeight: 400
}
const subtitle: React.CSSProperties = {
  marginTop: 2,
  fontSize: 10,
  letterSpacing: '0.3em',
  color: C.hint,
  fontFamily: F.ui
}
const modeCol: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
  width: 'min(560px, 80vw)'
}
const modeBtnBase: React.CSSProperties = {
  width: '100%',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 4,
  padding: '22px 20px',
  borderRadius: 8,
  cursor: 'pointer'
}
const showModeBtn: React.CSSProperties = {
  ...modeBtnBase,
  border: `0.5px solid ${C.cyan}`,
  background: `rgba(${C.accentRGB},0.08)`
}
const sketchModeBtn: React.CSSProperties = {
  ...modeBtnBase,
  border: 'none',
  background: C.amber,
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.18)'
}
const modeTitle: React.CSSProperties = {
  fontFamily: F.display,
  fontSize: 24,
  letterSpacing: '0.08em',
  color: C.white
}
const modeSub: React.CSSProperties = {
  fontSize: 12,
  color: C.label,
  fontFamily: F.ui,
  textAlign: 'center'
}
const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }
const smallBtn: React.CSSProperties = {
  background: 'transparent',
  border: `0.5px solid ${C.border}`,
  color: C.label,
  padding: '8px 13px',
  fontSize: 11,
  fontFamily: F.ui,
  borderRadius: 5,
  cursor: 'pointer'
}
const hintLine: React.CSSProperties = {
  fontSize: 11,
  color: C.faint,
  fontFamily: F.ui,
  textAlign: 'center',
  maxWidth: 520,
  lineHeight: 1.6
}
const errBox: React.CSSProperties = {
  maxWidth: 560,
  padding: '9px 14px',
  border: '1px solid #6a3531',
  borderRadius: 4,
  background: 'rgba(224,114,106,0.09)',
  color: '#e0726a',
  fontSize: 12,
  fontFamily: F.ui
}
