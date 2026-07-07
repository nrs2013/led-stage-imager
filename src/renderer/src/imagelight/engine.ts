/* ============================== 画像照明モード エンジン ==============================
 * デスクトップのモック「画像照明モード-試打台.html」の描画・状態をそのまま移植した正典。
 * セット写真（アルベド）を背景に、灯体（beam）で「写真を照らす」。色・PTZ・FX9種・
 * シーン棚×9・写真棚・ミュート/ソロ・MASTER・SMOKE。出力は frame キャンバス1枚（マーカー
 * は含めない＝本番出力に編集ハンドルは出ない）。React UI（ImageLightingMode.tsx）が駆動し、
 * frame を Syphon へ publish しつつ画面にも表示する。光の式は出荷済みUPLIGHTと同系
 * （screen混色・アルベド乗算・色比保持トーン・パン非対称・Smoke連動）。
 */
import { WHITE, COLORS, sameRgb, hexToRgb, type RGB3 } from './colors'
import { fixtureColor, beamPose, shutterGate, channelCount } from '../dmx/channel-math'
import { FlameFX, type FlameParams } from './flame'
import { SparklerFX, type SparklerParams } from './sparkler'
import { RainFX, type RainParams } from './rain'
import { LowSmokeFX, type LowSmokeParams } from './lowsmoke'
import {
  buildDecorLeds,
  decorChannelColor,
  DEFAULT_DECOR,
  type DecorPattern,
  type DecorSeg
} from './decor-pattern'
import { isEmptyPixel } from '../ui/mask'
import {
  chaseK,
  breathK,
  fireK,
  waveK,
  boltK,
  zoomPulseK,
  strobeAllK,
  strobeRndK,
  rainbowColor,
  colorChaseColor,
  searchTilt,
  frontSearch,
  defaultFxp,
  type FxParams,
  type SearchParams
} from './effects'
import { composeColorRatio } from '../render/compose'
import { findWarmBlobs } from './lantern-detect'
import { embossFromLuminance } from './relief-map'
import { alignSnap, equalSnapX, type Pt } from './snap'
import {
  drawStreetLampLit,
  drawStreetLamp1Shadow,
  drawStreetLamp1Body,
  drawStreetLamp1Glow
} from '../render/streetlamp'
import { drawChandelierLit } from '../render/chandelier'
import { drawMarqueeLit, marqueeBulbCount } from '../render/marquee'
import { drawBulbLit } from '../render/bulb'
import {
  drawParLit,
  drawPattLit,
  drawBlinderCellLit,
  drawBlinderHousing,
  drawPixelPattCellLit,
  drawPixelPattFrame
} from '../render/fixtures'
import { drawStarsLit } from '../render/stars'
import { drawFestoonWireLit, drawFestoonBulbLit, festoonBulbs } from '../render/festoon'
import type { Shape, ChannelMode, Fixture } from '../model/types'

/** 写真×光の合成方式。
 *  'mock'  = 出荷モック準拠（乗算＋暗部トー）。のむさんが v7 で検証済みの見え方。既定。
 *  'ratio' = 色比保持トーン（白に色が鮮やかに乗る・実験的）。検証の結果、ビーム芯の白茶けは
 *            主に光マップのscreen加算が原因でこの段では消せず、中間調が明るく寄って検証済みの
 *            見え方から離れたため既定にはしない（本番後に詰める用に残置）。 */
const PHOTO_TONE: 'mock' | 'ratio' = 'mock'

/** 論理座標系（モックと同じ）。内部解像度は Q 倍＝出力 1920×1080。 */
export const LW = 1600
export const LH = 900

/** 受信DMXが無い universe 用のゼロフレーム（照明モードのDMX駆動で参照）。 */
const DMX_ZERO512 = new Uint8Array(512)
// 内部/出力解像度の倍率。1.2＝1920×1080（写真のシャープさ優先・のむさん 2026-06-13）。
// カクつきは「静止画は描き直さない(dirty-skip)＋スモークのブルームを半解像度」で対処。
export const Q = 1.2
export const IW = Math.round(LW * Q) // 1920
export const IH = Math.round(LH * Q) // 1080

/** 灯体の上限（横一列に多数置けるよう余裕をもたせた。重ければ下げる）。 */
export const MAX_BEAMS = 64

/** 配置スナップ（吸着）の効く距離。論理座標(LW=1600基準)のpx。 */
const SNAP = 9

export type FxKey =
  | 'search'
  | 'rndsearch'
  | 'chase'
  | 'strobe'
  | 'rndstrobe'
  | 'colorchase'
  | 'breath'
  | 'fire'
  | 'wave'
  | 'bolt'
  | 'rainbow'
  | 'zoompulse'

export interface Beam {
  x: number
  y: number
  w0: number
  w1: number
  len: number
  pan: number // °
  tilt: number // °
  zoom: number // 倍率（×1=置いた姿=HOME）
  gauge: number // 0..1
  color: RGB3
  mute?: boolean
  solo?: boolean
  sp: SearchParams
  // 描画用の一時値（毎フレーム更新）
  _tn?: number
  _cn?: RGB3
  _zp?: number
  // モチーフ（街灯・シャンデリア・マーキー・電球・PAR・PAT・ミニブル・ピクセルPAT・星・垂れ幕）
  motif?:
    | 'streetlamp'
    | 'streetlamp1'
    | 'chandelier'
    | 'marquee'
    | 'bulb'
    | 'parlight'
    | 'patt'
    | 'blinder'
    | 'pixelpatt'
    | 'stars'
    | 'festoon'
    | 'image'
    | 'flame'
    | 'sparkler'
  motifDiam?: number
  imageSrc?: string // 画像灯体（リアルな発光画像・dataURL）。色は持たず明るさだけで光る
  motifText?: string
  motifLetterColors?: string[]
  motifSpeed?: number
  motifReverse?: boolean // マーキー逆方向チェイス
  motifSeed?: number // 星の散布レイアウトを固定（移動しても再シャッフルしない）
  // フロント灯体：前から当たる丸い光（プール）。下からの円錐ビーム(drawWallBeam)の代わりに
  //  光マップへ丸いプールを描く＝写真が照らされて「通った所だけセットが浮かぶ」。プール半径は motifDiam を流用。
  front?: boolean
  frontPat?: '8' | 'circle' | 'sweep' | 'random' | 'off' // サーチのパターン（off=静止）
  frontSpd?: number // サーチの速さ
  frontAmp?: number // サーチの振り幅（ステージpx）
  frontEdge?: number // ふち 0..1（0=くっきり / 1=ふわっ）
  // 特効(炎/火花)の噴き出す向きは照明と同じ TILT（b.tilt 度）から計算する＝専用フィールドは持たない。
  // 特効ステップシーケンサー用の安定ID（炎/火花マークに付与・並び替え/削除に強い）。
  sfxId?: number
  /** DMX控え（任意）。設定された灯体は外部卓(Art-Net)が色・向き・明るさを駆動する＝照明モードの
   *  「位置を置いたら、あとはDMXで操作」。電飾モードと同じ dmx/channel-math を流用。
   *  undefined＝未パッチ＝従来どおりアプリ内/MIDIで操作（既存ショーは全部こちら）。 */
  dmx?: {
    universe: number
    start: number
    mode: ChannelMode
    addressStep?: number
    fixedColor?: [number, number, number]
  }
}

/** シーンに保存されるFXの点き具合（master/smoke は含めない＝呼び出しても親フェーダーは動かない）。 */
export interface FxFlags {
  chase: boolean
  search: boolean
  searchRandom: boolean
  strobe: 'off' | 'all' | 'rnd'
  colorChase: boolean
  breath: boolean
  fire: boolean
  wave: boolean
  bolt: boolean
  rainbow: boolean
  zoompulse: boolean
}

export interface St extends FxFlags {
  master: number
  smoke: number
}

export interface Look {
  fxst: FxFlags
  fxp: FxParams
  lights: {
    gauge: number
    color: RGB3
    pan: number
    tilt: number
    zoom: number
    mute?: boolean
    solo?: boolean
  }[]
  /** カラフルチェイスで流す色並び（空=固定8色ぜんぶ）。シーンごとに保存。 */
  chasePalette?: RGB3[]
}

export interface Pattern {
  name: string
  key: string | null
  midi: number | null
  look: Look
}

export interface Scene {
  name: string
  kind: 'photo' | 'video'
  img?: HTMLImageElement
  video?: HTMLVideoElement
  objectUrl?: string // video: 解放(revoke)用
  /** 写真の元データURL（公演保存でファイルに書き出すため保持。動画は objectUrl から取得）。 */
  src?: string
  mat: HTMLCanvasElement // albedo（写真=固定／動画=毎コマ更新）
  thumb: HTMLCanvasElement
  fix?: { m: boolean; s: boolean }[]
  /** このシーンを呼び出す MIDI Note 番号（LEARN で割当）。 */
  midiNote?: number | null
  /** 4 辺スケールワープの結果 box（LW×LH 座標系）。null＝デフォルト contain fit。 */
  warpBox?: { x: number; y: number; w: number; h: number } | null
  /** ピース（写真の一部を切り抜いて 4 隅コーナーピンで貼り付ける）の並び。
   *  シーンに紐づき、後ろにあるピースほど上に描かれる。 */
  pieces?: Piece[]
  /** AIなし立体: 写真の明るさから作る方向つきエンボス(浮き彫り)マップ。mat と同寸・soft-lightで重ねる。 */
  lumRelief?: HTMLCanvasElement | null
}

/** 写真の一部を切り抜いて、ステージ上に 4 隅コーナーピンで貼り付ける単位。 */
export interface Piece {
  /** 一意 ID（シーン内で被らない）。 */
  id: string
  /** 切り抜き元の矩形（mat 絶対座標、写真の元解像度）。 */
  src: { x: number; y: number; w: number; h: number }
  /** ステージ上の 4 隅の貼り付け位置（LW×LH 座標系・左上→右上→右下→左下）。 */
  corners: [
    { x: number; y: number },
    { x: number; y: number },
    { x: number; y: number },
    { x: number; y: number }
  ]
}

/** Undo/Redo 用スナップショット。写真/動画の中身(img/video/mat/thumb)は参照を共有し、軽い
 *  フィールドだけコピーする（メディアは重いので複製しない）。 */
interface Snap {
  beams: Beam[]
  st: St
  fxp: FxParams
  selected: number[]
  activeScene: number
  patterns: (Pattern | null)[]
  userColors: RGB3[]
  chasePalette: RGB3[]
  scenes: Scene[]
  sfxChaseMode: 'random' | 'all' | 'inout' | 'outin'
  sfxChaseMs: number
}

/** 灯体を「中央の一番下を1番に、左右の外側ほど大きく（同距離は右が先）、下の段→上の段」へ
 *  並べる順番 perm を返す（perm[newIndex]=oldIndex）。renumberByPosition と単体テストで共有する純関数。 */
export function renumberOrder(pts: { x: number; y: number }[], lh: number = LH): number[] {
  const n = pts.length
  if (n < 2) return pts.map((_, i) => i)
  const xs = pts.map((p) => p.x)
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2
  const bandTol = lh * 0.05 // 縦これ以内＝同じ段とみなす
  const items = pts.map((p, i) => ({ i, x: p.x, y: p.y })).sort((a, b) => b.y - a.y) // 下(yが大)から
  const rows: { i: number; x: number; y: number }[][] = []
  for (const it of items) {
    const row = rows[rows.length - 1]
    if (row && Math.abs(it.y - row[0].y) <= bandTol) row.push(it)
    else rows.push([it])
  }
  const spread = Math.max(...xs) - Math.min(...xs)
  const eps = Math.max(0.5, spread * 0.01) // この幅以内のx＝中央とみなす
  const perm: number[] = []
  for (const row of rows) {
    const mid = row.filter((it) => Math.abs(it.x - cx) <= eps)
    const right = row.filter((it) => it.x - cx > eps).sort((a, b) => a.x - b.x) // 中央寄りの右から
    const left = row.filter((it) => cx - it.x > eps).sort((a, b) => b.x - a.x) // 中央寄りの左から
    for (const it of mid) perm.push(it.i)
    const m = Math.max(right.length, left.length)
    for (let k = 0; k < m; k++) {
      if (right[k]) perm.push(right[k].i) // 右を先
      if (left[k]) perm.push(left[k].i) // 次に左
    }
  }
  return perm
}

/** DMX 番地が衝突している灯体の index 集合を返す純関数。2 灯が衝突＝同じ universe かつ
 *  占有チャンネル [start, start+count) が重なる（start は 1 始まり・count はモードの ch 数）。
 *  index 安定（呼び出し側が灯体に対応づけられる）。null/undefined（未パッチ）は無視。
 *  dmxOverlaps と単体テストで共有する純関数。 */
export function detectDmxOverlaps(
  patches: ({ universe: number; start: number; count: number } | null | undefined)[]
): Set<number> {
  const hit = new Set<number>()
  for (let i = 0; i < patches.length; i++) {
    const a = patches[i]
    if (!a) continue
    for (let j = i + 1; j < patches.length; j++) {
      const b = patches[j]
      if (!b) continue
      if (a.universe !== b.universe) continue
      // 半開区間 [start, start+count) が交わるか
      if (a.start < b.start + b.count && b.start < a.start + a.count) {
        hit.add(i)
        hit.add(j)
      }
    }
  }
  return hit
}

// v3: リグ保存を「配置と仕込みだけ」に変更（向き/色/明るさを焼かない）＝旧保存に残った
//     チルト等を捨てて、初期プリセットを常にまっさら（均等10台・tilt0・下向き）にする
const RIG_KEY = 'decor.imagelight.rig.v3'

// アプリを新しく開くたびに明かり/色/MIDI を引き継がない（のむさん確定 2026-06-21）。
// 保持はページ生存中のメモリ(sessionRig)のみ＝モード切替の行き来では残るが、アプリ再起動で消える。
// 旧バージョンが localStorage に残した前回リグも、開いた瞬間に完全削除する。
let sessionRig: RigPayload | null = null
try {
  localStorage.removeItem(RIG_KEY)
} catch {
  /* localStorage が使えなくても支障なし */
}

/** localStorage / 公演ファイル 共通のリグ内容（灯体配置=beams は含めない）。 */
export interface RigPayload {
  st?: { master?: number; smoke?: number }
  fxp?: FxParams
  patterns?: (Pattern | null)[]
  userColors?: RGB3[]
  chasePalette?: RGB3[]
  paramMidi?: Record<string, number>
  masterMidi?: number | null
  fxMidi?: Partial<Record<FxKey, number>>
  fxKey?: Partial<Record<FxKey, string>>
  falloffPow?: number
  outCap?: number
  colorMidi?: Record<string, number>
  colorKey?: Record<string, string>
  sceneFadeMode?: 'cut' | 'fade'
  sceneFadeMs?: number
  strobeMidi?: number | null
  strobeRate?: number
  motifChaseMidi?: number | null
}
/** 公演ファイル（show.json）のシーン1件。メディアは media/ 配下のファイル名で参照。 */
export interface ShowSceneMeta {
  name: string
  kind: 'photo' | 'video'
  fix: { m: boolean; s: boolean }[] | null
  media: string | null
  /** このシーンを呼び出す MIDI Note 番号（未割当は省略可）。 */
  midiNote?: number | null
  /** 4 辺スケールワープの結果（LW×LH 座標系）。null/省略＝デフォルト contain fit。 */
  warpBox?: { x: number; y: number; w: number; h: number } | null
  /** ピース（4 隅コーナーピンで貼り付ける切り抜き）の並び。省略＝0 個。 */
  pieces?: Piece[]
}
/** 公演ファイル（show.json）全体。 */
export interface ShowFile {
  app: string
  kind: 'imagelight-show'
  version: number
  rig: RigPayload
  scenes: ShowSceneMeta[]
  /** 灯体配置（位置・向き・モチーフ等）。これが無いと開いても配置がまっさらになる。 */
  beams?: Beam[]
  /** マスク用アルファ画像（あれば media/ 配下のファイル名で参照）。 */
  mask?: { file: string } | null
  /** 簡単スケッチの電飾パターン設定（卓なし＝見た目だけ）。無い＝既定。 */
  decor?: DecorPattern
  /** 特効(SFX)の設定一式（炎/火花/雨雪/煙のツマミ・ON状態・ステップシーケンサー）。無い＝既定。 */
  sfx?: {
    flame?: Partial<FlameParams>
    sparkler?: Partial<SparklerParams>
    rain?: Partial<RainParams> & { on?: boolean }
    lowSmoke?: Partial<LowSmokeParams> & { on?: boolean }
    seqSteps?: number[][]
    seqMs?: number
    flameChase?: { on?: boolean; pattern?: 'random' | 'all' | 'inout' | 'outin'; ms?: number }
    sfxChase?: { mode?: 'random' | 'all' | 'inout' | 'outin'; ms?: number }
  }
  /** 見え方: 色ノリ（光の色を写真に乗せる量 0..0.4）。無い＝0（従来）。 */
  colorWash?: number
  /** 見え方: ベース明るさ（暗部の底上げ 0..0.3）。無い＝0（従来）。 */
  baseLift?: number
}

/** blob: URL（動画）→ dataURL（保存でファイルに書き出すため）。 */
async function blobUrlToDataUrl(url: string): Promise<string> {
  const blob = await (await fetch(url)).blob()
  return await new Promise<string>((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(fr.result as string)
    fr.onerror = () => reject(fr.error)
    fr.readAsDataURL(blob)
  })
}
/** dataURL → blob: URL（読込で動画を <video> に渡すため）。 */
async function dataUrlToBlobUrl(dataUrl: string): Promise<string> {
  const blob = await (await fetch(dataUrl)).blob()
  return URL.createObjectURL(blob)
}
/** dataURL の MIME から保存ファイルの拡張子を決める。 */
function extFromDataUrl(dataUrl: string): string {
  const mime = /^data:([^;]+)/.exec(dataUrl)?.[1] ?? ''
  const map: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/quicktime': 'mov'
  }
  return map[mime] ?? (mime.startsWith('video/') ? 'mp4' : 'png')
}

/** カラフルチェイスの既定色並び（ユーザーが色を組まなければ固定8色ぜんぶで流れる）。 */
const DEFAULT_CHASE_PALETTE: RGB3[] = COLORS.map((c) => c.rgb)

function mk(w: number, h: number, readback = false): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  if (readback) c.getContext('2d', { willReadFrequently: true })
  return c
}


/** 写真アルベド(mat)の作業解像度上限。Syphon 出力(outCv)はこの mat 解像度で
 *  アリーナへ送る（編集画面のフレームは別途 1920×1080 固定なので編集は軽いまま）。
 *  長辺をここまで縮小して持つ＝これより大きい画像だけ縮む（拡大はしない）。動画は1280px。
 *  4K(3840) 出力可。これ以上は OUT_CAP も一緒に上げる必要あり。シーンを大量に積むと
 *  1シーンあたり最大 約33MB(3840×2160×4) になる点に注意。 */
export const ALBEDO_MAX = 3840

/** Cap a photo's albedo working size to ALBEDO_MAX on its longest side (aspect kept,
 *  never upscales). Pure — unit-tested. */
export function albedoFitSize(nw: number, nh: number, max = ALBEDO_MAX): { w: number; h: number } {
  const longest = Math.max(nw, nh)
  const s = longest > max ? max / longest : 1
  return { w: Math.max(1, Math.round(nw * s)), h: Math.max(1, Math.round(nh * s)) }
}

const rgs = (c: RGB3 | number[], a: number): string =>
  `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${Math.max(0, Math.min(1, a)).toFixed(3)})`

// ---- ビームのリアル化チューニング値（のむさんと見た目を追い込む用・ここを変えて調整） ----
const BEAM_SPREAD_MIN = 1.5 // 出口から最低この倍に広がる円すい
const BEAM_BLUR = 0 // ★灯体ごとのblurは廃止（重いので）。やわらかさは全画面blur(縞退治)に集約＝下のBEAM_SOFTで調整
const BEAM_SOFT = 2.4 // ★全体のやわらかさ(px係数)。灯体blur廃止の代わり。大きいほどぼける(GPUで1回・軽い)
const BEAM_ROOT_BOOST = 0.6 // ★出口付近の明るさを足す 0..1（根元をもう少し明るく）
const CONTACT_HOT = 0.85 // 接触面の焼け（白飛び）0..1（据え置き）
const CONTACT_HOT_FROM = 0.3 // ★この明るさ(ゲージ)未満では白く焼けない。0..1。大きいほど「明るい時だけ白飛び」＝暗い時に白くならずリアル
const CONTACT_NIJIMI = 0.45 // 根元のにじみ 0..1（色つき＝明るさに比例で自然に暗くなる）

/** 固定シードの擬似乱数（毎回同じ「ランダム」個性）。 */
function makeSearchParams(rnd: () => number): SearchParams {
  return { phase: rnd() * Math.PI * 2, speedK: 0.6 + 0.8 * rnd(), widthK: 0.7 + 0.6 * rnd() }
}

export class ImageLightEngine {
  /** 編集画面の表示用フレーム（写真＋余白・マーカー無し）。 */
  readonly frame = mk(IW, IH)
  /** Syphon出力用（写真の部分だけ・写真の解像度・余白なし）。編集画面は frame、出力は outCv。 */
  readonly outCv = mk(16, 9, true)
  outW = 16
  outH = 9
  private outBlurCv = mk(16, 9)

  // 内部バッファ
  private lightCv = mk(IW, IH)
  private workCv = mk(IW, IH)
  private airCv = mk(IW, IH)
  private smoothCv = mk(IW, IH)
  private vmCv = mk(IW, IH) // 受け系(雨/雪/煙)の「matter×光マップ」合成用スクラッチ（drawImageのみ）
  private vmc = this.vmCv.getContext('2d')!
  private reliefCv = mk(IW, IH) // 立体強調の後処理用スクラッチ（編集フレーム）
  private reliefOutCv = mk(16, 9) // 立体強調の後処理用スクラッチ（出力・サイズ可変）
  private noiseCv = mk(IW, IH)
  private lamp1Cv = mk(IW, IH) // 一灯街灯: 本体×光マップの乗算マスク用スクラッチ（bbox内だけ触る）
  private noiseTile: HTMLCanvasElement
  private noisePattern: CanvasPattern | null = null // 静的タイル→毎フレーム createPattern しないよう一度だけ生成して使い回す
  private motifRankCache: number[] = [] // モチーフチェイスの順位を毎フレーム1回 O(n) で先計算（effI の O(n^2) 回避）
  private fc = this.frame.getContext('2d')!
  private lc = this.lightCv.getContext('2d')!
  private wc = this.workCv.getContext('2d')!

  // ---- スペシャルエフェクト(特効): プロシージャル炎(フレーマー) ----
  // flame.glow を光マップに足す→既存の写真×光で「セットが炎に照らされる」。flame.body は前面に重ねる。
  readonly flame = new FlameFX()
  // 特効: コールドスパーク(火花フォンテン)。glow→光マップで「火花がセットを照らす」、bodyは前面。
  readonly sparkler = new SparklerFX()
  // 特効: 受け系(雨/雪・ロースモーク)。matter(白いアルファ)×光マップ＝照明が当たった所だけ光る。
  readonly rain = new RainFX()
  readonly lowSmoke = new LowSmokeFX()
  setRainOn(v: boolean): void { this.rain.on = v; this.bump() }
  get rainOn(): boolean { return this.rain.on }
  setRainParams(p: Partial<RainParams>): void { this.rain.params = { ...this.rain.params, ...p }; this.bump() }
  getRainParams(): RainParams { return { ...this.rain.params } }
  setLowSmokeOn(v: boolean): void { this.lowSmoke.on = v; this.bump() }
  get lowSmokeOn(): boolean { return this.lowSmoke.on }
  lowSmokeRefill(): void { this.lowSmoke.refill(); this.bump() }
  setLowSmokeParams(p: Partial<LowSmokeParams>): void { this.lowSmoke.params = { ...this.lowSmoke.params, ...p }; this.bump() }
  getLowSmokeParams(): LowSmokeParams { return { ...this.lowSmoke.params } }
  /** 特効マークの噴き出す向き（ラジアン）＝照明と同じ TILT から計算。
   *  TILT=0 で真上、＋で右へ、−で左へ傾く（照明の TILT スライダーをそのまま使う）。 */
  private dirOf(b: Beam): number {
    return -Math.PI / 2 + ((b.tilt ?? 0) * Math.PI) / 180
  }
  /** 火花の灯体(motif='sparkler'・点灯中)の位置(0..1)＋向き(TILT由来)を返す＝噴出点。
   *  ステップシーケンサー再生中は「今のステップで点くマークだけ」になる。 */
  get sparklerPoints(): { fx: number; fy: number; dir: number }[] {
    return this.beams
      .filter((b) => b.motif === 'sparkler' && this.sfxOn(b))
      .map((b) => ({ fx: b.x / LW, fy: b.y / LH, dir: this.dirOf(b) }))
  }
  /** 火花の灯体が1つでもあれば特効ON（個別の入切はミュート＝灯体と同じ）。 */
  get sparklerEnabled(): boolean {
    return this.beams.some((b) => b.motif === 'sparkler')
  }
  /** 置いた火花の数（点灯有無に関係なく＝UI表示用）。 */
  get sparklerPlacedCount(): number {
    return this.beams.filter((b) => b.motif === 'sparkler').length
  }
  setSparklerParams(p: Partial<SparklerParams>): void {
    this.sparkler.params = { ...this.sparkler.params, ...p }
    this.bump()
  }
  getSparklerParams(): SparklerParams {
    return { ...this.sparkler.params }
  }
  /** 炎の灯体(motif='flame'・点灯中)の位置(0..1)＋向きを返す＝発射/チェイスの的。
   *  配置・選択・移動・削除・ミュートは灯体の仕組みがそのまま担当する。
   *  ステップシーケンサー再生中は「今のステップで点くマークだけ」になる。 */
  get flamePoints(): { fx: number; fy: number; dir: number }[] {
    return this.beams
      .filter((b) => b.motif === 'flame' && this.sfxOn(b))
      .map((b) => ({ fx: b.x / LW, fy: b.y / LH, dir: this.dirOf(b) }))
  }
  /** その特効マークが「今点いているか」。通常はミュート判定、シーケンサー再生中は今のステップ。 */
  private sfxOn(b: Beam): boolean {
    if (this.sfxSeqPlaying) return b.sfxId != null && this.currentSeqSet().has(b.sfxId)
    return this.isLit(b)
  }

