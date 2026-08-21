# AGENTS.md — LED STAGE IMAGER 開発引き継ぎ

**これから開発を引き継ぐ方（と、その方のAI）向けの説明書です。ここだけ読めば始められます。**
Codex / Claude Code はこのファイルを自動で読みます。人が読んでも分かるように書いてあります。

---

## 0. 先に3行

- これは**コンサート本番で実際に使っているアプリ**です。壊れると本番が止まります。
- **`main` が唯一の正**。作業はブランチを切って **Pull Request** で。🔴 **`main` に直 push しないでください。**
- 出す前に必ず `npm run typecheck && npm test`。**現状の基準値＝型エラー0 / テスト 50ファイル・369件すべて通過**（2026-08-09 実測）。

---

## 1. 何のアプリか

**LED STAGE IMAGER** — コンサートの電飾・照明を画面上に「絵」として作り、映像卓（Resolume Arena）へ映像として送り出す道具。

信号の流れ：

```
照明卓 ──DMX/Art-Net──▶ LED STAGE IMAGER ──Syphon(Mac) / NDI──▶ Resolume ──▶ 会場のLED
```

起動すると入口が2つ（`src/renderer/src/ui/StartScreen.tsx`）:

| 入口 | 中身 |
|---|---|
| **SHOW MODE** | 本番用。配置図（チャート）の上に電飾・灯体を並べ、卓から来たDMXで光らせて Syphon/NDI で出す。常に新規（空）で始まる。 |
| **LIGHT SKETCH** | かんたん版（旧・画像照明モード）。写真を灯体で照らして見た目を作る簡易プレビュー。卓なしでも動く。 |

技術構成：**Electron 39 + React 19 + TypeScript + electron-vite + zustand**、テストは **vitest**。
描画は Canvas 2D（`imagelight/engine.ts` が本体・約6,000行）。

本番で使うのは**必ずビルドした `.app`**。web 版（`dist-web` / github.io）は UI 確認用です。

---

## 2. 環境を作る（Mac・Apple シリコン）

```bash
git clone https://github.com/nrs2013/led-stage-imager.git ~/dev/decor-studio
cd ~/dev/decor-studio
npm ci
npm run typecheck && npm test
npm run build:mac        # → dist/mac-arm64/"LED STAGE IMAGER.app"
```

- **Node v24 系**で動作確認済み（v24.14.0 / npm 11.9.0）。
- `npm ci` が `EACCES` で落ちたら `npm ci --cache /tmp/npm-cache` で回避。
- 🔴🔴 **このリポジトリで dev サーバー／preview／ヘッドレスChrome を起動しないでください**
  （`npm run dev` `npm run dev:web` `npm start` すべて）。**過去に Mac ごと固まった実害があります。**
  Claude 側はフックが機械で止めますが、Codex にはその機械が無いので、この行が唯一の歯止めです。
  確認は「ビルドした `.app` を目視」＋ `npm run typecheck` ＋ `npm test` で行ってください（鉄則）。
  > 🚫 2026-08-22 まで、ここには逆に「UIだけ速く見たい時は `npm run dev:web`」「実機で見る時は `npm run dev`」と
  > 書いてあった。Claude への全Mac共通の禁止（CLAUDE.md）と正反対の指示が Codex にだけ
  > 出ている状態だった（監査#6）。
- Windows 版（`npm run build:win`）は **Windows 実機が必須**。Mac では作れません。

---

## 3. git で来ないファイル（無くても開発できます）

`.gitignore` で外してあるもの。**UI・ロジックの開発には要りません。**

| ファイル | 何 | 入手 |
|---|---|---|
| `resources/ndi/libndi.dylib` | Mac の NDI ランタイム（市販バイナリ） | `resources/ndi/README.md` に手順 |
| `resources/ndi/syphon2ndi` | Mac の Syphon→NDI ブリッジ（自前ビルド） | `tools/syphon-ndi-bridge/build.sh` |
| `resources/ndi/Processing.NDI.Lib.x64.dll` | Windows の NDI ランタイム | 同上（NDI 6 SDK から抽出） |
| `resources/midi/midiread` | Mac の CoreMIDI リーダー（自前ビルド） | `tools/midi-bridge/` |

