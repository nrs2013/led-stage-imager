/* 簡単スケッチ(LIGHT SKETCH)の「電飾パターン」純粋ロジック（エンジン非依存・テスト対象）。
 *
 *  のむさんの狙い: アルファ付きチャートを読み込むと、その「描ける所」（＝チャートで LED 面が
 *  透明に抜いてある所。チャートエディタと同じく透過＝描画範囲）の中だけに、1から描かなくても
 *  横/縦/縁取りの“細い線”を自動で並べたい。
 *
 *  確定仕様（のむさん 2026-06-20）:
 *   - 各コンテナ（連結した透明図形＝チャートの分かれた図形）ごとに別々に生成する。
 *   - 線は「点の集まり」ではなく“線そのもの”＝太さをピクセルで直接決める（チャートの実ドットに合わせる）。
 *   - 色チェイスは各コンテナの中を流れる（線を上から番号付けし、番号 % channels で色分け）。
 *
 *  この file は「生成（マスク→線分の並び）」と「色（ch番号+時間→色と明るさ）」の計算だけ。
 *  太さ(px)の見た目は描画側(engine)で付ける＝ここは“どこに線があるか”だけを返す純粋関数。 */
import { hsl2rgb, type RGB3 } from './colors'

export type DecorPatternKind = 'h' | 'v' | 'outline'
export type DecorEffect =
  | 'chase'
  | 'theater'
  | 'comet'
  | 'wave'
  | 'fill'
  | 'rainbow'
  | 'grad'
  | 'sparkle'
  | 'strobe'
  | 'pulse'
/** 色の流れる向き。順=番号小→大／逆=大→小／往復=端で折返し／中央=中央から外へ。 */
export type DecorDirection = 'fwd' | 'rev' | 'ping' | 'center'
/** 方向の概念が無い（全体一斉系）エフェクト。UI では方向セグメントをグレーアウトする。 */
export const DECOR_NONDIR: DecorEffect[] = ['sparkle', 'strobe', 'pulse']

export interface DecorPattern {
  /** この電飾パターンを表示するか。 */
  enabled: boolean
  /** 横ストライプ / 縦ストライプ / 縁取り。 */
  kind: DecorPatternKind
  /** チェイスの色数。既定 6。線を上から番号付けし、番号 % channels で色分け＝チェイス。 */
  channels: number
  /** 線と線の間隔（マスク作業 px）。小さいほど“びっしり”。 */
  lineSpacing: number
  /** 線の太さ（本番フレーム px・最小 1）。実チャートのドット幅に合わせる。 */
  thickness: number
  /** 色の動き方（エフェクト）。 */
  effect: DecorEffect
  /** 色の流れる向き（全体一斉系では無視）。 */
  direction: DecorDirection
  /** 色1（chase / pulse の主色、grad の片側）。 */
  color1: RGB3
  /** 色2（grad のもう片側）。 */
  color2: RGB3
  /** 速度（0.2〜3 くらい）。 */
  speed: number
  /** 再生中か（false＝静止）。 */
  playing: boolean
}

export const DEFAULT_DECOR: DecorPattern = {
  enabled: false,
  kind: 'h',
  channels: 6,
  lineSpacing: 14,
  thickness: 3,
  effect: 'chase',
  direction: 'fwd',
  color1: [255, 45, 120],
  color2: [25, 182, 255],
  speed: 1.2,
  playing: true
}

/** 生成された線分（run）。x,y はマスク作業 px の始点、len は軸方向の長さ（マスク px）、
 *  vertical=縦線、c=0..channels-1 のチャンネル番号。太さ(px)は描画側で付ける。 */
export interface DecorSeg {
  x: number
  y: number
  len: number
  vertical: boolean
  c: number
}

const clampInt = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v | 0

/** 連結した「描ける所」＝コンテナ（チャートの分かれた図形 1 つ）の外接矩形と面積。 */
interface DecorRegion {
  label: number
  minX: number
  minY: number
  maxX: number
  maxY: number
  area: number
}

/** 小さすぎるゴミ領域は無視（描ける所マスクの作業解像度 px 面積）。 */
const MIN_REGION_AREA = 48

/** drawable(>=128) を 4 連結でラベリング。labels[i]=領域番号(0..) / -1=描けない所。
 *  各コンテナを別物として扱うため、外接矩形だけでなく per-pixel の所属(labels)を持つ。 */