  // ---- 特効ステップシーケンサー（炎＋火花共通・ドラムマシン風の格子）----
  // sfxSeqSteps[col] = その列(ステップ)で点く特効マークの sfxId 配列。
  // 行＝置いた炎/火花マーク、列＝ステップ。マスのON/OFFで組み、テンポで自動ループ。
  // 再生中は flamePoints/sparklerPoints が今の列に絞られ、列頭で炎を発火。
  sfxSeqSteps: number[][] = [[], [], [], [], [], [], [], []] // 既定8ステップ
  sfxSeqPlaying = false
  sfxSeqMs = 420
  private sfxSeqIndex = 0
  private sfxSeqLast = 0
  private sfxIdSeq = 1
  /** 炎/火花マークに安定IDを割り振る（未割当だけ）。 */
  private ensureSfxIds(): void {
    for (const b of this.beams) {
      if ((b.motif === 'flame' || b.motif === 'sparkler') && b.sfxId == null) b.sfxId = this.sfxIdSeq++
    }
  }
  /** 炎/火花マークの一覧（sfxId 採番に使用）。 */
  get sfxMarks(): { id: number; idx: number; motif: 'flame' | 'sparkler' }[] {
    this.ensureSfxIds()
    const out: { id: number; idx: number; motif: 'flame' | 'sparkler' }[] = []
    for (let i = 0; i < this.beams.length; i++) {
      const b = this.beams[i]
      if (b.motif === 'flame' || b.motif === 'sparkler') out.push({ id: b.sfxId!, idx: i, motif: b.motif })
    }
    return out
  }
  private currentSeqSet(): Set<number> {
    return new Set(this.sfxSeqSteps[this.sfxSeqIndex] || [])
  }
  /** テンポでステップを進める（renderFrame から毎フレーム）。ループする。
   *  進めるのはステップ番号だけ＝点く炎/火花の集合(sfxOn)が切替わり、持続描画が追従する。 */
  private tickSfxSeq(now: number): void {
    if (!this.sfxSeqPlaying || this.sfxSeqSteps.length === 0) return
    if (!this.sfxSeqLast) this.sfxSeqLast = now
    if (now - this.sfxSeqLast >= this.sfxSeqMs) {
      this.sfxSeqLast = now
      this.sfxSeqIndex = (this.sfxSeqIndex + 1) % this.sfxSeqSteps.length
      this.bump(false) // 「再生中 X/Y」表示をライブ更新（保存はしない）
    }
  }
  /** 炎の灯体が1つでもあれば特効ON（個別の入切はミュート＝灯体と同じ）。 */
  get flameEnabled(): boolean {
    return this.beams.some((b) => b.motif === 'flame')
  }
  /** 置いた炎の数（点灯有無に関係なく＝UI表示用）。 */
  get flamePlacedCount(): number {
    return this.beams.filter((b) => b.motif === 'flame').length
  }
  flameChaseOn = false
  flameChasePattern: 'random' | 'all' | 'inout' | 'outin' = 'inout'
  flameChaseMs = 420 // 旧チェイスの保存互換用フィールド（発射は sfxChase に統一）
  /** 置いた炎を全部いっぺんに発射（無ければ標準4本）。 */
  flameFireAll(): void {
    if (this.flamePoints.length) this.flamePoints.forEach((p) => this.flame.fire(p.fx, p.fy, 1, p.dir))
    else this.flame.fireRow()
    this.bump()
  }
  // ---- SFX 発射パターン（炎・火花 共通）：置いた点を 全部同時/内→外/外→内/ランダム で順に発射 ----
  //  順番は「置いた位置」から自動判定（番号に依らない）。all 以外は 1 つずつ進む波（速さ=sfxChaseMs）。
  sfxChaseMode: 'all' | 'random' | 'inout' | 'outin' = 'all'
  sfxChaseMs = 420
  setSfxChaseMode(m: 'all' | 'random' | 'inout' | 'outin'): void {
    this.pushHistory('sfxchase')
    this.sfxChaseMode = m
    this.bump()
  }
  setSfxChaseMs(ms: number): void {
    this.pushHistory('sfxchase')
    this.sfxChaseMs = Math.max(60, Math.min(2000, ms))
    this.bump()
  }
  /** 発射順（index 配列）。inout=中央に近い順／outin=遠い順／random=決定的な擬似ランダム（毎フレーム同じ＝ちらつかない）。 */
  private sfxChaseOrder(pts: { fx: number; fy: number }[]): number[] {
    const n = pts.length
    const idx = pts.map((_, i) => i)
    if (this.sfxChaseMode === 'random') {
      const h = (i: number): number => {
        const s = Math.sin((i + 1) * 127.1) * 43758.5453
        return s - Math.floor(s)
      }
      return idx.sort((a, b) => h(a) - h(b))
    }
    const cx = pts.reduce((s, p) => s + p.fx, 0) / n
    const cy = pts.reduce((s, p) => s + p.fy, 0) / n
    const d = (p: { fx: number; fy: number }): number => Math.hypot(p.fx - cx, p.fy - cy)
    return idx.sort((a, b) => (this.sfxChaseMode === 'outin' ? d(pts[b]) - d(pts[a]) : d(pts[a]) - d(pts[b])))
  }
  /** 今この瞬間に「発射中」の点だけを返す。all=全部、それ以外=発射順で 1 つずつ進む（残りは自然に燃え尽き/消える）。 */
  private sfxChaseActive<T extends { fx: number; fy: number }>(pts: T[], now: number): T[] {
    if (this.sfxChaseMode === 'all' || pts.length <= 1) return pts
    const order = this.sfxChaseOrder(pts)
    const head = Math.floor(now / Math.max(60, this.sfxChaseMs)) % pts.length
    return [pts[order[head]]]
  }
  setFlameParams(p: Partial<FlameParams>): void {
    this.flame.params = { ...this.flame.params, ...p }
    this.bump()
  }
  getFlameParams(): FlameParams {
    return { ...this.flame.params }
  }
  /** 一発(単発)。fx,fy は 0..1（未指定は中央・床）。 */
  flameFire(fx = 0.5, fy = 1): void {
    this.flame.fire(fx, fy)
    this.bump()
  }
  /** 標準4本を時間差で一斉発射(単発)。 */
  flameFireRow(): void {
    this.flame.fireRow()
    this.bump()
  }
  /** 長押し開始(サスティン)。releaseで終わる。fx,fy は 0..1。 */
  flameHoldStart(fx = 0.5, fy = 1): void {
    this.flame.startHold(fx, fy)
    this.bump()
  }
  /** 置いた炎を全部、長押し開始（向きも反映）。 */
  flameHoldAllStart(): void {
    const pts = this.flamePoints
    if (pts.length) pts.forEach((p) => this.flame.startHold(p.fx, p.fy, 1, p.dir))
    else this.flame.startHold(0.5, 1)
    this.bump()
  }
  flameHoldRelease(): void {
    this.flame.release()
    this.bump()
  }
  /** 出力(outCv)へ炎本体を重ねる（box領域→出力解像度へ写像）。glowは光マップ経由で既にcomposeOutputに入る。 */
  private drawFlameOnOutput(): void {
    if (this.lightOnly || !this.box || this.outW <= 16) return
    const oc = this.outCv.getContext('2d', { willReadFrequently: true })!
    const box = this.box
    const bd = this.flame.body
    const kx = bd.width / IW
    const ky = bd.height / IH
    const sx = box.x * Q * kx
    const sy = box.y * Q * ky
    const sw = box.w * Q * kx
    const sh = box.h * Q * ky
    oc.setTransform(1, 0, 0, 1, 0, 0)
    // source-over: 炎本体の芯(不透明)が背景を隠して「前にある」感を出す（加算だと透けて発光オーバーレイ化して浮く）
    oc.globalCompositeOperation = 'source-over'
    oc.globalAlpha = 1
    oc.drawImage(bd, sx, sy, sw, sh, 0, 0, this.outW, this.outH)
    oc.globalCompositeOperation = 'source-over'
  }
  /** 出力(outCv)へ火花本体を重ねる（炎と同じ box→出力の写像）。glowは光マップ経由で反映済み。 */
  private drawSparklerOnOutput(): void {
    if (this.lightOnly || !this.box || this.outW <= 16) return
    const oc = this.outCv.getContext('2d', { willReadFrequently: true })!
    const box = this.box
    const bd = this.sparkler.body
    const kx = bd.width / IW
    const ky = bd.height / IH
    oc.setTransform(1, 0, 0, 1, 0, 0)
    oc.globalCompositeOperation = 'source-over'
    oc.globalAlpha = 1
    oc.drawImage(bd, box.x * Q * kx, box.y * Q * ky, box.w * Q * kx, box.h * Q * ky, 0, 0, this.outW, this.outH)
    oc.globalCompositeOperation = 'source-over'
  }

  /** 受け系(雨/雪/煙)の matter を「光マップで色付け＆マスク」して vmCv に作る。
   *  結果＝『照明が当たった所だけ・その光の色で光る粒/煙』（当たってない所は透明）。 */
  private buildVolumetric(matter: HTMLCanvasElement, QW: number, QH: number): void {
    const c = this.vmc
    c.setTransform(1, 0, 0, 1, 0, 0)
    c.globalAlpha = 1
    c.globalCompositeOperation = 'source-over'
    c.clearRect(0, 0, QW, QH)
    c.drawImage(this.lightCv, 0, 0) // 光マップの色
    c.globalCompositeOperation = 'destination-in'
    c.drawImage(matter, 0, 0, matter.width, matter.height, 0, 0, QW, QH) // matter のある所だけ残す
    c.globalCompositeOperation = 'source-over'
  }
  /** vmCv(色付き受け系) を前面 g へ加算合成（編集フレーム fc 用・全面）。 */
  private drawVolumetricFront(g: CanvasRenderingContext2D, alpha: number): void {
    g.setTransform(1, 0, 0, 1, 0, 0)
    g.globalCompositeOperation = 'lighter'
    g.globalAlpha = alpha
    g.drawImage(this.vmCv, 0, 0)
    g.globalAlpha = 1
    g.globalCompositeOperation = 'source-over'
  }
  /** vmCv(色付き受け系) を出力(outCv)へ加算合成（box領域→出力解像度）。 */
  private drawVolumetricOnOutput(alpha: number): void {
    if (this.lightOnly || !this.box || this.outW <= 16) return
    const oc = this.outCv.getContext('2d', { willReadFrequently: true })!
    const b = this.box
    oc.setTransform(1, 0, 0, 1, 0, 0)
    oc.globalCompositeOperation = 'lighter'
    oc.globalAlpha = alpha
    oc.drawImage(this.vmCv, b.x * Q, b.y * Q, b.w * Q, b.h * Q, 0, 0, this.outW, this.outH)
    oc.globalAlpha = 1
    oc.globalCompositeOperation = 'source-over'
  }
  private ac = this.airCv.getContext('2d')!

  // 状態
  st: St = {
    master: 1,
    smoke: 12,
    chase: false,
    search: false,
    searchRandom: false,
    strobe: 'off',
    colorChase: false,
    breath: false,
    fire: false,
    wave: false,
    bolt: false,
    rainbow: false,
    zoompulse: false
  }
  fxp: FxParams = defaultFxp()
  beams: Beam[] = []
  // ドラッグ中の吸着の基準位置（beginDrag で記録）。
  private dragOrig: { x: number; y: number }[] | null = null
  /** ドラッグ中の吸着ガイド（UIが読んで赤線・等間隔マーカーを描く）。 */
  snapGuides: {
    vx: number[]
    hy: number[]
    equal: { x0: number; x1: number; y: number }[]
  } | null = null
  /** 光だけ出力モード: 写真を使わず光マップだけをSyphonへ出力。Arena側で 映像×光(Multiply) して使う。 */
  lightOnly = false
  /** 立体強調 0..1。もとの写真に描き込まれた陰影をコントラストで濃くして“立体”を呼び戻す後処理。
   *  0=今と完全一致（後処理なし）。線も形もAIも足さない・GPU後処理1回。 */
  relief = 0
  /** 方向の立体 0..1（AIなし深度）。写真の明るさから作ったエンボスを soft-light で重ね、
   *  光の向きに応じた陰影を足す。0=なし。各写真の lumRelief を読込時に1回だけ作って毎フレームは軽い。 */
  lumReliefStrength = 0
  // 見え方（写真への光の乗り方）。どちらも 0=従来どおり（保存済みの公演の見た目を変えない）。
  colorWash = 0 // 色ノリ: 光の色を写真にそのまま少し乗せる(0..0.4)。掛け算だけだと青などが茶色いセットに乗らない対策
  baseLift = 0 // ベース明るさ: 暗部の底上げ(0..0.3)。明かりが点いている時だけ効く＝暗転は黒のまま
  selected: number[] = [0] // 選択中の灯体index（複数可）。空=未選択／全部入=ALL
  scenes: Scene[] = []
  activeScene = -1
  patterns: (Pattern | null)[] = Array(9).fill(null)
  activePattern = -1
  learnPattern: number | null = null
  /** Scene MIDI Learn 待機中のシーン番号。null=非待機。 */
  learnScene: number | null = null
  /** ピース作成モード（true の間、写真上のドラッグでピースの矩形を切り出す）。 */
  pieceCreating = false
  /** 編集中の選択ピース ID（null=未選択）。シーン切替で null へ。 */
  selectedPieceId: string | null = null
  /** マスク用画像（アルファ付きチャート）。境界線描画の元データ。 */
  maskImage: HTMLImageElement | null = null
  /** マスク画像の元dataURL（公演ファイル保存で書き出すため保持）。 */
  maskSrc: string | null = null
  /** マスクのアルファ境界線だけ描いたキャンバス（シアン1px）。BUILD で重ねる。 */
  maskEdgeCanvas: HTMLCanvasElement | null = null
  /** 簡単スケッチの電飾パターン（卓なし＝アプリ自身が色を流す“見た目だけ”の仕掛け）。 */
  decor: DecorPattern = { ...DEFAULT_DECOR }
  /** マスクのアルファから生成した線分（マスク作業解像度 px 座標）。null=未生成。 */
  private decorSegs: DecorSeg[] | null = null
  /** マスクの「描ける所」ビットマップ（作業解像度・255=描ける）。重い canvas 読み出しの結果を保持。 */
  private decorDrawable: Uint8Array | null = null
  private decorMaskW = 0
  private decorMaskH = 0
  /** チェイス用の時計（秒）。decor.playing 中だけ進む（t0 のリセットに影響されない）。 */
  private decorClock = 0
  private decorLastNow = -1
  armedSave = false
  userColors: RGB3[] = []
  /** カラフルチェイスで流す色並び（空=固定8色ぜんぶ）。COLOR欄からD&Dで組む。 */
  chasePalette: RGB3[] = []
  masterMidi: number | null = null
  masterLearn = false
  // FXツマミ等の MIDI CC 割当（paramId→CC番号・保存対象）。learnParam がLEARN待ちの対象。
  paramMidi: Record<string, number> = {}
  learnParam: string | null = null
  // エフェクト(FX)のトリガー割当：MIDIノート/キーで FX を ON/OFF（保存対象）。
  fxMidi: Partial<Record<FxKey, number>> = {}
  fxKey: Partial<Record<FxKey, string>> = {}
  /** FX LEARN 待機中の FX キー。null=非待機。 */
  learnFx: FxKey | null = null
  /** ビームの落ち込みの強さ（指数）。プリセット ソフト1.5 / 標準2.5 / きつめ4。保存対象。 */
  falloffPow = 2.5
  /** 出力(Syphon/NDI)の上限解像度の長辺px。なめらか1920 / バランス2560 / 高精細3840。
   *  低いほど毎フレームの吸い出し(getImageData)が軽く＝動きが滑らか。保存対象。 */
  outCap = 3840
  /** プリセット色のトリガー割当（hex→MIDIノート/キー）。色LEARN(◎)で設定。保存対象。 */
  colorMidi: Record<string, number> = {}
  colorKey: Record<string, string> = {}
  /** 色LEARN待機中の色(hex)。null=非待機。 */
  learnColor: string | null = null
  // ---- マスター・ランダムストロボ（特別ボタン）：今の出力を非破壊で全体点滅させるトグル。
  //  1回押し=ON / もう1回=元のシーンに戻る。MIDIラーン対応。strobeRate=速さ0..1。
  /** 特別ストロボ ON 中か（非保存：ライブのトグル）。 */
  strobeOverride = false
  /** 特別ストロボの MIDI ノート割当（保存対象）。 */
  strobeMidi: number | null = null
  /** 特別ストロボ LEARN 待機中か。 */
  learnStrobe = false
  /** モチーフチェイス(Chase motifs)の MIDI ノート割当（保存対象・rigData）。 */
  motifChaseMidi: number | null = null
  /** モチーフチェイス LEARN 待機中か。 */
  learnMotifChase = false
  /** 特別ストロボの速さ 0..1（大きいほど速い・保存対象）。 */
  strobeRate = 0.55
  /** 本番(PLAY)のシーン(明かり)切替方式と時間。cut=即／fade=時間補間。保存対象。 */
  sceneFadeMode: 'cut' | 'fade' = 'cut'
  sceneFadeMs = 1500
  private sceneFadeSeq = 0
  // paramId → 「0..1 を実値へ反映する関数」。UI(fxdefs)が登録（非保存）。
  private paramApply = new Map<string, (v01: number) => void>()

  // 描画対象の写真（=activeScene）
  private mat: HTMLCanvasElement | null = null
  /** 現在表示中の写真の枠（LW×LH 座標系）。UI 側はワープハンドル描画に読む。 */
  box: { x: number; y: number; w: number; h: number } | null = null
  // ユーザーが灯体の配置を一度でもいじったか（写真下端への自動追従を止めるフラグ）
  private rigCustomized = false
  // 公演を復元している最中か。復元は async で途中に await を挟むため、その間に自動保存タイマーが
  // 走ると「作りかけのショー」で il-autosave を上書き＝データ消失する。復元中は自動保存を止める。
  restoring = false
  // 灯体コピペ用の内部クリップボード（選択した複数灯体を丸ごと複製）
  private beamClip: Beam[] | null = null

  // パニック／タイミング
  private t0 = performance.now()
  panicGain = 1
  private panicSeq = 0

  private seed = 7
  private rnd = (): number => {
    this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff
    return this.seed / 0x7fffffff
  }

  // 変更通知（React 用）
  private version = 0
  private listeners = new Set<() => void>()
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  // 作成した動画 ObjectURL（削除してもUndoで戻せるよう、revoke は unmount まで遅らせて一括）
  private allUrls: string[] = []

  constructor() {
    this.noiseTile = this.buildNoiseTile()
    this.initBeams()
    this.loadRig()
  }

  // ---------- 購読 ----------
  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  getVersion = (): number => this.version
  /** 状態が変わったら呼ぶ → React 再描画＋遅延オートセーブ。 */
  private bump(persist = true): void {
    this.version++
    for (const fn of this.listeners) fn()
    if (persist) this.scheduleSave()
  }

  // ---------- Undo / Redo ----------
  private hist: Snap[] = []
  private fut: Snap[] = []
  private histTag: string | null = null
  private histAt = 0
  private snapshot(): Snap {
    return {
      beams: this.beams.map((b) => ({ ...b, color: b.color.slice() as RGB3, sp: { ...b.sp }, dmx: b.dmx ? { ...b.dmx } : undefined })),
      st: { ...this.st },
      fxp: JSON.parse(JSON.stringify(this.fxp)),
      selected: [...this.selected],
      activeScene: this.activeScene,
      patterns: JSON.parse(JSON.stringify(this.patterns)),
      userColors: this.userColors.map((c) => c.slice() as RGB3),
      chasePalette: this.chasePalette.map((c) => c.slice() as RGB3),
      // 写真/動画オブジェクトは参照共有・fix と pieces(配置)だけ独立コピー（Undoで戻せるように）
      scenes: this.scenes.map((s) => ({
        ...s,
        fix: s.fix?.map((f) => ({ ...f })),
        pieces: s.pieces?.map((p) => ({
          id: p.id,
          src: { ...p.src },
          corners: [
            { ...p.corners[0] },
            { ...p.corners[1] },
            { ...p.corners[2] },
            { ...p.corners[3] }
          ] as Piece['corners']
        }))
      })),
      sfxChaseMode: this.sfxChaseMode,
      sfxChaseMs: this.sfxChaseMs
    }
  }
  private restore(s: Snap): void {
    // 進行中のシーンフェードは「破棄」（snapしない＝復元した値が正。フェードRAFが古い補間で
    // 復元後の明かりを上書きし続ける事故を止める）。パニック(暗転)は本番の意思なので維持。
    this.sceneFadeSeq++
    this.sceneFadeActive = false
    this.sceneFadeTo = null
    this.beams = s.beams.map((b) => ({ ...b, color: b.color.slice() as RGB3, sp: { ...b.sp }, dmx: b.dmx ? { ...b.dmx } : undefined }))
    this.st = { ...s.st }
    this.fxp = JSON.parse(JSON.stringify(s.fxp))
    this.selected = s.selected.filter((i) => i >= 0 && i < s.beams.length)
    this.patterns = JSON.parse(JSON.stringify(s.patterns))
    this.userColors = s.userColors.map((c) => c.slice() as RGB3)
    this.chasePalette = s.chasePalette.map((c) => c.slice() as RGB3)
    this.scenes = s.scenes.map((sc) => ({
      ...sc,
      fix: sc.fix?.map((f) => ({ ...f })),
      pieces: sc.pieces?.map((p) => ({
        id: p.id,
        src: { ...p.src },
        corners: [
          { ...p.corners[0] },
          { ...p.corners[1] },
          { ...p.corners[2] },
          { ...p.corners[3] }
        ] as Piece['corners']
      }))
    }))
    this.sfxChaseMode = s.sfxChaseMode
    this.sfxChaseMs = s.sfxChaseMs
    const ai = s.activeScene >= 0 && s.activeScene < this.scenes.length ? s.activeScene : -1
    // 動画: 表示中だけ再生・他は停止
    this.scenes.forEach((sc, i) => {
      if (sc.kind === 'video' && sc.video && i !== ai) sc.video.pause()
    })
    this.activeScene = ai
    if (ai >= 0) {
      const cur = this.scenes[ai]
      this.mat = cur.mat
      if (cur.kind === 'video' && cur.video) cur.video.play().catch(() => {})
      this.fitImage()
    } else {
      this.mat = null
      this.box = null
    }
    this.t0 = performance.now()
    this.bump()
  }
  /** 変更の「直前」に呼ぶ。同じ tag が 600ms 以内なら合体（スライダー/ドラッグを1手に）。 */
  private pushHistory(tag?: string): void {
    const now = performance.now()
    if (tag && this.histTag === tag && now - this.histAt < 600) {
      this.histAt = now
      return
    }
    this.hist.push(this.snapshot())
    if (this.hist.length > 60) this.hist.shift()
    this.fut = []
    this.histTag = tag ?? null
    this.histAt = now
  }
  undo(): void {
    const prev = this.hist.pop()
    if (!prev) return
    this.fut.push(this.snapshot())
    this.restore(prev)
    this.histTag = null
  }
  redo(): void {
    const next = this.fut.pop()
    if (!next) return
    this.hist.push(this.snapshot())
    this.restore(next)
    this.histTag = null
  }
  // ---------- 初期化 ----------
  private buildNoiseTile(): HTMLCanvasElement {
    const n = mk(64, 64)
    const nc = n.getContext('2d')!
    const id = nc.createImageData(64, 64)
    let s = 12345
    for (let i = 0; i < id.data.length; i += 4) {
      s = (s * 1103515245 + 12345) & 0x7fffffff
      const v = (s >> 16) & 255
      id.data[i] = v
      id.data[i + 1] = v
      id.data[i + 2] = v
      id.data[i + 3] = 255
    }
    nc.putImageData(id, 0, 0)
    return n
  }

  /** 何もない初期状態のデフォルト灯体。横幅(LW)を均等に10分割した中央へ10台並べる
   *  （のむさん確定 2026-06-13）。配置はプロジェクト共通でlocalStorageに保存され、一度
   *  いじればその位置が維持される。保存が無い＝この均等10台から始まる。 */
  private initBeams(): void {
    const N = 10
    this.beams = Array.from({ length: N }, (_, i) => ({
      x: Math.round((LW / N) * (i + 0.5)), // 80,240,…,1520＝横幅で均等
      y: 840,
      w0: 40,
      w1: 260,
      len: 600,
      pan: 0,
      tilt: 0,
      zoom: 1,
      gauge: 0.72,
      color: WHITE.slice() as RGB3, // 既定は白（のむさん確定 2026-06-13）
      sp: makeSearchParams(this.rnd)
    }))
  }

  // ---------- 点灯判定・実効値 ----------
  isLit = (b: Beam): boolean => {
    const anySolo = this.beams.some((x) => x.solo)
    return !b.mute && (!anySolo || !!b.solo)
  }
  anyFx = (): boolean => {
    const s = this.st
    return (
      s.chase ||
      s.search ||
      s.strobe !== 'off' ||
      s.colorChase ||
      s.breath ||
      s.fire ||
      s.wave ||
      s.bolt ||
      s.rainbow ||
      s.zoompulse
    )
  }
  /** 表示中シーンが動画か（毎フレーム描き直しが要る）。 */
  activeIsVideo = (): boolean =>
    this.activeScene >= 0 && this.scenes[this.activeScene]?.kind === 'video'
  /** シーン明かりフェード／パニックフェードを別々に持つ。共有1個だと、片方の完了が
   *  もう片方の「描き続けて」信号を消し、暗転(panic)中に画面が固まる事故になる。 */
  private sceneFadeActive = false
  private sceneFadeTo: Look | null = null // 進行中フェードの目標（割込み時に即ジャンプで完了させるため）
  private panicActive = false
  /** どちらかのフェードが進行中か（描画ループの継続判定 isAnimating に使う）。 */
  get fading(): boolean {
    return this.sceneFadeActive || this.panicActive
  }
  /** モチーフ専用チェイス（テスト用＝モチーフだけを順番に点けたり消したり）。 */
  motifChase = false
  /** 毎フレーム描き直しが必要か（FX中・動画・パニックフェード中）。これが false かつ
   *  状態変化も無ければ、描画ループは1フレーム描いて止まってよい＝静止画は無負荷。 */
  isAnimating = (): boolean =>
    this.strobeOverride ||
    this.anyFx() ||
    this.activeIsVideo() ||
    this.fading ||
    this.motifChase ||
    this.decorAnimating() ||
    (this.flameEnabled && (this.flame.active || this.flameChaseOn)) ||
    (this.sparklerEnabled && (this.sparklerPoints.length > 0 || this.sparkler.active)) ||
    this.rain.active ||
    this.lowSmoke.active ||
    this.sfxSeqPlaying ||
    this.beams.some((b) => b.motif === 'marquee' || b.motif === 'stars') ||
    this.beams.some((b) => b.front && (b.frontPat ?? 'off') !== 'off') || // フロント灯体のサーチ（8の字/丸/横/ランダム）
    this.hasDmxPatched()
  /** 色が動くFX中（点灯中は色ボタンを握れない＝UIでグレーアウト）。 */
  colorOwnedByFx = (): boolean => this.st.rainbow || this.st.colorChase

