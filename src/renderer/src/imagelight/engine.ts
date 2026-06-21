/* ============================== 画像照明モード エンジン ==============================
 * デスクトップのモック「画像照明モード-試打台.html」の描画・状態をそのまま移植した正典。
 * セット写真（アルベド）を背景に、灯体（beam）で「写真を照らす」。色・PTZ・FX9種・
 * シーン棚×9・写真棚・ミュート/ソロ・MASTER・SMOKE。出力は frame キャンバス1枚（マーカー
 * は含めない＝本番出力に編集ハンドルは出ない）。React UI（ImageLightingMode.tsx）が駆動し、
 * frame を Syphon へ publish しつつ画面にも表示する。光の式は出荷済みUPLIGHTと同系
 * （screen混色・アルベド乗算・色比保持トーン・パン非対称・Smoke連動）。
 */
import { WHITE, COLORS, sameRgb, hexToRgb, type RGB3 } from './colors'
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
  defaultFxp,
  type FxParams,
  type SearchParams
} from './effects'
import { composeColorRatio } from '../render/compose'
import { alignSnap, equalSnapX, type Pt } from './snap'
import { drawStreetLampLit } from '../render/streetlamp'
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
import type { Shape } from '../model/types'

/** 写真×光の合成方式。
 *  'mock'  = 出荷モック準拠（乗算＋暗部トー）。のむさんが v7 で検証済みの見え方。既定。
 *  'ratio' = 色比保持トーン（白に色が鮮やかに乗る・実験的）。検証の結果、ビーム芯の白茶けは
 *            主に光マップのscreen加算が原因でこの段では消せず、中間調が明るく寄って検証済みの
 *            見え方から離れたため既定にはしない（本番後に詰める用に残置）。 */
const PHOTO_TONE: 'mock' | 'ratio' = 'mock'

/** 論理座標系（モックと同じ）。内部解像度は Q 倍＝出力 1920×1080。 */
export const LW = 1600
export const LH = 900
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
    | 'chandelier'
    | 'marquee'
    | 'bulb'
    | 'parlight'
    | 'patt'
    | 'blinder'
    | 'pixelpatt'
    | 'stars'
    | 'festoon'
  motifDiam?: number
  motifText?: string
  motifLetterColors?: string[]
  motifSpeed?: number
  motifReverse?: boolean // マーキー逆方向チェイス
  motifSeed?: number // 星の散布レイアウトを固定（移動しても再シャッフルしない）
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
}

