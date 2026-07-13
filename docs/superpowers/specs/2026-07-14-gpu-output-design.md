# GPU直結出力（ゼロコピーSyphon）— 設計（2026-07-14・承認待ち）

ミッション: 高精細(3840)でも60fpsでコマ落ちしない出力。
今は「毎コマCPU読み出し(getImageData)→IPC→ネイティブ」のコピー方式で、3840は毎秒約2GBの
ゴミ生成＝GC詰まりで物理的に60fps不可能。これを「GPUの絵をコピーせずそのままSyphonへ」に替える。

## 裏取り済みの土台（2026-07-14確認・全部実在）

- Electron 39.8.10: `new BrowserWindow({ webPreferences: { offscreen: { useSharedTexture: true } } })`
  → `wc.on('paint', (e, dirty, image) => e.texture)` で GPU テクスチャが来る。
  - ハンドルの場所は **`texture.textureInfo.handle.ioSurface`**（Buffer・Mac）。
    ※引き継ぎ書の `sharedTextureHandle` という名前は不正確だった。実物は `handle.ioSurface`。
  - `textureInfo.pixelFormat`（'bgra'想定）・`codedSize`・`contentRect` あり。
  - 🔴 使い終わったら即 `texture.release()`（同時に持てる枚数に上限あり）。
- node-syphon: `SyphonMetalServer.publishSurfaceHandle(handle: Buffer, imageRegion, textureDimension, flipped)`
  （server.metal.d.ts で確認・patch-node-syphon.mjs のリーク修正はpublishImageData側のみ＝干渉しない）。
- 前例: チャートの LiveView（`?output&live`）＝「別ウィンドウが chart:update を購読して自前描画」。

## アーキテクチャ: 見えない出力専用ウィンドウ

```
[編集ウィンドウ]                [main]                        [出力専用ウィンドウ(offscreen・非表示)]
  状態が変わったら ──IPC──▶ そのまま転送 ──────────────▶ 状態を受けて出力の絵だけを描く
                                 ◀──paint(texture)── Chromiumが60fpsで合成
                          handle.ioSurface を
                          publishSurfaceHandle へ（コピーゼロ）
                          → texture.release()
```

- 編集ウィンドウから重い読み出し（readOutputRGBA / readRGBA）が消える＝UIは軽くなる。
- 出力窓のサイズ＝出力解像度（1920/3840）。解像度変更時は窓を作り直す。
- `backgroundThrottling: false`・`wc.setFrameRate(60)`・`show: false`。
- モード終了/アプリ終了で窓を確実に destroy（broadcast の isDestroyed ガードは実装済み）。

## 状態同期（ピクセル一致が目標）

- チャート: 既存 `chart:update` をそのまま購読（LiveViewと同じ・OutputRenderer 流用）。
- 画像照明: 新チャネル2本。
  - `il:sync-show`（重い・変化時だけ）: serializeShow と同じ形式（写真/動画/マスク/灯体/シーン）。
    公演を開いた時・BUILD編集時のみ。毎フレームは流さない。
  - `il:sync-frame`（軽い・毎フレーム数KB）: 送信側の時刻ms・解決済みDMXフレーム・
    ゲージ/色/PTZ/FX/パニック/フェード状態。**時刻は編集側の ms をそのまま使う**＝
    ストロボ位相・ゴボ回転・星の瞬きが両側で同じ絵になる（engine の乱数 sp も種を共有）。
- 動画（映像素材）だけは2窓で再生タイミングが完全一致しない＝ピクセル一致の対象外（目視で同等ならOK）。

## Windows（NDI）

- `useSharedTexture` なしの software OSR: paint の `image`（NativeImage・BGRA）を直接
  `sendNdiFrame` へ。ndi-direct に BGRA の FourCC を追加（CPUでの並べ替えはしない）。
- レンダラ側の getImageData が消えるだけでも大幅改善。ゼロコピーではないが Windows は NDI が
  CPU フレーム必須なのでこれが上限。

## フォールバック（安全弁）

- 既存の readOutputRGBA / publishFrame 経路は**丸ごと残す**。
- SETUP に「出力方式: 高速(GPU) / 互換」トグル（Brutalist Vivid・絵文字なし・0.5px細線）。
  既定＝高速(GPU)。出力窓の生成失敗・paint が3秒来ない等は自動で互換へ落として表示で知らせる。

## フェーズ（一つずつ・各フェーズで実測）

1. **配管の証明（チャートで最小構成)**: offscreen窓＋paint→publishSurfaceHandle を
   チャート描画（chart:update購読・LiveView流用）で疎通。本番.app＋Syphon Recorderで60fps実測。
   use-chart-output の readRGBA はこのフェーズで置き換わる（＝電飾60fps化の相乗り）。
2. **画像照明（本丸）**: `?syphon-output` レンダラ＋il:sync-show/il:sync-frame。
   なめらか(1920)→高精細(3840)の順で実測60fps。ピクセル一致確認（静止・ストロボ・ゴボ・星）。
3. **Windows NDI**: software OSR→sendNdiFrame(BGRA)。build:win が通ってNDIが出るまで。
4. **トグル＆自動フォールバック＋30分連続運転**（RSS横ばい確認）。

## リスク（先に知っておく）→ フェーズ1で実測・確定済み（2026-07-14）

- Retina倍率: **的中**。OSRは主画面倍率(2)で描く（窓1920→絵3840）。enableDeviceEmulation では
  変わらない（実測）。**採用した補正＝窓を出力解像度÷倍率で作り setZoomFactor(1/倍率)**
  → 絵はぴったり1920x1080（実測）。ズームはロードごとにリセット＝did-finish-load で掛け直す。
- 色順: **正しい**。Chromium IOSurface(BGRA)をネイティブが MTLPixelFormatBGRA8Unorm で包む
  （vendor/node-syphon/MetalServer.mm.fixed:198）。真っ赤テストでCPU経路とバイト単位一致。
- 向き: **flipped=false が正**（本番CPU経路と同じ）。true だと上下逆（実測）。
- texture.release() 漏れ → publish直後に同期release・paintハンドラをtry/finallyで（実装済み）。
- 🔴 ブラウザ検証は出力経路を含まない。判定は必ず本番.app＋Syphon受け（7/13の教訓）。

## フェーズ1 実測結果（2026-07-14・本番.app＋自作Syphonプローブ）

- 60Hz Art-Net駆動のチャート: **58.9fps**（修正前42.6→ -4ms揺らぎ許容で改善。送信60Hz律速）
- GPU経路とCPU経路の絵: **8,294,400バイト中、差ゼロ＝ピクセル完全一致**（真っ赤固定テスト）
- フォールバック: 出力窓の描画プロセスをkill→「互換経路へフォールバック」発火→
  use-chart-output が自動再開して出力継続（実地確認）

## 完成の定義（引き継ぎ書のチェックリストそのまま）

1. 本番.app・なめらか(1920)・ランダムストロボ中: Syphon受けで実測60fps
2. 本番.app・高精細(3840)・同上: 実測60fps（本丸）
3. 30分連続運転でメモリ横ばい（Activity Monitor RSS）
4. 編集画面と出力の絵がピクセル一致（静止・ストロボ・ゴボ・星）
5. トグルで「互換」に戻せる・Windows exe がビルドできてNDIが出る