  private effI(b: Beam, i: number, ms: number): number {
    if (!this.isLit(b)) return 0
    const s = this.st
    let v = b.gauge * s.master * this.panicGain
    if (s.chase) v *= chaseK(this.fxp.chase, ms, i)
    if (s.breath) v *= breathK(this.fxp.breath, ms)
    if (s.fire) v *= fireK(this.fxp.fire, ms, i)
    if (s.wave) v *= waveK(this.fxp.wave, ms, i)
    if (s.bolt) v *= boltK(this.fxp.bolt, ms)
    if (s.strobe === 'all') v *= strobeAllK(this.fxp.strobe, ms)
    else if (s.strobe === 'rnd') v *= strobeRndK(this.fxp.rndstrobe, ms, i)
    // 特別ボタン（ランダムストロボ）：今の look の上から、灯体ごとにバラける本物のランダム
    // ストロボ(strobeRndK)を非破壊で重ねる。strobeRate(0..1)で速さ。OFFで元の look に戻る。
    if (this.strobeOverride) {
      v *= strobeRndK({ speed: 2 + this.strobeRate * 20, dens: 28, flow: 40 }, ms, i)
    }
    // モチーフ専用チェイス：モチーフだけを「モチーフ内の並び順」で順番に点滅
    // （通常灯体が間に挟まっても等間隔になるよう、モチーフ内の順位で位相をずらす）。
    if (b.motif && this.motifChase) {
      const rank = this.motifRankCache[i] ?? 0 // 先計算済み（render frame 冒頭で O(n)）
      v *= chaseK(this.fxp.chase, ms, rank)
    }
    return v
  }
  /** カラフルチェイスで実際に流す色並び（自前パレットが空なら固定8色ぜんぶ）。 */
  private effectiveChasePalette(): RGB3[] {
    return this.chasePalette.length ? this.chasePalette : DEFAULT_CHASE_PALETTE
  }
  private colorNow(b: Beam, i: number, ms: number): RGB3 {
    if (this.st.rainbow) return rainbowColor(this.fxp.rainbow, ms, i)
    if (!this.st.colorChase) return b.color
    return colorChaseColor(this.fxp.colorchase, this.effectiveChasePalette(), ms, i)
  }
  private tiltNow(b: Beam, ms: number): number {
    if (!this.st.search) return b.tilt
    return searchTilt(b.tilt, this.fxp.search, this.fxp.rndsearch, this.st.searchRandom, b.sp, ms)
  }

  // ---------- ビーム描画（世界座標・モック移植） ----------
  private beamColOf(b: Beam, I: number): number[] {
    const c = b._cn || b.color
    const low = Math.max(0, (0.5 - I) / 0.5)
    return [c[0] * I, c[1] * (1 - 0.3 * low) * I, c[2] * (1 - 0.6 * low) * I]
  }
  private trap(g: CanvasRenderingContext2D, b: Beam, wf: number, y0: number, y1: number): void {
    const t0v = (b.y - y0) / b.len
    const t1v = (b.y - y1) / b.len
    const wAt = (t: number): number => ((b.w0 + (b.w1 - b.w0) * t) * wf) / 2
    g.beginPath()
    g.moveTo(b.x - wAt(t0v), y0)
    g.lineTo(b.x + wAt(t0v), y0)
    g.lineTo(b.x + wAt(t1v), y1)
    g.lineTo(b.x - wAt(t1v), y1)
    g.closePath()
  }
  /** 終わり際の丸み: 層ごとに届く長さを変える（外ほど早く尽き中心だけ最後まで）。 */
  private drawBeamCore(g: CanvasRenderingContext2D, geo: Beam, col: number[], ampl: number): void {
    g.save()
    g.globalCompositeOperation = 'screen'
    if (BEAM_BLUR > 0) g.filter = `blur(${BEAM_BLUR}px)` // ビーム全体をやわらかくぼかす（線/照明のぼやけ）
    const NL = 12
    for (let k = 0; k < NL; k++) {
      const u = k / (NL - 1)
      const wf = 1 - u * 0.62
      const lf = 0.7 + 0.3 * Math.pow(u, 1.4)
      const L = geo.len * lf
      const gr = g.createLinearGradient(0, geo.y, 0, geo.y - L)
      for (let s = 0; s <= 28; s++) {
        const t = s / 28
        // 落ち込み: 光源(t=0)で最大、先(t=1)で0。指数 this.falloffPow で強さを切替（プリセット
        // ソフト1.5 / 標準2.5 / きつめ4）。大きいほど手前が明るく先がかなり暗いメリハリ。
        // ＋出口付近(t<0.3)をちょっとだけ強く（BEAM_ROOT_BOOST）。
        const boost = 1 + BEAM_ROOT_BOOST * Math.max(0, 1 - t / 0.3)
        const v = Math.pow(1 - t, this.falloffPow) * boost
        gr.addColorStop(t, rgs(col, v))
      }
      g.fillStyle = gr
      g.globalAlpha = ampl / NL
      this.trap(g, geo, wf, geo.y, geo.y - L)
      g.fill()
    }
    g.filter = 'none'
    g.globalAlpha = 1
    g.restore()
  }
  private withTilt(g: CanvasRenderingContext2D, b: Beam, deg: number, fn: () => void): void {
    if (!deg) {
      fn()
      return
    }
    g.save()
    g.translate(b.x, b.y)
    g.rotate((deg * Math.PI) / 180)
    g.translate(-b.x, -b.y)
    fn()
    g.restore()
  }
  private drawWallBeam(g: CanvasRenderingContext2D, b: Beam, I: number, T: number): void {
    const phi = ((b.pan || 0) * Math.PI) / 180
    const wallK = Math.pow(Math.max(0, Math.cos(phi)), (b.pan || 0) < 0 ? 3.2 : 1.8)
    if (I <= 0.004 || wallK <= 0.004) return
    const col = this.beamColOf(b, I).map((v) => v * wallK)
    const drive = I > 0.55 ? (I - 0.55) / 0.45 : 0
    const z = (b.zoom || 1) * (b._zp || 1)
    // リアル化チューニング（後で値を追い込む）：
    //  出口(w0)は最小値を保証して“線”にならないように、先端(w1)は必ず出口より広い円すいに。
    const w0e = b.w0 // 出口は素の太さ（“出口幅”の特別扱いはやめ、ぼやけ＝blur で柔らかくする）
    const w1e = Math.max(b.w1 * z, w0e * BEAM_SPREAD_MIN)
    const geo: Beam = { ...b, w0: w0e, w1: w1e }
    this.withTilt(g, b, T, () => {
      this.drawBeamCore(g, geo, col, 2.0 * (1 + 0.55 * drive))
      this.drawContactHot(g, geo, I, col, b.w0) // 焼け＋にじみ（サイズは元の太さ基準＝据え置き）
      if (drive > 0) {
        g.save()
        g.globalCompositeOperation = 'screen'
        const hL = geo.len * 0.2
        const gr2 = g.createLinearGradient(0, geo.y, 0, geo.y - hL)
        gr2.addColorStop(0, rgs(col, 0.6 * drive))
        gr2.addColorStop(1, rgs(col, 0))
        g.fillStyle = gr2
        this.trap(g, geo, 0.9, geo.y, geo.y - hL)
        g.fill()
        g.restore()
      }
    })
  }
  /** フロント灯体：前から当たる丸い光（プール）を光マップに描く。中心はサーチで (dx,dy) ずれる。
   *  ふち(frontEdge)はグラデの stop で表現（灯体ごとの blur は禁止＝激重。やわらかさは全画面 BEAM_SOFT に集約）。 */
  private drawFrontPool(g: CanvasRenderingContext2D, b: Beam, I: number, ms: number): void {
    if (I <= 0.004) return
    const col = this.beamColOf(b, I) // b._cn を反映した色×明るさ
    const R = (b.motifDiam ?? 220) / 2
    if (R <= 0) return
    const [dx, dy] = frontSearch(b.frontPat ?? 'off', b.frontSpd ?? 0.1, b.frontAmp ?? 0, b.sp, ms)
    const cx = b.x + dx
    const cy = b.y + dy
    const edge = Math.max(0, Math.min(1, b.frontEdge ?? 0.5))
    const p = 0.85 * (1 - edge) // ふちが効くほど中心の塗りプラトーが小さく＝外へなだらかに
    g.save()
    g.globalCompositeOperation = 'screen' // 加算でなく screen＝重なっても白飛びしすぎない（ビームと同じ流儀）
    const gr = g.createRadialGradient(cx, cy, 1, cx, cy, R)
    gr.addColorStop(0, rgs(col, 1))
    if (p > 0.001) gr.addColorStop(p, rgs(col, 1))
    gr.addColorStop((p + 1) / 2, rgs(col, 0.4))
    gr.addColorStop(1, rgs(col, 0))
    g.fillStyle = gr
    g.beginPath()
    g.arc(cx, cy, R, 0, Math.PI * 2)
    g.fill()
    g.restore()
  }
  /** セット接触面（根元）の焼け＝白飛びホットスポット＋出口の際のにじみ。screen 合成。 */
  private drawContactHot(
    g: CanvasRenderingContext2D,
    geo: Beam,
    I: number,
    col: number[],
    burnW: number
  ): void {
    if (I <= 0.02) return
    const cx = geo.x
    const cy = geo.y
    const w0 = burnW / 2 // 焼け/にじみのサイズは元の太さ基準（出口を細くしても焼けは縮めない）
    g.save()
    g.globalCompositeOperation = 'screen'
    // 出ている方向（上）だけに焼け/にじみを出す。根元より手前(下)へは広げない＝放射状の不自然さを消す。
    g.beginPath()
    g.rect(cx - 4000, cy - 4000, 8000, 4000) // y ≤ cy（光が進む側）だけ描く
    g.clip()
    // にじみ：根元のすぐ際に色つきのソフトな横広がり
    if (CONTACT_NIJIMI > 0) {
      const nR = w0 * 2.4
      const ng = g.createRadialGradient(cx, cy - w0 * 0.3, 1, cx, cy - w0 * 0.3, nR)
      ng.addColorStop(0, rgs(col, CONTACT_NIJIMI * I))
      ng.addColorStop(1, rgs(col, 0))
      g.fillStyle = ng
      g.beginPath()
      g.ellipse(cx, cy - w0 * 0.3, nR, nR * 0.78, 0, 0, Math.PI * 2)
      g.fill()
    }
    // 焼け：接触面の白飛びの芯。白い焼けは「明るい時だけ」出す——暗いゲージ(CONTACT_HOT_FROM未満)では
    // 0にして、暗いのに根元が白く焼ける不自然さを消す。二乗で立ち上がりを遅くし、低～中ゲージでは控えめ。
    const hot = Math.max(0, (I - CONTACT_HOT_FROM) / (1 - CONTACT_HOT_FROM))
    const wv = hot * hot * CONTACT_HOT
    if (CONTACT_HOT > 0 && wv > 0.004) {
      const hR = w0 * 1.5
      const hg = g.createRadialGradient(cx, cy, 1, cx, cy, hR)
      hg.addColorStop(0, `rgba(255,255,255,${(0.95 * wv).toFixed(3)})`)
      hg.addColorStop(0.45, `rgba(255,250,238,${(0.45 * wv).toFixed(3)})`)
      hg.addColorStop(1, 'rgba(255,245,225,0)')
      g.fillStyle = hg
      g.beginPath()
      g.arc(cx, cy, hR, 0, Math.PI * 2)
      g.fill()
    }
    g.restore()
  }
  private drawAirBeam(g: CanvasRenderingContext2D, b: Beam, I: number, T: number): void {
    const phi = ((b.pan || 0) * Math.PI) / 180
    const c = Math.cos(phi)
    const airK = (b.pan || 0) < 0 ? Math.pow(Math.max(0, c), 2.5) : 0.8 + 0.2 * c
    if (I <= 0.004 || airK <= 0.004) return
    const col = this.beamColOf(b, I).map((v) => v * airK)
    const z = (b.zoom || 1) * (b._zp || 1)
    const geo: Beam = {
      ...b,
      w1: b.w1 * z * (1 + 0.4 * (1 - Math.abs(c))),
      len: Math.max(b.len * 0.1, b.len * Math.abs(c))
    }
    this.withTilt(g, b, T, () => this.drawBeamCore(g, geo, col, 2.0))
  }

  // ---------- モチーフ描画 ----------
  private imageCache = new Map<string, HTMLImageElement>() // 画像灯体のデコード済み画像
  /** 画像灯体の画像をデコード&キャッシュ（dataURL→Image）。未ロードでもImageを返す。 */
  private imageFor(src: string): HTMLImageElement {
    let img = this.imageCache.get(src)
    if (!img) {
      img = new Image()
      img.onload = (): void => this.bump(false) // 読めたら再描画
      img.src = src
      this.imageCache.set(src, img)
    }
    return img
  }
  private drawMotifLit(g: CanvasRenderingContext2D, b: Beam, I: number, ms: number): void {
    const c = b._cn ?? b.color
    const d = b.motifDiam ?? 200
    // 一灯街灯：本体は「フル明るさで描いて光マップと掛け算」＝当たっている部分だけが・当たった
    // 方向から浮かぶ（一様に全身が光る嘘をやめる 2026-07-02）。読み戻し(getImageData)不要で軽い。
    if (b.motif === 'streetlamp1') {
      const rgb1: RGB3 = [c[0] * I, c[1] * I, c[2] * I]
      // 接地影（照らされた床でだけ見える・黒地では消える）
      drawStreetLamp1Shadow(g, b.x, b.y, d)
      // 本体：スクラッチに フル明るさで描く → 光マップを乗算 → 本体の形で切り抜き → フレームへ
      const x0 = Math.floor(Math.max(0, (b.x - d * 0.15) * Q))
      const x1 = Math.ceil(Math.min(IW, (b.x + d * 0.15) * Q))
      const y0 = Math.floor(Math.max(0, (b.y - d * 0.16) * Q))
      const y1 = Math.ceil(Math.min(IH, (b.y + d * 0.92) * Q))
      if (x1 > x0 && y1 > y0) {
        const g2 = this.lamp1Cv.getContext('2d')!
        g2.save()
        g2.setTransform(1, 0, 0, 1, 0, 0)
        g2.clearRect(x0, y0, x1 - x0, y1 - y0)
        g2.beginPath()
        g2.rect(x0, y0, x1 - x0, y1 - y0)
        g2.clip() // 以降の乗算をこの灯体の範囲だけに限定
        g2.setTransform(Q, 0, 0, Q, 0, 0)
        g2.globalCompositeOperation = 'source-over'
        drawStreetLamp1Body(g2, b.x, b.y, d)
        g2.setTransform(1, 0, 0, 1, 0, 0)
        g2.globalCompositeOperation = 'multiply' // 本体 × 当たっている光（方向・ムラがそのまま出る）
        g2.drawImage(this.lightCv, 0, 0)
        g2.globalCompositeOperation = 'destination-in' // 本体の形だけ残す（乗算で不透明化した余白を消す）
        g2.setTransform(Q, 0, 0, Q, 0, 0)
        drawStreetLamp1Body(g2, b.x, b.y, d)
        g2.restore()
        // フレームへ（g の transform はステージ座標系＝編集/出力どちらでも正しく写る）
        const sx = x0 / Q, sy = y0 / Q, sw = (x1 - x0) / Q, sh = (y1 - y0) / Q
        g.drawImage(this.lamp1Cv, x0, y0, x1 - x0, y1 - y0, sx, sy, sw, sh)
        // 明るさ補正: 乗算そのままだと旧仕様(光65%で全開)より暗いので、少しだけ足して合わせる
        g.save()
        g.globalCompositeOperation = 'lighter'
        g.globalAlpha = 0.55
        g.drawImage(this.lamp1Cv, x0, y0, x1 - x0, y1 - y0, sx, sy, sw, sh)
        g.restore()
      }
      // ランタンの灯り（自分の1ch・加算）
      drawStreetLamp1Glow(g, b.x, b.y, d, rgb1)
      return
    }
    if (I <= 0.004) return
    const rgb: RGB3 = [c[0] * I, c[1] * I, c[2] * I]
    if (b.motif === 'streetlamp') {
      drawStreetLampLit(g, b.x, b.y, d, rgb)
    } else if (b.motif === 'chandelier') {
      drawChandelierLit(g, b.x, b.y, d, rgb)
    } else if (b.motif === 'image') {
      // リアルな発光画像を「明るさだけ」で光らせる：加算合成で黒は出ず、明るい所が I 分だけ光る。
      const img = b.imageSrc ? this.imageFor(b.imageSrc) : null
      if (img && img.complete && img.naturalWidth > 0) {
        const w = d
        const h = d * (img.naturalHeight / img.naturalWidth)
        g.save()
        g.globalCompositeOperation = 'lighter'
        g.globalAlpha = Math.min(1, I)
        g.drawImage(img, b.x - w / 2, b.y - h / 2, w, h)
        g.restore()
      }
    } else if (b.motif === 'marquee') {
      const shape = {
        points: [{ x: b.x, y: b.y }],
        text: b.motifText ?? 'LIVE',
        fontSize: b.motifDiam ?? 200,
        letterColors: b.motifLetterColors
      } as unknown as Shape
      const n = marqueeBulbCount(shape)
      if (n <= 0) return
      const speed = b.motifSpeed ?? 8
      const raw = ((ms / 1000) * speed) % n
      const head = b.motifReverse ? (n - raw) % n : raw
      const win = Math.max(2, n * 0.25)
      drawMarqueeLit(g, shape, (i) => {
        const dist = (i - head + n) % n
        return Math.max(0, 1 - dist / win) * I
      })
    } else if (b.motif === 'bulb') {
      drawBulbLit(g, b.x, b.y, d, rgb, 'clear')
    } else if (b.motif === 'parlight') {
      drawParLit(g, b.x, b.y, d, rgb)
    } else if (b.motif === 'patt') {
      drawPattLit(g, b.x, b.y, d, rgb)
    } else if (b.motif === 'blinder') {
      const shape = { points: [{ x: b.x, y: b.y }], diameter: d } as unknown as Shape
      for (let i = 0; i < 8; i++) drawBlinderCellLit(g, shape, rgb, i)
      drawBlinderHousing(g, shape, Array(8).fill(rgb))
    } else if (b.motif === 'pixelpatt') {
      const shape = { points: [{ x: b.x, y: b.y }], diameter: d } as unknown as Shape
      for (let i = 0; i < 7; i++) drawPixelPattCellLit(g, shape, rgb, i)
      drawPixelPattFrame(g, shape, Array(7).fill(rgb))
    } else if (b.motif === 'stars') {
      // 星空: d×d の箱に散布。points[0]/[末尾]が箱の対角（render/stars の starBox 仕様）。
      const shape = {
        points: [
          { x: b.x - d / 2, y: b.y - d / 2 },
          { x: b.x + d / 2, y: b.y + d / 2 }
        ],
        starSeed: b.motifSeed ?? 1
      } as unknown as Shape
      drawStarsLit(g, shape, rgb, 0, ms) // 白い星
      drawStarsLit(g, shape, rgb, 1, ms) // 青い星
    } else if (b.motif === 'festoon') {
      // 垂れ幕（連なって垂れる電飾）: 幅 d の水平ワイヤが自重で垂れ、電球が並ぶ。
      const shape = { points: [{ x: b.x - d / 2, y: b.y }, { x: b.x + d / 2, y: b.y }] } as unknown as Shape
      const n = festoonBulbs(shape).length
      if (n <= 0) return
      const rgbs = Array(n).fill(rgb)
      drawFestoonWireLit(g, shape, rgbs)
      for (let i = 0; i < n; i++) drawFestoonBulbLit(g, shape, rgb, i)
    }
  }

  // ---------- フレーム描画 ----------
  /** frame キャンバスに1フレーム描く（マーカー無し）。React の30fpsループから呼ぶ。 */
  // ---------- DMX駆動（照明モード）：dmxパッチされた灯体だけ外部卓(Art-Net)が支配 ----------
  private dmxFrame: Record<number, Uint8Array> | null = null
  private dmxGamma = false
  /** いずれかの灯体に dmx パッチがあるか（再描画ゲート判定に使う）。 */
  hasDmxPatched(): boolean {
    return this.beams.some((b) => !!b.dmx)
  }
  /** 今フレームの Art-Net（signal-loss/Hold 処理済み）を渡す。renderFrame の頭で適用。 */
  setDmxFrame(eff: Record<number, Uint8Array>, gamma: boolean): void {
    this.dmxFrame = eff
    this.dmxGamma = gamma
  }
  /** パッチ灯体に卓の値を直書き（色=色相, gauge=明るさ×Shutter, pan/tilt/zoom）。setter は
   *  通さない（毎フレーム pushHistory＝undo爆発・選択干渉を避ける）。未パッチ灯体は触らない
   *  ＝従来どおりアプリ内/MIDIで操作。電飾モードと同じ dmx/channel-math を流用。 */
  private applyDmx(eff: Record<number, Uint8Array>, gamma: boolean, nowMs = 0): void {
    for (const b of this.beams) {
      const p = b.dmx
      if (!p) continue
      const data = eff[p.universe] ?? DMX_ZERO512
      const fx: Fixture = {
        id: '',
        shapeId: '',
        universe: p.universe,
        start: p.start,
        mode: p.mode,
        addressStep: p.addressStep,
        fixedColor: p.fixedColor
      }
      const pose = beamPose(fx, data)
      const col = fixtureColor(fx, data, gamma)
      const m = Math.max(col[0], col[1], col[2]) / 255 // 明るさ
      const hue: RGB3 =
        m > 0.004 ? [col[0] / m, col[1] / m, col[2] / m] : [col[0], col[1], col[2]]
      const gate = p.mode === 'beam8' || p.mode === 'beam9' ? shutterGate(fx, data, nowMs) : 1
      // PTZ チャンネルを持つモード(beam6/beam8)だけ向き/ズームを上書き。
      // rgb/dim 等の非ビームモードでは beamPose が 0 を返すため、上書きすると
      // 仕込んだ pan/tilt/zoom が毎フレーム home に潰れる＝配置データ事故になる。
      if (p.mode === 'beam6' || p.mode === 'beam8' || p.mode === 'beam9') {
        b.pan = pose.pan * 90 // ±90°
        b.tilt = pose.tilt * 180 // ±180°
        b.zoom = pose.zoom >= 0 ? 1 + pose.zoom * 3 : 1 + pose.zoom * 0.85 // 128=×1 / 全開×4 / 全閉×0.15
      }
      b.color = hue
      b.gauge = m * gate
    }
  }

