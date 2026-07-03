# CLAUDE.md — LED STAGE IMAGER

このファイルは Claude Code が自動で読むプロジェクトの説明書。**2台のMacで共通の前提**にするため、リポジトリに置いて GitHub で同期する。

## このアプリは何か
- **LED STAGE IMAGER**：Electron + React + TypeScript + Vite。コンサートの電飾/照明ツール。
- 2モード：**チャート(電飾配置)モード**（DMX/Art-Net受信 → 図形で電飾を描く → Syphon/NDI出力）と、**画像照明モード**（写真を“灯体”で照らす本番モード）。
- repo: `git@github.com:nrs2013/led-stage-imager.git`（旧 `decor-studio` は自動転送）。appId `com.decor.studio`。
- 開発ディレクトリ：`~/dev/decor-studio`。本番アプリ：`~/Desktop/LED STAGE IMAGER.app`（github.io はUI確認用・本番は必ず .app）。

## ユーザー（のむさん）について
- コンサート演出家・**コード未経験**。音声入力なので指示に文字化けが混じる。**結論から・普通の言葉で**説明する。コマンドは**コピペできる完成形**で渡す。
- **データ消失を極度に嫌う**（過去に位置データを潰して激怒）。破壊的操作の前は必ずバックアップ＆確認。
- 見せる前に**実物で自己確認**してから報告する。「全部できた」と言う前にチェックリストで自問（中途半端報告は厳禁）。
- 不明・複数解釈なら**勝手に解釈せず確認**してから動く。

## デザイン規約（Brutalist Vivid・厳守）
- **UIに絵文字を使わない**（記号/短い英字で代替）。
- ボタンは**0.5px細線＋半透明背景＋白文字**。塗りつぶし/太線にしない。
- **文字サイズを変えない**（過去に本番が崩れた）。
- **ボタンの当たり判定は大きめに**（小さいと「押しづらい」と言われる）。padding/幅/高さ＝hit areaだけ大きくし、文字・線は変えない。
- ビーム等の見た目は**実機でのむさんと追い込む**（プロトタイプの作り物は嫌われる）。

## ビルド→本番差し替え（定番）
```
cd ~/dev/decor-studio
npm run typecheck                      # 壊れた版を渡さない。先に必ず通す
npm run build:mac                      # → dist/mac-arm64/"LED STAGE IMAGER.app"
osascript -e 'quit app id "com.decor.studio"'
ditto "dist/mac-arm64/LED STAGE IMAGER.app" "$HOME/Desktop/LED STAGE IMAGER.app"
xattr -cr "$HOME/Desktop/LED STAGE IMAGER.app"
open "$HOME/Desktop/LED STAGE IMAGER.app"
```
- **Windows配布**：`npm run build:win` はホストarch依存でarm64になる。友達用は **x64**：`npx electron-builder --win --x64`（→ `dist/decor-studio-1.0.0-setup.exe`）。WindowsはMIDI不可（CoreMIDIはMac専用）。Mac版はAppleシリコン向け。
- `dist/.metadata_never_index` を置く＝ビルド成果物をSpotlight索引除外（再ビルド直後にMac全体が重くなるのを防ぐ）。

## Git / 2台Mac運用
- **GitHubが唯一の正**。作業前に `git pull`、作業後に `git commit`→`git push`（SSH。**PAT発行禁止**）。
- **commit / push は頼まれた時だけ**。勝手に上げない。
- 引き継ぎ書 `LED-STAGE-IMAGER-引き継ぎ-*.md` は公演機密扱いで `.gitignore` 済み（GitHubに上げない）。NDI/MIDIの市販・自前バイナリも gitignore 済み。

## 地雷・要注意（コードで踏みやすい）
- 🔴 **配置復元で縦位置が潰れる**：`engine.ts restoreShow()` は灯体復元後に必ず `rigCustomized=true`（立てないと `placeRigAtPhotoBottom` が全灯体を写真下端へ吸着＝データ事故）。差し替え/再起動前に `~/Library/Application Support/decor-studio/il-autosave` をバックアップ。
- 🔴 **灯体ごとの `ctx.filter='blur'` は禁止**（`lc` は willReadFrequently=ソフト描画でCPU畳み込み＝激重）。やわらかさは全画面blur1回（`BEAM_SOFT`）に集約。`BEAM_BLUR=0` を戻さない。
- **ビーム調整つまみ**（`engine.ts` 上部）：`BEAM_SOFT`(全体ぼかし)・`BEAM_ROOT_BOOST`(根元の明るさ)・`CONTACT_HOT`(白焼け強さ)・`CONTACT_HOT_FROM`(これ未満の明るさでは白く焼けない)・`CONTACT_NIJIMI`(色にじみ)。
- **Windows NDI**：同梱DLL(`resources/ndi/Processing.NDI.Lib.x64.dll`)＋koffi(win32_x64)を最優先で読む設計（NDI Tools不要）。出ない時はDLLでなく**Windowsファイアウォール / NDI探索(mDNS) / 受け手のサブネット**を疑う。Interface(回線)選択は **Art-Net入力専用でNDIに無関係**。
- **データ保存先**＝`~/Library/Application Support/decor-studio/`（il-autosave/show.json＋media、Local Storage）。アプリ差し替えでは消えない。
- **画像照明の「保存」＝1ファイル `.ledshow`**（ZIP中身＝show.json＋media/写真動画・アイコン付き・ダブルクリックで開く）。旧フォルダ保存(show.json＋media/)も「開く」で読める（後方互換・壊さない）。media のキーは `media/001.png` 形式で serialize/zip/restore 全て一致必須（`showbundle.ts`＝zip/unzip・往復テスト有り）。チャートは別で `.ledimager`(単一JSON)。
- **ミュート/ソロは写真(シーン)ごと保存・配置は全シーン共通**（非対称・仕様）。

## 作業の型
- 変更したら `npm run typecheck` → `build:mac` が通ってから差し替える。
- computer-use は Aqua Voice / Codex 等の透明ウィンドウにクリックを弾かれることがある（スクショは可）。最終の見た目はのむさんの実機確認に頼る。
