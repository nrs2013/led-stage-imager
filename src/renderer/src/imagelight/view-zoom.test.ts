import { describe, it, expect } from 'vitest'
import { fitScale, clampCenter, viewFromZoom, zoomToward, type ZoomState } from './view-zoom'

// 表示ズームの数式検証。ここが狂うとクリック位置と灯体がズレる＝本番事故なので機械で保証する。
const LW = 1600
const LH = 900

describe('view-zoom（画像照明モードの表示ズーム）', () => {
  it('f=1（全体表示）は従来の中央寄せ fit と完全一致', () => {
    // 従来: scale=min(cw/LW,ch/LH), ox=(cw-LW*scale)/2, oy=(ch-LH*scale)/2
    for (const [cw, ch] of [
      [2560, 1440],
      [1728, 1117],
      [1200, 900],
      [900, 1200] // 縦長ウィンドウでも
    ]) {
      const v = viewFromZoom({ f: 1, cx: LW / 2, cy: LH / 2 }, cw, ch, LW, LH)
      const scale = Math.min(cw / LW, ch / LH)
      expect(v.scale).toBeCloseTo(scale, 10)
      expect(v.ox).toBeCloseTo((cw - LW * scale) / 2, 8)
      expect(v.oy).toBeCloseTo((ch - LH * scale) / 2, 8)
    }
  })

  it('zoomToward: カーソルの下の舞台座標が拡大後も同じ画面位置に残る（固定点）', () => {
    const cw = 2560
    const ch = 1440
    let z: ZoomState = { f: 1, cx: LW / 2, cy: LH / 2 }
    let view = viewFromZoom(z, cw, ch, LW, LH)
    // 画面上の適当な位置（デバイスpx）にカーソルがあるとして 2 倍へ
    const mx = 700
    const my = 400
    const stageX = (mx - view.ox) / view.scale
    const stageY = (my - view.oy) / view.scale
    z = zoomToward(view, cw, ch, LW, LH, mx, my, 2)
    view = viewFromZoom(z, cw, ch, LW, LH)
    // 同じ舞台座標を新しい view で画面に戻すと、元のカーソル位置に一致する
    expect(view.ox + stageX * view.scale).toBeCloseTo(mx, 6)
    expect(view.oy + stageY * view.scale).toBeCloseTo(my, 6)
  })

  it('倍率を 1 に戻すと中央の全体表示へ戻る', () => {
    const cw = 2560
    const ch = 1440
    const z0: ZoomState = { f: 3, cx: 200, cy: 100 }
    const view = viewFromZoom(z0, cw, ch, LW, LH)
    const z = zoomToward(view, cw, ch, LW, LH, 0, 0, 1)
    expect(z).toEqual({ f: 1, cx: LW / 2, cy: LH / 2 })
  })

  it('clampCenter: どれだけパンしても舞台が画面から迷子にならない', () => {
    const cw = 2560
    const ch = 1440
    // 4倍ズームで極端に外へパン
    for (const [cx, cy] of [
      [-99999, -99999],
      [99999, 99999],
      [0, LH * 10]
    ]) {
      const z = clampCenter({ f: 4, cx, cy }, cw, ch, LW, LH)
      const v = viewFromZoom(z, cw, ch, LW, LH)
      // 画面の端が舞台の外へ出ない（=舞台が常に画面いっぱいに見えている）
      expect(v.ox).toBeLessThanOrEqual(0.0001)
      expect(v.oy).toBeLessThanOrEqual(0.0001)
      expect(v.ox + LW * v.scale).toBeGreaterThanOrEqual(cw - 0.0001)
      expect(v.oy + LH * v.scale).toBeGreaterThanOrEqual(ch - 0.0001)
    }
  })

  it('clampCenter: 全体表示(f=1)では常に中央固定（パンしても戻る）', () => {
    const cw = 2560
    const ch = 1440
    const z = clampCenter({ f: 1, cx: 0, cy: 0 }, cw, ch, LW, LH)
    // fit では少なくとも一辺が画面ぴったり＝その軸の中心は中央に固定される
    const scale = fitScale(cw, ch, LW, LH)
    if (cw / 2 / scale >= LW / 2) expect(z.cx).toBe(LW / 2)
    if (ch / 2 / scale >= LH / 2) expect(z.cy).toBe(LH / 2)
  })
})
