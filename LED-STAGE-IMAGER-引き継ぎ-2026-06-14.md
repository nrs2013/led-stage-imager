# LED STAGE IMAGER（旧 DECOR STUDIO）引き継ぎ書 — 2026-06-14

> **次スレッドの Claude へ。** これは 2026-06-14 に実施した一連の改修（改名・アイコン・画像照明モード強化・部品実寸化・Arena連携・メモリ対策）の完全な引き継ぎです。**すべてコード実装＋ビルド反映済み**（型/Lint/テスト161本green）。
>
> **読む順**：①本書 → ②`DECOR-STUDIO-画像照明モード-引き継ぎ-2026-06-13.md`（画像照明モードの土台）→ ③`DECOR-STUDIO-画像照明モード-実装指示書-2026-06-13.md`（モックの式）。
>
> **のむさん**：コンサート演出家・コード未経験・GitHub `nrs2013`。**舞台用語で噛み砕く／ターミナルはコピペできる完成形で／PATを貼られたら git push まで（director-workflow 準拠）／メモリOOM厳禁。**
>
> **場所**：`~/dev/decor-studio`。**アプリ名は「LED STAGE IMAGER」**（旧 DECOR STUDIO。内部の識別子だけ旧名が残る＝§2）。

---

## 0. 今ここ（最重要サマリ）

- **2026-06-14、下記すべてをコード実装＋ビルド反映済み**：`dist/mac-arm64/LED STAGE IMAGER.app`（署名なし・`open` でローカル起動OK）。
- **改名**：DECOR STUDIO → **LED STAGE IMAGER**（表示名・ウィンドウ・**Syphon出力名**）。内部ID（appId / executableName / 保存拡張子 / localStorageキー）は不変。
- **アイコン**：Electron初期アイコン（原子マーク）→ **F案「ライトカーテン」**（黒地に cyan/fuchsia/amber/green の4本ビームが降る）。
- **画像照明モード**：①FIXTURES折りたたみ ②灯体コピペ改善＋整列/等間隔スナップ＋⌥複製 ③**光だけ出力モード**（Arena Multiply連携用）。
- **電飾（卓）モード**：部品の既定サイズを**実寸mm**化（LEDピッチ基準・画面1px=1mm）。
- **メモリOOM対策**：見張り `decor-mem-guard` 常駐（本セッション中に2回OOM/負荷爆発した→強化）。
- **残課題**（実機で詰める）：Arena連携の縦横比合わせ／白茶け修正／LEDドット描画（光る3mm）／背景チャート実寸合わせ。

---

## 1. ⚠ メモリOOM対策（最初に読む・本セッションで2回事故）

本セッション中、**メモリ不足でMacが2回停止**した（① preview検証＋ビルド＋Codex常駐の三重がけ ② Workflow 8体並列で load 51・swap 6.5GB の crit）。**のむさんの最優先事項＝二度とOOMにしないこと。**

### 守ること
- **preview検証 禁止**（`npm run dev:web` の vite/esbuild ＋ headless Chrome がOOM主因）。描画の確認は **ビルド後の実機目視 ＋ typecheck ＋ テスト**で担保する。
- **Workflow（多エージェント並列）禁止**。8並列で crit を出した。多案生成などは Workflow を使わず **直接 show_widget で少数ずつ**。
- **型 / テスト / ビルドは逐次**（並行させない＝メモリのピークを1つずつに）。
- ビルド前に vite/preview を止め、起動中の旧アプリを終了する。**Codex（約4.5GB）を切ると安全**（のむさんは別作業で開けたままのことが多い）。
- **メモリの見方**：`vm_stat` の `Pages free` だけ見ない。`inactive` ＋ `speculative` も実質空き（再利用可）。実質空き = (free+inactive+speculative)×pagesize。

### メモリ見張り（常駐済み・無害＝通知のみ）
- 本体：`~/bin/decor-mem-guard.sh` ＋ LaunchAgent `~/Library/LaunchAgents/com.nomura.decor-mem-guard.plist`（**15秒毎・通知のみ・プロセスは原則殺さない**）。
- しきい値：実質空き<6GBで🟡 / <3GBで🔴、load>コア数×2.5で🟡 / ×4.5で🔴。危機時のみ「作業ゴミ」(vite/esbuild/vitest/electron-builder)だけ pkill。Codex・本番.app・デスクトップClaudeには絶対触らない。
- ログ：`~/Library/Logs/decor-mem-guard.log`。手動テスト：`zsh ~/bin/decor-mem-guard.sh test`。停止：`launchctl bootout gui/$(id -u)/com.nomura.decor-mem-guard`。