**無い時の挙動：**起動時に `existsSync` で見て、無ければ **NDI 出力が黙って無効になるだけ**（`src/main/output/ndi-bridge.ts:55`）。ビルドも起動も通ります。

また `LED-STAGE-IMAGER-*.md` / `DECOR-STUDIO-*.md`（過去の作業メモ）は**公演の機密が混ざるため公開リポに置いていません**。技術的に必要な要点は、このファイルと `CLAUDE.md` に写してあります。

---

## 4. 依頼者（野村）との付き合い方

- **コンサート演出家で、コードは書きません。** やり取りは日本語・普通の言葉で。舞台用語に例えなくて大丈夫です。
- **ターミナルのコマンドは、コピペしてそのまま動く完成形で**渡してください。
- 🔴 **データが消える・上書きされる変更は必ず事前に一声。** 過去に配置データを潰して大問題になっています。
- 🔴 **「できました」は、実物で動かして確かめてから。** 中途半端な状態での完了報告が一番困ります。
- **見た目・デザインの変更は事前確認**（下の §5）。**技術的な選択（ライブラリ・書き方・設計）は聞かずに進めて構いません。**
- 指示が曖昧・複数に読めるときは、勝手に解釈せず聞いてください。

---

## 5. デザイン規約（勝手に変えない）

現場で使い込んで固まった形です。触ると本番のオペレーションが崩れます。

- **UI に絵文字を使わない**（記号か短い英字で代替）。
- ボタンは **0.5px の細線＋半透明背景＋白文字**。塗りつぶし・太線にしない。
- **文字サイズを変えない**（過去に本番のレイアウトが崩れた）。
- **ボタンの当たり判定は大きめに。** padding / 幅 / 高さだけ大きくし、文字と線は変えない。
- ビーム（光の伸び）などの見た目は、**実機で本人と数値を追い込む**前提。作り込んだ「それっぽい」初期値だけで完成にしない。

---

## 6. 🔴 地雷（先に読む。踏むと本番事故）

1. **`engine.ts` の `restoreShow()` は灯体復元後に `rigCustomized = true` が必須。**
   立てないと `placeRigAtPhotoBottom` が全灯体を写真下端へ吸着＝**保存データが壊れる**。
2. **灯体ごとの `ctx.filter = 'blur'` は禁止。** `lc` は `willReadFrequently`＝ソフト描画なので CPU 畳み込みで激重になる。
   やわらかさは**全画面 blur 1回**（`BEAM_SOFT`）に集約済み。`BEAM_BLUR = 0` を戻さない。
3. **`main/index.ts` の `chart:open` は「読めてから保存先を覚える」順序。**
   逆順にすると、読込に失敗したファイルを次の ⌘S で上書きします。
   上書き先は renderer 側の `showPathRef`（実際に開けた／保存できた時だけ更新）を保存のたびに main へ渡す設計。**main に保存先を覚えさせない。**
4. **`engine.ts` 冒頭の `localStorage.removeItem(RIG_KEY)` は意図的**（明かり・色・シーンを前回から引きずらないため）。
   MIDI 割当だけ別キー `decor.imagelight.midimap.v1` に分離してあります。**混ぜ戻さない。**
5. **renderer で `window.confirm` を使わない。** JS が止まって終了確認が素通りします。
   未保存の三択確認は `window.__ilDirty` / `__ilSaveForClose` / `imagelight:ask-save`。**無応答 1.5 秒は「未保存扱い」が正**。
6. **暗転中のセンチネル `outW <= 16`。** 現場で入れたカクつき対策をそのまま移すと、**暗転中に電飾が LED に出続ける事故**になります。
7. **保存形式**：LIGHT SKETCH の公演は **1ファイル `.ledshow`**（ZIP：`show.json` ＋ `media/`）。旧フォルダ保存も「開く」で読める（後方互換・壊さない）。
   media のキーは `media/001.png` 形式で serialize / zip / restore すべて一致必須（`showbundle.ts` に往復テストあり）。SHOW MODE のチャートは別で `.ledimager`（単一 JSON）。
8. **ユーザーデータの置き場所** = `~/Library/Application Support/decor-studio/`（`il-autosave/show.json` ＋ media、Local Storage）。
   アプリを差し替えても消えません。**差し替え・大改修の前に `il-autosave` をコピーしてバックアップ。**
