# DECOR STUDIO 引き継ぎ書（2026-06-13）— 別の Mac で編集を再開する版

> 次のチャットの Claude へ。**まず本書を上から読む。** 機能の深い仕様は「朝の部・夜の部」= `DECOR-STUDIO-引き継ぎ-2026-06-11.md` / `同-夜.md`、Art-Net の続きなら `引き継ぎ-2026-06-10.md` §0 を必要時に参照。
> **⚠ 旧文書のパス読み替え**：06-10 内の `~/Documents/decor-studio` は全て `~/dev/decor-studio` に読み替える（06-11 に iCloud 圏外へ引っ越し済み・`tools/artnet-sniff.mjs` 等は新住所に実在）。06-11夜の「push はキーチェーン認証」も旧情報＝**現在は SSH**（`git@github.com:nrs2013/decor-studio.git`）。
> のむさん（コンサート演出家・コード未経験・GitHub `nrs2013`）向けには **結論先・普通の言葉・コピペ完成形コマンド** で。UI に絵文字は使わない（Brutalist Vivid）。本書の各機能説明は「操作」の段落がのむさん向け、「実装：」「データ：」の行は Claude 向けメモ。

---

## ⚡ 今ここ — セッション終了時点サマリ

**この1日（2026-06-12〜13 朝・MacBook Air M2 で作業）に出荷したもの。全6コミット push 済み・自動テスト150本 green・.app 起動確認済み：**

| コミット | 内容 |
|---|---|
| `72a1de2` | 矢印キー微調整を複数選択対応に＋ボール球の既定 Φ5.5→**Φ7**・垂れ電球 Φ4→**Φ7** |
| `1e06c47` | **レイヤー機能**（1レイヤー=1曲：チャート画像＋電飾。卓は番地で曲を呼び出す） |
| `314b6c3` | **ロック解除バグ修正** — パッチ無しのロック品が一生解除できなかった→右クリックが解除の入口に |
| `6520198` | **自動バックアップ**（5秒ミラー→起動画面「前回の続きから」）・⌘S保存・⌘A全選択・Saved表示・Chart Name欄 |
| `3883023` | **等間隔吸着**（スナップ候補を端家系/中心家系に分離）・**⌘D連続均等複製**・移動中Shift軸固定・**Keysガイド** |
| `ec0b27a` | **Quick Light** — 卓なしで色を選んでポンと点ける（Programmerパネル上部） |

**主リポジトリ**: `github.com/nrs2013/decor-studio`（main・最新 = `ec0b27a`）
**Web版（ブラウザUI専用）**: https://nrs2013.github.io/decor-studio/ ※docs/ 配信は今回更新していない（後述の宿題）

**次の始め方（のむさんがコピペ）：**
> `~/dev/decor-studio` の引き継ぎ書（DECOR-STUDIO-引き継ぎ-2026-06-13.md）を読んで。続きから。

---

## 🖥 別の Mac（iMac）で編集を再開する手順 — 本書の主目的

もう1台の Mac にも正コピー `~/dev/decor-studio` がある（2026-06-11 の iCloud 圏外引っ越しで作成済み。※06-10 文書では受信機を「nomura-mini」と呼んでいた — 本書で言う「iMac」と同一機体のはずだが、**作業開始時に `hostname` で確認**して、違ったら本書のこの行を直すこと）。**最新化は pull だけ**。Claude が以下を実行する：

```bash
cd ~/dev/decor-studio
git pull
npm install
npm run build && npx electron-builder --dir
open "dist/mac-arm64/DECOR STUDIO.app"
```

確認ポイント・つまずいた時の分岐：
- `git log --oneline -1` が本書のコミット以降であること
- pull が認証で止まったら `ssh -T git@github.com` で確認。Permission denied なら `git remote set-url origin https://github.com/nrs2013/decor-studio.git` で HTTPS（キーチェーン）に切替えてよい
- `npm install` が EACCES（権限がないというエラー表示）で落ちたら `npm install --cache ~/.npm-cache-clean`
- `open` が「見つからない」と言ったら `ls dist/` で実際のフォルダ名を確認（Apple Silicon は `mac-arm64`、Intel なら `mac`）
- アプリが開いたらツールバー右に **「Keys」「Programmer」** ボタンが見える＝最新版
- 自動テスト：`npx vitest run` → **150 passed**

