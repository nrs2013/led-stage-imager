import { useEffect, useState } from 'react'
import { useStore } from '../state/store'
import { createChart } from '../model/chart-model'
import { openChartFromFile, markNewChart } from '../io/file-ops'
import { readBackup } from '../io/autosave'
import type { Chart } from '../model/types'

/**
 * The doorway: first choose a MODE, not a file (cinematic-beam design・のむさん 2026-06-20).
 *  - SHOW MODE  … 本番。電飾・照明を配置図に置いて卓のDMXで可視化し Syphon/NDI 出力する。常に新規（空）で開始。
 *  - LIGHT SKETCH … かんたん。写真を灯体で照らして見た目を作る簡易プレビュー（旧・画像照明モード）。
 * チャート画像（配置図）は SHOW MODE に入ってから上のバーの「チャート画像」で貼る。
 * 画面の文言は英語のみ（のむさん要望）。ロゴは Cormorant Garamond 300（同梱・CSP font-src 'self'）。
 */
export function StartScreen(): React.JSX.Element {
  const setStarted = useStore((s) => s.setStarted)
  const setChart = useStore((s) => s.setChart)
  const setTool = useStore((s) => s.setTool)
  const setImageLight = useStore((s) => s.setImageLight)
  const setLightingOnly = useStore((s) => s.setLightingOnly)
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
  // 前回の自動バックアップは下の「Recover last session」でだけ復元する（保存し忘れの保険）。
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
      setError('Could not open the file: ' + (err as Error).message)
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
    <main className="ss-root">
      <style>{SS_CSS}</style>

      <svg className="ss-beam" viewBox="0 0 620 760" preserveAspectRatio="xMidYMin slice" aria-hidden="true">
        <defs>
          <linearGradient id="ss-cone" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#7bc5e8" stopOpacity="0.17" />
            <stop offset="0.5" stopColor="#7bc5e8" stopOpacity="0.05" />
            <stop offset="1" stopColor="#7bc5e8" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="ss-core" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fafaf8" stopOpacity="0.20" />
            <stop offset="1" stopColor="#fafaf8" stopOpacity="0" />
          </linearGradient>
        </defs>
        <g style={{ mixBlendMode: 'screen' }}>
          <polygon points="310,0 242,520 378,520" fill="url(#ss-cone)" />
          <polygon points="310,0 290,360 330,360" fill="url(#ss-core)" />
        </g>
      </svg>

      <div className="ss-inner">
        <div className="ss-glow" aria-hidden="true" />

        <div className="ss-fix" aria-hidden="true">
          <svg width="50" height="36" viewBox="0 0 46 34" fill="none" stroke="#a8a8a0" strokeWidth="1">
            <line x1="3" y1="4" x2="43" y2="4" />
            <line x1="9" y1="4" x2="6" y2="9" />
            <line x1="20" y1="4" x2="17" y2="9" />
            <line x1="31" y1="4" x2="28" y2="9" />
            <line x1="42" y1="4" x2="39" y2="9" />
            <rect x="18" y="8" width="10" height="9" rx="1.5" />
            <line x1="23" y1="17" x2="23" y2="22" />
            <path d="M19 22 L27 22 L31 33 L15 33 Z" stroke="#7bc5e8" strokeOpacity="0.5" />
          </svg>
        </div>

        <h1 className="ss-title">LED STAGE IMAGER</h1>
        <p className="ss-tag">DMX Visualizer&nbsp;·&nbsp;Syphon / NDI Output</p>

        <div className="ss-modes">
          <button
            className="ss-mode ss-show"
            onClick={enterShowMode}
            title="電飾モード — 透明な図面に電飾を本格描画し、卓のDMXで可視化して Syphon / NDI 出力"
          >
            <span className="ss-mi">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" strokeWidth="1">
                <rect x="2" y="3" width="16" height="11" rx="1" />
                <line x1="2" y1="14" x2="18" y2="14" />
                <circle cx="6.5" cy="7" r="1" />
                <circle cx="11" cy="9.5" r="1" />
                <circle cx="14.5" cy="6" r="1" />
              </svg>
            </span>
            <span className="ss-mt">
              <span className="ss-mh">Decor Mode</span>
              <span className="ss-ms">Draw decor on a chart · DMX · Syphon / NDI</span>
            </span>
            <svg className="ss-ar" width="14" height="14" viewBox="0 0 14 14" fill="none" strokeWidth="1">
              <path d="M5 3 L9 7 L5 11" />
            </svg>
          </button>

          <button
            className="ss-mode ss-light"
            onClick={() => {
              setLightingOnly(true)
              setImageLight(true)
            }}
            title="照明モード — 写真を読み込んで照明を当てる。⌘+クリックで灯体を置き、DMXで色・動き。深度（立体）対応"
          >
            <span className="ss-mi">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" strokeWidth="1">
                <rect x="8" y="2" width="4" height="3" rx="0.5" />
                <path d="M8.3 5 L4 16 L16 16 L11.7 5 Z" />
                <circle cx="10" cy="13" r="1.4" />
              </svg>
            </span>
            <span className="ss-mt">
              <span className="ss-mh">Lighting Mode</span>
              <span className="ss-ms">Light a photo · ⌘-click fixtures · DMX · relief</span>
            </span>
            <svg className="ss-ar" width="14" height="14" viewBox="0 0 14 14" fill="none" strokeWidth="1">
              <path d="M5 3 L9 7 L5 11" />
            </svg>
          </button>

          <button
            className="ss-mode ss-easy"
            onClick={() => {
              setLightingOnly(false)
              setImageLight(true)
            }}
            title="簡単モード — 電飾＋照明の両方を1画面で簡単に（卓 / Art-Net なしでOK）"
          >
            <span className="ss-mi">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" strokeWidth="1">
                <rect x="2.5" y="6.5" width="10" height="8" rx="1" />
                <rect x="7.5" y="3.5" width="10" height="8" rx="1" />
              </svg>
            </span>
            <span className="ss-mt">
              <span className="ss-mh">Easy Mode</span>
              <span className="ss-ms">Decor + lighting, the simple way</span>
            </span>
            <svg className="ss-ar" width="14" height="14" viewBox="0 0 14 14" fill="none" strokeWidth="1">
              <path d="M5 3 L9 7 L5 11" />
            </svg>
          </button>
        </div>

        <div className="ss-foot">
          <button className="ss-open" onClick={loadSaved} title="Open a saved show file (.ledimager)">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" strokeWidth="1">
              <path d="M1.5 4 L5.5 4 L7 6 L12.5 6 L12.5 11.5 L1.5 11.5 Z" />
            </svg>
            Open File
          </button>
          {backup && (
            <button
              className="ss-recover"
              onClick={resume}
              title="Safety net — restore what you were last editing (auto-backup every 5s)"
            >
              Recover last session
            </button>
          )}
        </div>

        {error && (
          <div className="ss-err" data-testid="start-error">
            {error}
          </div>
        )}
      </div>
    </main>
  )
}

