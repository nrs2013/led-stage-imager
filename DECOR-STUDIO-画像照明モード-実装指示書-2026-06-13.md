# DECOR STUDIO 画像照明モード 実装指示書（2026-06-13）

> **新スレッドのClaudeへ。** これは「画像照明モード」を本物のアプリに実装するための完全な指示書です。
> **読む順：** ①本書を最後まで → ②設計図＝動くモック `~/Desktop/画像照明モード-試打台.html`（**全機能・全式がここにある。これが正典**）→ ③背景 `~/dev/decor-studio/DECOR-STUDIO-引き継ぎ-2026-06-13.md`。
> **のむさん：** コンサート演出家・コード未経験・GitHub `nrs2013`。**舞台用語で噛み砕く／ターミナルはコピペ完成形／PATを貼られたら git push まで実行（director-workflow 準拠）。**

> **のむさんが新スレッドの最初に貼る一文（コピペ）：**
> `~/dev/decor-studio の DECOR-STUDIO-画像照明モード-実装指示書-2026-06-13.md を読んで、画像照明モードを本物のアプリに実装して。設計図はデスクトップの「画像照明モード-試打台.html」。`

---

## 0. ミッション

DECOR STUDIO（Electron + React + TypeScript + Vite）に **「画像照明モード」** を新規実装する。

- **何のため**：のむさん自身が本番で回す照明モード。**卓（Art-Net）なしで成立**。あさって（2026-06-15想定）本番。電飾チームにもDMGで渡す
- **何をする**：セット写真（チャート）を背景に、アッパーライト等の灯体で「写真を照らす」。色・エフェクト・シーンで演出
- **既存は壊さない**：現行の電飾モード（卓/Art-Net/Programmer/編集室）は温存。画像照明モードを**並立で追加**
- **出力**：既存の Syphon/NDI 経路（`OutputRenderer` → `main/output/syphon-publisher.ts`）にそのまま乗る。Resolume へは NDISyphon（導入済み）で Syphon→NDI

---

## 1. 設計図＝モックHTML（最重要）

**`~/Desktop/画像照明モード-試打台.html`** が全機能の動く実装（単一HTML・vanilla JS・canvas）。**式・UI・挙動はすべてここにある。迷ったらモックを読む。モックが正。**

モックの主要構造（関数名で grep できる）：
- 状態：`st`（master, smoke, 各FXフラグ, `fxp`=FXごとのツマミ）、`beams[]`（灯体）、`scenes[]`（写真棚）、`PATTERNS[]`（シーン棚×9）
- 描画：`draw()` → 光マップ生成（`drawWallBeam`/`drawBeamCore`/`trap`）→ 写真×光（色比保持）→ フレーム合成（空中ビーム・ブルーム）
- エフェクト：`chaseK / strobeK / breathK / fireK / waveK / boltK / zoomPulseK / colorNow(虹含む) / tiltNow(SEARCH)`
- 灯体構成：`isLit(b)`（ミュート/ソロ）、`saveFixState/loadFixState`（写真ごと）
- シーン：`currentLook() / applyLook()`、`renderPatterns / applyPattern / assignShortcut`
- 色：`hexToRgb/rgbToHex`、`userColors`（プリセット）

このモックは本物の出荷コード（`render/uplight.ts`）の式を移植して作ってある。**逆に、モック→出荷コードへ戻す作業が今回の本実装。**

---

## 2. 出荷コードのマッピング（どこに何を入れるか）

### 描画（既存を拡張・モックもOutputRendererも canvas なので移植しやすい）
- **`src/renderer/src/render/uplight.ts`**
  - `drawBeamCoreLocal`（既存）→ **終わり際の丸み**。今は12層が全部同じ長さ。モックの `drawBeamCore` どおり「層ごとに届く長さを変える」：層 index `u=k/(NL-1)`、横 `wf=1-u*0.62`、**縦 `lf=0.70+0.30*Math.pow(u,1.4)` で各層の長さ `L=len*lf`**、各層は自分の長さ内で逆二乗ガンマ減衰。先端が丸い舌になり両脇から先に暗くなる
  - `beamZoomScale`（既存 `zoom<0?1+zoom*0.85:1+zoom*1.5`）→ **上げ側を ×4.0 に：`zoom<0?1+zoom*0.85:1+zoom*3.0`**（DMX255で扇が4倍開く・ホーム128は不変）
  - `beamTiltRad`：`TILT_MAX` を **`(Math.PI*3)/4`（±135°）→ `Math.PI`（±180°）**。灯体を上に置いてTILTを振れば**トップライト（上から）**になる
  - **新エフェクト9種の関数を追加**（`breathK/fireK/waveK/boltK/zoomPulseK`＋虹=HSL色相回転＋既存 chase/strobe/search/colorchase）。式はモックの該当関数をそのまま移植
