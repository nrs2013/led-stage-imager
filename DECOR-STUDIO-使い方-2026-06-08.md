# DECOR STUDIO 使い方ガイド（2026-06-08 完成版）

> 全8段階（Milestone 0〜7）まで完成。電飾を描いて番地を振り、DMX卓の信号で光らせてSyphonでResolumeへ出すところまで動きます。

---

## これは何

コンサートのLED映像に出す「電飾」（線・電球・三角など）を、**本物のDMX卓（Art-Net）**から光らせるMacアプリ。電飾以外は黒で出し、**Syphon**で**Resolume Arena**へ渡し、**加算（Add）合成**で本番映像に重ねる（黒は加算で消える）。

## 起動のしかた

**開発で動かす（ソースから）:**
```
cd ~/Documents/decor-studio
npm install        # 初回だけ
npm run dev        # 編集画面が開く
```

**アプリ（.app）として動かす:**
```
cd ~/Documents/decor-studio
npm run build && npx electron-builder --dir
open "dist/mac-arm64/DECOR STUDIO.app"
```
できた `DECOR STUDIO.app` は `アプリケーション` に入れてOK（未署名なので初回は右クリック→開く）。

**起動オプション**（テスト・本番運用に便利）:
```
DECOR_QUERY='live' npm run dev        # 最初から本番モードで起動
DECOR_QUERY='live&demo' npm run dev   # サンプル電飾が光った状態で起動
```

## 基本の流れ

1. **下絵を読み込む**（上のバー）— その現場のチャート画像を背景に敷く。不透明度・表示を調整。位置合わせ用で、出力には出ない。
2. **描く** — 上のツール（Line / Pen / Bulb(楕円) / Tri / Rect / Star / Poly など）で電飾を描く。ドラッグで作成。折れ線(Poly-L)はクリックで頂点追加＋ダブルクリックで確定。
3. **番地を振る** — 図形を選ぶと右の **Inspector** で「ユニバース・開始番地・構成（RGB既定）」を割当。範囲（例 U0/1–3）が自動表示。同じ番地を複数図形に振れば**一斉点灯**。
4. **番地一覧（下）** — 全灯体の表。**番地が半端に重なると赤で警告**。CSV書き出し可。
5. **Live（右上）** — 本番モード。卓の信号で図形が光り、Syphonに出力。
6. **プレビュー全画面** — 2画面目に実寸で出力（操作は別画面で続けられる）。Escで閉じる。

## 卓（DMX）の繋ぎ方

- 卓とMacを**同じLAN**に繋ぐ（Art-Net）。卓側のArt-Net出力を有効に。
- アプリ下の**ステータスバー**で受信ランプを確認：ユニバースごとに**緑＝来てる／赤＝来てない**。
- 複数LANポートがある場合は、ステータスバー右の「**受信ポート**」で受信NICを選ぶ。
- 明るさは原則**卓のバーチャルディマー**でRGBに掛けて送る前提（だから1図形＝R/G/Bの3番地）。卓にディマーが無ければInspectorで構成を「RGB+Dim(4ch)」に。

## Resolumeへの出し方（本番Macで）

1. アプリをLiveにして出力中にする（ステータスバーの「Syphon ●」が点く）。
2. Resolume Arena で **Syphon/Spout ソース**を追加 →「**DECOR STUDIO**」を選ぶ。
3. そのレイヤーを**加算（Add）合成**にする → 黒が消えて電飾だけが本番映像に乗る。

> ※ この最終目視（Resolumeで黒が消えて乗る確認）は **Resolume導入済みのMac**で行ってください。開発中の検証は、Resolumeの代わりに自前のSyphonクライアントでフレーム受信・色一致を確認済みです。

## 卓が無いときのテスト

- 上の「**テスト卓**」を開く → 灯体ごとに R/G/B スライダで手動点灯。
- パターン：**全点灯／チェイス（順送り）／番地確認（1灯ずつ番地表示）／消灯**。
- 「手動／ライブ」で、手動上書きと卓の信号を切替。

## 保存・設定

- 上のバー：**新規／開く／保存／複製**。保存は `.decor.json` 1ファイル（下絵画像も埋め込み）。
- **設定**：キャンバスサイズ、Syphonソース名、ガンマ補正、未受信時（最後の値を保持／ゼロ）。

## 技術メモ（引き継ぎ用）

- Electron + electron-vite + React + TypeScript + Zustand。出力は **node-syphon（SyphonMetalServer）**にCPUのRGBAを発行（設計の「パスB」）。
- 出力描画は **Canvas 2D（加算合成＋shadowBlurでグロー）**。`OutputRenderer`。
- 受信：main の `ArtNetReceiver`（UDP6454）→ レンダラへIPC転送 → `dmx-bridge` がstoreへ。
- 純ロジック（番地→色 `channel-math`、重複 `patch`、保存 `chart-file`、モデル `chart-model`）は **Vitestで単体テスト**（`npm test`）。
- 出力ループは `setInterval`＋`backgroundThrottling:false`で、ウィンドウが背面でも止まらない。
- ブラウザだけでUI確認：`npm run dev:web`。

## 積み残し（任意の改良）

- ピクセルマッピング（1本の線を複数番地で部分制御）— 初版対象外。
- アプリアイコンはテンプレ既定（差し替え可）。コード署名・配布は未対応（ローカル運用）。