  renderFrame(now = performance.now()): void {
    if (this.dmxFrame) this.applyDmx(this.dmxFrame, this.dmxGamma, now) // 卓(DMX)支配の灯体に先に焼く
    this.updateVideoFrame() // 動画シーンなら mat を今のコマへ
    const ms = now - this.t0
    const decorT = this.decorTime(now) // 電飾チェイス用の時計（playing 中だけ進む・1フレーム1回）
    const QW = IW
    const QH = IH
    const beams = this.beams
    // モチーフ順位を1パスで先計算（effI 内の 0..i 走査＝O(n^2) を O(n) に）
    const mr = this.motifRankCache
    mr.length = beams.length
    for (let k = 0, rc = 0; k < beams.length; k++) {
      mr[k] = rc
      if (beams[k].motif) rc++
    }
    const Is = beams.map((b, i) => this.effI(b, i, ms))
    const maxI = Is.length ? Math.max(...Is) : 0
    let maxNonMotifI = 0
    for (let i = 0; i < beams.length; i++) {
      if (!beams[i].motif && Is[i] > maxNonMotifI) maxNonMotifI = Is[i]
    }
    const lc = this.lc
    const wc = this.wc
    const fc = this.fc
    // 特効: ステップシーケンサーを進める（再生中だけ。点くマークの集合を今ステップに切替）
    this.tickSfxSeq(now)
    // 特効: 炎も火花と同じく「置いて点いていれば出続ける」。点灯中の炎マークを毎フレーム持続。
    // （単発バースト=手で発射、チェイスは追加で乗る。OFF=炎マーク0個なら何も触らない）
    if (this.flameEnabled) {
      this.flame.setSustain(this.sfxChaseActive(this.flamePoints, now)) // 発射パターン(全部/内→外/外→内/ランダム)で点を絞る
      this.flame.tick(now)
    }
    const flameLit = this.flameEnabled && this.flame.active
    // 特効: 火花フォンテンは点灯中の点から連続噴出（OFF時は一切触らない）
    if (this.sparklerEnabled) {
      this.sparkler.setActive(this.sfxChaseActive(this.sparklerPoints, now))
      this.sparkler.tick(now)
    }
    const sparklerLit = this.sparklerEnabled && this.sparkler.active
    // 特効: 受け系(雨/雪・ロースモーク)を1フレーム進める（OFF時は触らない）。
    // 描画は光マップ確定後に「matter×光マップ」で前面合成する（照明が当たった所だけ光る）。
    if (this.rain.active) this.rain.tick(now)
    if (this.lowSmoke.active) this.lowSmoke.tick(now)
    const rainLit = this.rain.active
    const smokeLit = this.lowSmoke.active

    // ---- 光マップ
    lc.setTransform(1, 0, 0, 1, 0, 0)
    lc.clearRect(0, 0, QW, QH)
    lc.fillStyle = '#000'
    lc.fillRect(0, 0, QW, QH)
    if (maxI > 0.004) {
      beams.forEach((b, i) => {
        b._cn = this.colorNow(b, i, ms)
        if (!b.motif) {
          b._tn = this.tiltNow(b, ms)
          b._zp = this.st.zoompulse ? zoomPulseK(this.fxp.zoompulse, ms) : 1
        }
      })
      lc.setTransform(Q, 0, 0, Q, 0, 0)
      beams.forEach((b, i) => {
        if (b.front) this.drawFrontPool(lc, b, Is[i], ms)
        else if (!b.motif) this.drawWallBeam(lc, b, Is[i], b._tn!)
      })
      lc.setTransform(1, 0, 0, 1, 0, 0)
      // 縞退治のブラー書き戻し
      const sc = this.smoothCv.getContext('2d')!
      sc.clearRect(0, 0, QW, QH)
      sc.filter = `blur(${BEAM_SOFT * Q}px)`
      sc.drawImage(this.lightCv, 0, 0)
      sc.filter = 'none'
      lc.clearRect(0, 0, QW, QH)
      lc.fillStyle = '#000'
      lc.fillRect(0, 0, QW, QH)
      lc.drawImage(this.smoothCv, 0, 0)
      // ノイズは「光があるところだけ」（無灯部の底上げ禁止）
      const nmc = this.noiseCv.getContext('2d')!
      nmc.globalCompositeOperation = 'source-over'
      const pat = this.noisePattern ?? (this.noisePattern = nmc.createPattern(this.noiseTile, 'repeat'))
      if (pat) {
        nmc.fillStyle = pat
        nmc.fillRect(0, 0, QW, QH)
        nmc.globalCompositeOperation = 'multiply'
        nmc.drawImage(this.lightCv, 0, 0)
        lc.save()
        lc.globalCompositeOperation = 'lighter'
        lc.globalAlpha = 0.07
        lc.drawImage(this.noiseCv, 0, 0)
        lc.restore()
      }
    }

    // 特効: 炎の灯り(glow)を光マップに足す → 下のセット(写真)が炎で照らされる(既存の写真×光に乗る)
    if (flameLit) {
      lc.setTransform(1, 0, 0, 1, 0, 0)
      lc.globalCompositeOperation = 'lighter'
      lc.globalAlpha = 1
      lc.drawImage(this.flame.glow, 0, 0, this.flame.glow.width, this.flame.glow.height, 0, 0, QW, QH)
      lc.globalCompositeOperation = 'source-over'
    }
    // 特効: 火花の灯り(glow)を光マップに足す → セット(写真)が火花で照らされる
    if (sparklerLit) {
      lc.setTransform(1, 0, 0, 1, 0, 0)
      lc.globalCompositeOperation = 'lighter'
      lc.globalAlpha = 1
      lc.drawImage(this.sparkler.glow, 0, 0, this.sparkler.glow.width, this.sparkler.glow.height, 0, 0, QW, QH)
      lc.globalCompositeOperation = 'source-over'
    }

    // ---- 写真 × 光（座組の最大ゲージで露出が決まる＝出荷仕様）
    wc.setTransform(1, 0, 0, 1, 0, 0)
    wc.clearRect(0, 0, QW, QH)
    if ((maxI > 0.004 || flameLit || sparklerLit) && this.mat && this.box) {
      const b = this.box
      const tone = Math.max(0, (0.5 - maxI) / 0.5) * 0.85
      // ベース明るさ: 光マップ全体を screen で底上げ（暗部だけ持ち上がり、明部はほぼ不変）。
      // maxI に比例させる＝暗転・パニックでは効かずちゃんと真っ黒になる。
      const liftEff = this.baseLift * Math.min(1, maxI / 0.2)
      if (liftEff > 0.002) {
        const gLift = Math.round(liftEff * 255)
        lc.globalCompositeOperation = 'screen'
        lc.fillStyle = `rgb(${gLift},${gLift},${gLift})`
        lc.fillRect(0, 0, QW, QH)
        lc.globalCompositeOperation = 'source-over'
      }
      wc.setTransform(Q, 0, 0, Q, 0, 0)
      wc.globalCompositeOperation = 'source-over'
      wc.drawImage(this.mat, b.x, b.y, b.w, b.h) // アルベド
      wc.setTransform(1, 0, 0, 1, 0, 0)
      if (PHOTO_TONE === 'ratio') {
        const rx = Math.max(0, Math.floor(b.x * Q))
        const ry = Math.max(0, Math.floor(b.y * Q))
        const rw = Math.min(QW - rx, Math.ceil((b.x + b.w) * Q) - rx)
        const rh = Math.min(QH - ry, Math.ceil((b.y + b.h) * Q) - ry)
        if (rw > 0 && rh > 0) {
          const albedoPix = wc.getImageData(rx, ry, rw, rh)
          const lightPix = lc.getImageData(rx, ry, rw, rh)
          composeColorRatio(albedoPix.data, lightPix.data, albedoPix.data, tone)
          wc.putImageData(albedoPix, rx, ry)
        }
      } else {
        wc.globalCompositeOperation = 'multiply'
        wc.drawImage(this.lightCv, 0, 0)
        if (tone > 0.01) {
          wc.globalAlpha = tone
          wc.drawImage(this.lightCv, 0, 0)
          wc.globalAlpha = 1
        }
        // 色ノリ: 掛け算だけだと「青い光×茶色いセット≒真っ黒」で色が乗らないので、
        // 光の色そのものを screen で薄く重ねる（0=従来）。この後の destination-in で写真の形にクリップされる。
        if (this.colorWash > 0.002) {
          wc.globalCompositeOperation = 'screen'
          wc.globalAlpha = this.colorWash
          wc.drawImage(this.lightCv, 0, 0)
          wc.globalAlpha = 1
        }
        // 方向の立体(AIなし深度): 写真の明るさエンボスを soft-light で重ねる（写真の形でこの後クリップ）。
        const lrel = this.activeScene >= 0 ? this.scenes[this.activeScene]?.lumRelief : null
        if (lrel && this.lumReliefStrength > 0) {
          wc.setTransform(Q, 0, 0, Q, 0, 0)
          wc.globalCompositeOperation = 'soft-light'
          wc.globalAlpha = this.lumReliefStrength
          wc.drawImage(lrel, b.x, b.y, b.w, b.h)
          wc.globalAlpha = 1
          wc.setTransform(1, 0, 0, 1, 0, 0)
        }
        wc.setTransform(Q, 0, 0, Q, 0, 0)
        wc.globalCompositeOperation = 'destination-in'
        wc.drawImage(this.mat, b.x, b.y, b.w, b.h)
        wc.setTransform(1, 0, 0, 1, 0, 0)
        wc.globalCompositeOperation = 'source-over'
      }
    }

    // ---- フレーム合成
    fc.setTransform(1, 0, 0, 1, 0, 0)
    fc.clearRect(0, 0, QW, QH)
    fc.globalCompositeOperation = 'source-over'
    // 光だけ出力モードは編集画面も写真なしで光マップを表示（プレビュー）
    if (this.lightOnly) {
      fc.drawImage(this.lightCv, 0, 0)
    } else {
      fc.drawImage(this.workCv, 0, 0)
    }
    // ピース（写真の一部を切り抜いて 4 隅コーナーピンで貼る）を最終フレームに重ねる。
    // ピースが存在する場合のみ workCv を中間バッファとして再利用し照明を掛けて fc に乗せる。
    // ピースが無い場合はこのブロック全体をスキップする（透明 wc を fc に重ねると写真が消えるため）。
    const activeSceneForPieces = this.activeScene >= 0 ? this.scenes[this.activeScene] : null
    if (activeSceneForPieces?.pieces?.length && activeSceneForPieces.mat) {
      wc.setTransform(1, 0, 0, 1, 0, 0)
      wc.clearRect(0, 0, QW, QH)
      wc.globalCompositeOperation = 'source-over'
      this.drawPiecesOnFrame(wc)
      if (maxI > 0.004) {
        wc.setTransform(1, 0, 0, 1, 0, 0)
        wc.globalCompositeOperation = 'multiply'
        wc.drawImage(this.lightCv, 0, 0)
        wc.globalCompositeOperation = 'source-over'
      }
      fc.setTransform(1, 0, 0, 1, 0, 0)
      fc.globalCompositeOperation = 'source-over'
      fc.drawImage(this.workCv, 0, 0)
    }
    // モチーフ描画（街灯・シャンデリア・マーキー等）
    fc.setTransform(Q, 0, 0, Q, 0, 0)
    beams.forEach((b, i) => {
      if (b.motif) this.drawMotifLit(fc, b, Is[i], ms)
    })
    fc.setTransform(1, 0, 0, 1, 0, 0)
    fc.globalCompositeOperation = 'source-over'
    const airA = (this.st.smoke / 30) * 0.42
    if (maxI > 0.004 && airA > 0.01 && this.mat && this.box) {
      const ac = this.ac
      const b = this.box
      ac.setTransform(1, 0, 0, 1, 0, 0)
      ac.clearRect(0, 0, QW, QH)
      ac.globalCompositeOperation = 'source-over'
      ac.setTransform(Q, 0, 0, Q, 0, 0)
      beams.forEach((bm, i) => {
        if (!bm.motif && !bm.front) this.drawAirBeam(ac, bm, Is[i], bm._tn ?? this.tiltNow(bm, ms))
      })
      ac.globalCompositeOperation = 'destination-out'
      ac.drawImage(this.mat, b.x, b.y, b.w, b.h)
      ac.setTransform(1, 0, 0, 1, 0, 0)
      ac.globalCompositeOperation = 'source-over'
      fc.globalCompositeOperation = 'lighter'
      fc.globalAlpha = airA
      fc.drawImage(this.airCv, 0, 0)
      fc.globalAlpha = 1
      fc.globalCompositeOperation = 'source-over'
    }
    if (this.st.smoke > 0 && maxI > 0.004) {
      // ブルームは半解像度で計算（重いblurを約1/4のコストに・ソフトな光なので見た目ほぼ同じ）
      const hw = QW >> 1
      const hh = QH >> 1
      const bc = this.smoothCv.getContext('2d')! // 兼用バッファ
      bc.setTransform(1, 0, 0, 1, 0, 0)
      bc.globalCompositeOperation = 'source-over'
      bc.clearRect(0, 0, hw, hh)
      bc.filter = `blur(${this.st.smoke * 0.9 * Q * 0.5}px)`
      bc.drawImage(this.frame, 0, 0, QW, QH, 0, 0, hw, hh) // フレームを半分へ縮小
      bc.filter = 'none'
      fc.globalCompositeOperation = 'lighter'
      fc.drawImage(this.smoothCv, 0, 0, hw, hh, 0, 0, QW, QH) // 半分を拡大して加算
      fc.globalCompositeOperation = 'source-over'
    }

    // 電飾パターン（簡単スケッチ・卓なし）を frame に発光合成。写真の上に光が乗る。
    if (this.decor.enabled && this.decorSegs && this.decorSegs.length) {
      const boxLW = this.getMaskBoxLW()
      if (boxLW) {
        fc.setTransform(Q, 0, 0, Q, 0, 0)
        this.drawDecorLeds(fc, boxLW, decorT)
        fc.setTransform(1, 0, 0, 1, 0, 0)
        fc.globalCompositeOperation = 'source-over'
        fc.globalAlpha = 1
      }
    }

    // 特効(受け系): ロースモーク→雨/雪 を「matter×光マップ」で前面に加算（照明が当たった所だけ光る）。
    // 光が無ければ matter×光=黒＝何も足さない。煙(床)が奥、雨/雪が手前。炎/火花本体より後ろ。
    const lightPresent = maxI > 0.004 || flameLit || sparklerLit
    if (smokeLit && lightPresent) {
      this.buildVolumetric(this.lowSmoke.matter, QW, QH)
      this.drawVolumetricFront(fc, 1)
    }
    if (rainLit && lightPresent) {
      this.buildVolumetric(this.rain.matter, QW, QH)
      this.drawVolumetricFront(fc, 1)
    }

    // 特効: 炎本体を最前面に重ねる（前面レイヤー＝写真/光/モチーフ/電飾の上）
    if (flameLit) {
      fc.setTransform(1, 0, 0, 1, 0, 0)
      // source-over: 芯が不透明で背景を隠す＝前面にある炎。加算(lighter)だと透けて浮く
      fc.globalCompositeOperation = 'source-over'
      fc.globalAlpha = 1
      fc.drawImage(this.flame.body, 0, 0, this.flame.body.width, this.flame.body.height, 0, 0, QW, QH)
      fc.globalCompositeOperation = 'source-over'
    }
    // 特効: 火花本体を最前面に重ねる
    if (sparklerLit) {
      fc.setTransform(1, 0, 0, 1, 0, 0)
      fc.globalCompositeOperation = 'source-over'
      fc.globalAlpha = 1
      fc.drawImage(this.sparkler.body, 0, 0, this.sparkler.body.width, this.sparkler.body.height, 0, 0, QW, QH)
      fc.globalCompositeOperation = 'source-over'
    }

    // 立体強調: 編集フレームの仕上げ（もとの陰影を濃くして立体を呼び戻す・relief=0なら無処理）
    this.reliefPass(this.frame, this.fc, this.reliefCv, QW, QH)

    // ---- Syphon出力: 写真の部分だけを写真の解像度で（余白なし・写真フル解像度）
    this.composeOutput(maxI)
    // 出力(outCv)にもモチーフを乗せる＝編集画面と同じ絵を Resolume へ送る
    // （composeOutput は写真＋光だけ。モチーフはここで box→出力の写像で重ねる）。
    this.drawMotifsOnOutput(beams, Is, ms)
    // 出力にも電飾パターンを重ねる（編集画面と同じ絵を Arena へ）。
    this.drawDecorOnOutput(decorT)
    // 特効(受け系): 出力にも雨/雪・煙を「matter×光マップ」で重ねる（炎/火花本体より後ろ＝奥）。
    if (smokeLit && lightPresent) {
      this.buildVolumetric(this.lowSmoke.matter, QW, QH)
      this.drawVolumetricOnOutput(1)
    }
    if (rainLit && lightPresent) {
      this.buildVolumetric(this.rain.matter, QW, QH)
      this.drawVolumetricOnOutput(1)
    }
    // 特効: 出力にも炎本体を重ねる（glowは光マップ経由でcomposeOutputに既に反映済み）
    if (flameLit) this.drawFlameOnOutput()
    if (sparklerLit) this.drawSparklerOnOutput()

    // 立体強調: 出力(Syphon/NDI)も編集画面と同じ仕上げにする（relief=0なら無処理）
    if (this.relief > 0 && this.outW > 16) {
      const oc2 = this.outCv.getContext('2d', { willReadFrequently: true })!
      this.reliefPass(this.outCv, oc2, this.reliefOutCv, this.outW, this.outH)
    }
  }

  /** 出力(outCv)にモチーフを重ねる。outCv は box 領域を出力解像度に伸ばしたものなので、
   *  ステージ座標(LW×LH) → 出力座標へ写像してから drawMotifLit を呼ぶ（位置・大きさが
   *  写真上の見え方と一致）。空シーンは warpBox=全ステージなので全モチーフが入る。 */
  private drawMotifsOnOutput(beams: Beam[], Is: number[], ms: number): void {
    if (this.lightOnly || !this.box || this.outW <= 16) return
    if (!beams.some((b) => b.motif)) return
    const oc = this.outCv.getContext('2d', { willReadFrequently: true })!
    const box = this.box
    const sx = this.outW / box.w
    const sy = this.outH / box.h
    oc.setTransform(sx, 0, 0, sy, -box.x * sx, -box.y * sy)
    oc.globalCompositeOperation = 'source-over'
    beams.forEach((b, i) => {
      if (b.motif) this.drawMotifLit(oc, b, Is[i], ms)
    })
    oc.setTransform(1, 0, 0, 1, 0, 0)
    oc.globalCompositeOperation = 'source-over'
  }

  /** 立体強調: 仕上がった絵(cv)のコントラストと彩度を上げ、もとの写真の陰影を濃くして立体を呼び戻す。
   *  元絵をスクラッチへコピー → contrast/saturate フィルタで描き戻す。relief=0 なら何もしない。 */
  private reliefPass(
    cv: HTMLCanvasElement,
    cx: CanvasRenderingContext2D,
    scratch: HTMLCanvasElement,
    w: number,
    h: number
  ): void {
    if (this.relief <= 0 || w <= 0 || h <= 0) return
    if (scratch.width !== w) scratch.width = w
    if (scratch.height !== h) scratch.height = h
    const sx = scratch.getContext('2d')!
    sx.setTransform(1, 0, 0, 1, 0, 0)
    sx.globalAlpha = 1
    sx.globalCompositeOperation = 'source-over'
    sx.filter = 'none'
    sx.clearRect(0, 0, w, h)
    sx.drawImage(cv, 0, 0, w, h)
    // 立体は「コントラスト（陰影の濃さ）」で出す。色（彩度）はわざと上げない＝照明の色が濃くなりすぎない。
    const c = 100 + this.relief * 55 // contrast 100→155%（控えめ・影を濃くハイライトを強く＝彫りが立つ）
    cx.setTransform(1, 0, 0, 1, 0, 0)
    cx.globalAlpha = 1
    cx.globalCompositeOperation = 'source-over'
    cx.clearRect(0, 0, w, h)
    cx.filter = `contrast(${c}%)`
    cx.drawImage(scratch, 0, 0, w, h)
    cx.filter = 'none'
  }

  /** 立体強調の強さを設定。0=今と完全一致。 */
  setRelief(v: number): void {
    this.relief = Math.max(0, Math.min(1, v))
    this.bump()
  }

  /** 方向の立体（AIなし深度）の強さを設定。0=なし。 */
  setLumRelief(v: number): void {
    this.lumReliefStrength = Math.max(0, Math.min(1, v))
    this.bump()
  }
  /** 色ノリ（光の色を写真にそのまま乗せる量）を設定。0=従来（掛け算のみ）。 */
  setColorWash(v: number): void {
    this.colorWash = Math.max(0, Math.min(0.4, v))
    this.bump()
  }
  /** ベース明るさ（暗部の底上げ）を設定。0=従来。明かりが点いている時だけ効く。 */
  setBaseLift(v: number): void {
    this.baseLift = Math.max(0, Math.min(0.3, v))
    this.bump()
  }

  /** 写真(mat)の明るさから方向つきエンボス(浮き彫り)マップを1回だけ作る。≤900px の縮小サイズで返す。
   *  合成側(composeWorkCanvas/composeOutput)の drawImage が描画先サイズへ毎回拡大するので、mat 同寸へ
   *  引き伸ばして保持する必要はない（見た目同一・保持メモリ約1/18＝OOM対策）。失敗時は null。 */
  private buildLumRelief(mat: HTMLCanvasElement): HTMLCanvasElement | null {
    try {
      if (mat.width <= 0 || mat.height <= 0) return null
      const dw = Math.min(900, mat.width) // 走査は縮小（速い・ノイズ低減）
      const dh = Math.max(1, Math.round((dw * mat.height) / mat.width))
      const sc = mk(dw, dh, true)
      const sctx = sc.getContext('2d', { willReadFrequently: true })
      if (!sctx) return null
      sctx.drawImage(mat, 0, 0, dw, dh)
      const src = sctx.getImageData(0, 0, dw, dh)
      const emb = embossFromLuminance(src.data, dw, dh, { dx: 1, dy: 1, gain: 2.4 })
      const id = new ImageData(dw, dh)
      id.data.set(emb)
      const small = mk(dw, dh)
      small.getContext('2d')!.putImageData(id, 0, 0)
      return small // 拡大は合成時に任せる（mat 同寸の重複バッファを持たない）
    } catch {
      return null
    }
  }

  /** 出力(outCv)を「写真の部分だけ・写真の解像度・余白なし」で合成する。写真(mat)はフル解像度、
   *  ソフトな光は lightCv の box 領域を引き伸ばす（写真だけシャープに保つ）。編集画面とは別物。 */
  private composeOutput(maxI: number): void {
    const OUT_CAP = this.outCap // 出力上限幅（可変：なめらか1920/バランス2560/高精細3840）
    const flameLit = (this.flameEnabled && this.flame.active) || (this.sparklerEnabled && this.sparkler.active) // 特効: 炎/火花だけでも出力する
    // 光だけ出力モード: 写真を使わず光マップ(lightCv)を出力。Arena側で 映像×光(Multiply)。
    // 出力サイズも光の枠取りも「写真モードと完全に同じ」にする（写真を描かない・切り抜かない
    // だけの違い）。これで光だけに切り替えても解像度・位置が一切変わらず、Arena の映像×光が
    // ピッタリ重なる。チャート(mat)が無い時だけ光マップ素のサイズにフォールバック。
    if (this.lightOnly) {
      if (!this.mat || !this.box) {
        const ow = IW
        const oh = IH
        if (this.outCv.width !== ow) this.outCv.width = ow
        if (this.outCv.height !== oh) this.outCv.height = oh
        this.outW = ow
        this.outH = oh
        const oc = this.outCv.getContext('2d', { willReadFrequently: true })!
        oc.setTransform(1, 0, 0, 1, 0, 0)
        oc.globalCompositeOperation = 'source-over'
        oc.clearRect(0, 0, ow, oh)
        oc.drawImage(this.lightCv, 0, 0, ow, oh)
        return
      }
      const mw = this.mat.width
      const mh = this.mat.height
      const ow = Math.min(mw, OUT_CAP) // 写真モードと同一の出力サイズ
      const oh = Math.max(1, Math.round((mh * ow) / mw))
      if (this.outCv.width !== ow) this.outCv.width = ow
      if (this.outCv.height !== oh) this.outCv.height = oh
      this.outW = ow
      this.outH = oh
      const oc = this.outCv.getContext('2d', { willReadFrequently: true })!
      const lb = this.box
      const lbx = lb.x * Q
      const lby = lb.y * Q
      const lbw = lb.w * Q
      const lbh = lb.h * Q
      oc.setTransform(1, 0, 0, 1, 0, 0)
      oc.globalCompositeOperation = 'source-over'
      oc.clearRect(0, 0, ow, oh)
      oc.drawImage(this.lightCv, lbx, lby, lbw, lbh, 0, 0, ow, oh) // 光の box 領域→出力（写真モードと同じ枠取り）
      return
    }
    if (!this.mat || !this.box || (maxI <= 0.004 && !flameLit)) {
      // 写真無し or 無灯 → 透明な小フレーム（Add合成で何も乗らない）
      if (this.outCv.width !== 16) {
        this.outCv.width = 16
        this.outCv.height = 9
      }
      this.outW = this.outCv.width
      this.outH = this.outCv.height
      this.outCv.getContext('2d')!.clearRect(0, 0, this.outCv.width, this.outCv.height)
      return
    }
    const mw = this.mat.width
    const mh = this.mat.height
    const ow = Math.min(mw, OUT_CAP)
    const oh = Math.max(1, Math.round((mh * ow) / mw))
    if (this.outCv.width !== ow) this.outCv.width = ow
    if (this.outCv.height !== oh) this.outCv.height = oh
    this.outW = ow
    this.outH = oh
    const oc = this.outCv.getContext('2d', { willReadFrequently: true })!
    const tone = Math.max(0, (0.5 - maxI) / 0.5) * 0.85
    const b = this.box
    const bx = b.x * Q
    const by = b.y * Q
    const bw = b.w * Q
    const bh = b.h * Q
    oc.setTransform(1, 0, 0, 1, 0, 0)
    oc.globalCompositeOperation = 'source-over'
    oc.clearRect(0, 0, ow, oh)
    oc.drawImage(this.mat, 0, 0, ow, oh) // アルベド（写真フル解像度）
    oc.globalCompositeOperation = 'multiply'
    oc.drawImage(this.lightCv, bx, by, bw, bh, 0, 0, ow, oh) // 光（box領域→出力へ）
    if (tone > 0.01) {
      oc.globalAlpha = tone
      oc.drawImage(this.lightCv, bx, by, bw, bh, 0, 0, ow, oh)
      oc.globalAlpha = 1
    }
    // 色ノリ: 編集側(composeWorkCanvas)と同じ順序で出力にも適用。
    // これが無いと「編集では青が乗るのに本番出力(Syphon/NDI)では乗らない」＝会場で見た目が食い違う。
    if (this.colorWash > 0.002) {
      oc.globalCompositeOperation = 'screen'
      oc.globalAlpha = this.colorWash
      oc.drawImage(this.lightCv, bx, by, bw, bh, 0, 0, ow, oh)
      oc.globalAlpha = 1
    }
    // 方向の立体(AIなし深度): 出力(Syphon/NDI)にも mat 同寸でエンボスを soft-light で重ねる。
    const lrelO = this.activeScene >= 0 ? this.scenes[this.activeScene]?.lumRelief : null
    if (lrelO && this.lumReliefStrength > 0) {
      oc.globalCompositeOperation = 'soft-light'
      oc.globalAlpha = this.lumReliefStrength
      oc.drawImage(lrelO, 0, 0, ow, oh)
      oc.globalAlpha = 1
    }
    oc.globalCompositeOperation = 'destination-in'
    oc.drawImage(this.mat, 0, 0, ow, oh) // 写真の形に切り抜き
    oc.globalCompositeOperation = 'source-over'
    // ピース（切り抜き）を出力にも重ねる（編集画面 1688行付近と同じ手順・照明も同じく掛ける）。
    // これが無いと「編集では見えるのに本番出力(Syphon/NDI)に出ない」＝会場で見た目が食い違う。
    const scP = this.activeScene >= 0 ? this.scenes[this.activeScene] : null
    if (scP?.pieces?.length && scP.mat) {
      const pc = this.lamp1Cv.getContext('2d')! // 一時スクラッチとして再利用（使用前に全消去）
      pc.setTransform(1, 0, 0, 1, 0, 0)
      pc.globalCompositeOperation = 'source-over'
      pc.globalAlpha = 1
      pc.clearRect(0, 0, IW, IH)
      this.drawPiecesOnFrame(pc)
      if (maxI > 0.004) {
        pc.setTransform(1, 0, 0, 1, 0, 0)
        pc.globalCompositeOperation = 'multiply'
        pc.drawImage(this.lightCv, 0, 0)
        pc.globalCompositeOperation = 'source-over'
      }
      oc.globalCompositeOperation = 'source-over'
      oc.drawImage(this.lamp1Cv, bx, by, bw, bh, 0, 0, ow, oh)
    }
    if (this.st.smoke > 0) {
      const bw2 = Math.max(1, ow >> 1)
      const bh2 = Math.max(1, oh >> 1)
      if (this.outBlurCv.width !== bw2) this.outBlurCv.width = bw2
      if (this.outBlurCv.height !== bh2) this.outBlurCv.height = bh2
      const bc = this.outBlurCv.getContext('2d')!
      bc.setTransform(1, 0, 0, 1, 0, 0)
      bc.globalCompositeOperation = 'source-over'
      bc.clearRect(0, 0, bw2, bh2)
      bc.filter = `blur(${this.st.smoke * 0.9 * (ow / LW) * 0.5}px)`
      bc.drawImage(this.outCv, 0, 0, ow, oh, 0, 0, bw2, bh2)
      bc.filter = 'none'
      oc.globalCompositeOperation = 'lighter'
      oc.drawImage(this.outBlurCv, 0, 0, bw2, bh2, 0, 0, ow, oh)
      oc.globalCompositeOperation = 'source-over'
    }
  }