function labelRegions(
  drawable: Uint8Array,
  mw: number,
  mh: number
): { labels: Int32Array; regions: DecorRegion[] } {
  const labels = new Int32Array(mw * mh).fill(-1)
  const regions: DecorRegion[] = []
  const stack: number[] = []
  let next = 0
  for (let s = 0; s < mw * mh; s++) {
    if (drawable[s] < 128 || labels[s] !== -1) continue
    const L = next++
    let minX = mw
    let minY = mh
    let maxX = -1
    let maxY = -1
    let area = 0
    stack.length = 0
    stack.push(s)
    labels[s] = L
    while (stack.length) {
      const i = stack.pop()!
      const x = i % mw
      const y = (i / mw) | 0
      area++
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
      if (x > 0 && drawable[i - 1] >= 128 && labels[i - 1] === -1) {
        labels[i - 1] = L
        stack.push(i - 1)
      }
      if (x < mw - 1 && drawable[i + 1] >= 128 && labels[i + 1] === -1) {
        labels[i + 1] = L
        stack.push(i + 1)
      }
      if (y > 0 && drawable[i - mw] >= 128 && labels[i - mw] === -1) {
        labels[i - mw] = L
        stack.push(i - mw)
      }
      if (y < mh - 1 && drawable[i + mw] >= 128 && labels[i + mw] === -1) {
        labels[i + mw] = L
        stack.push(i + mw)
      }
    }
    regions.push({ label: L, minX, minY, maxX, maxY, area })
  }
  return { labels, regions }
}

/** 1 コンテナの中だけにパターンの線分を生成して out に積む。inside は「この領域に属する px か」。
 *  - 横/縦＝lineSpacing 間隔の線。各線で“内側の連続 run”を 1 本の線分にする（点ではなく線）。
 *    線は上(左)から番号付けし、番号 % channels で色分け＝色チェイスは各コンテナの中を流れる。
 *  - 縁取り＝外周のドットを線分(len=1)として出す。 */
function genPatternInRegion(
  out: DecorSeg[],
  inside: (x: number, y: number) => boolean,
  reg: DecorRegion,
  kind: DecorPatternKind,
  channels: number,
  lineSpacing: number
): void {
  const { minX, minY, maxX, maxY } = reg
  if (kind === 'h') {
    let k = 0
    for (let y = minY; y <= maxY; y += lineSpacing, k++) {
      const c = k % channels
      const yy = Math.round(y)
      let runStart = -1
      for (let x = minX; x <= maxX + 1; x++) {
        const ins = x <= maxX && inside(x, yy)
        if (ins && runStart < 0) runStart = x
        else if (!ins && runStart >= 0) {
          out.push({ x: runStart, y: yy, len: x - runStart, vertical: false, c })
          runStart = -1
        }
      }
    }
  } else if (kind === 'v') {
    let k = 0
    for (let x = minX; x <= maxX; x += lineSpacing, k++) {
      const c = k % channels
      const xx = Math.round(x)
      let runStart = -1
      for (let y = minY; y <= maxY + 1; y++) {
        const ins = y <= maxY && inside(xx, y)
        if (ins && runStart < 0) runStart = y
        else if (!ins && runStart >= 0) {
          out.push({ x: xx, y: runStart, len: y - runStart, vertical: true, c })
          runStart = -1
        }
      }
    }
  } else {
    // 縁取り: 外周ドット（内側で、近傍に外側がある所）を角度で channels 分割。
    const cx = (minX + maxX) / 2
    const cy = (minY + maxY) / 2
    const step = Math.max(2, Math.min(6, Math.round(lineSpacing / 2)))
    const rE = Math.max(2, step)
    for (let y = minY; y <= maxY; y += step) {
      for (let x = minX; x <= maxX; x += step) {
        if (!inside(x, y)) continue
        const interior =
          inside(x - rE, y) && inside(x + rE, y) && inside(x, y - rE) && inside(x, y + rE)
        if (interior) continue
        const a = Math.atan2(y - cy, x - cx)
        const n = (a + Math.PI) / (Math.PI * 2)
        out.push({
          x,
          y,
          len: 1,
          vertical: false,
          c: clampInt(Math.floor(n * channels), 0, channels - 1) % channels
        })
      }
    }
  }
}

/** 「描ける所マスク」(値>=128 が描ける)から、各コンテナ（連結した図形）ごとに、指定パターンの
 *  線分の並びを生成する（純粋）。太さ(px)は描画側で付ける＝ここは線の位置・長さだけ。
 *  返り値が空＝描ける所が無い。 */