const SS_CSS = `
.ss-root{flex:1;min-height:0;position:relative;overflow:hidden;background:#0a0a0a;display:flex;flex-direction:column;align-items:center;justify-content:center;}
.ss-beam{position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:1;}
.ss-inner{position:relative;z-index:2;width:min(480px,82vw);text-align:center;padding:24px 0;}
.ss-glow{position:absolute;top:-10px;left:50%;transform:translateX(-50%);width:460px;height:300px;background:radial-gradient(ellipse 55% 58% at 50% 42%,rgba(123,197,232,0.07),transparent 72%);mix-blend-mode:screen;pointer-events:none;}
.ss-fix{display:flex;justify-content:center;margin-bottom:42px;}
.ss-fix svg{opacity:.5;}
.ss-title{font-family:'Cormorant Garamond',serif;font-weight:300;font-size:52px;letter-spacing:.2em;color:#fafaf8;line-height:1;margin:0;text-indent:.2em;}
.ss-tag{margin:20px 0 0;font-size:10.5px;font-weight:300;letter-spacing:.34em;text-transform:uppercase;color:#a8a8a0;font-family:'Inter',sans-serif;}
.ss-modes{margin-top:54px;display:flex;flex-direction:column;gap:11px;text-align:left;}
.ss-mode{width:100%;display:flex;align-items:center;gap:18px;padding:18px 22px;border:0.5px solid #2c2a27;border-radius:10px;background:rgba(255,255,255,0.008);cursor:pointer;transition:border-color .2s,background .2s;font-family:'Inter',sans-serif;}
.ss-mode:hover{background:rgba(255,255,255,0.02);}
.ss-show:hover{border-color:#7bc5e8;}
.ss-light:hover{border-color:#7bc5e8;}
.ss-easy:hover{border-color:#f5c878;}
.ss-mi{flex:none;width:30px;display:flex;justify-content:center;}
.ss-mi svg{stroke:#7bc5e8;opacity:.85;}
.ss-easy .ss-mi svg{stroke:#f5c878;}
.ss-mt{flex:1;}
.ss-mh{display:block;font-size:13px;font-weight:300;letter-spacing:.2em;color:#e8e5dc;text-transform:uppercase;}
.ss-ms{display:block;margin-top:5px;font-size:10px;font-weight:300;letter-spacing:.06em;color:#888780;}
.ss-ar{flex:none;stroke:#5a5a55;transition:stroke .2s,transform .2s;}
.ss-show:hover .ss-ar{stroke:#7bc5e8;transform:translateX(3px);}
.ss-light:hover .ss-ar{stroke:#7bc5e8;transform:translateX(3px);}
.ss-easy:hover .ss-ar{stroke:#f5c878;transform:translateX(3px);}
.ss-foot{margin-top:30px;display:flex;align-items:center;justify-content:space-between;}
.ss-open{display:inline-flex;align-items:center;gap:9px;font-size:10px;font-weight:300;letter-spacing:.22em;text-transform:uppercase;color:#a8a8a0;cursor:pointer;background:none;border:none;font-family:'Inter',sans-serif;padding:6px 2px;}
.ss-open:hover{color:#fafaf8;}
.ss-open svg{stroke:#a8a8a0;}
.ss-recover{font-size:9px;font-weight:300;letter-spacing:.16em;text-transform:uppercase;color:#5a5a55;cursor:pointer;background:none;border:none;font-family:'Inter',sans-serif;padding:6px 2px;}
.ss-recover:hover{color:#888780;}
.ss-err{margin-top:18px;font-size:11px;color:#e0726a;font-family:'Inter',sans-serif;letter-spacing:.02em;}
`