  /** Syphon出力用 premultiplied RGBA（outCv＝写真の部分だけ・写真解像度）。 */
  readOutputRGBA(): Uint8ClampedArray {
    const ctx = this.outCv.getContext('2d', { willReadFrequently: true })!
    const d = ctx.getImageData(0, 0, this.outW, this.outH).data
    for (let i = 0; i < d.length; i += 4) {
      const a = d[i + 3]
      if (a === 255 || a === 0) continue
      d[i] = (d[i] * a) / 255
      d[i + 1] = (d[i + 1] * a) / 255
      d[i + 2] = (d[i + 2] * a) / 255
    }
    return d
  }

  // ---------- 灯体の選択／操作（複数選択対応） ----------
  /** 操作対象＝選択中の灯体すべて。GAUGE/COLOR/PTZ/仕込みはここ全員に効く。 */
  private targets(): Beam[] {
    return this.selected.map((i) => this.beams[i]).filter(Boolean) as Beam[]
  }
  /** 代表灯体（スライダーの表示値などに使う＝選択の先頭）。 */
  private refBeam(): Beam | undefined {
    return this.beams[this.selected[0]]
  }
  /** 全選択（FIXTURESのALL）か。 */
  isAllSelected(): boolean {
    return this.beams.length > 0 && this.selected.length === this.beams.length
  }
  isSelected(i: number): boolean {
    return this.selected.includes(i)
  }
  /** 選択中の灯体すべて（UI用・読み取り）。 */
  get selectedBeams(): Beam[] {
    return this.selected.map((i) => this.beams[i]).filter(Boolean) as Beam[]
  }
  /** 選択中に炎/火花マークが含まれるか（向き(TILT)パネルの表示判定）。 */
  get hasSfxSelected(): boolean {
    return this.selected.some((i) => {
      const b = this.beams[i]
      return !!b && (b.motif === 'flame' || b.motif === 'sparkler')
    })
  }
  /** 選択中の代表マークの TILT（向きスライダー表示用）。 */
  get selectedTilt(): number {
    return this.beams[this.selected[0]]?.tilt ?? 0
  }
  /** 単独選択（素クリック）。互換: -1 を渡すと全選択。 */
  selectBeam(i: number): void {
    if (i === -1) {
      this.selectAll()
      return
    }
    this.selected = i >= 0 && i < this.beams.length ? [i] : []
    this.bump(false)
  }
  selectAll(): void {
    this.selected = this.beams.map((_, i) => i)
    this.bump(false)
  }
  /** Shift+クリック: 選択に足す/外す。 */
  toggleSelectBeam(i: number): void {
    if (i < 0 || i >= this.beams.length) return
    this.selected = this.selected.includes(i)
      ? this.selected.filter((x) => x !== i)
      : [...this.selected, i]
    this.bump(false)
  }
  /** 四角ドラッグ（ラバーバンド）の結果をまとめて選択。add=true で既存選択に追加。 */
  setSelection(ids: number[], add = false): void {
    const valid = ids.filter((i) => i >= 0 && i < this.beams.length)
    this.selected = add ? [...new Set([...this.selected, ...valid])] : valid
    this.bump(false)
  }
  toggleMute(i: number): void {
    const b = this.beams[i]
    if (!b) return
    this.pushHistory()
    b.mute = !b.mute
    this.bump(false)
  }
  toggleSolo(i: number): void {
    const b = this.beams[i]
    if (!b) return
    this.pushHistory()
    b.solo = !b.solo
    this.bump(false)
  }
  /** すべての灯体の M(ミュート)・S(ソロ)を一括解除＝本番で誤って入れた S/M を一発で戻す。 */
  clearAllMuteSolo(): void {
    if (!this.beams.some((b) => b.mute || b.solo)) return
    this.pushHistory()
    this.beams.forEach((b) => {
      b.mute = false
      b.solo = false
    })
    this.bump(false)
  }
  /** 今どれかが M / S 中か（UI の注意表示・全解除ボタン表示の判定用）。 */
  muteSoloCount(): { mute: number; solo: number } {
    let mute = 0
    let solo = 0
    for (const b of this.beams) {
      if (b.mute) mute++
      if (b.solo) solo++
    }
    return { mute, solo }
  }
  // --- 整列（選んだ灯体をパワーポイント風にそろえる）。位置を動かすので必ず rigCustomized=true（写真下端への自動吸着＝データ事故を防ぐ）。1クリック＝1回のundo（pushHistory）。 ---
  private _selValid(): number[] {
    return this.selected.filter((i) => i >= 0 && i < this.beams.length && !!this.beams[i])
  }
  alignLeft(): void {
    const s = this._selValid()
    if (s.length < 2) return
    this.pushHistory()
    this.rigCustomized = true
    const v = Math.min(...s.map((i) => this.beams[i].x))
    for (const i of s) this.beams[i].x = v
    this.bump()
  }
  alignRight(): void {
    const s = this._selValid()
    if (s.length < 2) return
    this.pushHistory()
    this.rigCustomized = true
    const v = Math.max(...s.map((i) => this.beams[i].x))
    for (const i of s) this.beams[i].x = v
    this.bump()
  }
  alignCenterX(): void {
    const s = this._selValid()
    if (s.length < 2) return
    this.pushHistory()
    this.rigCustomized = true
    const xs = s.map((i) => this.beams[i].x)
    const c = (Math.min(...xs) + Math.max(...xs)) / 2
    for (const i of s) this.beams[i].x = c
    this.bump()
  }
  alignTop(): void {
    const s = this._selValid()
    if (s.length < 2) return
    this.pushHistory()
    this.rigCustomized = true
    const v = Math.min(...s.map((i) => this.beams[i].y))
    for (const i of s) this.beams[i].y = v
    this.bump()
  }
  alignBottom(): void {
    const s = this._selValid()
    if (s.length < 2) return
    this.pushHistory()
    this.rigCustomized = true
    const v = Math.max(...s.map((i) => this.beams[i].y))
    for (const i of s) this.beams[i].y = v
    this.bump()
  }
  alignMiddle(): void {
    const s = this._selValid()
    if (s.length < 2) return
    this.pushHistory()
    this.rigCustomized = true
    const ys = s.map((i) => this.beams[i].y)
    const c = (Math.min(...ys) + Math.max(...ys)) / 2
    for (const i of s) this.beams[i].y = c
    this.bump()
  }
  distributeX(): void {
    const s = this._selValid()
    if (s.length < 3) return
    this.pushHistory()
    this.rigCustomized = true
    const sorted = [...s].sort((a, b) => this.beams[a].x - this.beams[b].x)
    const x0 = this.beams[sorted[0]].x
    const x1 = this.beams[sorted[sorted.length - 1]].x
    const step = (x1 - x0) / (sorted.length - 1)
    sorted.forEach((i, k) => {
      this.beams[i].x = x0 + step * k
    })
    this.bump()
  }
  distributeY(): void {
    const s = this._selValid()
    if (s.length < 3) return
    this.pushHistory()
    this.rigCustomized = true
    const sorted = [...s].sort((a, b) => this.beams[a].y - this.beams[b].y)
    const y0 = this.beams[sorted[0]].y
    const y1 = this.beams[sorted[sorted.length - 1]].y
    const step = (y1 - y0) / (sorted.length - 1)
    sorted.forEach((i, k) => {
      this.beams[i].y = y0 + step * k
    })
    this.bump()
  }

  /** 灯体の番号(=並び順)を「置いた場所」で振り直す。中央の一番下を1番に、左右の外側へ
   *  行くほど大きく（同距離は右が先）、下の段→上の段へ。事故防止＝各シーンの保存(fix)と
   *  各パターンの保存(look.lights)も同じ並びに揃える（呼び出しがズレない）。⌘Zで戻せる。 */
  renumberByPosition(): void {
    const n = this.beams.length
    if (n < 2) return
    this.pushHistory()
    this.rigCustomized = true
    // perm[newIdx] = oldIdx ＝ index に連動する全配列を同じ順に並べ替える（純関数・テスト済）
    const perm = renumberOrder(this.beams)
    const beams = this.beams
    this.beams = perm.map((i) => beams[i])
    for (const sc of this.scenes) {
      const fx = sc.fix
      if (fx && fx.length === n) sc.fix = perm.map((i) => fx[i])
    }
    for (const p of this.patterns) {
      const lights = p?.look?.lights
      if (lights && lights.length === n) p!.look.lights = perm.map((i) => lights[i])
    }
    this.selected = []
    this.bump()
  }

  addFixtureAt(x: number, y: number): void {
    if (this.beams.length >= MAX_BEAMS) return
    this.pushHistory()
    this.rigCustomized = true // 配置をいじった → 写真下端への自動追従を止める
    const ref = this.refBeam()
    const beamRef = ref?.motif ? undefined : ref // モチーフ選択中は寸法を引き継がない
    this.beams.push({
      x,
      y,
      w0: beamRef?.w0 ?? 40,
      w1: beamRef?.w1 ?? 260,
      len: beamRef?.len ?? 600,
      pan: 0,
      tilt: 0,
      zoom: 1,
      gauge: beamRef?.gauge ?? 0.72,
      color: (beamRef?.color.slice() as RGB3) ?? (WHITE.slice() as RGB3),
      sp: makeSearchParams(this.rnd)
    })
    this.selected = [this.beams.length - 1]
    this.bump()
  }
  addFixtureAuto(): void {
    if (this.beams.length >= MAX_BEAMS) return
    const last = this.beams[this.beams.length - 1]
    let x = last ? last.x + 165 : 800
    if (x > 1480) x = 140 + ((this.beams.length * 137) % 1200)
    this.addFixtureAt(x, 840)
  }
  addMotifAuto(
    type:
      | 'streetlamp'
      | 'streetlamp1'
      | 'chandelier'
      | 'marquee'
      | 'bulb'
      | 'parlight'
      | 'patt'
      | 'blinder'
      | 'pixelpatt'
      | 'stars'
      | 'festoon'
      | 'flame'
      | 'sparkler',
    atX?: number,
    atY?: number
  ): void {
    if (this.beams.length >= MAX_BEAMS) return
    // atX/atY 指定（⌘+クリック地点）があればそこ。無ければ同種の最後から右にずらして自動配置。
    const same = this.beams.filter((b) => b.motif === type)
    const last = same[same.length - 1]
    let x = atX ?? (last ? last.x + 220 : 800)
    let y = atY ?? (last ? last.y : 380)
    if (atX === undefined && x > 1460) { x = 200 + ((same.length * 180) % 1200); y += 180 }
    this.pushHistory()
    this.rigCustomized = true
    const warm: RGB3 = [255, 190, 100]
    this.beams.push({
      x,
      y,
      w0: 0,
      w1: 0,
      len: 0,
      pan: 0,
      tilt: 0,
      zoom: 1,
      gauge: 0.9,
      color: warm,
      sp: makeSearchParams(this.rnd),
      motif: type,
      motifDiam:
        type === 'streetlamp' ? 80 :   // 既定を半分に（やたら大きい対策）
        type === 'streetlamp1' ? 220 :  // 一灯リアル・既定を半分に（全高≈220px）
        type === 'chandelier' ? 48 :   // 1.2m
        type === 'marquee' ? 72 :      // 1.8m
        type === 'blinder' ? 20 :      // 50cm
        type === 'parlight' ? 8 :      // 20cm
        type === 'bulb' ? 6 :          // 15cm
        type === 'patt' ? 20 :         // 50cm
        type === 'pixelpatt' ? 28 :    // 70cm
        type === 'stars' ? 400 :       // 星空フィールド 10m角
        type === 'festoon' ? 240 :     // 垂れ幕 6m幅
        type === 'flame' ? 64 :        // 炎 1.6m
        type === 'sparkler' ? 56 : 200, // 火花 1.4m
      ...(type === 'marquee' ? { motifText: 'LIVE', motifSpeed: 8 } : {}),
      ...(type === 'stars' ? { motifSeed: Math.floor(this.rnd() * 1e6) + 1 } : {})
    })
    this.selected = [this.beams.length - 1]
    this.bump()
  }
  /** フロント灯体を追加（前から当たる丸い光）。motif は持たず front=true＝光マップに丸いプールを描く。
   *  既定は「止まった丸」(off)＝置いた瞬間は動かず、狙った場所に置きやすい・光とハンドルがズレない。
   *  動き(8の字/丸/横/ランダム)は位置を決めてから LIGHT タブで ON。番号列には通常の灯体として並ぶ。 */
  addFront(atX?: number, atY?: number): void {
    if (this.beams.length >= MAX_BEAMS) return
    const same = this.beams.filter((b) => b.front)
    const last = same[same.length - 1]
    let x = atX ?? (last ? last.x + 240 : 800)
    let y = atY ?? (last ? last.y : 420)
    if (atX === undefined && x > 1460) { x = 220 + ((same.length * 200) % 1200); y += 160 }
    this.pushHistory()
    this.rigCustomized = true
    this.beams.push({
      x,
      y,
      w0: 0,
      w1: 0,
      len: 0,
      pan: 0,
      tilt: 0,
      zoom: 1,
      gauge: 0.72,
      color: WHITE.slice() as RGB3,
      sp: makeSearchParams(this.rnd),
      front: true,
      frontPat: 'off',
      frontSpd: 0.1, // 既定はゆったり（約10秒で1周）。0.35だと約3秒で1周＝目が回ると不評だった

      frontAmp: 320,
      frontEdge: 0.5,
      motifDiam: 260 // プール直径（MOTIF SIZE スライダーで調整）
    })
    this.selected = [this.beams.length - 1]
    this.bump()
  }
  setFrontPat(p: '8' | 'circle' | 'sweep' | 'random' | 'off'): void {
    this.targets().forEach((b) => { if (b.front) b.frontPat = p })
    this.bump()
  }
  setFrontSpd(v: number): void {
    const n = Math.max(0, v)
    this.targets().forEach((b) => { if (b.front) b.frontSpd = n })
    this.bump()
  }
  setFrontAmp(v: number): void {
    const n = Math.max(0, Math.round(v))
    this.targets().forEach((b) => { if (b.front) b.frontAmp = n })
    this.bump()
  }
  setFrontEdge(v: number): void {
    const n = Math.max(0, Math.min(1, v))
    this.targets().forEach((b) => { if (b.front) b.frontEdge = n })
    this.bump()
  }
  /** リアルな発光画像を灯体として追加（明るさだけで光る・色は画像のまま）。 */
  addImageMotif(dataUrl: string): void {
    if (this.beams.length >= MAX_BEAMS) return
    const same = this.beams.filter((b) => b.motif === 'image')
    const last = same[same.length - 1]
    let x = last ? last.x + 220 : 800
    let y = last ? last.y : 380
    if (x > 1460) {
      x = 200 + ((same.length * 180) % 1200)
      y += 180
    }
    this.pushHistory()
    this.rigCustomized = true
    this.imageFor(dataUrl) // 先読み
    this.beams.push({
      x,
      y,
      w0: 0,
      w1: 0,
      len: 0,
      pan: 0,
      tilt: 0,
      zoom: 1,
      gauge: 0.9,
      color: [255, 255, 255],
      sp: makeSearchParams(this.rnd),
      motif: 'image',
      imageSrc: dataUrl,
      motifDiam: 300
    })
    this.selected = [this.beams.length - 1]
    this.bump()
  }
  /** 行灯さがし: 表示中の写真から「明るくて暖色に光っている塊」を見つけ、ステージ座標(LW×LH)で返す。
   *  写真読込時/ボタン押下時に一回だけ走らせる想定（本番では走らせない）。重いAIは使わない。 */
  detectLanterns(): { x: number; y: number }[] {
    if (!this.mat || !this.box) return []
    const dw = 240 // 縮小して走査（速い＆細かいノイズが潰れる）
    const dh = Math.max(1, Math.round((dw * this.mat.height) / this.mat.width))
    const sc = mk(dw, dh, true)
    const ctx = sc.getContext('2d', { willReadFrequently: true })
    if (!ctx) return []
    ctx.drawImage(this.mat, 0, 0, dw, dh)
    const img = ctx.getImageData(0, 0, dw, dh)
    const blobs = findWarmBlobs(img.data, dw, dh)
    const box = this.box
    // 縮小画像の重心 → 写真内割合 → 写真枠(box)経由でステージ座標へ。
    return blobs.map((b) => ({
      x: Math.round(box.x + (b.cx / dw) * box.w),
      y: Math.round(box.y + (b.cy / dh) * box.h)
    }))
  }

  /** 行灯さがしの結果を「光る玉(bulb)」の灯体として追加する（非破壊＝既存灯体は消さない・足すだけ）。
   *  戻り値＝追加できた個数。0 なら見つからなかった（or 空きが無い）。⌘Z で一括で戻せる。 */
  addLanternsFromImage(): number {
    const pts = this.detectLanterns()
    if (!pts.length || this.beams.length >= MAX_BEAMS) return 0
    this.pushHistory()
    this.rigCustomized = true // 配置をいじった → 写真下端への自動追従を止める（データ事故防止）
    const warm: RGB3 = [255, 180, 90]
    const start = this.beams.length
    for (const p of pts) {
      if (this.beams.length >= MAX_BEAMS) break
      this.beams.push({
        x: p.x,
        y: p.y,
        w0: 0,
        w1: 0,
        len: 0,
        pan: 0,
        tilt: 0,
        zoom: 1,
        gauge: 0.95,
        color: warm.slice() as RGB3,
        sp: makeSearchParams(this.rnd),
        motif: 'bulb',
        motifDiam: 44
      })
    }
    const added = this.beams.length - start
    if (added > 0) this.selected = Array.from({ length: added }, (_, i) => start + i)
    this.bump()
    return added
  }

  setMotifDiam(v: number): void {
    const n = Math.max(4, Math.round(v))
    this.targets().forEach((b) => { b.motifDiam = n })
    this.bump()
  }
  setMotifText(s: string): void {
    this.targets().forEach((b) => { b.motifText = s || 'LIVE' })
    this.bump()
  }
  setMotifSpeed(v: number): void {
    const n = Math.max(0.5, v)
    this.targets().forEach((b) => { b.motifSpeed = n })
    this.bump()
  }
  setMotifReverse(v: boolean): void {
    this.targets().forEach((b) => { b.motifReverse = v })
    this.bump()
  }
  /** モチーフ専用チェイスの ON/OFF（テスト用）。速さ・柔らかさは CHASE のツマミと共用。 */
  setMotifChase(on: boolean): void {
    this.motifChase = on
    if (on) this.t0 = performance.now() // 押した瞬間から流し始める
    this.bump()
  }
  /** 特定ビームの gauge を直接設定（PLAY モードのモチーフ個別スライダー用）。 */
  setBeamGauge(idx: number, v: number): void {
    const b = this.beams[idx]
    if (!b) return
    b.gauge = Math.max(0, Math.min(1, v))
    this.bump()
  }
  /** 背景写真なしで使える空シーンを追加。モチーフだけ使いたい場合に。
   *  mat は「全画面・透明」＝出力(outCv)は IW×IH の透明地にモチーフだけが乗る。
   *  warpBox を全ステージにして、ステージのどこに置いたモチーフも出力に入るようにする。 */
  addEmptyScene(): void {
    const mat = document.createElement('canvas')
    mat.width = IW; mat.height = IH // 透明のまま（塗らない）＝出力は透明地
    const thumb = document.createElement('canvas')
    thumb.width = 96; thumb.height = 54
    const tc = thumb.getContext('2d')!
    tc.fillStyle = '#111'
    tc.fillRect(0, 0, 96, 54)
    this.pushHistory()
    this.scenes.push({
      name: '空の背景',
      kind: 'photo',
      mat,
      thumb,
      warpBox: { x: 0, y: 0, w: LW, h: LH }
    })
    this.selectScene(this.scenes.length - 1)
    this.bump()
  }
  /** ドラッグ移動: 選択中の灯体すべてを (dx,dy) 動かす。 */
  moveSelectedBy(dx: number, dy: number): void {
    if (!this.selected.length || (!dx && !dy)) return
    this.pushHistory('move')
    this.rigCustomized = true // 動かした → 写真下端への自動追従を止める
    this.targets().forEach((b) => {
      b.x += dx
      b.y += dy
    })
    this.bump()
  }
  removeSelected(): void {
    if (!this.selected.length) return
    this.pushHistory()
    this.rigCustomized = true
    const drop = new Set(this.selected)
    this.beams = this.beams.filter((_, i) => !drop.has(i))
    this.selected = this.beams.length ? [Math.min(this.selected[0], this.beams.length - 1)] : []
    this.bump()
  }
  /** ⌘C: 選択中の灯体ぜんぶを内部クリップボードへ（仕込み・向き・色を丸ごと）。
   *  dmx は深いコピー＝元とペースト先が同じオブジェクトを共有して片方のパッチ変更が両方に効く事故を防ぐ。 */
  copyBeam(): void {
    const t = this.targets()
    if (!t.length) return
    this.beamClip = t.map((b) => ({
      ...b,
      color: b.color.slice() as RGB3,
      sp: { ...b.sp },
      dmx: b.dmx ? { ...b.dmx } : undefined
    }))
  }
  /** ⌘V: コピーした灯体を少し横へずらして複製（伸び・広がり・向き・色すべて同じ）。複数可。 */
  pasteBeam(): void {
    if (!this.beamClip || !this.beamClip.length) return
    this.pushHistory()
    this.rigCustomized = true
    const newIdx: number[] = []
    for (const src of this.beamClip) {
      if (this.beams.length >= MAX_BEAMS) break
      let x = src.x + 44
      const y = src.y + 44 // 斜め下にずらす＝真横より重なりにくい（PowerPoint風）
      if (x > LW - 20) x = 20 + ((this.beams.length * 60) % (LW - 40)) // 端を越えたら折り返し
      this.beams.push({
        ...src,
        x,
        y: y > LH - 20 ? src.y : y, // 下端を越えるなら縦はそのまま
        color: src.color.slice() as RGB3,
        sp: makeSearchParams(this.rnd),
        dmx: src.dmx ? { ...src.dmx } : undefined, // 深いコピー＝パッチ変更が元と連動する事故防止
        sfxId: undefined // 特効IDは複製しない＝新しいIDが振られる（同じIDが2灯に付くとシーケンサーが誤爆）
      })
      newIdx.push(this.beams.length - 1)
    }
    if (newIdx.length) this.selected = newIdx
    this.bump()
  }

  /** ⌥ドラッグ用: 選択群を同じ位置に複製して新しい群を選択（元は残す）。 */
  duplicateSelectedInPlace(): void {
    const t = this.targets()
    if (!t.length) return
    this.pushHistory()
    this.rigCustomized = true
    const newIdx: number[] = []
    for (const src of t) {
      if (this.beams.length >= MAX_BEAMS) break
      this.beams.push({
        ...src,
        color: src.color.slice() as RGB3,
        sp: makeSearchParams(this.rnd),
        dmx: src.dmx ? { ...src.dmx } : undefined,
        sfxId: undefined // 複製に同じ特効IDを持たせない（シーケンサー誤爆防止）
      })
      newIdx.push(this.beams.length - 1)
    }
    if (newIdx.length) this.selected = newIdx
    this.bump()
  }

  /** ドラッグ開始: 選択群の現在位置を覚える（吸着の基準）。 */
  beginDrag(): void {
    this.dragOrig = this.targets().map((b) => ({ x: b.x, y: b.y }))
  }

  /** ドラッグ中: 開始位置から (rawDx,rawDy) 動かしつつ整列・等間隔へ吸着する。
   *  useSnap=false なら吸着もガイドも完全 OFF（Shift キーで一時的に外す用）。 */
  dragTo(rawDx: number, rawDy: number, useSnap: boolean = true): void {
    const orig = this.dragOrig
    if (!orig || !this.selected.length) return
    const sel = this.selected
    let sx = 0
    let sy = 0
    let guides: { vx: number[]; hy: number[]; equal: { x0: number; x1: number; y: number }[] } = {
      vx: [],
      hy: [],
      equal: []
    }
    if (useSnap) {
      const selSet = new Set(sel)
      const others: Pt[] = this.beams
        .filter((_, i) => !selSet.has(i))
        .map((b) => ({ x: b.x, y: b.y }))
      const pts: Pt[] = orig.map((o) => ({ x: o.x + rawDx, y: o.y + rawDy }))
      const a = alignSnap(pts, others, SNAP)
      sx = a.dx
      sy = a.dy
      guides = { vx: a.vx, hy: a.hy, equal: [] as { x0: number; x1: number; y: number }[] }
      // 等間隔は単体ドラッグのときだけ（横方向）。決まったら整列の縦線より優先する。
      if (sel.length === 1) {
        const eq = equalSnapX(pts[0].x, others, SNAP)
        if (eq) {
          sx = eq.x - pts[0].x
          guides.vx = []
          guides.equal = eq.marks.map((m) => ({ x0: m[0], x1: m[1], y: pts[0].y + sy }))
        }
      }
    }
    this.pushHistory('move')
    this.rigCustomized = true
    for (let k = 0; k < sel.length; k++) {
      const b = this.beams[sel[k]]
      b.x = orig[k].x + rawDx + sx
      b.y = orig[k].y + rawDy + sy
    }
    this.snapGuides =
      useSnap && (guides.vx.length || guides.hy.length || guides.equal.length) ? guides : null
    this.bump()
  }

  /** ドラッグ終了: 基準とガイドを消す。 */
  endDrag(): void {
    this.dragOrig = null
    if (this.snapGuides) {
      this.snapGuides = null
      this.bump()
    }
  }