export function buildDecorLeds(
  drawable: Uint8Array,
  mw: number,
  mh: number,
  opts: { kind: DecorPatternKind; channels: number; lineSpacing: number }
): DecorSeg[] {
  const channels = Math.max(1, opts.channels | 0)
  const lineSpacing = Math.max(2, opts.lineSpacing | 0)
  if (mw <= 0 || mh <= 0 || drawable.length < mw * mh) return []
  const { labels, regions } = labelRegions(drawable, mw, mh)
  const out: DecorSeg[] = []
  for (const reg of regions) {
    if (reg.area < MIN_REGION_AREA) continue
    const inside = (x: number, y: number): boolean => {
      const xi = x | 0
      const yi = y | 0
      if (xi < 0 || yi < 0 || xi >= mw || yi >= mh) return false
      return labels[yi * mw + xi] === reg.label
    }
    genPatternInRegion(out, inside, reg, opts.kind, channels, lineSpacing)
  }
  return out
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)
/** 決定的な擬似乱数 0..1（きらめき用・同じ入力なら同じ結果＝再生で安定）。 */
const dhash = (n: number): number => {
  const s = Math.sin(n) * 43758.5453
  return s - Math.floor(s)
}

/** チャンネル番号 + 方向 + 時間（秒）→ そのチャンネルの色と明るさ（0..1）。純粋。
 *  - 全体一斉系（sparkle/strobe/pulse）は方向を無視。
 *  - それ以外は方向を「実効位置 e・周期 M・先頭 h」に写してから流す（向き軸を全エフェクト横断で適用）。 */
export function decorChannelColor(
  ch: number,
  channels: number,
  effect: DecorEffect,
  direction: DecorDirection,
  c1: RGB3,
  c2: RGB3,
  speed: number,
  t: number
): [number, number, number, number] {
  const N = Math.max(1, channels)
  // ---- 方向の概念が無い（全体一斉）系 ----
  if (effect === 'sparkle') {
    const fr = Math.floor(t * speed * 6)
    const b = dhash(ch * 131.7 + fr * 977.3) > 0.78 ? 1 : 0.05
    return [c1[0], c1[1], c1[2], b]
  }
  if (effect === 'strobe') {
    const b = Math.floor(t * speed * 8) % 2 ? 0.95 : 0.06
    return [c1[0], c1[1], c1[2], b]
  }
  if (effect === 'pulse') {
    const b = ((Math.sin(t * speed * 1.5) + 1) / 2) * 0.85 + 0.12
    return [c1[0], c1[1], c1[2], b]
  }
  // ---- 方向 → 実効位置 e / 周期 M / 先頭 h ----
  let e: number
  let M: number
  let h: number
  if (direction === 'center') {
    M = Math.max(1, Math.ceil(N / 2))
    e = Math.abs(ch - (N - 1) / 2)
    h = (t * speed) % M
  } else {
    M = N
    e = direction === 'rev' ? N - 1 - ch : ch
    if (direction === 'ping') {
      const per = 2 * N
      const q = (t * speed) % per
      h = q < N ? q : per - q
    } else {
      h = (t * speed) % M
    }
  }
  if (effect === 'rainbow') {
    const rgb = hsl2rgb((e / M) * 360 + t * speed * 40, 0.9, 0.55)
    return [rgb[0], rgb[1], rgb[2], 0.95]
  }
  if (effect === 'grad') {
    const m = (Math.sin((e / M) * Math.PI * 2 - (h / M) * Math.PI * 2) + 1) / 2
    return [lerp(c1[0], c2[0], m), lerp(c1[1], c2[1], m), lerp(c1[2], c2[2], m), 0.95]
  }
  if (effect === 'wave') {
    const b = (Math.sin((e / M) * Math.PI * 4 - (h / M) * Math.PI * 2) + 1) / 2
    return [c1[0], c1[1], c1[2], clamp01(b)]
  }
  if (effect === 'fill') {
    const thr = h / M
    const pos = e / Math.max(1, M - 1)
    return [c1[0], c1[1], c1[2], pos <= thr ? 1 : 0.06]
  }
  if (effect === 'theater') {
    const step = Math.max(2, Math.round(N / 3))
    const d = Math.round(e) - Math.round(h)
    const b = (((d % step) + step) % step) === 0 ? 1 : 0.06
    return [c1[0], c1[1], c1[2], b]
  }
  // chase / comet: 先頭 h から後ろへ尾を引いて流れる（comet は尾が長い）。
  const tr = effect === 'comet' ? Math.max(2, M * 0.55) : Math.max(1.2, M * 0.3)
  const d = (((h - e) % M) + M) % M
  const b = d < tr ? 1 - d / tr : 0.06
  return [c1[0], c1[1], c1[2], clamp01(b)]
}