- **`src/renderer/src/output/OutputRenderer.ts` の `renderUplights`（156行〜）**
  - 写真×光の合成（248,278 の `imageAlbedo` × 光マップ）を **色比保持トーン**に変更（白茶け解消＝§5の式）。これが「白に色が鮮やかに乗る」リアリティの核心
  - **ノイズ床退治**：今の全画面ノイズ（縞退治）を、**光マップと乗算してから加算**するよう変更。無灯部は完全な闇のまま（§5）
  - エフェクトの適用：各 fixture の I（明るさ系: chase/strobe/breath/fire/wave/bolt）・color（虹/colorchase）・pose.zoom（zoompulse）を毎フレーム変調
  - **ミュート/ソロ**：`isLit(fixture)` が false の灯体は描画スキップ

### 状態（store拡張）
- **`src/renderer/src/state/store.ts`**
  - 画像照明モードの状態：`scenes`（写真棚＝セット写真＋写真ごとの灯体構成 `fix`）、`patterns`（シーン棚×9＝明かりの完成形）、FXフラグ＋`fxp`、`beams`（灯体・配置・`mute`/`solo`）、`master`、`masterMidi`、`userColors`
  - シーン：`currentLook/applyLook`（色・ゲージ・PTZ・FX・FXツマミを保存/復元）
  - 写真ごとのミュート構成：`saveFixState/loadFixState`（写真切替で使う灯体が切り替わる）

### UI（新規コンポーネント）
- **`src/renderer/src/ui/ImageLightingMode.tsx`（新規）**：モックの PLAY/BUILD をReactで再現
  - **PLAY**：シーン×9（数字キー/MIDI/クリックで呼ぶ）、MASTER（LEARN+↑↓キー）、ESC案内、下に写真棚
  - **BUILD**：FIXTURES（番号+色ドット+**M/S内蔵**・⌘クリック追加・上限24）、GAUGE、COLOR（固定8色+カラーピッカー+色プリセット）、PAN/TILT/ZOOM+HOME、**FXラック12**（点けたFXのツマミだけ出る）、SCENES（保存/LEARN/改名）、仕込み（出口幅/広がり/届く高さ）、MASTER、SMOKE
  - **ステージ**：写真背景＋灯体マーカー（番号+下にM/S・双方向連動）＋⌘クリック追加＋ドラッグ移動
- **`src/renderer/src/App.tsx`**：モード切替に「画像照明モード」を追加（現在 `mode` と `testOpen`/`ManualFaders` がある。画像照明モードは新しい mode 値 or 専用画面として）

### MIDI（新規・CDSで実績のあるWeb MIDI）
- シーンの **LEARN（ノート 0x90）**＋マスターの **LEARN（CC 0xB0）**。モックの `initMidi` を移植。`navigator.requestMIDIAccess`

### 出力（既存・原則触らない）
- `main/output/syphon-publisher.ts` ＋ `OutputRenderer` の結果が自動で Syphon に乗る
- 背景は透明黒(0,0,0,0)＋premultiplied（実装済み）→ NDIアルファ付き or Add合成で「描画以外はいかない」

---

## 3. フェーズ別タスク（優先順・あさって本番）

### フェーズ1（必須：これで本番がResolumeに出る）
1. `uplight.ts`：終わり際の丸み・ZOOM×4.0・TILT±180
2. `OutputRenderer.renderUplights`：**色比保持トーン**＋ノイズ床退治
3. 画像照明モードの最小UI（写真読込・⌘クリックで灯体配置・GAUGE・COLOR・PAN/TILT/ZOOM）＋App.tsxにモード追加
4. Syphon/NDI出力確認（既存経路に乗ることを確認）

### フェーズ2（よく使う）
5. シーン棚×9（保存/呼出・数字キー）
6. エフェクト9種（点けたFXのツマミ）
7. ミュート/ソロ（灯体ボタン内蔵＋ステージ・写真ごと記憶）

### フェーズ3（あれば本番が楽）
8. カラーピッカー＋色プリセット（**localStorageで永続化**）
9. マスター/シーンの MIDI LEARN、↑↓キー、ESCパニックフェード
10. シーン名のダブルクリック編集・LEARN（キー/MIDI）

---

## 4. 確定した決定事項（のむさんと検証済み・変えない）

- **色比保持トーン**＝白に色が鮮やかに乗る（CGの白飛びを避ける）。家訓「色は白へ振らない」の写真素材への正しい適用。**テカリ・陰影は強いと嘘くさい → 隠し味 or 見送り**（フェーズ外）
- **操作モデル**：写真＝マウスでクリック ／ 明かり＝シーン（数字/MIDI/クリック）／ 緊急＝ESC（1.5秒フェードアウト）。本番PLAYはツマミゼロ
- **灯体配置は全シーン共通**、**ミュート/ソロは写真（セット）ごと**（使う灯体だけ絞る）
- **灯体追加は⌘+クリックのみ**（素クリックでは追加しない＝誤爆防止）＋＋ボタン。上限24
- エフェクト9種全採用 ／ ZOOM=広がりのみ（長さは変えない）／ 無灯部は完全な闇
- NDI：ArenaはマルチNDI入力可。別PC（電飾/照明）→Add合成 or 1台集約。担当が分かれるなら別PC

