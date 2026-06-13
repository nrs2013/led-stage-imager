# DECOR STUDIO 画像照明モード 引き継ぎ書（2026-06-13）

> **次スレッドの Claude へ。** これは「画像照明モード」を本物のアプリ（Electron + React + TS）へ実装し、
> 当日まで多数の改修を重ねた現時点の完全な引き継ぎです。
> **読む順**：①本書 → ②`DECOR-STUDIO-画像照明モード-実装指示書-2026-06-13.md`（初期の正典・モックの式）→ ③背景は `DECOR-STUDIO-引き継ぎ-2026-06-13.md`。
> **のむさん**：コンサート演出家・コード未経験・GitHub `nrs2013`。**舞台用語で噛み砕く／ターミナルはコピペ完成形／PAT を貼られたら git push まで（director-workflow 準拠）。**
> **設計図の正典＝デスクトップ `画像照明モード-試打台.html`（v7・全式がここにある）。**

---

## 0. 今ここ（最重要サマリ）

- **画像照明モードは実装完了・あさって本番（6/15想定）用に稼働中。** のむさん自身が回す照明モード（卓/Art-Net不要）。
- アプリは2モード構成：**①画像照明モード**（新規・本書）／**②従来の電飾照明**（卓/grandMA用・温存）。
- 入口＝StartScreen の琥珀ボタン「IMAGE LIGHTING」。出口＝モード内右上「←フル機能照明へ」。
- 出力は**自前で30fps（実際は dirty-skip）で Syphon へ publish**（既存「DECOR STUDIO」ソースに相乗り）。
- **コードは型チェック・Lint・テスト153本green・electron-vite build 通過済み。** `.app` は `dist/mac-arm64/DECOR STUDIO.app` にビルド済（署名なし・ローカル起動OK）。
- **未確認＝本番MacでのSyphon→Resolume目視のみ**（環境的にショーMac案件）。
- **⚠ メモリOOMが何度も発生した。preview検証の作法は §8 を厳守。**

---

## 1. 画像照明モードとは

セット写真（チャート）を**反射する面（アルベド）**として、灯体（uplight/beam）で「写真を照らす」。色・PTZ・FX・シーンで演出する。光の式は出荷済みUPLIGHTと同系（screen混色・アルベド乗算・パン非対称・Smoke連動・終わり際の丸み）。

- **PLAY（本番）**：シーン9枠＋を叩くだけ。ツマミは出さない。MASTER フェーダー、ESC=1.5秒フェード、0=即暗転、F=全灯、←→=写真送り。
- **BUILD（明かり作り）**：MASTER/SMOKE・仕込み・FIXTURES・GAUGE・COLOR・PAN/TILT/ZOOM・FX12・SCENES。
- **三層運用**：決め所＝シーン（キー/MIDIパッド/クリック）／明るさ＝MASTER（物理MIDIフェーダー or ↑↓）／緊急＝ESC。

---

## 2. ファイル構成

**新規 `src/renderer/src/imagelight/`**
- `engine.ts` … 描画パイプライン・全状態・全ロジック（モック移植の中核。約1500行）。Reactに依存しない自前エンジン。
- `effects.ts` … FX9種の純関数（chase/strobe/breath/fire/wave/bolt/zoompulse/rainbow/colorChase/searchTilt）。`effects.test.ts` あり。
- `colors.ts` … `RGB3`型・`AMBER`/`WHITE`/`COLORS`(固定8色)・`hexToRgb`/`rgbToHex`/`hsl2rgb`/`sameRgb`。
- `fxdefs.ts` … FXグリッドの並び`FX_BUTTONS`・ラベル`FX_LABEL`・各FXツマミ定義`FX_PARAMS`(min/max/get/set/fmt)。
- `ImageLightingMode.tsx` … React UI（PLAY/BUILD二画面・ステージcanvas・30fpsループ・キーボード・ポインタ操作）。CSSは`.il-`接頭でscoped（`IL_CSS`）。

**新規 `src/renderer/src/render/`**
- `compose.ts` … 色比保持トーン`composeColorRatio`/`toneRatioPixel`。`compose.test.ts` あり。

**改変した既存ファイル**
- `render/uplight.ts` … `drawBeamCoreLocal`（層別長＝終わり際の丸み）・`beamZoomScale`(上げ側×3.0)・`TILT_MAX=Math.PI`(±180°)。
- `output/OutputRenderer.ts` … ノイズ床退治（ノイズ×光マップ）。※色比保持トーンは入れず元の乗算に戻してある（DMX電飾モード用）。
- `App.tsx` … `imageLight`時に`<ImageLightingMode>`を全画面表示／メニュー⌘Z/⌘C/⌘V を画像照明モードへ橋渡し（`useMenuUndo`）。
- `state/store.ts` … `imageLight`フラグ＋`setImageLight`／`imageLightUndo/Redo/Copy/Paste`＋`setImageLightHandlers`。
- `ui/StartScreen.tsx` … 入口の琥珀ボタン（`setImageLight(true)`）。