---

## 2. 改名（DECOR STUDIO → LED STAGE IMAGER）

### 変えた所（ユーザーに見える表示名・Syphon名）
- `electron-builder.yml`: `productName: LED STAGE IMAGER`（→ `.app` 名が「LED STAGE IMAGER.app」になる）
- `src/renderer/index.html`: `<title>`
- `src/renderer/src/ui/StartScreen.tsx`: 起動画面 `<h1>` ＋ NDI説明文中の「DECOR STUDIO」
- **Syphon出力名（実体はメインプロセス）**：
  - `src/main/output/syphon-publisher.ts`（`start(name='LED STAGE IMAGER')`）
  - `src/main/index.ts`（`publisher.start('LED STAGE IMAGER')` 起動時＋rename時フォールバック＋コメント/console.log）
  - `src/renderer/src/model/chart-model.ts`（chart 既定 `syphon.name`）＋ `chart-model.test.ts`（期待値）
  - `src/renderer/src/output/LiveView.tsx`（"Syphon Out: …" 表示）

### 変えていない所（内部ID＝既存データ互換のため意図的に温存）
- `electron-builder.yml`: `appId: com.decor.studio`、`executableName: decor-studio`
- 保存拡張子 `.decor.json`、`RIG_KEY='decor.imagelight.rig.v3'`、`window.__decorStore`、`decor:image-loaded` イベント、`DecorApi` 型名
- MVR(grandMA3)エクスポートの "DECOR Cell" / "DECOR STUDIO"（`io/mvr-export.ts`・grandMA連携メタ＝別系統。変えると卓側の互換に影響しうる）
- 起動画面サブタイトル「CHART-BASED LED DECORATION」（のむさん未指定でそのまま。変える時は一声）

### ⚠ 本番Resolumeへの影響
Syphon名が変わった＝Resolume の Sources で旧「DECOR STUDIO」が消え「**LED STAGE IMAGER**」が出る。**本番でソースを選び直す必要あり**（のむさんは統一(A)を選択済み）。

---

## 3. アイコン（F案：ライトカーテン）

- 元SVG：`build/icon-src.svg`（200x200・地色 `#14110d` に cyan `#38d6ee` / fuchsia `#e879f9` / amber `#fbbf24` / green `#a8e878` の4ビーム＋上の光源点＋床のドット）。
- 差し替え済み：`build/icon.icns`・`build/icon.png`・`resources/icon.png`。
- ⚠ macはアイコンキャッシュで Dock/Finder の反映が遅れることがある（アプリ自体は新アイコン）。
- **再生成手順は §10**（rsvg等は入っていない。標準の qlmanage / sips / iconutil で作る）。

---

## 4. 画像照明モードの改修（`src/renderer/src/imagelight/`）

### 4-1 FIXTURES 折りたたみ（ImageLightingMode.tsx）
- 「仕込み」と同じ `<details className="il-note"><summary>▸ FIXTURES（灯体の選択）</summary> … </details>` でラップ。既定で畳む（あまり見ないため）。

### 4-2 灯体コピペ改善＋スナップ（`snap.ts` 新規 ＋ engine.ts ＋ ImageLightingMode.tsx）
- **直した問題**：描画は配列の後ろ＝手前なのに、ヒットテストは配列の前から探していた→重なると奥(古い)を掴み、群の選択が解除された。
- **ヒット**：onStageDown を **「選択中を手前から優先 → なければ手前から」** の逆順ループに。M/Sボタンのループも逆順。
- **⌥(Option)ドラッグで複製**：onStageDown で `e.altKey` なら `engine.duplicateSelectedInPlace()`（同位置に複製→ドラッグで分離。元は残る）。
- **整列/等間隔スナップ**：
  - `snap.ts`（canvas非依存の純粋関数）：`alignSnap`（群の点を他灯体の x/y に吸着）・`equalSnapX`（単体ドラッグ時、3つが等間隔になる x へ吸着）。`SNAP=9`（論理px）。
  - engine.ts：`beginDrag()/dragTo(rawDx,rawDy)/endDrag()` でドラッグを絶対位置＋吸着に。`snapGuides`（{vx,hy,equal}）を UI が読み、`drawSnapGuides`（ImageLightingMode.tsx）が赤い整列線・等間隔マーカーを描く。
  - テスト：`snap.test.ts`（8本）。
- **斜めずらしpaste**：`engine.pasteBeam` を `src.x+44 / src.y+44` に（真横より重なりにくい）。