---

## 5. 実装の要点（モックから抽出・コピペの土台）

**色比保持トーン**（写真×光の各ピクセル。`dr,dg,db`=アルベド×光、強光で1超え）：
```
const mx = Math.max(dr, dg, db);
if (mx > 0) { const v = mx / (1 + mx * 0.45); const s = v / mx; dr *= s; dg *= s; db *= s; }
// → 色比（彩度）を保って明るさだけ圧縮。白茶けない。チャンネル独立clipは禁止
```

**ノイズ床退治**（無灯部を完全な闇に）：
```
// ノイズタイルを別キャンバスに敷き → 光マップと multiply → それを lighter で加算
// 光ゼロの場所は ノイズ×0=0 で底上げされない
```

**終わり際の丸み**（drawBeamCore 内・層ループ）：
```
const u = k / (NL - 1);            // NL=12
const wf = 1 - u * 0.62;           // 横: 外1.0 → 中心0.38
const lf = 0.70 + 0.30 * Math.pow(u, 1.4); // 縦: 外0.70 → 中心1.00
const L = len * lf;                // 各層の届く長さ。各層内で逆二乗ガンマ減衰
```

**ZOOM ×4.0**：`beamZoomScale = zoom < 0 ? 1 + zoom*0.85 : 1 + zoom*3.0`
**TILT ±180°**：`TILT_MAX = Math.PI`

**エフェクト（モックの式・t0=エフェクト開始時刻）**：
```
breathK(now)=(1-d)+d*(0.5+0.5*sin(2π*speed*t));  d=depth/100   // 全灯・呼吸
fireK(i,now)=clamp(0.72+amount/100*0.42*(0.55*sin(s+i*7.1)+0.30*sin(s*2.7+i*13.3)+0.15*sin(s*5.1+i*3.7)),0.05,1); s=t*5*speed  // 各灯・炎
waveK(i,now)=0.25+0.75*(0.5+0.5*sin(2π*speed*t - i*(0.4+2.5*length/100)))  // 波
boltK(now)= h<0.22 ? 1+strength/100*exp(-(r-floor(r))*5) : 1; r=t*2*max(0.1,rate); h=frac(sin(floor(r)*127.1)*43758.5453)  // 全灯・雷
zoomPulseK(now)=max(0.3, 1+amount/100*0.9*sin(2π*speed*t))   // 開閉（zoomに乗る）
虹: hue = t*speed*360 + i*spread/100*55; rgb = hsl2rgb(hue,0.95,0.6)   // colorNowで返す・colorChaseと排他
chase/strobe/colorchase/search(tilt): モックの chaseK/strobeK/colorNow/tiltNow をそのまま
```
**点灯判定**：`isLit(b) = !b.mute && (!beams.some(x=>x.solo) || b.solo)`

**FXごとのツマミ**（点いているFXのものだけUIに出す）：モックの `FX_PARAMS` 参照（速さ・幅・やわらか・点灯率・密度・なじみ・深さ・揺れ・波の長さ・頻度・強さ・ばらし・開き幅）

---

## 6. 検証＆既知の罠

- **テスト**：`cd ~/dev/decor-studio && npm test`（現在135本green・維持）／型 `npm run typecheck`
- **ビルド&起動**：`npm run build && npx electron-builder --dir` → `open "dist/mac-arm64/DECOR STUDIO.app"`
- **Web版反映**（任意）：従来どおり `dist-web` 経由で GitHub Pages
- **push**：キーチェーン認証で `git push origin main` がそのまま通る（PATを貼られたら直接push）
- **罠（引き継ぎ書より）**：
  - eval内で「DMX変更→ピクセル計測」は前フレームを読む。状態変更と計測は別evalに分ける
  - ヘッドレスは rAF 間引きで1フレーム遅延。`preview_screenshot` も古い画面を返すことがある（2回撮る or 先にピクセル実測）
  - 巨大HTML（画像埋め込み）への文字列置換は python で（Editはread必須）

---

## 7. 完成イメージ（のむさんの本番運用）

1. 玄関でセット写真（チャート）を読み込む → 写真棚に並ぶ
2. BUILD で灯体を⌘クリック配置（全シーン共通）→ 写真ごとにM/Sで使う灯体を絞る
3. BUILD で明かりを作る（色・PTZ・FX）→ シーン番号に保存・名前付け・LEARN
4. 本番は PLAY：写真をクリックでセット転換、シーンを数字/MIDI/クリックで呼ぶ、マスターフェーダー（物理MIDI）で全体フェード、困ったらESC
5. Syphon→NDISyphon→Resolume Arena（電飾は別PC or 同アプリ別モード、Arenaでadd合成）

**三層**：決め所=シーン（キー/パッド）／明るさ=マスターフェーダー／緊急=ESC。