---

## 3. アーキテクチャ・データモデル

- **論理座標系 LW×LH = 1600×900（固定・export const）**。灯体配置・評価式・写真fitの基準。**ここは動かさない。**
- **内部/編集表示の解像度 Q=1.2 → IW×IH=1920×1080**（編集画面・frame・光マップ）。
- **出力（Syphon）は別物**＝`outCv`（写真の部分だけ・写真の解像度・余白なし）。§4⑳参照。
- 状態は**zustandでなく `ImageLightEngine`** が保持（高頻度canvas状態のため）。React は `useSyncExternalStore(engine.subscribe, engine.getVersion)` で再描画。store は橋渡しフラグのみ。
- **主要状態**：`beams[]`（灯体・x/y/w0/w1/len/pan°/tilt°/zoom倍率/gauge/color/mute/solo/sp）、`selected:number[]`（複数選択）、`st`(master/smoke/FXフラグ)、`fxp`(FXツマミ値)、`scenes[]`(写真/動画棚)、`patterns[]`(シーン棚・可変長)、`chasePalette`(チェイス色)、`userColors`、`paramMidi`/`masterMidi`。
- **描画**：`renderFrame(now)` → 光マップ(lightCv,screen合算+ブラー+ノイズ×光)→ 写真×光(workCv,mock乗算+暗部トー)→ frame合成(空中ビーム+bloom半解像度)→ **`composeOutput`でoutCv** 。
- **Undo/Redo**：`snapshot/restore/pushHistory(tag・600ms合体)`。`hist/fut`、60段。メディア(img/video/mat)は参照共有。

---

## 4. 実装済み機能（全リスト）

**基盤**
- モック(試打台v7)を engine.ts へ全移植：PLAY/BUILD・シーン棚×9・写真棚・ミュート/ソロ・MASTER・SMOKE・FX9種・カラーピッカー＋色プリセット(localStorage)・シーンのキー/MIDI LEARN・マスターMIDI CC LEARN・ESCパニックフェード。
- 共通描画改良：終わり際の丸み・ZOOM上限×4.0・TILT±180°・ノイズ床退治。
- **色比保持トーン**（`render/compose.ts`）：実装・テスト済だが**既定OFF**。`engine.ts`の `PHOTO_TONE='ratio'` で有効化可。OFF理由＝検証で白茶けは光マップscreen加算が主因と判明し、この段では消えず中間調が明るく寄り検証済モックから離れたため。本番後の詰め用。