  /** 光だけ出力モードの切替（写真なしで光マップだけを出力する）。 */
  setLightOnly(v: boolean): void {
    this.lightOnly = v
    this.bump()
  }
  /** ビームの落ち込みの強さ（指数）を切替。ソフト1.5 / 標準2.5 / きつめ4。 */
  setFalloff(pow: number): void {
    this.falloffPow = pow
    this.bump()
  }
  /** 出力上限解像度を切替。なめらか1920 / バランス2560 / 高精細3840。低いほど滑らか。 */
  setOutCap(px: number): void {
    this.outCap = px
    this.bump()
  }
  /** 同じキー(e.code)を持つ他カテゴリ(pattern/FX/color)から外す＝「1キー1役」。 */
  private clearKeyEverywhere(code: string): void {
    this.patterns.forEach((p) => {
      if (p && p.key === code) p.key = null
    })
    for (const k of Object.keys(this.fxKey) as FxKey[]) if (this.fxKey[k] === code) delete this.fxKey[k]
    for (const h of Object.keys(this.colorKey)) if (this.colorKey[h] === code) delete this.colorKey[h]
  }
  /** 同じ MIDI ノートを持つ他カテゴリ(strobe/FX/color/pattern/scene)から外す＝「1ノート1役」。 */
  private clearMidiNoteEverywhere(note: number): void {
    if (this.strobeMidi === note) this.strobeMidi = null
    if (this.motifChaseMidi === note) this.motifChaseMidi = null
    for (const k of Object.keys(this.fxMidi) as FxKey[]) if (this.fxMidi[k] === note) delete this.fxMidi[k]
    for (const h of Object.keys(this.colorMidi)) if (this.colorMidi[h] === note) delete this.colorMidi[h]
    this.patterns.forEach((p) => {
      if (p && p.midi === note) p.midi = null
    })
    this.scenes.forEach((s) => {
      if (s.midiNote === note) s.midiNote = null
    })
  }
  /** 本番シーン切替の方式（cut/fade）と時間(ms)を設定。 */
  setSceneFadeMode(mode: 'cut' | 'fade'): void {
    this.sceneFadeMode = mode
    this.bump()
  }
  setSceneFadeMs(ms: number): void {
    this.sceneFadeMs = Math.max(0, ms)
    this.bump()
  }

  setGauge(pct: number): void {
    this.pushHistory('gauge')
    this.wake()
    this.targets().forEach((b) => (b.gauge = pct / 100))
    this.bump()
  }
  setColor(rgb: RGB3): void {
    this.pushHistory('color')
    this.wake()
    this.targets().forEach((b) => (b.color = rgb.slice() as RGB3))
    this.bump()
  }
  /** 選択灯体の DMX 控えを設定/部分更新（null＝外す）。user 編集なので pushHistory。
   *  毎フレームの applyDmx（卓→灯体の直書き）とは別物。 */
  setBeamDmx(patch: Partial<NonNullable<Beam['dmx']>> | null): void {
    this.pushHistory('dmx')
    for (const b of this.targets()) {
      if (patch === null) {
        b.dmx = undefined
        continue
      }
      const cur = b.dmx ?? { universe: 0, start: 1, mode: 'beam8' as ChannelMode }
      const next = { ...cur, ...patch }
      // 使用ch数が512をはみ出す位置は詰める（例: beam8 を 509 に置くと ch513-516 が
      // 存在せず、卓で触っても一部だけ動かない“半分死んだ灯体”になる）。モード変更でも効かせる。
      next.start = Math.max(1, Math.min(513 - channelCount(next.mode), next.start))
      b.dmx = next
    }
    this.bump()
  }
  /** 選択灯体に空きアドレスを自動割当（universe 0・選択外のパッチ済みの後ろから順に・step-up）。 */
  autoPatchSelected(): void {
    const sel = this.targets()
    if (!sel.length) return
    this.pushHistory('dmx')
    // 選択外のパッチ済み灯体が占有する最大の「次の空き」絶対チャンネル(0始まり)を全 universe 横断で求める。
    let maxAbs = 0
    for (const b of this.beams) {
      if (b.dmx && !sel.includes(b)) {
        const end = b.dmx.universe * 512 + (b.dmx.start - 1) + channelCount(b.dmx.mode)
        maxAbs = Math.max(maxAbs, end)
      }
    }
    let universe = Math.floor(maxAbs / 512)
    let next = (maxAbs % 512) + 1
    for (const b of sel) {
      const mode = b.dmx?.mode ?? ('beam8' as ChannelMode)
      const count = channelCount(mode)
      if (next + count - 1 > 512) {
        universe++
        next = 1
      }
      b.dmx = { universe, start: next, mode, fixedColor: b.dmx?.fixedColor, addressStep: b.dmx?.addressStep }
      next += count
    }
    this.bump()
  }
  /** 卓アドレスが衝突している灯体の番号(1 始まり) 一覧。空＝衝突なし。UI / canvas の警告に使う。 */
  dmxOverlaps(): number[] {
    const patches = this.beams.map((b) =>
      b.dmx
        ? { universe: b.dmx.universe, start: b.dmx.start, count: channelCount(b.dmx.mode) }
        : null
    )
    return [...detectDmxOverlaps(patches)].sort((a, b) => a - b).map((i) => i + 1)
  }
  /** 全灯体に空きアドレスを一括自動割当（番号順に 1 から step-up＝衝突しない・512を超えたら次のuniverseへ繰り上げ）。
   *  既存の控えのモード/色は維持し、番地だけ詰め直す。⌘Z で戻せる。 */
  autoPatchAll(): void {
    if (!this.beams.length) return
    this.pushHistory('dmx')
    let universe = 0
    let next = 1
    for (const b of this.beams) {
      const mode = b.dmx?.mode ?? ('beam8' as ChannelMode)
      const count = channelCount(mode)
      if (next + count - 1 > 512) {
        universe++
        next = 1
      }
      b.dmx = { universe, start: next, mode, fixedColor: b.dmx?.fixedColor, addressStep: b.dmx?.addressStep }
      next += count
    }
    this.bump()
  }
  setPan(v: number): void {
    this.pushHistory('pan')
    this.targets().forEach((b) => (b.pan = v))
    this.bump()
  }
  setTilt(v: number): void {
    this.pushHistory('tilt')
    this.targets().forEach((b) => (b.tilt = v))
    this.bump()
  }
  setZoom(mult: number): void {
    this.pushHistory('zoom')
    this.targets().forEach((b) => (b.zoom = mult))
    this.bump()
  }
  home(): void {
    this.pushHistory('home')
    this.targets().forEach((b) => {
      b.pan = 0
      b.tilt = 0
      b.zoom = 1
    })
    this.bump()
  }
  setRig(field: 'w0' | 'w1' | 'len', v: number): void {
    this.pushHistory('rig-' + field)
    this.targets().forEach((b) => (b[field] = v))
    this.bump()
  }
  setMaster(v: number): void {
    this.pushHistory('master')
    this.st.master = Math.max(0, Math.min(1, v))
    this.wake()
    this.bump()
  }
  setSmoke(v: number): void {
    this.pushHistory('smoke')
    this.st.smoke = v
    this.bump()
  }

  /** 現在選択（or先頭）灯体の表示用スナップ。 */
  ref(): Beam | undefined {
    return this.refBeam()
  }

  // ---------- FX ----------
  fxState(key: FxKey): boolean {
    const s = this.st
    switch (key) {
      case 'search':
        return s.search && !s.searchRandom
      case 'rndsearch':
        return s.search && s.searchRandom
      case 'chase':
        return s.chase
      case 'strobe':
        return s.strobe === 'all'
      case 'rndstrobe':
        return s.strobe === 'rnd'
      case 'colorchase':
        return s.colorChase
      case 'breath':
        return s.breath
      case 'fire':
        return s.fire
      case 'wave':
        return s.wave
      case 'bolt':
        return s.bolt
      case 'rainbow':
        return s.rainbow
      case 'zoompulse':
        return s.zoompulse
    }
  }
  fxToggle(key: FxKey): void {
    this.pushHistory()
    const on = !this.fxState(key)
    const s = this.st
    switch (key) {
      case 'search':
        s.search = on
        s.searchRandom = false
        break
      case 'rndsearch':
        s.search = on
        s.searchRandom = on
        break
      case 'chase':
        s.chase = on
        break
      case 'strobe':
        s.strobe = on ? 'all' : 'off'
        break
      case 'rndstrobe':
        s.strobe = on ? 'rnd' : 'off'
        break
      case 'colorchase':
        s.colorChase = on
        if (on) s.rainbow = false
        break
      case 'breath':
        s.breath = on
        break
      case 'fire':
        s.fire = on
        break
      case 'wave':
        s.wave = on
        break
      case 'bolt':
        s.bolt = on
        break
      case 'rainbow':
        s.rainbow = on
        if (on) s.colorChase = false
        break
      case 'zoompulse':
        s.zoompulse = on
        break
    }
    if (on) {
      this.t0 = performance.now()
      this.wake()
    }
    this.bump()
  }
  setFxp<K extends keyof FxParams>(key: K, field: keyof FxParams[K], value: number): void {
    this.pushHistory('fxp-' + String(key) + '-' + String(field))
    ;(this.fxp[key] as Record<string, number>)[field as string] = value
    this.bump()
  }
  /** すべての FX を消す。pushHist=true（既定＝外部から単独で呼ぶ場合）は直前の look を履歴へ
   *  積み、⌘Z で戻せるようにする。blackout/panicFade は開始時に自前で 1 回積むので、内部からは
   *  pushHist=false で呼んで二重に積まないようにする。 */
  stopAllFx(pushHist = true): void {
    if (pushHist) this.pushHistory()
    const s = this.st
    s.chase = false
    s.search = false
    s.searchRandom = false
    s.strobe = 'off'
    s.colorChase = false
    s.breath = s.fire = s.wave = s.bolt = s.rainbow = s.zoompulse = false
    this.strobeOverride = false // 特別ストロボ(灯体ごとランダム)も止める＝暗転/パニック後に持ち越さない
    this.bump()
  }

  // ---------- 写真／動画棚（シーン＝背景セット） ----------
  /** アルベド化: drawImage → ×217 →（透過素材は自分の形に切り抜き）。動画(opaque)は
   *  矩形全面なので切り抜きを省略し、毎コマ呼んでも軽いようにする。 */
  private buildAlbedo(
    dst: HTMLCanvasElement,
    source: CanvasImageSource,
    w: number,
    h: number,
    opaque: boolean
  ): void {
    if (dst.width !== w) dst.width = w
    if (dst.height !== h) dst.height = h
    const c = dst.getContext('2d')!
    c.globalCompositeOperation = 'source-over'
    c.clearRect(0, 0, w, h)
    c.drawImage(source, 0, 0, w, h)
    c.globalCompositeOperation = 'multiply'
    c.fillStyle = 'rgb(217,217,217)'
    c.fillRect(0, 0, w, h)
    if (!opaque) {
      c.globalCompositeOperation = 'destination-in'
      c.drawImage(source, 0, 0, w, h)
    }
    c.globalCompositeOperation = 'source-over'
  }
  private albedoOf(img: HTMLImageElement): HTMLCanvasElement {
    // cap to ALBEDO_MAX so a high-res photo doesn't keep tens of MB per scene (OOM fix)
    const { w, h } = albedoFitSize(img.naturalWidth || img.width, img.naturalHeight || img.height)
    const a = mk(w, h)
    this.buildAlbedo(a, img, a.width, a.height, false)
    return a
  }
  private makeThumbFrom(source: CanvasImageSource, w: number, h: number): HTMLCanvasElement {
    const th = mk(184, 104)
    const tc = th.getContext('2d')!
    tc.fillStyle = '#000'
    tc.fillRect(0, 0, 184, 104)
    const s = Math.min(184 / w, 104 / h)
    tc.drawImage(source, (184 - w * s) / 2, (104 - h * s) / 2, w * s, h * s)
    return th
  }
  /** 写真を棚に追加→即そのシーンへ（dataURL から非同期ロード）。 */
  addPhoto(dataUrl: string, name?: string): Promise<void> {
    return new Promise((resolve) => {
      const im = new Image()
      im.onload = (): void => {
        const w = im.naturalWidth || im.width
        const h = im.naturalHeight || im.height
        const scene: Scene = {
          name: name || 'PHOTO ' + (this.scenes.length + 1),
          kind: 'photo',
          // deliberately DON'T keep `img`: the full-res decoded bitmap is huge and only the
          // downscaled `mat` (render) + `src` (save) are needed → `im` is GC'd after this.
          src: dataUrl, // 公演保存でファイルに書き出すため元データを保持
          mat: this.albedoOf(im),
          thumb: this.makeThumbFrom(im, w, h)
        }
        scene.lumRelief = this.buildLumRelief(scene.mat) // AIなし立体マップを読込時に1回だけ
        this.pushHistory()
        this.scenes.push(scene)
        this.selectScene(this.scenes.length - 1)
        resolve()
      }
      im.onerror = (): void => resolve()
      im.src = dataUrl
    })
  }


  /** ループ動画を棚に追加→即そのシーンへ。動画＝「動くアルベド（反射面）」として毎コマ
   *  取り込む。重い素材対策で内部は最大幅1280pxへ縮小（出力1080pには十分・以降は軽い）。 */
  addVideo(url: string, name?: string): Promise<void> {
    return new Promise((resolve) => {
      const v = document.createElement('video')
      v.src = url
      v.loop = true
      v.muted = true
      v.playsInline = true
      v.preload = 'auto'
      if (url.startsWith('blob:')) this.allUrls.push(url)
      let done = false
      const finish = (): void => {
        if (done) return
        done = true
        resolve()
      }
      v.addEventListener('loadeddata', () => {
        if (done) return
        const vw = v.videoWidth || 1280
        const vh = v.videoHeight || 720
        const scale = Math.min(1, 1280 / vw)
        const mw = Math.max(1, Math.round(vw * scale))
        const mh = Math.max(1, Math.round(vh * scale))
        const mat = mk(mw, mh)
        this.buildAlbedo(mat, v, mw, mh, true)
        const scene: Scene = {
          name: name || 'VIDEO ' + (this.scenes.length + 1),
          kind: 'video',
          video: v,
          objectUrl: url.startsWith('blob:') ? url : undefined,
          mat,
          thumb: this.makeThumbFrom(v, vw, vh)
        }
        this.pushHistory()
        this.scenes.push(scene)
        this.selectScene(this.scenes.length - 1)
        finish()
      })
      v.onerror = finish
      v.play().catch(() => {}) // 最初のフレームのデコードを促す（muted=自動再生OK）
    })
  }
  /** 表示中シーンが動画なら、この瞬間のフレームをアルベド化して mat を更新（毎フレーム）。 */
  private updateVideoFrame(): void {
    if (this.activeScene < 0) return
    const sc = this.scenes[this.activeScene]
    if (!sc || sc.kind !== 'video' || !sc.video) return
    // 本番安全網: 表示中の動画が（ウィンドウ背面化などで）止まっていたら必ず再開させる
    if (sc.video.paused) sc.video.play().catch(() => {})
    if (sc.video.readyState < 2) return // HAVE_CURRENT_DATA 未満（フレーム未着）
    this.buildAlbedo(sc.mat, sc.video, sc.mat.width, sc.mat.height, true)
  }
  /** 画面を閉じる時: 全動画を停止＋ObjectURLを解放（メモリリーク防止）。 */
  disposeMedia(): void {
    for (const s of this.scenes) {
      if (s.kind === 'video' && s.video) {
        s.video.pause()
        s.video.src = ''
      }
    }
    for (const u of this.allUrls) URL.revokeObjectURL(u) // 削除済み含め全URLをここで解放
    this.allUrls = []
  }
  private fitImage(): void {
    if (!this.mat) {
      this.box = null
      return
    }
    // 4辺スケールワープが効いていればそれを優先（active scene に紐づく）
    const active = this.activeScene >= 0 ? this.scenes[this.activeScene] : null
    if (active && active.warpBox) {
      this.box = { ...active.warpBox }
      return
    }
    const sc = Math.min((LW - 80) / this.mat.width, (LH - 240) / this.mat.height)
    const iw = this.mat.width * sc
    const ih = this.mat.height * sc
    this.box = { x: (LW - iw) / 2, y: 40, w: iw, h: ih }
  }

  /** active scene の warpBox を更新（LW×LH 座標系）。null でリセット。 */
  setActiveSceneWarpBox(box: { x: number; y: number; w: number; h: number } | null): void {
    const i = this.activeScene
    if (i < 0 || i >= this.scenes.length) return
    if (box) {
      // 最小サイズだけ守る（0 以下や負値の暴走防止）。座標自体はステージ外もOK。
      const MIN = 20
      const w = Math.max(MIN, box.w)
      const h = Math.max(MIN, box.h)
      this.scenes[i].warpBox = { x: box.x, y: box.y, w, h }
    } else {
      this.scenes[i].warpBox = null
    }
    this.fitImage()
    this.bump()
  }

  /** 表示中シーンが warp 中か（リセットボタンの表示判定用）。 */
  isActiveSceneWarped(): boolean {
    const i = this.activeScene
    if (i < 0 || i >= this.scenes.length) return false
    return !!this.scenes[i].warpBox
  }

  // ---------- ピース（写真の一部を切り抜いて 4 隅コーナーピンで貼る） ----------

  /** ピース作成モードのトグル。ON 中は写真上ドラッグで矩形を切り出してピース化。 */
  setPieceCreating(on: boolean): void {
    this.pieceCreating = on
    if (!on) this.bump(false)
    else this.bump(false)
  }

  /** ピース選択（id=null で解除）。ハンドル表示・Delete 対象の管理。 */
  selectPiece(id: string | null): void {
    this.selectedPieceId = id
    this.bump(false)
  }

  /** 写真の元解像度座標（mat 絶対座標）の矩形でピースを追加。
   *  dst の 4 隅は「写真の現在表示位置」に合わせて初期化＝ピンを刺した状態。
   *  src が極小（誤クリック）なら null を返してスキップ。 */
  addPieceFromSrcRect(src: { x: number; y: number; w: number; h: number }): Piece | null {
    if (src.w < 4 || src.h < 4) return null
    const i = this.activeScene
    if (i < 0 || i >= this.scenes.length) return null
    const scene = this.scenes[i]
    if (!scene || !scene.mat || !this.box) return null
    const mw = scene.mat.width
    const mh = scene.mat.height
    const box = this.box
    const tx = (sx: number): number => box.x + (sx / mw) * box.w
    const ty = (sy: number): number => box.y + (sy / mh) * box.h
    const id = 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
    const piece: Piece = {
      id,
      src: { x: src.x, y: src.y, w: src.w, h: src.h },
      corners: [
        { x: tx(src.x), y: ty(src.y) },
        { x: tx(src.x + src.w), y: ty(src.y) },
        { x: tx(src.x + src.w), y: ty(src.y + src.h) },
        { x: tx(src.x), y: ty(src.y + src.h) }
      ]
    }
    if (!scene.pieces) scene.pieces = []
    this.pushHistory()
    scene.pieces.push(piece)
    this.selectedPieceId = id
    this.bump()
    return piece
  }

  /** 選択中のピースを削除。Delete キー用。 */
  removeSelectedPiece(): void {
    const id = this.selectedPieceId
    if (!id) return
    const scene = this.activeScene >= 0 ? this.scenes[this.activeScene] : null
    if (!scene || !scene.pieces) return
    const idx = scene.pieces.findIndex((p) => p.id === id)
    if (idx < 0) return
    this.pushHistory()
    scene.pieces.splice(idx, 1)
    this.selectedPieceId = null
    this.bump()
  }

  /** 座標（LW×LH 座標系）でヒットするピースを手前から探す。 */
  pickPieceAt(p: { x: number; y: number }): Piece | null {
    const scene = this.activeScene >= 0 ? this.scenes[this.activeScene] : null
    if (!scene || !scene.pieces) return null
    for (let i = scene.pieces.length - 1; i >= 0; i--) {
      const piece = scene.pieces[i]
      if (this.pointInQuad(p, piece.corners)) return piece
    }
    return null
  }

  private pointInQuad(
    p: { x: number; y: number },
    c: [
      { x: number; y: number },
      { x: number; y: number },
      { x: number; y: number },
      { x: number; y: number }
    ]
  ): boolean {
    return (
      this.pointInTriangle(p, c[0], c[1], c[2]) || this.pointInTriangle(p, c[0], c[2], c[3])
    )
  }

  private pointInTriangle(
    p: { x: number; y: number },
    a: { x: number; y: number },
    b: { x: number; y: number },
    c: { x: number; y: number }
  ): boolean {
    const s = (
      pp: { x: number; y: number },
      aa: { x: number; y: number },
      bb: { x: number; y: number }
    ): number => (pp.x - bb.x) * (aa.y - bb.y) - (aa.x - bb.x) * (pp.y - bb.y)
    const d1 = s(p, a, b)
    const d2 = s(p, b, c)
    const d3 = s(p, c, a)
    const hasNeg = d1 < 0 || d2 < 0 || d3 < 0
    const hasPos = d1 > 0 || d2 > 0 || d3 > 0
    return !(hasNeg && hasPos)
  }

  /** ピースの 4 隅のうち 1 つを動かす（LW×LH 座標系・絶対位置）。 */
  updatePieceCorner(id: string, cornerIdx: 0 | 1 | 2 | 3, dst: { x: number; y: number }): void {
    const scene = this.activeScene >= 0 ? this.scenes[this.activeScene] : null
    if (!scene || !scene.pieces) return
    const piece = scene.pieces.find((p) => p.id === id)
    if (!piece) return
    // Undo 対象に（'piece-move' タグで連続ドラッグは1手にまとまる＝灯体の move と同方式）
    this.pushHistory('piece-move')
    piece.corners[cornerIdx] = { x: dst.x, y: dst.y }
    this.bump()
  }

  /** 最終フレームの上にアクティブシーンのピースを順に描く（renderFrame から呼ばれる）。
   *  Step 1 ではピースに光は当てない＝最終フレームに直接重ねるだけ（box 外も自由に置ける）。 */
  drawPiecesOnFrame(ctx: CanvasRenderingContext2D): void {
    const scene = this.activeScene >= 0 ? this.scenes[this.activeScene] : null
    if (!scene || !scene.pieces || !scene.pieces.length || !scene.mat) return
    ctx.save()
    ctx.setTransform(Q, 0, 0, Q, 0, 0) // LW×LH 論理座標 → IW×IH 物理ピクセル
    for (const piece of scene.pieces) {
      this.drawPieceQuad(ctx, scene.mat, piece)
    }
    ctx.restore()
  }

  /** ピースを 2 三角形に分けてアフィン変換で描く（4 隅コーナーピン）。 */
  private drawPieceQuad(
    ctx: CanvasRenderingContext2D,
    src: HTMLCanvasElement,
    piece: Piece
  ): void {
    const s = piece.src
    const c = piece.corners
    // 三角形 1：src (TL, TR, BR) → dst c[0], c[1], c[2]
    this.drawTextureTriangle(
      ctx,
      src,
      s.x,
      s.y,
      c[0].x,
      c[0].y,
      s.x + s.w,
      s.y,
      c[1].x,
      c[1].y,
      s.x + s.w,
      s.y + s.h,
      c[2].x,
      c[2].y
    )
    // 三角形 2：src (TL, BR, BL) → dst c[0], c[2], c[3]
    this.drawTextureTriangle(
      ctx,
      src,
      s.x,
      s.y,
      c[0].x,
      c[0].y,
      s.x + s.w,
      s.y + s.h,
      c[2].x,
      c[2].y,
      s.x,
      s.y + s.h,
      c[3].x,
      c[3].y
    )
  }

  /** src 3 点 → dst 3 点のアフィン変換を計算して三角形領域内だけ drawImage。
   *  ctx は呼び出し時点の transform を保持し、その上にアフィンを乗算する。 */
  private drawTextureTriangle(
    ctx: CanvasRenderingContext2D,
    src: HTMLCanvasElement,
    sx0: number,
    sy0: number,
    dx0: number,
    dy0: number,
    sx1: number,
    sy1: number,
    dx1: number,
    dy1: number,
    sx2: number,
    sy2: number,
    dx2: number,
    dy2: number
  ): void {
    const x0 = sx1 - sx0
    const x1 = sx2 - sx0
    const y0 = sy1 - sy0
    const y1 = sy2 - sy0
    const det = x0 * y1 - x1 * y0
    if (Math.abs(det) < 1e-9) return // 退化三角形は描かない
    const u0 = dx1 - dx0
    const u1 = dx2 - dx0
    const v0 = dy1 - dy0
    const v1 = dy2 - dy0
    const a = (u0 * y1 - u1 * y0) / det
    const c = (u1 * x0 - u0 * x1) / det
    const b = (v0 * y1 - v1 * y0) / det
    const d = (v1 * x0 - v0 * x1) / det
    const e = dx0 - a * sx0 - c * sy0
    const f = dy0 - b * sx0 - d * sy0
    ctx.save()
    // dst 三角形だけにクリップ（隣の三角形にはみ出さない）
    ctx.beginPath()
    ctx.moveTo(dx0, dy0)
    ctx.lineTo(dx1, dy1)
    ctx.lineTo(dx2, dy2)
    ctx.closePath()
    ctx.clip()
    ctx.transform(a, b, c, d, e, f)
    ctx.drawImage(src, 0, 0)
    ctx.restore()
  }
  /** 初期プリセット（まだ配置をいじっていない）の灯体を、貼られた写真のすぐ下へ寄せる。
   *  ユーザーが一度でも灯体を動かしたら（rigCustomized）追従しない＝その配置を維持。 */
  private placeRigAtPhotoBottom(): void {
    if (this.rigCustomized || !this.box) return
    const y = Math.min(LH - 24, Math.round(this.box.y + this.box.h + 12)) // 写真の下端のすぐ下
    this.beams.forEach((b) => (b.y = y))
  }
  // ミュート/ソロは「写真（セット）ごと」に保存（配置は全シーン共通）
  private saveFixState(si: number): void {
    const sc = this.scenes[si]
    if (sc) sc.fix = this.beams.map((b) => ({ m: !!b.mute, s: !!b.solo }))
  }
  private loadFixState(si: number): void {
    const f = this.scenes[si]?.fix
    this.beams.forEach((b, i) => {
      b.mute = !!(f && f[i] && f[i].m)
      b.solo = !!(f && f[i] && f[i].s)
    })
  }
  selectScene(i: number): void {
    if (!this.scenes[i]) return
    if (this.activeScene >= 0 && this.activeScene !== i) {
      this.saveFixState(this.activeScene)
      const prev = this.scenes[this.activeScene]
      if (prev?.kind === 'video') prev.video?.pause() // 非表示の動画は止める（軽さ・本数対策）
    }
    this.activeScene = i
    const cur = this.scenes[i]
    this.mat = cur.mat
    if (cur.kind === 'video' && cur.video) {
      cur.video.play().catch(() => {})
      this.updateVideoFrame()
    }
    this.loadFixState(i)
    this.fitImage()
    this.placeRigAtPhotoBottom() // 初期プリセットは写真のすぐ下へ寄せる（未編集の間だけ）
    this.selectedPieceId = null // シーン切替で別シーンのピース選択を残さない
    this.pieceCreating = false // 作成モードもシーン切替で抜ける
    this.bump()
  }
  nextScene(dir: number): void {
    if (!this.scenes.length) return
    const i = Math.max(0, Math.min(this.scenes.length - 1, this.activeScene + dir))
    this.selectScene(i)
  }
  /** 写真を棚から削除。表示中の写真を消したら隣を出す（全部消えたら無灯）。 */
  removeScene(i: number): void {
    if (i < 0 || i >= this.scenes.length) return
    this.pushHistory()
    const removed = this.scenes[i]
    // Undoで戻せるよう破棄はしない（停止だけ・src解放/ revoke は unmount の disposeMedia で一括）
    if (removed.kind === 'video' && removed.video) removed.video.pause()
    const wasActive = i === this.activeScene
    this.scenes.splice(i, 1)
    if (wasActive) {
      this.activeScene = -1 // 表示中が消えた → 古い番号へ保存しない
      if (this.scenes.length === 0) {
        this.mat = null
        this.box = null
        this.bump()
      } else {
        this.selectScene(Math.min(i, this.scenes.length - 1)) // 隣を表示
      }
    } else {
      if (i < this.activeScene) this.activeScene-- // 前を消したら番号がひとつ繰り上がる
      this.bump()
    }
  }