### ⚠ Mac をまたぐ時の注意（重要・3つ）

1. **自動バックアップは Mac ごとに別**。「前回の続きから」（起動画面の緑ボタン）は各 Mac の `~/Library/Application Support/decor-studio/autosave.decor.json` を見るので、**MacBook で作業中のチャートは iMac には出ない**。持ち運ぶなら MacBook 側で **⌘S でファイル保存**（.decor.json）→ AirDrop か iCloud で渡して iMac で Load。
2. **デスクトップの起動ボタン**：`DECOR-起動.command` は iCloud 同期でデスクトップに見えるはず。パスは両 Mac 共通（`~/dev/decor-studio/dist/mac-arm64/`）なので**ビルドさえすればそのまま動く**。
3. **🚫 `DECOR-公開.command` は今は実行禁止**。中身が `git add -A` → `git commit --amend` → `git push` で、HEAD が push 済みの現状では**実行すると必ず push が拒否され、しかも未追跡ファイルを巻き込んで履歴を書き換える**。Web 版を公開したくなったら宿題1の手動手順を使う（.command 自体を普通の commit に直すまで封印）。
4. **MacBook 固有の罠（もう1台には無関係のはず）**：MacBook の `~/.npm` キャッシュに root 所有（管理者の持ち物になった）ファイルが混入しており、`npm install` が EACCES（権限エラー）で落ちる場合は `npm install --cache ~/.npm-cache-clean` で回避（恒久修正は `sudo chown -R nomurayuuki:staff ~/.npm`・のむさんのパスワードが必要）。

### Claude 開発環境の再現（iMac 側）

- ブラウザ検証用 dev サーバー：`~/.claude/launch.json`（**ホームの方**）に以下を足すと preview ツールで起動できる（MacBook では追加済み・iCloud 同期対象外なので iMac では手動で要追加）：

```json
{
  "name": "decor-web",
  "runtimeExecutable": "bash",
  "runtimeArgs": ["-c", "cd /Users/nomurayuuki/dev/decor-studio && npm run dev:web -- --port 7660 --strictPort"],
  "port": 7660
}
```

- ブラウザ検証の作法：`window.__decorStore` / `window.__decorView` が公開されている（store 直叩きと座標変換に使う）。**プレビューのビューポートは必ず 1680×1000 程度にリサイズ→リロードしてから**操作系を検証する（狭いとキャンバスが潰れてクリック検証が全部空振りする。今日2回ハマった）。React の state 切替とクリックを**同じ eval でやらない**（切替前のクロージャが走る）。合成 PointerEvent には `buttons: 1` を必ず入れる。

---

## 🆕 今回の新機能 — 仕組みと操作（のむさんへの説明にそのまま使える）

### 1. レイヤー（曲ページ）— `1e06c47`

- **1レイヤー = 1曲**（チャート画像＋その曲の電飾一式）。右パネル最上部の **LAYERS** で管理。
- 追加：**+ Image**（画像を選ぶ）／**+ Blank**／**キャンバスへ画像ドロップ**（ファイル名が曲名になる）。名前ダブルクリックで変更。削除はその曲の電飾ごと消える（confirm あり・undo 可）。
- 編集できるのは**アクティブレイヤーだけ**。他の曲は Show 時に 22% の薄いゴーストで見え、クリック・囲み選択・消しゴムは素通り（事故防止）。**⌘V の貼り付けと Fill の生成物も常に今の曲に着地**する（曲Aでコピー→曲Bで⌘V＝曲B所属）。**曲ページの追加/切替で選択は全解除**される（Quick Light の「選択中 0」になるのは仕様）。
- **出力（Syphon/Live）は常に全レイヤー合成**。点いていない電飾は透明＝**卓がその曲の番地に色を入れるだけで曲が「呼び出される」**（番地住み分け方式・のむさん選択）。曲ごとにユニバースを分けて運用（例：M1=U1、M2=U2…）。フェードは卓側で自由。
- データ：Chart **version 2**（`layers[]`・`activeLayerId`・`Shape.layerId`）。**v1 ファイルは開いた瞬間に自動変換**（`io/chart-file.ts` の `migrateV1` — 旧 underlay と全 shapes を「CHART 1」レイヤーに包む）。保存は常に v2。