### 4-3 光だけ出力モード（engine.ts ＋ ImageLightingMode.tsx）★Arena連携の本命
- **目的**：写真をアプリに貼らず、**灯体の光マップだけ**を Syphon 出力する。Arena 側で「映像 × 光（Multiply）」＝映像はVJが自由に差し替え、照明はアプリで操作、と分業できる。
- **実装**：
  - `engine.lightOnly`（boolean state）＋ `setLightOnly(v)`。
  - `renderFrame` のフレーム合成：lightOnly時、編集画面も写真なしで `lightCv`（光マップ）を表示（黒地に光のプレビュー）。`fc.drawImage(this.lightOnly ? this.lightCv : this.workCv, 0, 0)`。
  - `composeOutput` 冒頭：lightOnly時、`outCv = lightCv` を IW×IH=1920×1080 でそのまま出力（写真×光はスキップ）。
  - UI：BUILD の「← 本番へ」の下に「**光だけ出力**」トグル（il-mini・ON時シアン）。
  - 光マップ `lightCv` は写真 `mat` と独立に計算される（renderFrame 内 `if(maxI>0.004)` の灯体光部分）＝写真なしでも灯体さえ点いていれば光が出る。

---

## 5. 電飾（卓）モードの改修：部品サイズの実寸mm化

- **ルール（のむさん確定）**：LED 1ドット＝**光る部分3mm＋すき間9mm＝中心〜中心12mm**。**画面1px = 実物1mm**。部品は**横幅だけ**で定義（縦横比は不問）。
- **実装**（新規配置時の既定 diameter を実寸mm＝px に）：
  - `render/fixtures.ts`：`PAR_DEFAULT_DIAMETER=300`(パー30cm) / `BLINDER_DEFAULT_WIDTH=300`(8灯ミニブル30cm) / `PATT_DEFAULT_DIAMETER=500`(PAT「ただのパット」50cm) / `PIXELPATT_DEFAULT_DIAMETER=700`(Pixel PAT「パッド」70cm)
  - `render/bulb.ts`：`BULB_DEFAULT_DIAMETER=150`(ボール球15cm)
  - ドロップ時は `editor/EditorCanvas.tsx:1935` がこれら定数を参照＝**新規配置が実寸**に。既存 shape は元サイズを保持（壊れない）。
  - テスト：`editor/geometry.test.ts` のボール球 bounds を `BULB_DEFAULT_DIAMETER` 参照に修正。
- **⚠ 注意**：部品が実寸で大きくなる（パッド700px等）。**背景チャートも実寸前提**になるので、「**このチャートは横◯m**」で背景と部品の縮尺を揃える仕組み（§7-4）まで入れて本当に合う。

---

## 6. Arena連携（光だけ出力 → Multiply）★実機検証で確認済み

- **構想**：Arena に映像を置き、アプリは光だけ出力 → Arena で「映像 × 光（Multiply）」＝アプリの照明で映像を照らす。アプリ内の「写真×光」と同じ乗算原理＝見た目も同等。
- **Resolume側（Arena 7.26.2 で実機確認済み）**：
  - レイヤーの **Blend Mode = Multiply**。API は `parameter:set` の `video/mixer/Blend Mode`（`target:'layer'`）。GUIはレイヤー左端のブレンドモードボタン。
  - **下レイヤー＝映像／上レイヤー(Multiply)＝アプリの光（Syphon「LED STAGE IMAGER」）**。
  - 仮の光は Resolume の `Gradient`（Type=Radial、Color1=白〜薄グレー #cfcfcf、Color2=暗グレー #171717）で「中央スポット＋周辺は闇」が自然に出た。
  - Resolume 自身が「白黒(光)をカラー(映像)に Multiply は定番テクニック」と明言。
- **⚠ Resolume MCP の落とし穴**：`clip open` は**空コンポ/空deckだと "not found"** を返す。**ユーザーが手動で clip を1つ置くと、以降は MCP の open も通る**ようになる。
- **残課題＝縦横比**：光だけ出力は IW×IH=1920×1080（16:9）。映像が 32:9 等だと Multiply で位置がずれる。Arena側の Transform で光を映像にフィット、または**アプリ出力の比率を映像（チャート）に合わせる**仕組みが要る。次に実機で詰める。

---

## 7. 残課題（優先順・すべて実機で詰める）

