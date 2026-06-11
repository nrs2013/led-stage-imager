# DECOR STUDIO 引き継ぎ書（2026-06-11）

> 次のチャットの Claude へ。**まず本書 → `DECOR-STUDIO-引き継ぎ-2026-06-10.md`（Art-Net診断の続き）→ 必要に応じて使い方ガイド** の順で読むこと。
> のむさん（コンサート演出家・コード未経験・GitHub `nrs2013`）向けには **結論先・舞台用語・コピペ完成形コマンド** で。

---

## 🏠 同日夕方 追記：iCloud圏外 `~/dev/decor-studio` へ引っ越し完了（最重要）

- **作業場の正住所は今後 `~/dev/decor-studio`**。本書・過去の引き継ぎ書内の `~/Documents/decor-studio` は全てこれに読み替えること。
- **経緯**：6/11朝のiCloud事故・第3波で、push済みだったのに**ローカルのgit台帳（mainの栞）が2コミット巻き戻され**、同日朝に施工したばかりの .nosync symlink 対策まで剥がされた。GitHub側（origin/main `cb38efa`）は無傷＝失われた物ゼロ。これを機に稽古場ごとiCloud圏外へ引っ越した。
- **§1 のiCloud対策（.nosync symlink）は旧居用の歴史資料**。新居はiCloud圏外なので **不要・未施工が正しい**（node_modules / dist は普通のフォルダでOK）。
- 旧フォルダは `~/Documents/decor-studio-旧2026-06-11` に封印（ソースとgit履歴のみ・部品とビルドは撤去済み・**いつ削除してもOK**）。`~/Documents/DECOR-STUDIO-引っ越しのお知らせ.md` に案内板あり。
- デスクトップの再公開ボタン `DECOR-公開.command` は新住所に書き換え済み。
- §3 の「push はのむさん確認待ち」は**解消済み**（ボール球 `e1162e4` ＋ Web版ビルド `cb38efa` をpush済み・GitHub Pages反映済み）。
- 新居での検収：`npm test` 67本green・`.app` ビルド成功（264MB）。

---

## 🪧 同日午後 追加実装：ネオン管（NEON）— 実装・出荷済み

**経緯**：のむさん要望「ネオン看板をテキスト打ちで作りたい。書体いろいろ（参考画像のネオンサイン集）。グロウは標準でON、ただし光りすぎ防止の調整ツマミ。1文字ずつ番地を変えてチェイスしたい」。モック（書体試打台）で方向確定 → 横一行のみでスタート（縦書き・改行・アーチは第2弾）。

| 項目 | 内容 |
|---|---|
| 図形タイプ | `neon`（`points[0]`=看板の**中心**、`text`・`fontId`・`fontSize`px・`neonGlow`0–100 既定55） |
| 置き方 | PARTS棚「ネオン管」をD&D → Inspectorで テキスト / 書体（8種・各書体で見本表示のボタン）/ 文字サイズ / グロウ% |
| 番地 | **空白を除く1文字=1灯体**。`fixture.addressStep`=文字間隔（既定=ch幅）。**間隔0=全文字同番地=一斉点灯**（`addressAt` が明示0を「進めない」と解釈するよう変更。undefined/負は従来どおり既定幅） |
| 書体8種 | Neonderthaw / Pacifico / Mr Dafoe / Sacramento / Monoton / Tilt Neon / **Bebas=縁だけ管(stroke)** / Noto Sans JP(日本語)。全部 @fontsource 同梱＝オフラインOK。**追加は `render/neon.ts NEON_FONTS` に1行 + `main.tsx` にimport** |
| 描画 | `render/neon.ts`。白い芯＋色の後光（参考画像と同じ構造）・ゲージで後光が育つ・**92%超で白サージ**（ボール球と同じ味付け）。色とゲージは卓RGB任せ（`bulbHueIntensity` 共用）。**消灯文字は完全透明**（Add/Alpha合成で正しく消える）。編集室はスケマティック（冷えた管） |
| レイアウト | prefix幅測定でカーニング維持・空白は幅だけ消費。webfontは非同期なので `main.tsx` でpreload + `fonts.loadingdone` で再測定&再描画（`clearNeonLayoutCache`） |
| 連番の仕組み | `repeatCount(shape)` がneonで文字数を返す → OutputRenderer（インスタンスi=文字i だけ描く）/ PatchTable ×N / **MVRは文字ごとの実座標**で自動対応。Array欄はneonでは非表示（看板自体が配列） |
| コピペ | ボール球と同じ**中心基準**（pasteDelta拡張） |