### 2. Quick Light（卓なしチェックの主役）— `ec0b27a`

- **Programmer**（ツールバー右）の最上部。舞台定番11色スウォッチ＋自由な色＋明るさフェーダー1本。
- 対象：**全部／今の曲／選択中**（キャンバスの選択と連動・各ボタンに個数表示）→「点ける」「消す」。
- **⚠ 点くのは「番地をパッチ済みの電飾」だけ**。パッチしていない図形はどの対象でも点かない（本物と同じ：結線していない電球は光らない）。ボタンの個数もパッチ数なので、LAYERS の図形数と食い違うことがある。「点けたのに点かない」相談はまず Inspector の PATCH 欄を確認。
- 殺し文句の使い方：**キャンバスで電飾を選んで（⌘A や囲み選択）→ 色ポン → 点ける**。Live 画面に切り替えて見え方確認。Syphon 経由で Resolume にもそのまま出る。
- 実装：`store.setManualMany(fixtureIds, rgb)`（1回の更新でまとめ塗り＋manualMode 自動ON）。
- 従来の Full/Chase/Check/Clear・番地別 RGB フェーダーはパネル下部に温存。

### 3. 等間隔吸着＋スナップの家系分離 — `3883023`

- 移動中、**並んでいるモチーフと同じ間隔・同じ中心ピッチ**になる位置でピタッと吸着（PowerPoint のスマートガイド相当）。
- **設計の核心（変えないこと）**：吸着候補は2家系に分離した。
  - **端家系** `xs/ys` = bbox の端、エッジ続きのギャップ候補
  - **中心家系** `cxs/cys` = 図形中心・線/フェストゥーンの端点・チャート島の中心・キャンバス中心・中心ピッチ候補
  - **家系をまたいでマッチしない**（`snapMoveDelta` が別々に評価し近い方を採用）。ボール球（中心基準）が箱の「端」に半端に吸う誤マッチを根絶するため。球・ネオン・舞台灯体の salient は中心のみ。
- `buildGapCandidates`（snapping.ts）：同じ行（y範囲が重なる）/同じ列のペアから O(n²) で候補生成、移動開始時に1回だけ。端ギャップは 1200px・中心ピッチは 2400px（MAX_GAP*2）超のペアを無視。
- おまけ：**移動中 Shift = 縦横まっすぐスライド**もここで追加（描画系の Shift まっすぐ・正円・ペン直線・頂点軸固定は**元から実装済みだった**）。

### 4. ⌘D 連続均等複製 — `3883023`

- 複製 → 好きな位置へドラッグ → **⌘D 連打でその間隔のまま列が伸びる**（PowerPoint の Ctrl+D）。**単一選択のみ対応**（複数選択中は1個だけ複製される — 複数対応は宿題）。
- 実装：`store.lastDup = {srcId, newId}`。⌘D の対象が直前の複製なら「そのペアの位置差」をオフセットに使う。**セッション内のみ・保存されない**（仕様）。

### 5. Keys ガイド — `3883023`

- ツールバー右の **Keys** ボタン or **?キー**で、全ショートカット・隠し操作の一覧（`ui/HelpPanel.tsx`・2カラム・31項目）。**新しいショートカットを足したら必ずここにも足す**こと。

### 6. 自動バックアップ＋⌘S/⌘A — `6520198`

- 編集中、チャートを **5秒デバウンスでミラー保存**（`io/autosave.ts`）。.app は `userData/autosave.decor.json`（IPC: `chart:autosave-write/read`）、ブラウザ版は IndexedDB（db `decor-studio` / store `kv` / key `autosave`）。
- 起動画面に**「前回の続きから — 名前（n枚・電飾n個）」**ボタン（緑）が出る。落ちても誤って閉じても戻る。
- **⌘S = 保存**（成功で SubBar に「Saved: ファイル名」2.5秒表示・カスタムイベント `decor:saved`）。**⌘A = 今の曲ページを全選択**（ロック品と他レイヤーは対象外）。
- **Setup に Chart Name 欄**（保存ファイル名になる。今までは常に Untitled だった）。

### 7. ロック解除の入口 — `314b6c3`

