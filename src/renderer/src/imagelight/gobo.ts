// gobo.ts — ゴボ（光の柄）: フロント灯体の光だまりに乗せる柄。2026-07-12 アプリ搭載。
// 承認済モック「ゴボ（光の柄）比較.html」の柄生成を移植（512²・透明地に白・固定シード＝毎回同じ柄）。
// 🔴くっきり度は毎フレーム blur を掛けない（灯体ごとの ctx.filter='blur' は激重地雷）。
//   代わりに生成時へ4段階のぼかしを焼き分けてキャッシュし、描画は回転 drawImage だけにする。

export type GoboKind = 'komorebi' | 'water' | 'breakup' | 'window'
export const GOBO_KINDS: { kind: GoboKind; label: string; title: string }[] = [
  { kind: 'komorebi', label: '木漏れ日', title: '葉の隙間の有機的なまだら' },
  { kind: 'water', label: '水面', title: 'ゆらめく水の網目（2枚が逆方向に回って干渉）' },
  { kind: 'breakup', label: '破片', title: 'ブレイクアップ（細かいかけら状）' },
  { kind: 'window', label: '窓格子', title: '桟で区切られたアーチ窓' }
]

const S = 512
const BLUR_STEPS = [0, 3, 8, 14] // くっきり度(1→0)に対応するぼかしpx（生成時に焼く）

function rng(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return s / 0x7fffffff
  }
}