  // ---------- シーン棚（明かりの完成形×9＝Pattern） ----------
  private currentLook(): Look {
    const s = this.st
    return {
      fxst: {
        chase: s.chase,
        search: s.search,
        searchRandom: s.searchRandom,
        strobe: s.strobe,
        colorChase: s.colorChase,
        breath: s.breath,
        fire: s.fire,
        wave: s.wave,
        bolt: s.bolt,
        rainbow: s.rainbow,
        zoompulse: s.zoompulse
      },
      fxp: JSON.parse(JSON.stringify(this.fxp)),
      lights: this.beams.map((b) => ({
        gauge: b.gauge,
        color: b.color.slice() as RGB3,
        pan: b.pan,
        tilt: b.tilt,
        zoom: b.zoom,
        mute: !!b.mute,
        solo: !!b.solo
      })),
      chasePalette: this.chasePalette.map((c) => c.slice() as RGB3)
    }
  }
  private applyLook(L: Look): void {
    if (!L) return
    const s = this.st
    // 旧シーン互換: 記録に無いFXは確実にOFF
    s.chase = s.search = s.searchRandom = s.colorChase = false
    s.strobe = 'off'
    s.breath = s.fire = s.wave = s.bolt = s.rainbow = s.zoompulse = false
    Object.assign(s, L.fxst)
    if (L.fxp) this.fxp = JSON.parse(JSON.stringify(L.fxp))
    // 復元データ(古い/壊れた/手編集 show.json)で lights が無い/壊れていても落ちないよう防御。
    const lights = Array.isArray(L.lights) ? L.lights : []
    lights.forEach((f, i) => {
      const b = this.beams[i]
      if (!b || !f || !Array.isArray(f.color)) return
      b.gauge = f.gauge
      b.color = f.color.slice() as RGB3
      b.pan = f.pan
      b.tilt = f.tilt
      b.zoom = f.zoom
      b.mute = !!f.mute // 旧パターン(未保存)は false=ミュート無し
      b.solo = !!f.solo
    })
    // 旧シーン互換: chasePalette が無ければ空（=8色ぜんぶ）に
    this.chasePalette = (L.chasePalette ?? []).map((c) => c.slice() as RGB3)
    this.t0 = performance.now()
  }
  toggleArmSave(): void {
    this.armedSave = !this.armedSave
    this.bump(false)
  }
  /** シーン枠を1つ増やす（好きなだけ＝上限64まで）。10個目以降はクリック/MIDI/LEARNで呼ぶ。 */
  addSceneSlot(): void {
    if (this.patterns.length >= 64) return
    this.pushHistory()
    this.patterns.push(null)
    this.bump()
  }
  /** 末尾の「空きシーン」を1つ減らす（最低9枠は残す・データのある枠は消さない）。 */
  removeLastSceneSlot(): void {
    const n = this.patterns.length
    if (n <= 9 || this.patterns[n - 1] !== null) return
    this.pushHistory()
    this.patterns.pop()
    this.bump()
  }
  /** PLAY/BUILD どちらからでも: armed中なら保存、そうでなければ呼び出し。 */
  patternSlotClick(i: number): void {
    if (this.armedSave) {
      this.pushHistory()
      const p = this.patterns[i]
      this.patterns[i] = {
        name: p ? p.name : 'シーン' + (i + 1),
        key: p ? p.key : null,
        midi: p ? p.midi : null,
        look: this.currentLook()
      }
      this.armedSave = false
      this.activePattern = i
      this.bump()
    } else if (this.patterns[i]) {
      this.applyPattern(i)
    }
  }
  applyPattern(i: number): void {
    const p = this.patterns[i]
    if (!p) return
    this.pushHistory()
    this.wake()
    this.activePattern = i
    this.sceneFadeSeq++ // 進行中のフェードがあれば止める（カット/別シーンで割込み）
    if (this.sceneFadeMode === 'fade' && this.sceneFadeMs > 0 && this.beams.length) {
      this.startSceneFade(p.look)
    } else {
      this.applyLook(p.look)
    }
    this.bump()
  }
  /** シーン(明かり)切替をフェードする。各灯の gauge/色/pan/tilt/zoom を sceneFadeMs かけて
   *  現在値→目標値へ補間。FX(真偽)は即適用（補間不可）。panicFade と同じ rAF 方式。 */
  private startSceneFade(L: Look): void {
    if (!L) return
    this.sceneFadeTo = L // 割込み(暗転/全点灯)時に目標へ即ジャンプで完了させるため覚える
    // 復元データが壊れていても落ちないよう lights を検証して使う。
    const lights = Array.isArray(L.lights) ? L.lights : []
    const from = this.beams.map((b) => ({
      gauge: b.gauge,
      color: b.color.slice() as RGB3,
      pan: b.pan,
      tilt: b.tilt,
      zoom: b.zoom
    }))
    // FX/fxp/chasePalette は即適用（旧シーン互換で全FX一旦OFF→記録を反映）
    const s = this.st
    s.chase = s.search = s.searchRandom = s.colorChase = false
    s.strobe = 'off'
    s.breath = s.fire = s.wave = s.bolt = s.rainbow = s.zoompulse = false
    Object.assign(s, L.fxst)
    if (L.fxp) this.fxp = JSON.parse(JSON.stringify(L.fxp))
    this.chasePalette = (L.chasePalette ?? []).map((c) => c.slice() as RGB3)
    // mute/solo は真偽値＝フェード不可。明かり切替と同時に即反映する。
    this.beams.forEach((b, i) => {
      const t = lights[i]
      if (t) {
        b.mute = !!t.mute
        b.solo = !!t.solo
      }
    })
    this.t0 = performance.now()
    const dur = this.sceneFadeMs
    const seq = this.sceneFadeSeq
    const t0 = performance.now()
    this.sceneFadeActive = true
    const lerp = (a: number, b: number, k: number): number => a + (b - a) * k
    const step = (now: number): void => {
      if (this.sceneFadeSeq !== seq || !this.sceneFadeActive) return // 割込み/暗転で中断
      const k = dur > 0 ? Math.min(1, (now - t0) / dur) : 1
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2 // easeInOut
      this.beams.forEach((b, i) => {
        const f = from[i]
        const t = lights[i]
        if (!f || !t || !Array.isArray(t.color)) return
        b.gauge = lerp(f.gauge, t.gauge, e)
        b.color = [
          Math.round(lerp(f.color[0], t.color[0], e)),
          Math.round(lerp(f.color[1], t.color[1], e)),
          Math.round(lerp(f.color[2], t.color[2], e))
        ] as RGB3
        b.pan = lerp(f.pan, t.pan, e)
        b.tilt = lerp(f.tilt, t.tilt, e)
        b.zoom = lerp(f.zoom, t.zoom, e)
      })
      this.bump(false)
      if (k < 1) requestAnimationFrame(step)
      else {
        lights.forEach((t, i) => {
          const b = this.beams[i]
          if (!b || !t || !Array.isArray(t.color)) return
          b.gauge = t.gauge
          b.color = t.color.slice() as RGB3
          b.pan = t.pan
          b.tilt = t.tilt
          b.zoom = t.zoom
        })
        this.sceneFadeActive = false
        this.sceneFadeTo = null
        this.bump(false)
      }
    }
    requestAnimationFrame(step)
  }
  /** 進行中のシーンフェードを「目標の明かりへ即ジャンプ」で完了させる（暗転/全点灯の割込み用）。
   *  ただ止めるだけだと gauge/色が中途半端なブレンドで取り残され、戻した時に
   *  「どのシーンでもない明かり」になる（照明卓はフェード割込み＝目標へスナップが常識）。 */
  private snapSceneFade(): void {
    const L = this.sceneFadeTo
    if (this.sceneFadeActive && L) {
      const lights = Array.isArray(L.lights) ? L.lights : []
      lights.forEach((f, i) => {
        const b = this.beams[i]
        if (!b || !f || !Array.isArray(f.color)) return
        b.gauge = f.gauge
        b.color = f.color.slice() as RGB3
        b.pan = f.pan
        b.tilt = f.tilt
        b.zoom = f.zoom
      })
    }
    this.sceneFadeActive = false
    this.sceneFadeTo = null
  }
  renamePattern(i: number, name: string): void {
    const p = this.patterns[i]
    if (!p) return
    this.pushHistory()
    p.name = name.trim() || 'シーン' + (i + 1)
    this.bump()
  }
  /** スロット i の明かりを消す＝空きにする（位置・他スロットのショートカットは保持。Undoで戻せる）。 */
  clearPattern(i: number): void {
    if (i < 0 || i >= this.patterns.length || !this.patterns[i]) return
    this.pushHistory()
    this.patterns[i] = null
    if (this.activePattern === i) this.activePattern = -1
    this.bump()
  }
  setLearnPattern(i: number | null): void {
    this.learnPattern = i
    if (i !== null) {
      this.initMidi() // Windows は Web MIDI をここで初期化（Mac は CoreMIDI 主経路・冪等）
      this.learnScene = null // 排他：シーン Learn を消す
      this.learnFx = null
      this.learnColor = null
      this.learnStrobe = false
      this.learnMotifChase = false
    }
    this.bump(false)
  }
  assignShortcut(i: number, key: string | null, midi: number | null): void {
    this.pushHistory()
    if (key != null) this.clearKeyEverywhere(key) // 1キー1役（pattern内の同キーもここで外れる）
    if (midi != null) this.clearMidiNoteEverywhere(midi) // 1ノート1役
    const p = this.patterns[i]
    if (p) {
      if (key != null) p.key = key
      if (midi != null) p.midi = midi
    }
    this.learnPattern = null
    this.bump()
  }
  /** シーン名を変える（空なら 'PHOTO n' に戻す）。 */
  renameScene(i: number, name: string): void {
    if (i < 0 || i >= this.scenes.length) return
    this.pushHistory()
    this.scenes[i].name = name.trim() || 'PHOTO ' + (i + 1)
    this.bump()
  }
  /** シーン MIDI Learn の待機を開始/解除。null で解除。 */
  setLearnScene(i: number | null): void {
    if (i !== null && (i < 0 || i >= this.scenes.length)) return
    this.learnScene = i
    if (i !== null) {
      this.initMidi() // Windows は Web MIDI をここで初期化（Mac は CoreMIDI 主経路・冪等）
      // 他の Learn 系を全部消す（同時に 2 つ待たない）。
      this.learnPattern = null
      this.masterLearn = false
      this.learnParam = null
      this.learnFx = null
      this.learnColor = null
      this.learnStrobe = false
      this.learnMotifChase = false
    }
    this.bump(false)
  }
  /** シーンに MIDI Note を割当。同じ Note は他シーン＋他カテゴリからも外す＝1ノート1役。null でクリア。 */
  assignSceneMidi(i: number, note: number | null): void {
    if (i < 0 || i >= this.scenes.length) return
    this.pushHistory()
    if (note !== null) this.clearMidiNoteEverywhere(note)
    this.scenes[i].midiNote = note
    this.learnScene = null
    this.bump()
  }