9. **ミュート／ソロは写真（シーン）ごとに保存、配置は全シーン共通。** 非対称ですが仕様です。
10. **電飾（SHOW MODE）の Syphon/NDI 出力は常時**（編集中も 30fps で送出・LIGHT SKETCH 中は自動で黙る）。
    「Resolume に出ない」の一次疑いは **Resolume 側のソース選択**。Windows で出ない時は DLL でなく**ファイアウォール / NDI 探索(mDNS) / 受け手のサブネット**。
    アプリ内の Interface（回線）選択は **Art-Net 入力専用で NDI とは無関係**です。
11. **`typecheck` が通っても配置は間違えられます**（JSX は型が通る）。**必ずブラウザか実機で目視。**

---

## 7. 残っている課題（優先度順）

1. 🔴 **つまみドラッグのもたつき（本命・未解決）。**
   根因＝つまみを1目盛り動かすたびに `imagelight/ImageLightingMode.tsx` の画面全体が作り直される（開発ビルドで1回約50ms）。
   本筋は「ドラッグ中は全体を作り直さない」か「画面を分割してつまみの行だけ描き直す」。前者は一度試して**かえって遅くなった**ため入れていません。
   ⚠️ **必ず Electron 実機で測る**（ブラウザの隠れタブは rAF が止まり fps を誤ります）。
2. **光の伸び／ランダムサーチの数値追い込み。** `engine.ts` 冒頭のつまみ（`BEAM_REAL` / `BEAM_SPREAD_DIM` / `BEAM_END_FADE_FROM` / `BEAM_HAZE` / `BEAM_SOFT` / `BEAM_ROOT_BOOST` / `CONTACT_HOT` / `CONTACT_HOT_FROM` / `CONTACT_NIJIMI`）を**実機で本人と**。
3. **SHOW MODE に「最初の画面へ戻る」導線が無い**（LIGHT SKETCH 側にはある）。仕様の穴。付けるかは要確認。
4. **保存漏れの残り**：表示中の CUE 番号 / GO 位置 / LOCK / モチーフチェイスの走行状態、LEARN 待機中に別公演を開くと割当が消える。
5. **Windows のカクつきと色（未解決）。** 送出解像度を下げると色が変わる。現場機は稼働中のため慎重に。
6. **LED 出し**：送出だけ整数分の1に縮小（縦ライン揃え）、チャート読込で原寸、`MAX_W` 上限。

---

## 8. 作業の型

```bash
cd ~/dev/decor-studio
git fetch origin && git status -sb
git switch -c feat/やること              # main に直接コミットしない
# …実装…
npm run typecheck && npm test            # 型0 / 369件 が基準
npm run build:mac                        # 実機で見る
git push -u origin feat/やること         # → Pull Request
```

- **共同作業者として招待します。** GitHub のユーザー名（またはメールアドレス）を教えてください。
  招待が届いたら、**このリポジトリに直接ブランチを切って push → Pull Request** でお願いします。フォークからの PR でも構いません。
- ブランチ：`main` が正。`feat/depth-3d-relight`（3D・奥行き系の実験）と `backup-local-2026-06-14` が未マージで残っています。
- **`.app` の差し替え**（実機で確認する時）:

```bash
osascript -e 'quit app id "com.decor.studio"'
for i in $(seq 1 30); do pgrep -f "MacOS/LED STAGE IMAGER" >/dev/null || break; sleep 1; done
pgrep -f "MacOS/LED STAGE IMAGER" >/dev/null && echo "まだ起動中（保存確認に答えて）" || {
  ditto "dist/mac-arm64/LED STAGE IMAGER.app" "$HOME/Desktop/LED STAGE IMAGER.app"
  xattr -cr "$HOME/Desktop/LED STAGE IMAGER.app"
  open "$HOME/Desktop/LED STAGE IMAGER.app"
}
```

未保存があると quit が「保存しますか？」で止まります。**終了を待ってから差し替える**（動作中に上書きしない）。

- Mac 版・Windows 版とも**無署名**です。受け取る人に開き方の説明が必要になります。
- `CLAUDE.md` は同じ内容の内部向けメモです（読んで構いません）。

---

## 9. 困ったら

**仕様は野村が全部決めています。** 迷ったら実装を進める前に聞いてください。
「どちらが正しいか分からない」で止まる方が、作ってから直すより早いです。