function mkTex(draw: (g: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = c.height = S
  draw(c.getContext('2d')!)
  return c
}

// 木漏れ日：葉の隙間の有機的なまだら（明るい塊が不規則に散る）
function texKomorebi(): HTMLCanvasElement {
  return mkTex((g) => {
    const r = rng(7)
    g.fillStyle = '#fff'
    for (let i = 0; i < 60; i++) {
      const a = r() * Math.PI * 2
      const d = Math.pow(r(), 0.7) * 215
      const bx = S / 2 + Math.cos(a) * d
      const by = S / 2 + Math.sin(a) * d
      const n = 3 + ((r() * 4) | 0)
      const br = 10 + r() * 26
      g.globalAlpha = 0.55 + r() * 0.45
      for (let k = 0; k < n; k++) {
        const ox = (r() - 0.5) * br * 1.8
        const oy = (r() - 0.5) * br * 1.8
        g.beginPath()
        g.ellipse(bx + ox, by + oy, br * (0.4 + r() * 0.6), br * (0.3 + r() * 0.5), r() * Math.PI, 0, 7)
        g.fill()
      }
    }
    for (let i = 0; i < 90; i++) {
      const a = r() * Math.PI * 2
      const d = Math.pow(r(), 0.6) * 235
      g.globalAlpha = 0.3 + r() * 0.5
      g.beginPath()
      g.arc(S / 2 + Math.cos(a) * d, S / 2 + Math.sin(a) * d, 2 + r() * 6, 0, 7)
      g.fill()
    }
  })
}

// 水面：ゆらめく網目（コースティクス）。2枚を実行時に逆回転させて干渉させる
function texWater(seed: number): HTMLCanvasElement {
  return mkTex((g) => {
    const r = rng(seed)
    g.strokeStyle = '#fff'
    g.lineJoin = 'round'
    g.shadowColor = '#fff'
    g.shadowBlur = 3 // 生成時1回だけ＝地雷ではない
    for (let i = 0; i < 80; i++) {
      const a = r() * Math.PI * 2
      const d = Math.pow(r(), 0.8) * 225
      const bx = S / 2 + Math.cos(a) * d
      const by = S / 2 + Math.sin(a) * d
      const br = 14 + r() * 46
      const ph = r() * 9
      const w1 = 2 + ((r() * 4) | 0)
      const w2 = 2 + ((r() * 4) | 0)
      g.globalAlpha = 0.35 + r() * 0.5
      g.lineWidth = 1.5 + r() * 3.5
      g.beginPath()
      const n = 16
      for (let k = 0; k <= n; k++) {
        const t = (k / n) * Math.PI * 2
        const rr = br * (1 + 0.28 * Math.sin(t * w1 + ph) + 0.18 * Math.sin(t * w2 + ph * 2))
        const px = bx + Math.cos(t) * rr
        const py = by + Math.sin(t) * rr
        if (k) g.lineTo(px, py)
        else g.moveTo(px, py)
      }
      g.closePath()
      g.stroke()
    }
  })
}

// ブレイクアップ：細かい破片状のかけら
function texBreakup(): HTMLCanvasElement {
  return mkTex((g) => {
    const r = rng(31)
    g.fillStyle = '#fff'
    for (let i = 0; i < 130; i++) {
      const a = r() * Math.PI * 2
      const d = Math.pow(r(), 0.65) * 228
      const bx = S / 2 + Math.cos(a) * d
      const by = S / 2 + Math.sin(a) * d
      const sz = 8 + r() * 26
      const rot = r() * Math.PI
      g.globalAlpha = 0.55 + r() * 0.45
      g.save()
      g.translate(bx, by)
      g.rotate(rot)
      g.beginPath()
      const n = 3 + ((r() * 3) | 0)
      for (let k = 0; k < n; k++) {
        const t = (k / n) * Math.PI * 2 + r() * 0.8
        const rr = sz * (0.5 + r() * 0.6)
        const px = Math.cos(t) * rr * 1.4
        const py = Math.sin(t) * rr * 0.7
        if (k) g.lineTo(px, py)
        else g.moveTo(px, py)
      }
      g.closePath()
      g.fill()
      g.restore()
    }
  })
}

// 窓格子：桟で区切られた窓（上端アーチ）
function texWindow(): HTMLCanvasElement {
  return mkTex((g) => {
    g.fillStyle = '#fff'
    const cols = 3
    const rows = 4
    const mull = 20
    const ox = 76
    const oy = 56
    const pw = (S - ox * 2 - mull * (cols - 1)) / cols
    const ph = (S - oy * 2 - mull * (rows - 1)) / rows
    for (let i = 0; i < cols; i++)
      for (let j = 0; j < rows; j++) g.fillRect(ox + i * (pw + mull), oy + j * (ph + mull), pw, ph)
    g.globalCompositeOperation = 'destination-in'
    g.beginPath()
    g.moveTo(ox, S - oy)
    g.lineTo(ox, S / 2)
    g.arc(S / 2, S / 2, S / 2 - ox, Math.PI, 0)
    g.lineTo(S - ox, S - oy)
    g.closePath()
    g.fill()
  })
}

type TexKey = 'komorebi' | 'waterA' | 'waterB' | 'breakup' | 'window'
const baseCache = new Map<TexKey, HTMLCanvasElement>()
function baseTex(key: TexKey): HTMLCanvasElement {
  let t = baseCache.get(key)
  if (!t) {
    t =
      key === 'komorebi'
        ? texKomorebi()
        : key === 'waterA'
          ? texWater(11)
          : key === 'waterB'
            ? texWater(23)
            : key === 'breakup'
              ? texBreakup()
              : texWindow()
    baseCache.set(key, t)
  }
  return t
}

// くっきり度の焼き分け（key:blurStep ごとに1回だけ生成）
const variantCache = new Map<string, HTMLCanvasElement>()
function variantTex(key: TexKey, blurPx: number): HTMLCanvasElement {
  const ck = key + ':' + blurPx
  let t = variantCache.get(ck)
  if (!t) {
    if (blurPx <= 0) t = baseTex(key)
    else {
      const c = document.createElement('canvas')
      c.width = c.height = S
      const g = c.getContext('2d')!
      g.filter = `blur(${blurPx}px)` // 生成時1回だけ＝毎フレームではない
      g.drawImage(baseTex(key), 0, 0)
      g.filter = 'none'
      t = c
    }
    variantCache.set(ck, t)
  }
  return t
}

/** 柄テクスチャを取得（sharp 0..1、水面は which=0/1 の2枚）。キャッシュ済みを返すだけ＝毎フレーム安い。 */
export function goboTex(kind: GoboKind, sharp: number, which: 0 | 1 = 0): HTMLCanvasElement {
  const s = Math.max(0, Math.min(1, sharp))
  const blurPx = BLUR_STEPS[Math.max(0, Math.min(BLUR_STEPS.length - 1, Math.round((1 - s) * (BLUR_STEPS.length - 1))))]
  const key: TexKey = kind === 'water' ? (which ? 'waterB' : 'waterA') : kind
  return variantTex(key, blurPx)
}
