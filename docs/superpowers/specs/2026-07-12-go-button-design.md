# フェーズ2: GOボタン（キュー進行）— 設計（2026-07-12・のむさん承認済み）

曲の流れに沿って「このCUE＋この特効」を順番に並べた進行表を持ち、本番はGOを押すだけで次へ進む。
タイムコード同期・自動進行はやらない（人がGOを押す）。

## データ（engine.ts）

- `export interface CueStep { pattern: number | null; sfx: number | null; memo: string }`
  - pattern = patterns のインデックス（null=明かりは変えない）
  - sfx = sfxScenes のインデックス（null=特効は変えない）
- フィールド: `cueSheet: CueStep[] = []`・`cuePos = -1`（-1=開始前。cuePos は実行位置＝保存しない）
- キー/MIDI: `goKeyMap: { go?: string; back?: string }`・`goMidiMap: { go?: number; back?: number }`・
  `learnGo: 'go' | 'back' | null`（既存 learnFire と同じ排他仲間に入れる）
- メソッド:
  - `goNext()` / `goBack()`: cuePos を ±1（範囲クランプ）→ `applyCueStep(cuePos)`
  - `applyCueStep(i)`: step.pattern != null → applyPattern(pattern)／step.sfx != null → applySfxScene(sfx)
  - `goReset()`: cuePos = -1（適用はしない）
  - 編集: `addCueStep()` / `removeCueStep(i)` / `moveCueStep(i, dir)` / `updateCueStep(i, patch)`（全て pushHistory）
  - `assignGoShortcut(which, key?, midi?)` + `setLearnGo(which|null)`（既存の clearKeyEverywhere/
    clearMidiNoteEverywhere で1キー1役を維持。既存 learn 系との相互排他も既存流儀どおり）

## 保存・undo

- serializeShow: `go: { steps: cueSheet, keys: goKeyMap, midi: goMidiMap }` を追加。
  restoreShow は無ければ `[]`/`{}`（旧ショーはそのまま）。cuePos は保存せず -1 で開始。
- snapshot/restore（undo）: cueSheet と goKeyMap/goMidiMap を含める（編集を⌘Zで戻せる）。cuePos は含めない。
- restoreShowInner で cuePos = -1 に戻す。

## UI（ImageLightingMode.tsx）

- CUEタブ「本番 CUE」セクションの直後に「GO進行」セクション:
  - 大GOボタン（il-firebtn 級の当たり判定）: 1行目に「GO」、2行目に次ステップの内容
    （memo があれば memo、なければ「CUE n」「SFX n」）＋ 位置表示「n / 総数」。
    進行表が空のときは「進行表が空（下で作る）」表示で無効。
  - 隣に BACK（1つ戻って適用）・RESET（先頭前へ・適用なし）の il-mini。
  - GO/BACK に ◎LEARN（既存流儀・engine.learnGo）。
  - 進行表エディタ: 行＝「番号・CUEセレクト（なし/シーン1..N名前付き）・SFXセレクト（なし/1..6名前付き）・
    メモinput・↑・↓・×」。現在行（cuePos）をハイライト。「＋ 行を追加」。
  - editLock 中: 編集系（セレクト・メモ・↑↓・×・追加）は disabled。GO/BACK/RESET は使える。
- PLAYパネル（SHOW MODE）: パターン枠の上に大GOボタン＋位置表示（編集UIなし・進行表が空なら非表示）。
- キー入力: onKey に goKeyMap の go/back 照合（e.repeat 無視）。MIDI: handleMidiMessage の
  noteon 照合に goMidiMap を追加。learnGo 待ち中のキー/MIDI捕捉も既存 learnFire と同じ位置に追加。

## 検証

typecheck・vitest（applyCueStep/goNext/goBack/クランプ/空表の純ロジックをテスト）・
ブラウザ実機（GO で CUE+SFX が適用・BACK・LEARN・LOCK 中の編集不可/GO可・.ledshow 往復）→
敵対レビュー → build → デスクトップ差し替え → push → 変更メモ。
