import { describe, it, expect } from 'vitest'
import { ImageLightEngine } from './engine'

/** 出力(Syphon/NDI)の「中身なし」まわり。エンジン全体はキャンバスが要り node では作れないので、
 *  prototype のメソッドを「必要なフィールドだけ持つ this」に .call して実ロジックを走らせる
 *  （engine-saveall.test.ts と同じ作法）。
 *
 *  守りたいことは2つ:
 *   ① 無灯（暗転/ストロボOFF/マスター0）でも出力の解像度を変えない
 *      … 変えると受け手(Resolume)が毎回フォーマットを繋ぎ直してカクつく（現場 2026-07-22 の主犯）
 *   ② 🔴 中身なしのコマに電飾/モチーフ等を描かない
 *      … 描くと「暗転中も電飾がLEDに出続ける」データ事故になる。①を直す時に一番踏みやすい地雷。
 */

type Any = Record<string, unknown>
const call = (self: Any, method: string, ...args: unknown[]): unknown =>
  (ImageLightEngine.prototype as unknown as Record<string, (...a: unknown[]) => unknown>)[
    method
  ].call(self as never, ...args)

/** clearRect しか呼ばれない前提の、最小のキャンバス偽物。 */
const fakeCanvas = (w: number, h: number): Any => ({ width: w, height: h })
const noopCtx = (): Any => ({ clearRect: () => {}, setTransform: () => {}, drawImage: () => {} })

/** composeOutput が要るフィールドだけ持つ this。写真は 3840x2160 相当。 */
const sceneWithPhoto = (outCap = 3840): Any => ({
  outCap,
  lightOnly: false,
  flameEnabled: false,
  sparklerEnabled: false,
  flame: { active: false },
  sparkler: { active: false },
  mat: { width: 3840, height: 2160 },
  box: { x: 0, y: 0, w: 100, h: 100 },
  outCv: fakeCanvas(3840, 2160),
  outW: 3840,
  outH: 2160,
  octx: () => noopCtx()
})

describe('出力が「中身なし」のとき', () => {
  it('① 無灯でも出力の解像度は変わらない（16x9 に縮まない）', () => {
    const self = sceneWithPhoto()
    call(self, 'composeOutput', 0) // maxI=0 ＝ 無灯（暗転・ストロボOFF・マスター0）
    expect(self.outW).toBe(3840)
    expect(self.outH).toBe(2160)
    expect((self.outCv as Any).width).toBe(3840)
  })

  it('① 出力上限(outCap)を下げた時は、その大きさで一定になる', () => {
    const self = sceneWithPhoto(1920)
    call(self, 'composeOutput', 0)
    expect(self.outW).toBe(1920)
    expect(self.outH).toBe(1080)
  })

  it('無灯なら「中身なし」の印が立つ', () => {
    const self = sceneWithPhoto()
    call(self, 'composeOutput', 0)
    expect(self.outBlank).toBe(true)
  })

  it('写真がまだ無い時だけ、従来どおり小さいダミーになる', () => {
    const self = sceneWithPhoto()
    self.mat = null
    self.outCv = fakeCanvas(3840, 2160)
    call(self, 'composeOutput', 0)
    expect(self.outW).toBe(16)
    expect(self.outH).toBe(9)
    expect(self.outBlank).toBe(true)
  })
})

describe('🔴 中身なしのコマに描き込まないこと（暗転中に電飾がLEDへ出続ける事故の防止）', () => {
  /** 電飾を描く条件は全部そろえておき、outBlank だけで止まるかを見る。
   *  止まらなかったら octx() まで進んで、この印が投げられる。 */
  const decorReady = (outBlank: boolean): Any => ({
    lightOnly: false,
    box: { x: 0, y: 0, w: 100, h: 100 },
    outBlank,
    decor: { enabled: true },
    decorSegs: [{}],
    outW: 3840,
    outH: 2160,
    getMaskBoxLW: () => ({ w: 100, h: 100 }),
    octx: () => {
      throw new Error('DREW')
    }
  })

  it('中身なしなら、電飾は出力に描かれない', () => {
    expect(() => call(decorReady(true), 'drawDecorOnOutput', 0)).not.toThrow()
  })

  it('中身ありなら、ちゃんと描きに行く（上のテストが素通りしていないことの裏取り）', () => {
    expect(() => call(decorReady(false), 'drawDecorOnOutput', 0)).toThrow('DREW')
  })
})
