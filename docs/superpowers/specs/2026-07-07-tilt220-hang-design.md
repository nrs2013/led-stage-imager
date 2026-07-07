# TILT 220度制限＋上吊り/床置き 設計（2026-07-07 のむさん承認済み）

## 目的

実機のムービングライトに合わせて TILT の振り幅を **±110度（合計220度）** に制限し、
灯体が**上吊り（トラスから下向き）か床置き（床から上向き）か**を区別できるようにする。
照明モード・Easyモード共通。

## 決定事項（のむさんとの合意）

1. **220度制限**: TILT を ±110度 に制限。対象は「普通の灯体（ビーム）」のみ。
   - 炎・火花（SFX）の「向き」は噴出方向の指定であって首振りではない → **従来通り ±180度・制限なし**
   - PAN は今回対象外（現行の PAN は奥行き表現。±90のまま）
2. **上吊り/床置きの指定**: 置いた場所で自動判定＋切替ボタン（のむさん選択）
   - 灯体を⌘クリックで置いた瞬間、**写真の上半分なら「上吊り」・下半分なら「床置き」**
   - LIGHT タブの PAN/TILT/ZOOM カードに切替ボタン（選択灯体に効く・⌘Zで戻る）
   - 床置き＝真上が定位置（tilt=0）で±110度／上吊り＝真下が定位置で±110度
   - DMX 128=定位置は従来通り（0/255 が両端110度）。卓側から見た挙動は吊り向きに依らず同じマップ
3. **後方互換**: 印のない灯体＝床置き（今まで通り）。古い保存データはそのまま開ける。
   TILT が ±110 を超えて保存されていた場合のみ、開いた時に 110 で止まる
4. **hang は配置と同格＝全シーン共通**（Look（シーンごとの明かり）には含めない。ミュート/ソロとは違う扱い）
5. **見送り**: 卓側 TILT 反転（現場で「逆に動く」と言われたら applyDmx に1行で足せる）

## 実装方針（案1・承認済み）

灯体に `hang?: 'above' | 'below'`（undefined=below=床置き）を1つ持たせ、
**描画時の回転に180度足すだけ**。DMX・保存・Undo の既存の仕組みは無改修で流用する。
（現行でも tilt=180 で下向きビームは描けている＝下向き描画は既知の動作）

### 変更箇所

| 場所 | 変更 |
|---|---|
| `engine.ts` Beam interface | `hang?: 'above' \| 'below'` 追加（undefined=床置き） |
| `engine.ts` 新規 pure 関数 | `clampTilt(v)` = ±110 に丸め、`autoHang(y, box)` = 写真上半分判定（export・テスト対象） |
| `engine.ts` applyDmx | `pose.tilt * 180` → `* 110` |
| `engine.ts` setTilt | 灯体（motif なし）だけ clampTilt。SFX（motif あり）は素通し |
| `engine.ts` applyLook / restoreShowInner | 復元する tilt を灯体だけ clampTilt |
| `engine.ts` tiltNow | 戻り値を clampTilt（サーチの揺れも実機同様に端で止まる） |
| `engine.ts` renderFrame の `_tn` 計算＋drawAirBeam の fallback | `+ (hang==='above' ? 180 : 0)` |
| `engine.ts` addFixtureAt | 置いた y が写真の上半分なら `hang:'above'` |
| `engine.ts` 新規 toggleHang() | 選択灯体の上吊り⇄床置き切替（pushHistory=⌘Z可） |
| `ImageLightingMode.tsx` TILT スライダー | min/max を ±110（選択が SFX のときは ±180 のまま） |
| `ImageLightingMode.tsx` MIDI `pose.tilt` | SFX 選択中 ±180 / 灯体 ±110 |
| `ImageLightingMode.tsx` PTZ カード | Home の行に「上吊り/床置き」切替ボタン（motif/front 選択中は非表示・Brutalist Vivid 準拠） |

### 変えないもの

- SFX タブの TILT スライダー（±180）・dirOf・炎/火花の噴出計算
- serializeShow / Look の構造（hang はスプレッドコピーで自動保存）
- home()（tilt=0 のまま。上吊りなら真下＝正しい定位置）
- placeRigAtPhotoBottom・初期10灯（床置きのまま）
- コピー/ペースト/⌥複製（スプレッドコピーで hang も複製される＝正しい）

## テスト

- `clampTilt`: ±110 で止まる・範囲内は素通し
- `autoHang`: 写真上半分→above・下半分→undefined・写真なし→LH/2 基準
- 既存 295 件が全部通ること（typecheck 含む）