1. **Arena連携の縦横比合わせ**（光だけ出力 vs 映像のアスペクト）。§6。
2. **白茶け修正**：赤＋赤で白くなる（家訓「色は白へ振らない」に反する）。現実は赤＋赤＝より明るい赤。原因＝光マップの screen 加算で赤が天井に張り付き白へにじむ。描画なのでテストで担保不可＝実機を見ながら。
3. **LEDドット描画**：光る部分3mm＋すき間9mm＝中心12mm の粒状感を、部品表面 or 出力に再現。実機調整。
4. **背景チャート実寸合わせ**：「このチャートは横◯m」を設定して、部品の実寸（§5）と背景の縮尺を揃える。現状チャートは縮尺バラバラ。
5. 色比保持トーン `PHOTO_TONE='ratio'` の本番後A/B（6-13 引き継ぎ §7）。

---

## 8. ビルド・検証手順（コピペ）

```
cd ~/dev/decor-studio
npm run typecheck          # 型(node+web)
npm test                   # テスト161本green
# ↓ ビルド前に Codex を切ると安全。preview/vite は使わない（OOM対策）
npm run build && npx electron-builder --dir
open "dist/mac-arm64/LED STAGE IMAGER.app"   # ← 改名後の .app 名に注意
```

- 署名なし＝自分のMacは `open` でそのまま起動できる。
- 単一ファイルの軽い検証（コピペ改善・実寸定数など「見なくても分かる」変更）は **typecheck＋テストで担保し、preview を省略**してよい。描画/出力/Syphon など見ないと分からない変更だけ、ビルド後に実機目視。
- push はキーチェーン認証で `git push origin main` がそのまま通る（PATを貼られたら直接 push）。
- dev環境のみ `window.__ilEngine` でエンジンを叩ける（`import.meta.env.DEV`）。

---

## 9. 主な変更ファイル一覧（2026-06-14）

**新規**
- `src/renderer/src/imagelight/snap.ts` ＋ `snap.test.ts`（整列/等間隔スナップ）
- `build/icon-src.svg`（アイコンF の元）
- 本書 `LED-STAGE-IMAGER-引き継ぎ-2026-06-14.md`

**改変**
- `src/renderer/src/imagelight/engine.ts`（`lightOnly` / `beginDrag`・`dragTo`・`endDrag` / `duplicateSelectedInPlace` / `pasteBeam` 斜め / `composeOutput`・`renderFrame` の光だけ分岐 / `SNAP`）
- `src/renderer/src/imagelight/ImageLightingMode.tsx`（FIXTURES折りたたみ / ヒット手前・選択優先 / ⌥複製 / ドラッグ吸着 / `drawSnapGuides` / 光だけトグル）
- `src/renderer/src/render/fixtures.ts`・`render/bulb.ts`（実寸mm定数）
- `src/renderer/src/editor/geometry.test.ts`（bulb bounds を定数参照に）
- `electron-builder.yml`・`src/renderer/index.html`・`ui/StartScreen.tsx`・`main/index.ts`・`main/output/syphon-publisher.ts`・`model/chart-model.ts`(+test)・`output/LiveView.tsx`（改名・Syphon名）
- `build/icon.icns`・`build/icon.png`・`resources/icon.png`（アイコンF）

---

## 10. アイコン再生成（コピペ完成形）

`build/icon-src.svg` を編集したら以下で `.icns` 等を作り直す（標準ツールのみ）：

```
cd ~/dev/decor-studio
SRC=/tmp/icon-src.svg.png
qlmanage -t -s 1024 -o /tmp build/icon-src.svg >/dev/null 2>&1   # SVG→1024 PNG
ISET=/tmp/LEDStageImager.iconset; rm -rf "$ISET"; mkdir -p "$ISET"
for s in 16 32 128 256 512; do
  sips -z $s $s "$SRC" --out "$ISET/icon_${s}x${s}.png" >/dev/null 2>&1
  d=$((s*2)); sips -z $d $d "$SRC" --out "$ISET/icon_${s}x${s}@2x.png" >/dev/null 2>&1
done
iconutil -c icns "$ISET" -o build/icon.icns
sips -z 512 512 "$SRC" --out build/icon.png >/dev/null 2>&1
cp build/icon.png resources/icon.png
# 反映は再ビルド（§8）。Dockのキャッシュが残る時は再ログインで確実。
```

---

## 11. 次の始め方（のむさんがコピペ）

> `~/dev/decor-studio` の `LED-STAGE-IMAGER-引き継ぎ-2026-06-14.md` を読んで。続きから。

**最初にやること**：実機（`LED STAGE IMAGER.app`）＋ Resolume Arena で、**§6 Arena連携の縦横比**と **§7 の白茶け・LEDドット描画・背景チャート実寸合わせ**を実機で詰める。**メモリは §1 を厳守**（preview禁止・Workflow並列禁止・逐次・Codex切る）。
