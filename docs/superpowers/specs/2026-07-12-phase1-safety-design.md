# フェーズ1: 安全と小粒3機能 — 設計（2026-07-12・のむさん承認済み）

9案採択のフェーズ1。調査の結果、当初4案のうち「世代バックアップ」は実装済み（il-autosave/history・20世代・保険/BACKUP UI）と判明し対象外。残り3つを実装する。

## ② NOW→SCENE の信頼性修正（卓ストロボ中の保存が明るさ0になる運まかせを解消）

**現状**: applyDmx が毎フレーム `b.gauge = m * gate` を焼き、`currentLook()` は `b.gauge` を直読みする。
卓の値は既存の「● いまの明かりをシーンへ保存」でそのまま取り込める（新ボタン不要）。
ただし gate は shutterGate（8〜245=ストロボの明暗 0/1）なので、暗相の瞬間に保存すると gauge=0 で保存される。

**変更**:
- `channel-math.ts` に `shutterStable(fx, data): 0|1` を追加（0〜7=0・8〜255=1。ストロボは「点いている扱い」）。
- `Beam` に `gaugeStable?: number` を追加。applyDmx で `b.gaugeStable = m * shutterStable(...)` を焼く。
- `currentLook()` の gauge を `b.dmx && this.dmxFrame ? (b.gaugeStable ?? b.gauge) : b.gauge` に。
- テスト: shutterStable の純関数テスト（閉/ストロボ/開）。

## ③ 暗転トグル復帰（0キーで暗転⇄直前の明かりへフェード復帰）

**現状**: blackout() は panicGain=0（係数型・gauge/master温存）＋ stopAllFx ＋ activePattern=-1。
undo は panicGain を維持する設計のため、⌘Z でも画面は真っ黒のまま＝復帰手段が実質ない。

**変更**（engine）:
- フィールド `preBlackout: Look | null` / `preBlackoutPattern: number` を追加。
- `blackout()` 冒頭で `currentLook()` と activePattern を退避（stopAllFx の前）。
- `blackoutToggle()` を新設: 暗転中（panicGain===0 && preBlackout あり）なら復帰、そうでなければ blackout()。
- 復帰 = pushHistory → applyLook(退避Look)（FX・チェイスも復活）→ activePattern 復元 →
  panicGain を 0→1 へフェード（sceneFadeMode='cut' なら即・'fade' なら sceneFadeMs）。
- `wake()`（CUE適用・全点灯）と `panicFade()`（Esc）開始時に preBlackout をクリア＝古い退避で誤復帰しない。
- getter `blackedOut` を追加（暗転ボタンの点灯表示用）。

**UI**: キー'0'・PLAYの暗転ボタン・CUEタブの暗転ボタンを blackoutToggle() に差し替え。
暗転中はボタンに on クラス（文字サイズ・ラベルは変えない）。Esc/戻す(undo)は従来のまま。

## ④ 本番中の上書きロック（LOCK）

**現状**: PLAY(SHOW MODE) 画面には SAVE/削除/LEARN が元々無く安全。危険地帯は本番中に触る
CUEタブに同居する SFXシーンの編集列（保存●・名前変更・削除×・LEARN◎）と、LIGHTタブの「明かりに保存」カード。

**変更**（UI のみ・engine 変更なし）:
- `editLock` state を追加。CUEタブ「本番 CUE」ヘッダに小さな LOCK トグルボタン（Brutalist Vivid・絵文字なし）。
- ON の間 disabled にするもの: SFXシーンの ●保存アーム・名前変更・×削除・◎LEARN／
  LIGHTタブの ●いまの明かりをシーンへ保存・✎名前変更・×削除・◎LEARN。
- 呼び出し（シーン適用・SFX発射・ALL）はロック中もそのまま。
- LOCK ON にした瞬間、進行中の保存アーム（armedSave / sfxArm）は解除する。
- 保存しない（アプリ再起動で解除）＝本番の日だけ ON にする運用。

## 検証

typecheck・vitest（shutterStable テスト追加）・ブラウザ実機（暗転トグルのフェード復帰・FX復活・
LOCK中に保存系が押せない/呼び出しは効く・ストロボ保存はエンジン直叩きで gaugeStable を確認）→
多角レビュー → build:mac → デスクトップ差し替え → push → 変更メモ。