**追加改修（時系列・①〜⑳）**
- ① 写真棚の削除：サムネ右上hoverの×＋右クリック（`removeScene`）。表示中を消したら隣へ、全消しで無灯。
- ② BUILDで **Delete/Backspace** で選択灯体を削除（PLAY中・ALL選択時は無効＝誤爆防止）。
- ③ **ループ動画素材**：写真と同じ「照らす」見え方。`addVideo`→objectURL→`<video loop muted>`→毎フレーム`updateVideoFrame`でアルベド化。内部は最大幅1280pxへ縮小。非表示動画はpause、表示中は安全網で必ずplay維持。写真棚に▶バッジ。D&D/ファイルともimage+video受付。
- ④ **デモ画像(HINATAダミー)撤去 → 空スタート**。素材0枚はステージ中央に「＋写真／動画をドロップ」案内。
- ⑤ 初期灯体を**均等10台**（横幅LW均等分割）。
- ⑥ **Undo/Redo**（⌘Z/⌘C/⌘V）：履歴スタック＋ほぼ全mutationに`pushHistory`。store経由でApp.tsxの`useMenuUndo`が画像照明モード時はそちらへ分岐。
- ⑦ **カラフルチェイスの色をD&Dで指定**：`chasePalette`（空=固定8色）。COLOR欄の色をドラッグ→「流す色」へ。色並びはシーン(Look)にも保存。
- ⑧→⑰ リグ保存方針（後述）。
- ⑨ 初期プリセット灯体を**写真のすぐ下へ自動配置**（`placeRigAtPhotoBottom`・`rigCustomized`が立つまで追従）。
- ⑩ **灯体コピペ**（⌘C→⌘V）：選択ぜんぶを仕込み(w0/w1/len)＋向き(PTZ)＋色ごと複製・x+50ずらし。`beamClip:Beam[]`。
- ⑪ 用語「届く高さ」→**「伸び」**（上から吊るトップライトに合わせ）。
- ⑫ **シーン枠を可変長**（9固定→＋で追加・上限64・末尾の空き枠は−で減らせる）。
- ⑬ **シーンのキーLEARNを物理キー(e.code)基準に**：IME(日本語入力)オンで英字keydownがProcess化して拾えなかった不具合を解消。A〜Z・記号・スペース等どのキーでもIME無関係に割当可。`shortcutCode`/`codeLabel`。0(Digit0)/f(KeyF)/Delete/矢印もe.code化。
- ⑭ **灯体の複数選択**：選択モデルを`selected:number[]`へ。素クリック=単独・Shift+クリック=トグル・空き四角ドラッグ=ラバーバンド・選択ドラッグ=まとめて移動・⌘C/⌘V/Delete=まとめて。FIXTURESストリップもShift対応。ラバーバンド矩形は緑破線描画。
- ⑮ 灯体上限 **24→64**（`MAX_BEAMS=64`）。※24上限が「動画でコピペできない」の原因だった。
- ⑯ 既定灯体色 **アンバー→白**（`WHITE`定数）。
- ⑰ **灯体配置の永続化を廃止**（のむさん「前のセッティングを引きずる」）：saveRig/loadRig から `beams`/`rigCustomized` を除外＝**毎起動まっさら（均等10台・画像下追従・白）**。保存対象＝シーン/色プリセット/チェイス色/FXツマミ値/MASTER・SMOKE/MIDI割当 のみ。旧キャッシュのbeamsは読まないので無視。
- ⑱ **FXツマミ＆Master の MIDI CC LEARN**：各FXパラメータ行の **◎ボタン**を押して物理CCを回すと割当。以後そのCCで 0..1→min..max に反映。`paramMidi`(保存)/`learnParam`/`paramApply`(UIが`key.idx`→反映関数を登録)。
- ⑲ **カクつき修正**：原因＝静止画でも毎フレームrenderFrame（写真＋スモークで30台45ms＝予算33ms超）。対策(a)**dirty-skip**＝`engine.isAnimating()`(anyFx/動画/フェード)＋version変化/rubber/force(初回・resize・mode切替)の時だけ描く＝静止画は無負荷。(b)bloomを半解像度。
- ⑳ **出力＝写真の部分だけ・写真の解像度・余白なし**：編集画面は従来1920(余白あり)のまま、`composeOutput`が`outCv`へ「写真(matフル解像度)×光(lightCvのbox領域を引き伸ばし)＋bloom」を合成し、`readOutputRGBA`/`outW`/`outH`でpublish（上限3840幅）。検証：2200×1400写真→出力ぴったり2200×1400・余白なし。

---

## 5. 重要な設計判断・確定事項（変えない）

- **論理座標 LW×LH=1600×900 は固定**。灯体配置・評価式・写真fitの基準。動かすと全部崩れる。
- **写真＝アルベド（反射率の地図）**。光が当たった所だけ見える・無灯部は完全な闇。**色は白へ振らない**（家訓）。調光は白でなく赤橙へ沈む。
- **screen混色**（リニア加法・照明屋判定）。**写真×光は mock の乗算＋暗部トーが既定**（のむさんがv7で検証済の見え方）。色比保持トーンは既定OFF（§4）。
- **配置は全シーン共通／向き・色・明るさ・FXはシーン(Look)に保存**。リグ（配置）は永続化しない＝起動まっさら（⑰）。
- **編集画面は余白あり・出力は写真ぴったり余白なし**（⑳。のむさん確定）。
- 灯体追加は **⌘+クリックのみ**（誤爆防止）＋ストリップの＋。既定色=白。初期=均等10台が写真下へ追従。
- 操作モデル：写真＝下の棚をクリック／明かり＝シーンを叩く（キー/MIDI/クリック）／緊急＝ESC。本番PLAYはツマミゼロ。

---

## 6. 重要な定数・スイッチ（engine.ts 冒頭）

- `PHOTO_TONE: 'mock' | 'ratio' = 'mock'` … 写真合成。`'ratio'`で色比保持トーン（実験）。
- `LW=1600 / LH=900`（論理・不変） / `Q=1.2 → IW=1920 / IH=1080`（内部・編集表示）。
- `MAX_BEAMS=64` … 灯体上限。重ければ下げる。
- `RIG_KEY='decor.imagelight.rig.v3'` … localStorageキー。**beamsは保存しない**。
- `DEFAULT_CHASE_PALETTE` … 固定8色（チェイス未指定時）。
- `composeOutput`内 `OUT_CAP=3840` … 出力上限幅。

---

## 7. 未確認・宿題（優先順）