- ロック品は左クリック素通りのまま、**右クリックだけ当たる**（`hitTest(p, {locked: true})` のフォールバック）→ メニューに「ロック解除（n個）」。右ドラッグの「掴んで移動」はロック品では無効のまま。
- 背景：解除の唯一の入口が「パッチ表のチップ→Inspector」だったが、**写真素材などパッチしない物はチップが出ない**＝解除手段ゼロだった（のむさん報告の実害）。
- ついでに UI 絵文字を除去（パッチ表 🔒→`LOCK` バッジ・Inspector のボタン文言）。

### 8. Φ7 と矢印キー — `72a1de2`

- ボール球の既定 Φ5.5→**7**・垂れ電球 Φ4→**7**。ボール球は**既定のままの径はファイルに保存されず、手で変えた値だけが保存される**作り。だから径を触っていない既存ボール球は自動で 7 に追従し、手で変えた球と既存の垂れ電球（置いた時に径を焼き込む方式）はそのまま。
- 矢印キー微調整（1ドット・Shift=10ドット）を**複数選択対応**に（`store.nudgeShapes` — 1回の undo で全図形戻る）。

---

## 🗺 コード地図（今回の新規・重要変更）

```
src/renderer/src/
├── model/types.ts        … Chart v2（Layer / Underlay 型・Shape.layerId）
├── model/chart-model.ts  … createChart が layers 付き v2 を返す・addShape が activeLayerId 付与
├── model/erase.ts        … eraseCellsFromChart に layerId 引数（他レイヤーのストローク保護）
├── io/chart-file.ts      … parseChart: v1→v2 自動 migration（migrateV1）
├── io/autosave.ts        … 新規。useAutosave（5秒ミラー）・readBackup。Electron=IPC / Web=IndexedDB
├── state/store.ts        … addLayer/removeLayer/setActiveLayer/setLayerVisible/renameLayer・
│                            activeLayerOf（export）・nudgeShapes・lastDup・setManualMany・
│                            setChartName・helpOpen
├── editor/LayersPanel.tsx … 新規。右パネル最上部の LAYERS
├── editor/snapping.ts    … 家系分離（SnapCand/Salient に cxs/cys）・buildGapCandidates・mergeCand
├── editor/EditorCanvas.tsx … 矢印キー複数nudge・⌘S/⌘A/?・hitTest layerフィルタ＆lockedオプション・
│                            画像ドロップ=新規レイヤー・移動中Shift軸固定・flatX/flatY（頂点snap用）
├── ui/HelpPanel.tsx      … 新規。Keys ガイド
├── ui/StartScreen.tsx    … 「前回の続きから」ボタン
├── ui/SettingsDialog.tsx … Chart Name 欄
└── test/ManualFaders.tsx … Quick Light セクション（SWATCHES 11色・対象3種）

src/main/index.ts          … chart:autosave-write/read IPC（userData/autosave.decor.json）
src/preload/index.ts(.d.ts) … autosaveWrite/autosaveRead 公開
```

**触ってはいけない既存の核**（06-11 夜から不変）：`render/fixtures.ts` の `reflectGain`（グレアの法則）・`render/bulb.ts` の家訓白クリップ（55/88）・screen 合成の混色・UPLIGHT の仕込み/演出分離。

---

## 🔴 ランドマイン（既存＋今回の増補）

1. **（最重要・既存）** github.io / Pages 版はブラウザ UI 専用。**Art-Net(UDP 6454) も Syphon も動かない**。「卓の信号が来ない」相談はまず「Web じゃなく .app を使ってる？」。Art-Net 診断の一次情報は `引き継ぎ-2026-06-10.md` §0。
2. **layerId 未設定の図形は layers[0] 所属**として扱う（v1 migration と同じ意味論）。EditorCanvas の描画/hitTest/marquee、erase.ts、LayersPanel の個数表示、すべてこのルールで統一済み。新しい所属判定を書くときも `sh.layerId ?? chart.layers[0]?.id` を使うこと。
3. **出力は全レイヤー常時合成**。レイヤーの visible は**編集画面専用**（OutputRenderer はレイヤーを一切見ない）。「Live で他の曲が映り込む」は故障ではなく、卓がその番地に色を入れているだけ。
4. **スナップの家系分離を崩さない**。候補もサリエントも「端」と「中心」を混ぜると、ボール球が箱の端に半端吸着する元のバグが再発する。`snap1D` を使う頂点/コーナー系は点なので `flatX/flatY` で両家系を混ぜてよい（意図的）。
5. **自動バックアップは Mac ローカル**（上述）。さらに**「New」や「Load」をしても autosave は5秒後に新チャートで上書きされる**＝直前の作業を戻したいなら即「前回の続きから」ではなく undo を使う。
6. **Save は常にダイアログが出る**（保存先を覚える「上書き保存」ではない）。Electron の `chart:save` が毎回 showSaveDialog を出す仕様。不満が出たら「前回パスに黙って上書き＋⌘⇧S で別名」を実装検討。
7. **chart-file の version を上げる時**は migrateV1 の連鎖（v1→v2→…）と既存テスト（chart-file.test.ts）の round-trip を必ず更新。
8. **Web 版 docs/ は今回未更新**（宿題参照）。github.io の表示は `5348f7b` 時点のまま＝レイヤーも Quick Light も Web 版には**まだ無い**。

