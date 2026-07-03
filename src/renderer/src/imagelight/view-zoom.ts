// 画像照明モードの「表示ズーム」計算（画面の見た目だけ。出力には無関係）。
// f = fit(全体表示)比の倍率、cx/cy = 画面中央に見せる舞台(lw×lh)座標。
// 描画とクリック変換は全部ここから導いた {scale, ox, oy} を使う＝ズレようがない。

export interface ZoomState {
  f: number
  cx: number
  cy: number
}
export interface ZoomView {
  scale: number
  ox: number
  oy: number
}

/** 全体がちょうど収まる倍率（従来の fit と同じ式）。 */
export const fitScale = (cw: number, ch: number, lw: number, lh: number): number =>
  Math.min(cw / lw, ch / lh)

/** 中心を舞台の範囲に制限＝拡大中でも写真が画面から迷子にならない。 */
export function clampCenter(
  z: ZoomState,
  cw: number,
  ch: number,
  lw: number,
  lh: number
): ZoomState {
  const scale = fitScale(cw, ch, lw, lh) * z.f
  const halfW = cw / 2 / scale
  const halfH = ch / 2 / scale
  return {
    f: z.f,
    cx: halfW >= lw / 2 ? lw / 2 : Math.min(lw - halfW, Math.max(halfW, z.cx)),
    cy: halfH >= lh / 2 ? lh / 2 : Math.min(lh - halfH, Math.max(halfH, z.cy))
  }
}

/** ズーム状態 → 描画/クリック変換に使う {scale, ox, oy}。f=1 なら従来の中央寄せと完全一致。 */
export function viewFromZoom(
  z: ZoomState,
  cw: number,
  ch: number,
  lw: number,
  lh: number
): ZoomView {
  const zc = clampCenter(z, cw, ch, lw, lh)
  const scale = fitScale(cw, ch, lw, lh) * zc.f
  return { scale, ox: cw / 2 - zc.cx * scale, oy: ch / 2 - zc.cy * scale }
}

/** カーソル位置(mx,my=デバイスpx)の下の場所を動かさずに倍率を nf へ。戻り値は新しいズーム状態。 */
export function zoomToward(
  view: ZoomView,
  cw: number,
  ch: number,
  lw: number,
  lh: number,
  mx: number,
  my: number,
  nf: number
): ZoomState {
  const sx = (mx - view.ox) / view.scale // カーソル下の舞台座標（固定点）
  const sy = (my - view.oy) / view.scale
  const s2 = fitScale(cw, ch, lw, lh) * nf
  if (nf <= 1.0001) return { f: 1, cx: lw / 2, cy: lh / 2 } // 全体表示に戻ったら中央へ
  return {
    f: nf,
    cx: sx + (cw / 2 - mx) / s2,
    cy: sy + (ch / 2 - my) / s2
  }
}