  /** マスク用画像を入れる（dataURL）。null/空文字で解除。
   *  入れた時点でアルファ境界線キャンバスを作る（BUILDで重ねて表示）。 */
  async setMaskFromDataUrl(dataUrl: string | null): Promise<void> {
    if (!dataUrl) {
      this.maskImage = null
      this.maskSrc = null
      this.maskEdgeCanvas = null
      this.decorSegs = null
      this.decorDrawable = null
      this.decorMaskW = 0
      this.decorMaskH = 0
      this.bump()
      return
    }
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const im = new Image()
      im.onload = () => resolve(im)
      im.onerror = (): void => reject(new Error('mask load failed'))
      im.src = dataUrl
    })
    this.maskImage = img
    this.maskSrc = dataUrl
    this.maskEdgeCanvas = this.buildMaskEdgeCanvas(img)
    this.rebuildDecorMask()
    this.regenDecorLeds()
    this.bump()
  }

  /** アルファ境界線だけ描いた canvas を「マスク画像の元アスペクト比そのまま」で作る。
   *  - 巨大画像（>= 4096×4096 相当の総ピクセル）は内部で 4096×... に縮小してから抽出（8K でも OOM しない安全装置）
   *  - 戻り値の canvas サイズはマスク画像の縦横比そのまま（描画側で contain fit する）
   *  - 取込み 1 回だけ呼ばれる重い処理。console.time で実時間ログを出す。
   *  - サイズが 0 や読込み失敗時は null を返す（呼び元で握りつぶし）。 */
  private buildMaskEdgeCanvas(img: HTMLImageElement): HTMLCanvasElement | null {
    const swSrc = img.naturalWidth || img.width
    const shSrc = img.naturalHeight || img.height
    if (swSrc <= 0 || shSrc <= 0) return null
    // 8K fallback: 総ピクセルが約 16M を超えたら 4096 を長辺に揃えてダウンサンプル
    const MAX_PX = 4096 * 4096
    let sw = swSrc
    let sh = shSrc
    if (swSrc * shSrc > MAX_PX) {
      const k = Math.sqrt(MAX_PX / (swSrc * shSrc))
      sw = Math.max(1, Math.round(swSrc * k))
      sh = Math.max(1, Math.round(shSrc * k))
    }
    const tag = `[mask] edge ${sw}×${sh} from ${swSrc}×${shSrc}`
    console.time(tag)
    let edge: HTMLCanvasElement | null = null
    try {
      // 1) 抽出元のアルファ取得（必要なら縮小してから）
      const src = document.createElement('canvas')
      src.width = sw
      src.height = sh
      const sctx = src.getContext('2d', { willReadFrequently: true })!
      sctx.imageSmoothingEnabled = true
      sctx.imageSmoothingQuality = 'high'
      sctx.clearRect(0, 0, sw, sh)
      sctx.drawImage(img, 0, 0, sw, sh)
      const id = sctx.getImageData(0, 0, sw, sh)
      const a = id.data
      const TH = 128
      // 2) 同サイズのエッジ canvas にシアンを打つ
      edge = document.createElement('canvas')
      edge.width = sw
      edge.height = sh
      const ectx = edge.getContext('2d')!
      const oId = ectx.createImageData(sw, sh)
      const od = oId.data
      const R = 0x22
      const G = 0xd3
      const B = 0xee
      const rowStride = sw * 4
      for (let y = 0; y < sh; y++) {
        for (let x = 0; x < sw; x++) {
          const i = (y * sw + x) * 4
          const cur = a[i + 3] >= TH ? 1 : 0
          let isEdge = false
          if (x > 0 && (a[i - 4 + 3] >= TH ? 1 : 0) !== cur) isEdge = true
          if (!isEdge && x < sw - 1 && (a[i + 4 + 3] >= TH ? 1 : 0) !== cur) isEdge = true
          if (!isEdge && y > 0 && (a[i - rowStride + 3] >= TH ? 1 : 0) !== cur) isEdge = true
          if (!isEdge && y < sh - 1 && (a[i + rowStride + 3] >= TH ? 1 : 0) !== cur) isEdge = true
          if (isEdge) {
            od[i] = R
            od[i + 1] = G
            od[i + 2] = B
            od[i + 3] = 255
          }
        }
      }
      ectx.putImageData(oId, 0, 0)
      // GC ヒント：抽出元 canvas のバックストアは即解放（巨大画像時に効く）
      src.width = 0
      src.height = 0
    } catch (e) {
      console.error('[mask] buildMaskEdgeCanvas failed', e)
      edge = null
    }
    console.timeEnd(tag)
    return edge
  }

  /** マスクを画面に描くときの「写真と同じ枠」を返す。
   *  - active scene の写真 box（this.box, LW×LH 座標系）→ Q 倍で IW×IH 座標系の枠に合わせる
   *  - その枠の中で マスクの元アスペクト比を保ったまま contain fit
   *  - 写真が無いときはステージ全体 IW×IH に対して contain fit（線だけ見える）
   *  - 戻り値は IW×IH 座標系（display ctx の transform 下でそのまま使える）
   *  - マスク未取込なら null */
  getMaskDisplayBox(): { x: number; y: number; w: number; h: number } | null {
    if (!this.maskImage) return null
    const mw = this.maskImage.naturalWidth || this.maskImage.width
    const mh = this.maskImage.naturalHeight || this.maskImage.height
    if (mw <= 0 || mh <= 0) return null
    const photoBox = this.box
    if (photoBox) {
      const px = photoBox.x * Q
      const py = photoBox.y * Q
      const pw = photoBox.w * Q
      const ph = photoBox.h * Q
      const sc = Math.min(pw / mw, ph / mh)
      const iw = mw * sc
      const ih = mh * sc
      return { x: px + (pw - iw) / 2, y: py + (ph - ih) / 2, w: iw, h: ih }
    }
    const sc = Math.min(IW / mw, IH / mh)
    const iw = mw * sc
    const ih = mh * sc
    return { x: (IW - iw) / 2, y: (IH - ih) / 2, w: iw, h: ih }
  }

  // ---------- 電飾パターン（簡単スケッチ・卓なし＝アプリ自身が色を流す） ----------

  /** マスク表示枠を LW×LH 座標で返す（getMaskDisplayBox は IW×IH＝Q倍なので割り戻す）。 */
  private getMaskBoxLW(): { x: number; y: number; w: number; h: number } | null {
    const b = this.getMaskDisplayBox()
    if (!b) return null
    return { x: b.x / Q, y: b.y / Q, w: b.w / Q, h: b.h / Q }
  }

  /** 電飾パターン設定を更新。形/本数/ピッチが変わったら LED を作り直す。 */
  setDecor(patch: Partial<DecorPattern>): void {
    const before = this.decor
    this.decor = { ...before, ...patch }
    const geomChanged =
      (patch.kind !== undefined && patch.kind !== before.kind) ||
      (patch.channels !== undefined && patch.channels !== before.channels) ||
      (patch.lineSpacing !== undefined && patch.lineSpacing !== before.lineSpacing)
    if (geomChanged || (this.decor.enabled && !this.decorSegs && !!this.maskImage)) {
      this.regenDecorLeds()
    }
    if (patch.playing === true) this.decorLastNow = -1 // 再開でチェイスが飛ばないように
    this.bump()
  }

  /** マスク画像のアルファ→「描ける所」ビットマップを作業解像度で作って保持（マスク取込時だけ）。
   *  作業解像度は長辺 1280 に抑える＝巨大マスクでも軽い。極性はチャートエディタ computeMask と同じ。 */
  private rebuildDecorMask(): void {
    const img = this.maskImage
    if (!img) {
      this.decorDrawable = null
      this.decorMaskW = 0
      this.decorMaskH = 0
      return
    }
    const swSrc = img.naturalWidth || img.width
    const shSrc = img.naturalHeight || img.height
    if (swSrc <= 0 || shSrc <= 0) {
      this.decorDrawable = null
      return
    }
    const MAXW = 1280
    const k = Math.min(1, MAXW / Math.max(swSrc, shSrc))
    const sw = Math.max(1, Math.round(swSrc * k))
    const sh = Math.max(1, Math.round(shSrc * k))
    const c = document.createElement('canvas')
    c.width = sw
    c.height = sh
    const ctx = c.getContext('2d', { willReadFrequently: true })
    if (!ctx) {
      this.decorDrawable = null
      return
    }
    ctx.clearRect(0, 0, sw, sh)
    ctx.drawImage(img, 0, 0, sw, sh)
    const data = ctx.getImageData(0, 0, sw, sh).data
    // この画像にアルファがあるか（computeMask と同じ判定）。
    let hasAlpha = false
    for (let i = 0; i < sw * sh; i++) {
      if (data[i * 4 + 3] < 250) {
        hasAlpha = true
        break
      }
    }
    // 描ける所＝透過(アルファ無し画像なら黒)。チャートエディタ computeMask と同じ極性で 255 に。
    const drawable = new Uint8Array(sw * sh)
    for (let i = 0; i < sw * sh; i++) {
      const empty = isEmptyPixel(
        data[i * 4],
        data[i * 4 + 1],
        data[i * 4 + 2],
        data[i * 4 + 3],
        hasAlpha
      )
      drawable[i] = empty ? 255 : 0
    }
    this.decorDrawable = drawable
    this.decorMaskW = sw
    this.decorMaskH = sh
    c.width = 0
    c.height = 0
  }

  /** 保持中の「描ける所」ビットマップから、各コンテナごとに線分を作り直す（形/色数/間隔変更時）。
   *  太さ(px)は描画側なので含めない＝太さスライダーは再生成不要で軽い。
   *  重い canvas 読み出しは rebuildDecorMask 側に分離してあるので、スライダー操作でも軽い。 */
  private regenDecorLeds(): void {
    const d = this.decorDrawable
    if (!d || this.decorMaskW <= 0 || this.decorMaskH <= 0) {
      this.decorSegs = null
      return
    }
    this.decorSegs = buildDecorLeds(d, this.decorMaskW, this.decorMaskH, {
      kind: this.decor.kind,
      channels: this.decor.channels,
      lineSpacing: this.decor.lineSpacing
    })
  }

  /** 電飾チェイスが動いているか（毎フレーム描き直しが要るか）。 */
  decorAnimating(): boolean {
    return this.decor.enabled && this.decor.playing && !!this.decorSegs && this.decorSegs.length > 0
  }

  /** チェイス用の時計（秒）。playing 中だけ進める。 */
  private decorTime(now: number): number {
    if (this.decorLastNow < 0) this.decorLastNow = now
    if (this.decor.enabled && this.decor.playing) {
      this.decorClock += (now - this.decorLastNow) / 1000
    }
    this.decorLastNow = now
    return this.decorClock
  }

  /** 既に「LW×LH 座標へ変換済み」の ctx に、box(LW×LH)の中へ電飾の線分を発光描画する。
   *  線分（run）を「太さ thickness(本番px)」の長方形で描く＝点ではなく“線そのもの”。
   *  frame（fc・Q変換）と 出力(outCv・box→出力写像)で共通に使う。 */
  private drawDecorLeds(
    ctx: CanvasRenderingContext2D,
    box: { x: number; y: number; w: number; h: number },
    t: number
  ): void {
    const segs = this.decorSegs
    if (!segs || !segs.length || this.decorMaskW <= 0 || this.decorMaskH <= 0) return
    const d = this.decor
    const N = Math.max(1, d.channels)
    const cs: { css: string; a: number }[] = new Array(N)
    for (let i = 0; i < N; i++) {
      const [r, g, b, a] = decorChannelColor(i, N, d.effect, d.direction, d.color1, d.color2, d.speed, t)
      cs[i] = { css: `rgb(${r | 0},${g | 0},${b | 0})`, a }
    }
    const sx = box.w / this.decorMaskW // マスク px → LW（x）
    const sy = box.h / this.decorMaskH // マスク px → LW（y・アスペクト同率）
    // 太さは本番フレーム(IW)px 指定。fc は Q 変換下なので LW へは /Q。最小でも約 1px 残す。
    const thick = Math.max(0.6, d.thickness / Q)
    const half = thick / 2
    ctx.globalCompositeOperation = 'lighter'
    for (let kk = 0; kk < segs.length; kk++) {
      const S = segs[kk]
      const c = cs[S.c]
      if (!c || c.a <= 0.03) continue
      const X = box.x + S.x * sx
      const Y = box.y + S.y * sy
      ctx.fillStyle = c.css
      ctx.globalAlpha = Math.min(1, c.a)
      if (S.vertical) ctx.fillRect(X - half, Y, thick, Math.max(thick, S.len * sy))
      else ctx.fillRect(X, Y - half, Math.max(thick, S.len * sx), thick)
    }
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
  }

  /** 出力(outCv)に電飾パターンを重ねる（モチーフと同じ box→出力写像）。 */
  private drawDecorOnOutput(t: number): void {
    if (this.lightOnly || !this.box || this.outW <= 16) return
    if (!this.decor.enabled || !this.decorSegs || !this.decorSegs.length) return
    const boxLW = this.getMaskBoxLW()
    if (!boxLW) return
    const oc = this.outCv.getContext('2d', { willReadFrequently: true })!
    const box = this.box
    const sx = this.outW / box.w
    const sy = this.outH / box.h
    oc.setTransform(sx, 0, 0, sy, -box.x * sx, -box.y * sy)
    this.drawDecorLeds(oc, boxLW, t)
    oc.setTransform(1, 0, 0, 1, 0, 0)
    oc.globalCompositeOperation = 'source-over'
    oc.globalAlpha = 1
  }

  // ---------- パニック・全体 ----------
  wake(): void {
    this.panicSeq++
    this.panicGain = 1
    this.panicActive = false
    this.snapSceneFade() // フェード中の割込み＝目標へ即ジャンプで完了（中途半端な明かりで残さない）
  }
  blackout(): void {
    // 暗転の直前の look（FX・明るさ）を履歴へ積む → ⌘Z で直前へ戻せる。stopAllFx は
    // 内部呼びなので二重に積まない（pushHist=false）。
    this.pushHistory()
    this.panicSeq++
    this.panicGain = 0
    this.panicActive = false
    this.snapSceneFade() // フェード中の暗転＝目標へ即ジャンプしてから真っ黒（戻した時に正しいシーンの明かり）
    this.stopAllFx(false)
    this.activePattern = -1
    this.bump(false)
  }
  fullOn(): void {
    this.pushHistory()
    this.wake()
    this.beams.forEach((b) => (b.gauge = 1))
    this.bump()
  }
  /** ESC: 1.5秒で全部ふわっと闇へ。途中で明かりを触ると中止。 */
  panicFade(): void {
    // パニック開始時に直前の look（FX・明るさ）を履歴へ積む → フェード完了後でも ⌘Z で一発で
    // 直前へ戻せる。完了時の stopAllFx は内部呼びなので二重に積まない（pushHist=false）。
    this.pushHistory()
    const my = ++this.panicSeq
    const t1 = performance.now()
    const from = this.panicGain
    this.panicActive = true // 描画ループに「フェード中＝描き続けて」と知らせる
    const step = (now: number): void => {
      if (this.panicSeq !== my) {
        this.panicActive = false
        return
      }
      const k = Math.min(1, (now - t1) / 1500)
      this.panicGain = from * (1 - k)
      if (k < 1) requestAnimationFrame(step)
      else {
        this.panicActive = false
        this.stopAllFx(false)
        this.activePattern = -1
        this.bump(false)
      }
    }
    requestAnimationFrame(step)
  }

  // ---------- 色プリセット ----------
  addUserColor(rgb: RGB3): void {
    if (!this.userColors.some((c) => sameRgb(c, rgb))) {
      this.pushHistory()
      this.userColors.push(rgb.slice() as RGB3)
      this.bump()
    }
  }
  removeUserColor(i: number): void {
    this.pushHistory()
    this.userColors.splice(i, 1)
    this.bump()
  }

  // ---------- カラフルチェイスの色並び（COLORからD&Dで組む・空=8色ぜんぶ） ----------
  addChaseColor(rgb: RGB3): void {
    this.pushHistory()
    this.chasePalette.push(rgb.slice() as RGB3)
    this.bump()
  }
  removeChaseColor(i: number): void {
    if (i < 0 || i >= this.chasePalette.length) return
    this.pushHistory()
    this.chasePalette.splice(i, 1)
    this.bump()
  }
  clearChasePalette(): void {
    if (!this.chasePalette.length) return
    this.pushHistory()
    this.chasePalette = []
    this.bump()
  }

  // ---------- MIDI ----------
  private midiTried = false
  /** 検出した MIDI 入力ポート名（ステータス表示用）。 */
  midiInputs: string[] = []
  /** MIDI 入力構成が変わったとき呼ばれる（UI 側がメインへ通知するのに使う）。 */
  onMidiInputs: ((names: string[]) => void) | null = null
  setMasterLearn(on: boolean): void {
    this.masterLearn = on
    if (on) {
      this.learnParam = null // 同時に2つ待たない
      this.learnFx = null
      this.learnColor = null
      this.learnStrobe = false
      this.learnMotifChase = false
      this.initMidi()
    }
    this.bump(false)
  }
  /** FXツマミ等にMIDI CCを学習する待ち状態（次に動かしたCCがこのparamIdへ）。 */
  setLearnParam(id: string | null): void {
    this.learnParam = id
    if (id != null) {
      this.masterLearn = false
      this.learnFx = null
      this.learnColor = null
      this.learnStrobe = false
      this.learnMotifChase = false
      this.initMidi()
    }
    this.bump(false)
  }
  /** FX を「次のMIDIノート / キー」で呼べるようにする LEARN 待機。null=中止。 */
  setLearnFx(key: FxKey | null): void {
    this.learnFx = key
    if (key != null) {
      this.learnPattern = null
      this.learnScene = null
      this.masterLearn = false
      this.learnParam = null
      this.learnColor = null
      this.learnStrobe = false
      this.learnMotifChase = false
      this.initMidi()
    }
    this.bump(false)
  }
  /** FX にショートカット（キー/MIDIノート）を割り当てる。両方nullで解除。 */
  assignFxShortcut(fx: FxKey, code: string | null, midi: number | null): void {
    if (code != null) this.clearKeyEverywhere(code) // 1キー1役
    if (midi != null) this.clearMidiNoteEverywhere(midi) // 1ノート1役
    if (code != null) this.fxKey[fx] = code
    if (midi != null) this.fxMidi[fx] = midi
    this.learnFx = null
    this.bump()
  }
  /** FX の割当を解除（キー・MIDI両方）。 */
  clearFxShortcut(fx: FxKey): void {
    delete this.fxKey[fx]
    delete this.fxMidi[fx]
    this.bump()
  }
  /** UI(fxdefs)が「paramId→0..1を実値へ反映する関数」を登録する。 */
  setParamApply(map: Map<string, (v01: number) => void>): void {
    this.paramApply = map
  }
  /** パラメータの MIDI CC 割当を解除（◎ボタン右クリック）。 */
  clearParamMidi(id: string): void {
    delete this.paramMidi[id]
    if (this.learnParam === id) this.learnParam = null
    this.bump()
  }
  /** 特別ストロボのON/OFF（1回目=今の出力を全体点滅／2回目=元のシーンに戻る・非破壊）。 */
  toggleStrobeOverride(): void {
    this.strobeOverride = !this.strobeOverride
    this.bump(false)
  }
  /** 特別ストロボの MIDI LEARN 待機の ON/OFF（他の LEARN は解除）。 */
  setLearnStrobe(on: boolean): void {
    this.learnStrobe = on
    if (on) {
      this.initMidi() // Windows は Web MIDI をここで初期化（Mac は CoreMIDI 主経路・冪等）
      this.learnFx = null
      this.learnColor = null
      this.learnPattern = null
      this.learnScene = null
      this.learnMotifChase = false
    }
    this.bump(false)
  }
  /** 特別ストロボの MIDI 割当を解除。 */
  clearStrobeShortcut(): void {
    this.strobeMidi = null
    this.bump()
  }
  /** モチーフチェイスの MIDI Learn 待機を開始/解除。 */
  setLearnMotifChase(on: boolean): void {
    this.learnMotifChase = on
    if (on) {
      this.initMidi() // Windows は Web MIDI をここで初期化（Mac は CoreMIDI 主経路・冪等）
      this.learnFx = null
      this.learnColor = null
      this.learnPattern = null
      this.learnScene = null
      this.learnStrobe = false
    }
    this.bump(false)
  }
  /** モチーフチェイスの MIDI 割当を解除。 */
  clearMotifChaseShortcut(): void {
    this.motifChaseMidi = null
    this.bump()
  }
  /** 特別ストロボの速さ 0..1。 */
  setStrobeRate(v01: number): void {
    this.strobeRate = Math.max(0, Math.min(1, v01))
    this.bump()
  }
  /** MIDI メッセージ1件を処理（ネイティブ midiread / Web MIDI 共通の入口）。
   *  stt=ステータス, note=データ1(ノート/CC番号), vel=データ2(ベロシティ/値)。 */
  handleMidiMessage(stt: number, note: number, vel: number): void {
    if ((stt & 0xf0) === 0x90 && vel > 0) {
      // ノートON：LEARN中なら割当、そうでなければ割当済みを発火
      if (this.learnFx != null) this.assignFxShortcut(this.learnFx, null, note)
      else if (this.learnPattern != null) this.assignShortcut(this.learnPattern, null, note)
      else if (this.learnScene != null) this.assignSceneMidi(this.learnScene, note)
      else if (this.learnStrobe) {
        this.clearMidiNoteEverywhere(note) // 1ノート1役
        this.strobeMidi = note
        this.learnStrobe = false
        this.bump()
      } else if (this.learnMotifChase) {
        this.clearMidiNoteEverywhere(note) // 1ノート1役
        this.motifChaseMidi = note
        this.learnMotifChase = false
        this.bump()
      } else if (this.strobeMidi != null && note === this.strobeMidi) {
        this.toggleStrobeOverride()
      } else if (this.motifChaseMidi != null && note === this.motifChaseMidi) {
        this.setMotifChase(!this.motifChase)
      } else {
        const fk = (Object.keys(this.fxMidi) as FxKey[]).find((k) => this.fxMidi[k] === note)
        const ck = Object.keys(this.colorMidi).find((h) => this.colorMidi[h] === note)
        if (fk) this.fxToggle(fk)
        else if (ck) this.setColor(hexToRgb(ck))
        else {
          const pi = this.patterns.findIndex((p) => p && p.midi === note)
          if (pi >= 0) this.applyPattern(pi)
          else {
            const si = this.scenes.findIndex((s) => s.midiNote === note)
            if (si >= 0) this.selectScene(si)
          }
        }
      }
    } else if ((stt & 0xf0) === 0xb0) {
      // CC = 物理つまみ/フェーダー
      if (this.masterLearn) {
        this.masterMidi = note
        this.masterLearn = false
        this.bump()
      } else if (this.learnParam != null) {
        this.paramMidi[this.learnParam] = note // FXツマミ等にCC割当
        this.learnParam = null
        this.bump()
      } else {
        if (this.masterMidi === note) this.setMaster(vel / 127)
        for (const pid in this.paramMidi) {
          if (this.paramMidi[pid] === note) this.paramApply.get(pid)?.(vel / 127)
        }
      }
    }
  }
  initMidi(): void {
    const nav = navigator as Navigator & { requestMIDIAccess?: () => Promise<MIDIAccess> }
    if (this.midiTried || !nav.requestMIDIAccess) return
    // midiTried は「成功してから」立てる。requestMIDIAccess はユーザー操作(クリック)起点でないと
    // 解決しないことがあり、ここで先に true にすると mount時の失敗が以降の再試行を永久ブロックする。
    nav
      .requestMIDIAccess()
      .then((acc) => {
        if (this.midiTried) return // 別の呼び出しが先に成功済みなら二重初期化しない
        this.midiTried = true
        const refreshInputs = (): void => {
          const names: string[] = []
          acc.inputs.forEach((inp) => names.push(inp.name || 'MIDI'))
          this.midiInputs = names
          console.log('[midi] アクセス許可。入力ポート:', names.length ? names.join(', ') : '(なし)')
          this.onMidiInputs?.(names)
          this.bump()
        }
        const hook = (inp: MIDIInput): void => {
          inp.onmidimessage = (m: MIDIMessageEvent): void => {
            const data = m.data
            if (!data) return
            this.handleMidiMessage(data[0], data[1] ?? 0, data[2] ?? 0)
          }
        }
        acc.inputs.forEach(hook)
        refreshInputs()
        acc.onstatechange = (e): void => {
          const port = e.port
          if (port && port.type === 'input' && port.state === 'connected') hook(port as MIDIInput)
          refreshInputs()
        }
      })
      .catch((e) => {
        // 失敗はログのみ。midiTried は立てない＝次のクリック(操作起点)で再試行できる。
        console.warn('[midi] requestMIDIAccess 失敗:', e)
      })
  }

  // ---------- 永続化（リグ＋シーン棚＋色プリセット。写真は重いので保存しない） ----------
  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => this.saveRig(), 800)
  }
  /** 画面を閉じる前に確実に保存する（オートセーブの遅延を待たない）。 */
  flushSave(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    this.saveRig()
  }
  // localStorage / 公演ファイル 共通のリグ内容（配置=beams は含めない＝起動時まっさら。
  // のむさん確定 2026-06-13「前のセッティングを引きずらない」）。保存対象＝シーン明かり
  // (patterns)・色プリセット・チェイス色・FXツマミ値・MASTER/SMOKE・MIDI割当。
  private rigData(): RigPayload {
    return {
      st: { master: this.st.master, smoke: this.st.smoke },
      fxp: this.fxp,
      patterns: this.patterns,
      userColors: this.userColors,
      chasePalette: this.chasePalette,
      paramMidi: this.paramMidi,
      masterMidi: this.masterMidi,
      fxMidi: this.fxMidi,
      fxKey: this.fxKey,
      falloffPow: this.falloffPow,
      outCap: this.outCap,
      colorMidi: this.colorMidi,
      colorKey: this.colorKey,
      sceneFadeMode: this.sceneFadeMode,
      sceneFadeMs: this.sceneFadeMs,
      strobeMidi: this.strobeMidi,
      strobeRate: this.strobeRate,
      motifChaseMidi: this.motifChaseMidi
    }
  }
  // rigData を取り込む（localStorage / 公演読込 共通）。灯体配置は読み込まない。
  private applyRig(d: RigPayload | null | undefined): void {
    if (!d) return
    if (d.st) {
      this.st.master = d.st.master ?? 1
      this.st.smoke = d.st.smoke ?? 12
    }
    if (d.fxp) this.fxp = { ...this.fxp, ...d.fxp }
    if (Array.isArray(d.patterns)) this.patterns = d.patterns
    if (Array.isArray(d.userColors)) this.userColors = d.userColors
    if (Array.isArray(d.chasePalette)) this.chasePalette = d.chasePalette
    if (d.paramMidi && typeof d.paramMidi === 'object') this.paramMidi = d.paramMidi
    if (typeof d.masterMidi === 'number') this.masterMidi = d.masterMidi
    if (d.fxMidi && typeof d.fxMidi === 'object') this.fxMidi = d.fxMidi
    if (d.fxKey && typeof d.fxKey === 'object') this.fxKey = d.fxKey
    if (typeof d.falloffPow === 'number') this.falloffPow = d.falloffPow
    if (typeof d.outCap === 'number') this.outCap = d.outCap
    if (d.colorMidi && typeof d.colorMidi === 'object') this.colorMidi = d.colorMidi
    if (d.colorKey && typeof d.colorKey === 'object') this.colorKey = d.colorKey
    if (d.sceneFadeMode === 'cut' || d.sceneFadeMode === 'fade') this.sceneFadeMode = d.sceneFadeMode
    if (typeof d.sceneFadeMs === 'number') this.sceneFadeMs = d.sceneFadeMs
    if (typeof d.strobeMidi === 'number') this.strobeMidi = d.strobeMidi
    if (typeof d.motifChaseMidi === 'number') this.motifChaseMidi = d.motifChaseMidi
    if (typeof d.strobeRate === 'number') this.strobeRate = d.strobeRate
  }
  private saveRig(): void {
    // セッション内（ページ生存中）だけ保持＝モード切替の行き来では残るが、アプリ再起動で消える。
    // localStorage には書かない＝新しく開いたら明かり/色/MIDI はまっさら。
    try {
      sessionRig = JSON.parse(JSON.stringify(this.rigData())) as RigPayload
    } catch {
      /* ignore */
    }
  }
  private loadRig(): void {
    // 同一セッション中に作ったリグだけ復元（モード切替で消えないように）。
    // アプリ再起動後は sessionRig=null＝初期状態のまま＝まっさら。
    if (sessionRig) this.applyRig(sessionRig)
  }

  /** 自動保存してよい“本物の中身”があるか。写真(scene)もマスクも無く配置も未編集
   *  （＝起動直後のデフォルト灯体だけ）なら false＝中身なし扱い。冷間起動のデフォルト
   *  状態で前回データ(il-autosave)を上書きする事故を防ぐためのガード。 */
  hasSaveableContent(): boolean {
    return this.scenes.length > 0 || !!this.maskImage || this.rigCustomized
  }

  /** 公演まるごとの書き出し材料を作る（リグ＋シーン一覧＋メディアのファイル）。
   *  写真=元dataURL／動画=blobをfetchしてdataURL化。重いので保存時だけ呼ぶ。 */
  async serializeShow(): Promise<{ json: string; media: { file: string; dataUrl: string }[] }> {
    const media: { file: string; dataUrl: string }[] = []
    const scenesMeta: ShowSceneMeta[] = []
    for (let i = 0; i < this.scenes.length; i++) {
      const sc = this.scenes[i]
      let dataUrl: string | null = null
      if (sc.kind === 'photo') dataUrl = sc.src ?? sc.img?.src ?? null
      else if (sc.kind === 'video' && sc.objectUrl) dataUrl = await blobUrlToDataUrl(sc.objectUrl)
      const file = dataUrl ? `media/${String(i + 1).padStart(3, '0')}.${extFromDataUrl(dataUrl)}` : null
      if (dataUrl && file) media.push({ file, dataUrl })
      scenesMeta.push({
        name: sc.name,
        kind: sc.kind,
        fix: sc.fix ?? null,
        media: file,
        midiNote: sc.midiNote ?? null,
        warpBox: sc.warpBox ?? null,
        pieces: sc.pieces ? sc.pieces.map((p) => ({
          id: p.id,
          src: { ...p.src },
          corners: [
            { ...p.corners[0] },
            { ...p.corners[1] },
            { ...p.corners[2] },
            { ...p.corners[3] }
          ]
        })) : undefined
      })
    }
    // マスク画像（あれば）も media/ に書き出して show.json から参照
    let maskMeta: { file: string } | null = null
    if (this.maskSrc) {
      const file = `media/mask.${extFromDataUrl(this.maskSrc)}`
      maskMeta = { file }
      media.push({ file, dataUrl: this.maskSrc })
    }
    const show: ShowFile = {
      app: 'LED STAGE IMAGER',
      kind: 'imagelight-show',
      version: 1,
      rig: this.rigData(),
      // 灯体配置を丸ごと保存（runtime 専用の _tn/_cn/_zp は復元時に再計算されるので含めてOK）。
      beams: this.beams.map((b) => ({ ...b, color: b.color.slice() as RGB3, sp: { ...b.sp }, dmx: b.dmx ? { ...b.dmx } : undefined })),
      scenes: scenesMeta,
      mask: maskMeta,
      colorWash: this.colorWash,
      baseLift: this.baseLift,
      decor: {
        ...this.decor,
        color1: this.decor.color1.slice() as RGB3,
        color2: this.decor.color2.slice() as RGB3
      },
      sfx: {
        flame: { ...this.flame.params },
        sparkler: { ...this.sparkler.params },
        rain: { ...this.rain.params, on: this.rain.on },
        lowSmoke: { ...this.lowSmoke.params, on: this.lowSmoke.on },
        seqSteps: this.sfxSeqSteps.map((s) => s.slice()),
        seqMs: this.sfxSeqMs,
        flameChase: { on: this.flameChaseOn, pattern: this.flameChasePattern, ms: this.flameChaseMs },
        sfxChase: { mode: this.sfxChaseMode, ms: this.sfxChaseMs }
      }
    }
    return { json: JSON.stringify(show, null, 2), media }
  }

  /** 公演を読み込む。show.json の文字列と「media/ファイル名 → dataURL」の対応を渡す。
   *  既存のシーン/明かりを置き換える（写真も動画も復元）。 */
  async restoreShow(showJson: string, mediaByFile: Record<string, string>): Promise<boolean> {
    // 復元中フラグを立てる（finally で必ず下ろす）。途中の await 中に自動保存タイマーが
    // 作りかけのショーを書き出して il-autosave を潰すのを防ぐ。
    this.restoring = true
    try {
      return await this.restoreShowInner(showJson, mediaByFile)
    } finally {
      this.restoring = false
    }
  }

  private async restoreShowInner(
    showJson: string,
    mediaByFile: Record<string, string>
  ): Promise<boolean> {
    let show: ShowFile
    try {
      show = JSON.parse(showJson) as ShowFile
    } catch {
      return false
    }
    if (!show || show.kind !== 'imagelight-show') return false
    // 既存メディアを停止＋解放してから差し替え
    for (const s of this.scenes) {
      if (s.video) {
        try {
          s.video.pause()
        } catch {
          /* noop */
        }
      }
      if (s.objectUrl) URL.revokeObjectURL(s.objectUrl)
    }
    this.scenes = []
    this.activeScene = -1
    // 既存マスクも一旦解除（無いショーを開いたら線が残らないように）
    this.maskImage = null
    this.maskSrc = null
    this.maskEdgeCanvas = null
    this.applyRig(show.rig)
    // 電飾パターン設定を復元（無いショーは既定へ＝前のショーの設定を引きずらない）。
    this.decor = show.decor ? { ...DEFAULT_DECOR, ...show.decor } : { ...DEFAULT_DECOR }
    this.decorSegs = null
    this.decorDrawable = null
    this.decorClock = 0
    this.decorLastNow = -1
    // マスク復元（show.mask があれば）。setMaskFromDataUrl が LED を作り直す。
    if (show.mask && show.mask.file) {
      const maskUrl = mediaByFile[show.mask.file]
      if (maskUrl) await this.setMaskFromDataUrl(maskUrl)
    }
    for (const sm of show.scenes ?? []) {
      const dataUrl = sm.media ? mediaByFile[sm.media] : null
      if (!dataUrl) continue
      if (sm.kind === 'video') {
        const blobUrl = await dataUrlToBlobUrl(dataUrl)
        await this.addVideo(blobUrl, sm.name)
      } else {
        await this.addPhoto(dataUrl, sm.name)
      }
      const added = this.scenes[this.scenes.length - 1]
      if (added) {
        if (sm.fix) added.fix = sm.fix
        if (sm.midiNote != null) added.midiNote = sm.midiNote
        if (sm.warpBox) added.warpBox = { ...sm.warpBox }
        if (sm.pieces && sm.pieces.length) {
          added.pieces = sm.pieces.map((p) => ({
            id: p.id,
            src: { ...p.src },
            corners: [
              { ...p.corners[0] },
              { ...p.corners[1] },
              { ...p.corners[2] },
              { ...p.corners[3] }
            ]
          }))
        }
      }
    }
    // 灯体配置を復元（無い古いファイルは空＝従来どおり）。
    this.beams = (show.beams ?? []).map((b) => ({
      ...b,
      color: b.color.slice() as RGB3,
      sp: { ...b.sp },
      dmx: b.dmx ? { ...b.dmx } : undefined // 深いコピー＝複数灯が同じdmxオブジェクトを共有する事故防止
    }))
    // 特効ID(sfxId)の重複除去: 壊れた/手編集の show.json や旧バグ由来の重複があると
    // ステップシーケンサーが2灯同時に誤爆する。最初の1灯だけ残し、残りは振り直し(ensureSfxIds)に任せる。
    {
      const seenSfx = new Set<number>()
      for (const b of this.beams) {
        if (typeof b.sfxId !== 'number') continue
        if (seenSfx.has(b.sfxId)) b.sfxId = undefined
        else seenSfx.add(b.sfxId)
      }
    }
    // 特効(SFX)の設定一式を復元（無い古いファイルは既定のまま）。
    const sfx = show.sfx
    if (sfx) {
      if (sfx.flame) this.flame.params = { ...this.flame.params, ...sfx.flame }
      if (sfx.sparkler) this.sparkler.params = { ...this.sparkler.params, ...sfx.sparkler }
      if (sfx.rain) {
        const { on, ...p } = sfx.rain
        this.rain.params = { ...this.rain.params, ...p }
        this.rain.on = !!on
      }
      if (sfx.lowSmoke) {
        const { on, ...p } = sfx.lowSmoke
        this.lowSmoke.params = { ...this.lowSmoke.params, ...p }
        this.lowSmoke.on = !!on
      }
      if (Array.isArray(sfx.seqSteps)) {
        this.sfxSeqSteps = sfx.seqSteps.map((s) => (Array.isArray(s) ? s.slice() : []))
        if (this.sfxSeqSteps.length === 0) this.sfxSeqSteps = [[], [], [], [], [], [], [], []]
      }
      if (typeof sfx.seqMs === 'number') this.sfxSeqMs = sfx.seqMs
      if (sfx.flameChase) {
        this.flameChaseOn = !!sfx.flameChase.on
        if (sfx.flameChase.pattern) this.flameChasePattern = sfx.flameChase.pattern
        if (typeof sfx.flameChase.ms === 'number') this.flameChaseMs = sfx.flameChase.ms
      }
      // 発射パターン(sfxChase)の復元。古い保存(sfxChase 無し)は旧 flameChase の pattern から引き継ぐ。
      if (sfx.sfxChase) {
        if (sfx.sfxChase.mode) this.sfxChaseMode = sfx.sfxChase.mode
        if (typeof sfx.sfxChase.ms === 'number') this.sfxChaseMs = sfx.sfxChase.ms
      } else if (sfx.flameChase && sfx.flameChase.on && sfx.flameChase.pattern) {
        this.sfxChaseMode = sfx.flameChase.pattern
        if (typeof sfx.flameChase.ms === 'number') this.sfxChaseMs = sfx.flameChase.ms
      }
    }
    // 見え方（色ノリ・ベース明るさ）を復元。無い古いファイルは 0＝従来の見た目。
    this.colorWash = typeof show.colorWash === 'number' ? Math.max(0, Math.min(0.4, show.colorWash)) : 0
    this.baseLift = typeof show.baseLift === 'number' ? Math.max(0, Math.min(0.3, show.baseLift)) : 0
    this.sfxSeqPlaying = false
    this.sfxSeqIndex = 0
    // sfxId カウンタを復元（既存の最大+1）＝復元後に足す炎/火花のID衝突を防ぐ。
    let maxSfxId = 0
    for (const b of this.beams) if (typeof b.sfxId === 'number' && b.sfxId > maxSfxId) maxSfxId = b.sfxId
    this.sfxIdSeq = maxSfxId + 1
    // 復元した灯体配置は「ユーザーが置いた配置」そのもの。これを立てないと selectScene →
    // placeRigAtPhotoBottom が全灯体の縦位置を写真下端に潰してしまう（位置が全部リセットされるバグ）。
    // 件数に関わらず必ず立てる：外部から配置を入れた経路では自動吸着を必ず止める（空配置でも
    // 後から灯体を足す前に selectScene が走ると吸着が暴発するため、件数条件を撤廃）。
    this.rigCustomized = true
    // 灯体があれば先頭を選択しておく（初期化直後と同じ＝selected=[0]）。空のままだと
    // 復元直後に GAUGE/COLOR/PTZ を動かしても targets() が空で何も効かず「直したのに効かない」
    // 見え方になるため、初期状態と挙動を揃える。
    this.selected = this.beams.length ? [0] : []
    this.selectScene(this.scenes.length ? 0 : -1)
    this.bump()
    return true
  }
}