---

## 🧪 検証の回し方（Claude 用）

```bash
cd ~/dev/decor-studio
npx vitest run            # 150 本（19 ファイル）
npm run typecheck         # node + web 両方
npm run dev:web           # ブラウザ版 dev（vite.web.config.ts）
npm run build && npx electron-builder --dir   # .app 再生成
```

- ビルド後のアプリ差し替え（完成形）：
  `osascript -e 'tell application "DECOR STUDIO" to quit'; sleep 2; open "dist/mac-arm64/DECOR STUDIO.app"`
- **画面ロック中の Mac では .app のウィンドウ確認ができない**（macOS がウィンドウを出さない・コードの問題ではない。2026-06-12 に切り分け済み）。その場合はブラウザ版で機能検証し、その旨を正直に報告する。

---

## 🔥 未決・宿題（優先順）

1. **Web 版（github.io）への反映**（本件の正本。冒頭サマリとランドマイン8はここを参照）— docs/ が `5348f7b` 時点のまま＝レイヤーも Quick Light も Web 版にはまだ無い。反映の完成形手順（**`DECOR-公開.command` は使わない**・封印理由は「Macまたぎ注意3」）：

```bash
cd ~/dev/decor-studio
npx vite build --config vite.web.config.ts
rm -rf docs/assets docs/index.html
cp -R dist-web/. docs/
git add docs
git commit -m "build(pages): Web版に2026-06-12〜13の機能を反映"
git push
```

2. **キュー保存/再生**（のむさんに提案済み・「まず色ポンから」で見送り）— 点灯状態を場面として保存→ボタン/フェードで呼び出し。Quick Light の自然な次の一歩。
3. **レイヤーの並べ替え・複製**／**Programmer の番地別フェーダーに「選択中だけ表示」フィルタ**／**⌘D の複数選択対応**。
4. **06-11 夜からの継続案件**（詳細は `引き継ぎ-2026-06-11-夜.md` の宿題欄）：
   - 4a. 照明屋さんの返事待ち（UPLIGHT プレゼン HTML）
   - 4b. Art-Net 受信の実機確認 — 送信側 grandMA3 onPC の作業待ち。受信機は 06-10 で「nomura-mini・IP 192.168.1.171」と記録された機体（手順は 06-10 §0・パスは ~/dev に読み替え）
   - 4c. ネオン太文字の管筋化（モック判定案件）
   - 4d. ルームランプ再挑戦（約束・保留中）
   - 4e. 暗部トーの写真ごと判定（記録のみ・実害なし）
5. **「上書き保存」方式の検討**（ランドマイン6）。

---

## のむさんの仕事ルール（このプロジェクトの不文律）

- 結論先。普通の言葉（舞台比喩は不要と明言済み）。コマンドは値を埋めた完成形。候補を出すなら最大4個。
- **UI に絵文字を使わない**。ボタンは 0.5px 細線の Brutalist Vivid（`ui/tokens.ts` が基準）。テキストサイズを勝手に変えない。
- 技術的な How は聞かずに推奨で進める。**破壊系・UX 大変更・デザインは事前確認**。
- 報告前に必ず実物で動作確認（「全部できた」と言う前にチェックリスト自問）。未確認のことは未確認と言う。
- 複数解釈がある指示は AskUserQuestion で選択肢を出して確認してから動く。