- **テスト82本green**（neon.test.ts 15本追加：文字数/レイアウト/中心/番地間隔0/レジストリ）。型クリーン。
- **ブラウザ実技試験済み**（dev:web + `__decorStore` + `setUniverseData` でDMX偽装）：虹7色で1文字ずつ別色 ✓ チェイス1コマ（1文字だけ点灯・他は跡形なし）✓ グロウ5%↔90% ✓ 縁だけ管（MOTEL風）✓ コンソールエラー0。
- 正直な注意：筆記体は文字が繋がって見えるため1文字チェイスは切れ目が見える（本物のネオンも同じ）。チェイス映えは大文字系書体。
- 残り＝のむさん検品待ち：光り方の好み調整（グロウ既定値・芯の白さ）・書体の追加希望・第2弾（縦書き/改行/アーチ）。

---

## 0. 今日やったこと（新機能：ボール球）

**ボール球（電球）機能を実装・出荷済み。** のむさん要望の経緯：電飾アプリとして「リアルな電球を置いて、ゲージ（卓フェーダー）で光る強さが変わる」機能。デモを3回見せて方向確定（アニメっぽい十字光芒はNG→写真調へ、色は卓任せ、クリア質感）。

### 仕様（確定済み・実装済み）

| 項目 | 内容 |
|---|---|
| 図形タイプ | `bulb`（`points[0]`=中心1点、`diameter` 既定**5.5**ドット、`bulbStyle` clear/frost） |
| 置き方 | 右サイドバー新設「**PARTS棚**」（`PartsPalette.tsx`）からキャンバスへD&D。中心がドロップしたマスに乗る |
| 2個目以降 | ⌘C → 空きマスをクリック（ペーストマーク）→ ⌘V。**ボール球のみのコピペは中心基準**（`pasteDelta` in geometry.ts）。他図形は従来どおり左上基準 |
| 色とゲージ | **両方とも卓（grandMA3）のRGBが握る**。`bulbHueIntensity()`: max成分=ゲージ、比率=色相。(128,0,0)=赤の半分 |
| 描画 | `src/renderer/src/render/bulb.ts`。クリア=ガラス映り込み+コイル白飛び+ジュワッと育つにじみ+水平レンズ筋（十字キラーンは廃止）。ゲージ92%超で白サージ（のむさん「最後はもっと光った感じ」対応） |
| 本番出力 | `OutputRenderer` は**加算描画のみ**＝消灯バルブは完全透明（LED的に正しい）。Syphon/Resolume Add合成で従来どおり |
| Inspector | BULB選択時：径（0.5刻み）+ 質感（クリア/フロスト）。Display/Width は非表示 |
| Array | 既存 repeat がボール球にも効く＝**等間隔の球列（ストリングライト）が一発** |

テスト67本green（bulb.test.ts / geometry.test.ts に追加分）。ブラウザ検証済み（dev:web + `__decorStore` フック）。

## 1. 🔴 重大：このフォルダは iCloud に齧られる（対策済み・知らないと死ぬ）

`~/Documents` は **iCloud Drive同期**（複数Mac共有）。今日だけで **2回 node_modules が破壊された**（esbuildのバイナリ消失→index.js消失）。git も一度 **SIGBUS(exit 138)** で殺され、コミットメッセージが前回ので刻まれた（amendで修正済み）。iCloudの衝突コピー「dist 2」も湧いた（削除済み）。

### 対策済みの構造（2026-06-11〜）

```
node_modules -> node_modules.nosync   （symlink。.nosync は iCloud が同期しない）
dist         -> dist.nosync           （同上）
```

- `.gitignore` に `node_modules.nosync` / `dist.nosync` 追加済み
- electron-builder.yml の files に除外追加済み（dist symlink化で自前出力の自動除外が効かなくなるため明示除外。+ @fontsource原材料除外で **.app 630MB→264MB**）
- **今後 npm がコケて「ファイルが無い」系エラーが出たら、まず iCloud を疑う**。直し方：`cd ~/Documents/decor-studio && rm -rf node_modules.nosync && npm ci`
- 根本対策（未実施・のむさんに提案中）：リポジトリごと iCloud 外（例 `~/dev/`）へ引っ越し

## 2. ビルド&起動（新住所）

```
cd ~/dev/decor-studio
npm run build && npx electron-builder --dir
open "dist/mac-arm64/DECOR STUDIO.app"
```

## 3. 未解決・次の一手

- **Art-Net受信トラブル**：引き継ぎ-2026-06-10 §0 参照（送信側=grandMA3 onPC、本命容疑=送信側Macのローカルネットワーク許可）。本日は未進展。
- **push**：本日のボール球コミットはローカルのみ。push はのむさん確認待ち（GitHub Pages の Web版も更新される）。
- ボール球の将来案：PARTS棚に第2弾アイコン（ロープライト等）追加はパレットに項目を足すだけの構造にしてある。