// v3: リグ保存を「配置と仕込みだけ」に変更（向き/色/明るさを焼かない）＝旧保存に残った
//     チルト等を捨てて、初期プリセットを常にまっさら（均等10台・tilt0・下向き）にする
const RIG_KEY = 'decor.imagelight.rig.v3'

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
  readonly frame = mk(IW, IH, true)
  /** Syphon出力用（写真の部分だけ・写真の解像度・余白なし）。編集画面は frame、出力は outCv。 */
  readonly outCv = mk(16, 9, true)
  outW = 16
  outH = 9
  private outBlurCv = mk(16, 9)

  // 内部バッファ
  private lightCv = mk(IW, IH, true)
  private workCv = mk(IW, IH, true)
  private airCv = mk(IW, IH)
  private smoothCv = mk(IW, IH)
  private noiseCv = mk(IW, IH)
  private noiseTile: HTMLCanvasElement
  private fc = this.frame.getContext('2d')!
  private lc = this.lightCv.getContext('2d', { willReadFrequently: true })!
  private wc = this.workCv.getContext('2d', { willReadFrequently: true })!
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
      beams: this.beams.map((b) => ({ ...b, color: b.color.slice() as RGB3, sp: { ...b.sp } })),
      st: { ...this.st },
      fxp: JSON.parse(JSON.stringify(this.fxp)),
      selected: [...this.selected],
      activeScene: this.activeScene,
      patterns: JSON.parse(JSON.stringify(this.patterns)),
      userColors: this.userColors.map((c) => c.slice() as RGB3),
      chasePalette: this.chasePalette.map((c) => c.slice() as RGB3),
      // 写真/動画オブジェクトは参照共有・fix だけ独立コピー
      scenes: this.scenes.map((s) => ({ ...s, fix: s.fix?.map((f) => ({ ...f })) }))
    }
  }
  private restore(s: Snap): void {
    this.beams = s.beams.map((b) => ({ ...b, color: b.color.slice() as RGB3, sp: { ...b.sp } }))
    this.st = { ...s.st }
    this.fxp = JSON.parse(JSON.stringify(s.fxp))
    this.selected = s.selected.filter((i) => i >= 0 && i < s.beams.length)
    this.patterns = JSON.parse(JSON.stringify(s.patterns))
    this.userColors = s.userColors.map((c) => c.slice() as RGB3)
    this.chasePalette = s.chasePalette.map((c) => c.slice() as RGB3)
    this.scenes = s.scenes.map((sc) => ({ ...sc, fix: sc.fix?.map((f) => ({ ...f })) }))
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
  /** ESCパニックのフェード進行中フラグ。 */
  fading = false
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
    this.beams.some((b) => b.motif === 'marquee' || b.motif === 'stars')
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
      let rank = 0
      for (let j = 0; j < i; j++) if (this.beams[j].motif) rank++
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
  private drawMotifLit(g: CanvasRenderingContext2D, b: Beam, I: number, ms: number): void {
    if (I <= 0.004) return
    const c = b._cn ?? b.color
    const rgb: RGB3 = [c[0] * I, c[1] * I, c[2] * I]
    const d = b.motifDiam ?? 200
    if (b.motif === 'streetlamp') {
      drawStreetLampLit(g, b.x, b.y, d, rgb)
    } else if (b.motif === 'chandelier') {
      drawChandelierLit(g, b.x, b.y, d, rgb)
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
  renderFrame(now = performance.now()): void {
    this.updateVideoFrame() // 動画シーンなら mat を今のコマへ
    const ms = now - this.t0
    const decorT = this.decorTime(now) // 電飾チェイス用の時計（playing 中だけ進む・1フレーム1回）
    const QW = IW
    const QH = IH
    const beams = this.beams
    const Is = beams.map((b, i) => this.effI(b, i, ms))
    const maxI = Is.length ? Math.max(...Is) : 0
    let maxNonMotifI = 0
    for (let i = 0; i < beams.length; i++) {
      if (!beams[i].motif && Is[i] > maxNonMotifI) maxNonMotifI = Is[i]
    }
    const lc = this.lc
    const wc = this.wc
    const fc = this.fc

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
        if (!b.motif) this.drawWallBeam(lc, b, Is[i], b._tn!)
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
      const pat = nmc.createPattern(this.noiseTile, 'repeat')
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

    // ---- 写真 × 光（座組の最大ゲージで露出が決まる＝出荷仕様）
    wc.setTransform(1, 0, 0, 1, 0, 0)
    wc.clearRect(0, 0, QW, QH)
    if (maxI > 0.004 && this.mat && this.box) {
      const b = this.box
      const tone = Math.max(0, (0.5 - maxI) / 0.5) * 0.85
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
    fc.drawImage(this.lightOnly ? this.lightCv : this.workCv, 0, 0)
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
        if (!bm.motif) this.drawAirBeam(ac, bm, Is[i], bm._tn ?? this.tiltNow(bm, ms))
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

    // ---- Syphon出力: 写真の部分だけを写真の解像度で（余白なし・写真フル解像度）
    this.composeOutput(maxI)
    // 出力(outCv)にもモチーフを乗せる＝編集画面と同じ絵を Resolume へ送る
    // （composeOutput は写真＋光だけ。モチーフはここで box→出力の写像で重ねる）。
    this.drawMotifsOnOutput(beams, Is, ms)
    // 出力にも電飾パターンを重ねる（編集画面と同じ絵を Arena へ）。
    this.drawDecorOnOutput(decorT)
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

  /** 出力(outCv)を「写真の部分だけ・写真の解像度・余白なし」で合成する。写真(mat)はフル解像度、
   *  ソフトな光は lightCv の box 領域を引き伸ばす（写真だけシャープに保つ）。編集画面とは別物。 */
  private composeOutput(maxI: number): void {
    const OUT_CAP = this.outCap // 出力上限幅（可変：なめらか1920/バランス2560/高精細3840）
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
    if (!this.mat || !this.box || maxI <= 0.004) {
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
    oc.globalCompositeOperation = 'destination-in'
    oc.drawImage(this.mat, 0, 0, ow, oh) // 写真の形に切り抜き
    oc.globalCompositeOperation = 'source-over'
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
      | 'chandelier'
      | 'marquee'
      | 'bulb'
      | 'parlight'
      | 'patt'
      | 'blinder'
      | 'pixelpatt'
      | 'stars'
      | 'festoon'
  ): void {
    if (this.beams.length >= MAX_BEAMS) return
    // 同種モチーフの最後の位置から右にずらす、なければ中央上寄りに配置
    const same = this.beams.filter((b) => b.motif === type)
    const last = same[same.length - 1]
    let x = last ? last.x + 220 : 800
    let y = last ? last.y : 380
    if (x > 1460) { x = 200 + ((same.length * 180) % 1200); y += 180 }
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
        type === 'streetlamp' ? 160 :  // 4m
        type === 'chandelier' ? 48 :   // 1.2m
        type === 'marquee' ? 72 :      // 1.8m
        type === 'blinder' ? 20 :      // 50cm
        type === 'parlight' ? 8 :      // 20cm
        type === 'bulb' ? 6 :          // 15cm
        type === 'patt' ? 20 :         // 50cm
        type === 'pixelpatt' ? 28 :    // 70cm
        type === 'stars' ? 400 :       // 星空フィールド 10m角
        type === 'festoon' ? 240 : 200, // 垂れ幕 6m幅
      ...(type === 'marquee' ? { motifText: 'LIVE', motifSpeed: 8 } : {}),
      ...(type === 'stars' ? { motifSeed: Math.floor(this.rnd() * 1e6) + 1 } : {})
    })
    this.selected = [this.beams.length - 1]
    this.bump()
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
  /** ⌘C: 選択中の灯体ぜんぶを内部クリップボードへ（仕込み・向き・色を丸ごと）。 */
  copyBeam(): void {
    const t = this.targets()
    if (!t.length) return
    this.beamClip = t.map((b) => ({ ...b, color: b.color.slice() as RGB3, sp: { ...b.sp } }))
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
        sp: makeSearchParams(this.rnd)
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
      this.beams.push({ ...src, color: src.color.slice() as RGB3, sp: makeSearchParams(this.rnd) })
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
    L.lights.forEach((f, i) => {
      const b = this.beams[i]
      if (!b) return
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
      const t = L.lights[i]
      if (t) {
        b.mute = !!t.mute
        b.solo = !!t.solo
      }
    })
    this.t0 = performance.now()
    const dur = this.sceneFadeMs
    const seq = this.sceneFadeSeq
    const t0 = performance.now()
    this.fading = true
    const lerp = (a: number, b: number, k: number): number => a + (b - a) * k
    const step = (now: number): void => {
      if (this.sceneFadeSeq !== seq || !this.fading) return // 割込み/暗転で中断
      const k = dur > 0 ? Math.min(1, (now - t0) / dur) : 1
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2 // easeInOut
      this.beams.forEach((b, i) => {
        const f = from[i]
        const t = L.lights[i]
        if (!f || !t) return
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
        L.lights.forEach((t, i) => {
          const b = this.beams[i]
          if (!b) return
          b.gauge = t.gauge
          b.color = t.color.slice() as RGB3
          b.pan = t.pan
          b.tilt = t.tilt
          b.zoom = t.zoom
        })
        this.fading = false
        this.bump(false)
      }
    }
    requestAnimationFrame(step)
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
      this.learnScene = null // 排他：シーン Learn を消す
      this.learnFx = null
      this.learnColor = null
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
      // 他の Learn 系を全部消す（同時に 2 つ待たない）。
      this.learnPattern = null
      this.masterLearn = false
      this.learnParam = null
      this.learnFx = null
      this.learnColor = null
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
    this.fading = false
  }
  blackout(): void {
    // 暗転の直前の look（FX・明るさ）を履歴へ積む → ⌘Z で直前へ戻せる。stopAllFx は
    // 内部呼びなので二重に積まない（pushHist=false）。
    this.pushHistory()
    this.panicSeq++
    this.panicGain = 0
    this.fading = false
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
    this.fading = true // 描画ループに「フェード中＝描き続けて」と知らせる
    const step = (now: number): void => {
      if (this.panicSeq !== my) {
        this.fading = false
        return
      }
      const k = Math.min(1, (now - t1) / 1500)
      this.panicGain = from * (1 - k)
      if (k < 1) requestAnimationFrame(step)
      else {
        this.fading = false
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
  /** 特別ストロボのON/OFF（1回目=今の出力を全体点滅／2回目=元のシーンに戻る・非破壊）。 */
  toggleStrobeOverride(): void {
    this.strobeOverride = !this.strobeOverride
    this.bump(false)
  }
  /** 特別ストロボの MIDI LEARN 待機の ON/OFF（他の LEARN は解除）。 */
  setLearnStrobe(on: boolean): void {
    this.learnStrobe = on
    if (on) {
      this.learnFx = null
      this.learnColor = null
      this.learnPattern = null
      this.learnScene = null
    }
    this.bump(false)
  }
  /** 特別ストロボの MIDI 割当を解除。 */
  clearStrobeShortcut(): void {
    this.strobeMidi = null
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
      } else if (this.strobeMidi != null && note === this.strobeMidi) {
        this.toggleStrobeOverride()
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
      strobeRate: this.strobeRate
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
    if (typeof d.strobeRate === 'number') this.strobeRate = d.strobeRate
  }
  private saveRig(): void {
    try {
      localStorage.setItem(RIG_KEY, JSON.stringify(this.rigData()))
    } catch {
      /* localStorage 不可でも本番に支障なし */
    }
  }
  private loadRig(): void {
    try {
      const raw = localStorage.getItem(RIG_KEY)
      if (raw) this.applyRig(JSON.parse(raw) as RigPayload)
    } catch {
      /* 壊れていたら初期状態のまま */
    }
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
      beams: this.beams.map((b) => ({ ...b, color: b.color.slice() as RGB3, sp: { ...b.sp } })),
      scenes: scenesMeta,
      mask: maskMeta,
      decor: {
        ...this.decor,
        color1: this.decor.color1.slice() as RGB3,
        color2: this.decor.color2.slice() as RGB3
      }
    }
    return { json: JSON.stringify(show, null, 2), media }
  }

  /** 公演を読み込む。show.json の文字列と「media/ファイル名 → dataURL」の対応を渡す。
   *  既存のシーン/明かりを置き換える（写真も動画も復元）。 */
  async restoreShow(showJson: string, mediaByFile: Record<string, string>): Promise<boolean> {
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
      sp: { ...b.sp }
    }))
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