1. **本番MacでのSyphon→Resolume目視**（最優先・環境的にショーMac案件）：出力が「写真の解像度ぴったり・余白なし」で出るか、Add合成で乗るか、NDISyphon→別PCも。
2. **パフォーマンス実機確認**：dirty-skip後、FX/動画/多灯体時のfps。重ければ Q を下げる/bloom更軽量化/灯体上限。出力が大写真(〜3840)の時のreadOutputRGBA負荷。
3. **MIDIコントローラー実機**：各FXツマミ◎→CC割当、マスターCC、シーンのMIDIパッド(ノート)。
4. **色比保持トーン**（`PHOTO_TONE='ratio'`）の本番後A/B。
5. テカリ（スペキュラ）・入射角の陰影は「強いと嘘くさい」ので見送り（フェーズ外）。

---

## 8. ⚠ メモリの教訓（重要・OOMが何度も起きた）

- **OOMの主因＝preview検証**（`npm run dev:web` の vite/esbuild ＋ headless Chrome）＋ビルド/複数Electronインスタンスが重なった時。
- **作法**：(a) preview検証は **1セッション・eval最小限・screenshot最小・終わったら即 `preview_stop`＋`pkill vite`**。(b) **ビルド前に vite/preview を必ず止める**。(c) DECORインスタンスは1つに（古いのは`osascript -e 'tell application "DECOR STUDIO" to quit'`）。
- **メモリの見方**：`vm_stat` の `Pages free` だけ見ない。**`Pages inactive`＋`Pages speculative` も実質空き**（再利用可）。free数百MBでも実質十数GB空きのことが多い。
- 単純な変更（定数・配列ロジック・レイアウト）は **typecheck＋テスト153本green で担保しpreviewを省略**してよい。描画/MIDI/出力など"見ないと分からない"変更だけ最小previewで確認。

---

## 9. ビルド・起動・検証手順（コピペ）

```
cd ~/dev/decor-studio
npm run typecheck        # 型（node+web）
npm test                 # テスト153本green
npm run build && npx electron-builder --dir
open "dist/mac-arm64/DECOR STUDIO.app"
```

- ブラウザでUIだけ確認（任意・メモリ注意）：`npm run dev:web`（port5174）→ 終わったら必ず `pkill -f "vite --config vite.web.config.ts"`。
- 既に起動中のアプリを前面へ：`osascript -e 'tell application "DECOR STUDIO" to activate'`。
- push はキーチェーン認証で `git push origin main` がそのまま通る（PATを貼られたら直接push）。
- **dev環境のみ** `window.__ilEngine` にエンジンが出る（`import.meta.env.DEV`）。検証時に `e=window.__ilEngine` で状態を叩ける。

---

## 10. 本番運用ガイド（のむさん向け・舞台用語）

1. アプリ起動 → スタート画面の**琥珀ボタン「IMAGE LIGHTING」**で画像照明モードへ。
2. **玄関**：セット写真（or ループ動画）をドロップ → 写真棚に並ぶ。複数OK。サムネ右上×で削除。
3. **明かり作り（BUILD）**：
   - 灯体は最初から均等10台が**写真のすぐ下**に。**⌘+クリックで追加**・ドラッグで移動・**Shift+クリック/四角ドラッグで複数選択**・**⌘C→⌘Vでコピペ**・Deleteで削除。
   - COLOR（既定白）・GAUGE・PAN/TILT/ZOOM・FX12を選んだ灯体に。**M=消す・S=これだけ**（写真ごとに記憶）。
   - カラフルチェイスは「流す色」へCOLORをD&D（空なら8色）。
   - **各FXツマミの◎を押して物理つまみを回すとMIDI割当**。MASTERもLEARNでフェーダー割当。
   - 「●いまの明かりをシーンへ保存」→番号をクリック。**シーンは＋で好きなだけ追加**。LEARNでキー/MIDIパッド割当（どのキーでもOK）・✎で改名。
4. **本番（PLAY）**：シーンを叩くだけ（数字/任意キー/MIDIパッド/クリック）。MASTERで全体フェード。**ESC=1.5秒で消える／0=即暗転／F=全灯／←→=写真送り**。
5. **出力**：画像照明モードにいる間ずっと自動でSyphonへ（ボタン不要・常時）。Resolumeには**写真の部分だけ写真解像度で**出る。別PCはNDISyphon経由。
6. **起動するたび灯体はまっさら**（均等10台・白・画像下）。作った**シーン・色・MIDI割当は保存**される。

---

## 11. 次の始め方（のむさんがコピペ）

> `~/dev/decor-studio` の `DECOR-STUDIO-画像照明モード-引き継ぎ-2026-06-13.md` を読んで。続きから。

**最初にやること**：本番MacでSyphon→Resolume目視（§7-1）と、エフェクト/動画動作時のカクつき実機確認（§7-2）。重ければ §6 の定数で調整。
