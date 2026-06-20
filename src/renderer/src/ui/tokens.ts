import type { CSSProperties } from 'react'

// Nomu Design System — Brutalist Vivid (dark canvas, 0.5px lines, semi-transparent, white text).
export const C = {
  canvas: '#0a0a0a',
  surface: '#131211',
  surface2: '#1a1918',
  panel: '#0f0e0d',
  inputBg: '#1d1b19',
  border: '#2c2a27',
  borderFaint: '#211f1d',
  // DECOR STUDIO chrome accent (provisional: cyan — electric light feel)
  accent: '#7bc5e8',
  accentRGB: '123,197,232',
  // shared palette (for category / shape use later)
  fuchsia: '#c186c8',
  amber: '#f5c878',
  cyan: '#7bc5e8',
  green: '#a8e878',
  yellow: '#ffe57a',
  // text
  white: '#fafaf8',
  text: '#e8e5dc',
  label: '#a8a8a0',
  hint: '#888780',
  faint: '#5a5a55'
} as const

export const F = {
  display: "'Bebas Neue', 'Inter', sans-serif",
  ui: "'Inter', 'Noto Sans JP', sans-serif",
  mono: "'JetBrains Mono', monospace",
  // 起動画面の細セリフ・ワードマーク用（@fontsource 同梱・CSP font-src 'self'）。
  serif: "'Cormorant Garamond', 'Times New Roman', serif"
} as const

/** Cinematic chrome（のむさん 2026-06-20）：バー/パネル/背景に "機械加工された卓" の
 *  微妙な奥行きを与える。near-black の暖色レンジ内のごく薄いグラデ＋上端ハイライトだけで、
 *  作業領域（キャンバス＝色精度のため中立 #0a0a0a）には触れない。 */
export const chrome = {
  /** ツールバー/サブバー/ステータスバー＝上が持ち上がる卓パネル（はっきり見える奥行き） */
  bar: 'linear-gradient(180deg, #1d1a15 0%, #121009 52%, #070604 100%)',
  /** バー上端の細ハイライト（削り出しエッジ感） */
  topHi: 'inset 0 1px 0 rgba(255,255,255,0.07)',
  /** 上のバーの下端＝cyanの発光ライン（"電源が入った卓" のアクセント） */
  accentEdge: '0 1px 0 0 rgba(123,197,232,0.5), 0 6px 24px -5px rgba(123,197,232,0.45)',
  /** 右側のパネル列（Layers/Parts/Inspector） */
  panel: 'linear-gradient(180deg, #151210 0%, #090806 100%)',
  /** アプリ全体の地＝中央が明るい暗転した客席の奥行き */
  root: 'radial-gradient(140% 130% at 50% -16%, #1a1611 0%, #0a0908 50%, #040404 100%)'
} as const

export const inputStyle: CSSProperties = {
  background: C.inputBg,
  border: `1px solid #3b3631`,
  color: C.white,
  padding: '7px 9px',
  borderRadius: 4,
  fontSize: 12,
  fontFamily: F.mono,
  width: '100%',
  outline: 'none',
  boxSizing: 'border-box'
}

export const fieldLabel: CSSProperties = {
  fontSize: 10,
  color: C.label,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  fontFamily: F.ui,
  marginBottom: 4,
  display: 'block'
}

/** Brutalist-Vivid button: 0.5px accent line + semi-transparent bg + white text (idle),
 *  solid accent + dark text (active/selected). */
// Solid lighting-console button (grandMA2-style): filled dark key, 1px border, subtle
// bevel; lights up in the accent colour when active/selected.
export function buttonStyle(opts?: { active?: boolean; accent?: string; accentRGB?: string }): CSSProperties {
  const accent = opts?.accent ?? C.accent
  const active = opts?.active ?? false
  return {
    background: active ? accent : '#242220',
    border: `1px solid ${active ? accent : '#3b3631'}`,
    color: active ? '#0a0a0a' : C.text,
    padding: '9px 15px',
    borderRadius: 3,
    fontSize: 12,
    fontFamily: F.ui,
    fontWeight: 600,
    letterSpacing: '0.02em',
    cursor: 'pointer',
    lineHeight: 1,
    whiteSpace: 'nowrap',
    boxShadow: active ? 'none' : 'inset 0 1px 0 rgba(255,255,255,0.05)',
    transition: 'background 120ms'
  }
}
