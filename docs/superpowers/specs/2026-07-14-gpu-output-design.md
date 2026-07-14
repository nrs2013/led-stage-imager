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

1. **配管の証明（チャートで最小構成)**: ✅完了（2026-07-14・a656f4d）。58.9fps・ピクセル完全一致・
   フォールバック実地確認・敵対レビュー21体の確定指摘7件修正込み。
2. **画像照明（本丸）**: ✅実装完了（2026-07-14・67dc716）。実公演で絵の同等性確認済み
   （GPU/互換の差分1.4%＝撮影時刻ズレのアニメ画素と丸めのみ）。
   **60fpsの最終実測だけ未了**＝深夜検証環境の制約（下の「フェーズ2で学んだこと」参照）。
3. **Windows NDI**: 未着手。software OSR→sendNdiFrame(BGRA)。build:win が通ってNDIが出るまで。
4. **トグル**: ✅前倒しで実装済み（SETUPのOUTPUT行・localStorage永続）。30分連続運転は実施済み
   （結果は変更メモ/引き継ぎ参照）。

## フェーズ2 敵対レビュー（26エージェント）→ 確定16件を修正（2026-07-14）

本番影響の大きい順（すべて実コードで裏取り済み）:
- 🔴 **暗転/写真なし/復元中に paint が止まり見張り番が誤発火→GPU経路が本番中に静かに死ぬ**
  ＋暗転しても直前の明るい絵が残る → 出力窓の blit を「退化フレーム(outW≤16)は透明化して必ず
  paint を起こす」に変更。復元中も最後の絵を保持して paint 継続。実測: 暗転で60fps・透明16x9・
  フォールバック誤発火0（互換が publish していた 16x9 透明と一致）。
- 🔴 **relief(立体強調)/lumReliefStrength が同期経路に無く GPU出力だけ立体感ゼロ** →
  LiveFrame に追加。実測: relief=0.7 で GPU/互換の差 0.02%（丸め誤差のみ・輝度ほぼ一致）。
- 🔴 **炎の単発発射イベントがコアレッシング/復元で消える(flameHoldRelease 消失=炎が消えない)** →
  受信側で events を捨てず連結、復元中は pending に温存。
- 🔴 **出力窓エンジンが unmount で後始末されず WebGL枯渇/動画再生継続/ObjectURLリーク** →
  cleanup で disposeMedia。
- **モード切替/互換→高速トグル/公演読込中に出力が黒落ち** → pull型ハンドシェイク
  (il:request-show)＋「出力窓が実絵を1枚描くまで(il:output-ready)は編集側CPUが本番」に。
- **公演同期の inflight 握り潰し** → 完了後に再送(dirtyフラグ)。**restoreShow の交錯** → 直列化。
- **ワープ/切り抜き調整で全動画を再送** → 署名を media(本体)と show(構造)に分離、
  構造だけ変化時は json のみ送り blob はキャッシュ再利用。
- **画像灯体の並べ替えで出力の絵が別灯体に残る** → showSignature に画像灯体の位置を含める。
- **GPU死亡/互換切替で静止シーンだと古い絵が凍る** → onActive(false) で強制再描画+publish。
- **outCv の willReadFrequently が退化パスで失われ互換経路が GPU読み戻しに落ちる** → octx() に統一。
- **__ilEngine 常時露出が退出後も公演をピン留め** → 退出時に null。
- **幻の炎(recordLiveEvents OFF/ONで残留イベント再生)** → setRecordLiveEvents で切替時クリア。

## フェーズ2で学んだこと（2026-07-14）

- 🔴 **22fps天井の正体は読み出しだけではなかった**: 3840 の出力合成(composeOutput)は
  willReadFrequently のCPUキャンバスで1コマ30-45ms（--disable-frame-rate-limit で実コストが
  露出・通常測定では非同期エンキューで4-5msに見える罠）。対策2本:
  ①出力窓は outCv をGPUキャンバス化（engine.outReadback=false・33ms→9.5ms実測）
  ②編集側は GPU出力中 composeOutput を丸ごとスキップ（engine.skipCompose）
- **出力窓は「最新コマだけ描く」**（コアレッシング）: 着信＞処理の時に行列が無限に伸びて
  遅延が増え続けるのを防ぐ。追いつける時は全コマ素通し。
- 🔴 **初期化レース2件**（実測で発見）:
  ①出力窓のReactリスナー登録前に届いたIPCは消える → pull型ハンドシェイク(gpu-output:hello)
  ②編集窓の did-finish-load(onload) は React の起動より遅い → モードのリセットに使うと
    先に立った imagelight を chart に巻き戻す → did-navigate で行う
- **深夜の headless 検証は rAF が25-30Hzに縛られる**（画面スリープ）＝送り手(編集rAF)を
  60Hzで回せない。60fps最終実測は画面が起きている環境で行うこと。
  --disable-frame-rate-limit 起動は能力測定に使える（1920で編集55fps実証済み）が、
  非同期描画コストが同期化されて見えるので数字の解釈に注意。
- 開発用フラグ: `DECOR_QUERY='iltest&cap3840&strobe'` で照明モード直行＋前回データ復元＋
  負荷。性能診断ログ（編集側=iltest時のみ[il perf]・出力窓=常時[gpu-il perf]・5秒毎）。

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
