# PROGRESS.md — 段階と進み具合

たたみさん（Tatami-Iwashi）プロジェクト「LED IMAGERを究極のソフトに育てあげる」の進行記録。
作業ルールは AGENTS.md、決定事項は DECISIONS.md。

## 段階（全5）
1. ✅ 変更できる状態にする（2026-11-05）
2. ⬜ 改善したい点を洗い出す（たたみさんの要望＋AGENTS.md §7 の残課題）
3. ⬜ 優先順位を決めて1件ずつ実装（ブランチ→PR）
4. ⬜ Mac 実機で .app を確認
5. ⬜ 本番投入

## 2026-11-05 段階1の結果
- リポジトリ：`nrs2013/led-stage-imager`（main が正・直 push 禁止・PR で）
- 構成：Electron 39 + React 19 + TypeScript + electron-vite + zustand / テスト vitest
  - `src/main`（Art-Net受信・MIDI・Syphon/NDI出力・保存）／`src/preload`／`src/renderer/src`（UI・描画。本体は `imagelight/engine.ts`）
- クラウド環境で確認：`npm ci` → `npm run typecheck`（型エラー0）→ `npm test`（52ファイル・394件すべて通過）→ `electron-vite build` 成功
- .app の作成（`npm run build:mac`）と見た目の確認は Mac 実機のみ。dev サーバー類は起動禁止（AGENTS.md §2）
