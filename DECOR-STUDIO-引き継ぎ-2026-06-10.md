# DECOR STUDIO 引き継ぎ書（2026-06-10）

> 次のチャットの Claude へ。**まず本書 → 必要に応じて `DECOR-STUDIO-使い方-2026-06-08.md`** を読むこと。
> のむさん（コンサート演出家・コード未経験・GitHub `nrs2013`）向けには **結論先・舞台用語・コピペ完成形コマンド** で。

---

## 0. いま何が起きているか（最優先・未解決）

**Art-Net受信トラブルの診断中。** のむさんは「実装（本番運用）に向けて走りたい」状況。

- 構成：**別のMac（送信側＝grandMA系 onPC・のむさん回答2026-06-10）→ このMac（nomura-mini, アプリ受信側）** にArt-Netを送りたいが、**アプリの受信ランプが点かない**。
- **🔴 まず大前提**：受信側は必ず **`.app`（DECOR STUDIO.app）** で動かす。**Webアドレス `nrs2013.github.io/decor-studio` はブラウザ＝UDP不可で Art-Net を絶対に受けない**（今回のむさんはここで一度ハマった）。起動：`open "~/Documents/decor-studio/dist/mac-arm64/DECOR STUDIO.app"`
- **診断済みの事実（このMac側は全て正常）：**
  - アプリ（Electron）は起動して **UDP `*:6454` を待ち受け中**（lsofで確認済み）
  - macOSファイアウォール無効
  - このMacのIP：**en0 Ethernet = `192.168.1.171/24`**、**en1 USB-LAN = `10.229.81.229/24`**（**2.x.x.x は持っていない**）
  - **OSレベルの盗み聞き（12秒×2回・120秒・480秒）→ 受信パケット0個**＝信号がMacの玄関にすら来ていない。**アプリのバグではない。**
- **容疑（有力順）：**
  1. 送信側が**Art-Net初期値の `2.x.x.x` 網**で `2.255.255.255` に同報 → このMacは2.xを持たないのでOSが破棄（**grandMA は既定でこの 2.x 網になりがち**＝今回の本命。grandMA側でArt-Net出力の宛先IP・出力NIC・Universeを要確認）
  2. 送信側Macの **macOS「ローカルネットワーク」許可がOFF**（設定→プライバシーとセキュリティ→ローカルネットワーク→送信ソフトをON→ソフト再起動）
  3. 物理的に別の網（送信側がどの口・どの網に繋がっているか未確認）
- **次の一手（ここから再開）：**
  1. このMacで見張り：`cd ~/Documents/decor-studio && node tools/artnet-sniff.mjs 120`
  2. その間に**送信側Mac**のターミナルで通り道テスト：`echo hello | nc -u -w1 192.168.1.171 6454` → 見張りに `HIT: from <送信側IP> non-artnet len=6` が出れば**道は通っている**（残りはソフト設定）。出なければ網違い。
  3. のむさんから未回収の情報：**①送信ソフト名 ②送信側MacのIP ③送信設定画面のスクショ**
- **直し方（どちらか）：**
  - **A（推奨）**: 送信側で送信先IP（Unicast）に `192.168.1.171` を直指定＋送信側自身のIPも同網（例 `192.168.1.200/255.255.255.0`）。**grandMA3 onPC**: Menu→Network→DMX Protocols→Art-Net で出力ON・宛先・Universe・出力NICを設定／**MA2 onPC**: Setup→Network。送信側Macは**設定→プライバシーとセキュリティ→ローカルネットワーク**で卓ソフトをON＋ソフト再起動。
  - **B**: このMacに 2.x を追加（システム設定→ネットワーク→卓が繋がる口→詳細→TCP/IP→手入力 `2.0.0.100` / `255.0.0.0`）
- 備考：受信ランプはユニバース不問で点く（届きさえすれば点灯）。盗み聞きツールはアプリと同居可能（reuseAddr）。ただしUnicast受信中はパケットを奪い合う可能性があるので、最終確認はツールを止めてアプリのランプで。

## 1. このアプリは何（30秒）

コンサートLEDに出す「電飾」を本物のDMX卓（Art-Net）で光らせるMacアプリ（Electron）。電飾以外は黒で出し、**Syphon→Resolume ArenaにAdd合成**で本番映像に乗せる。詳細仕様は `docs/superpowers/specs/`、運用手順は `DECOR-STUDIO-使い方-2026-06-08.md`。

## 2. 到達点（全部実装・検証済み）

- **M0〜M7 完了**：Art-Net受信／Syphon出力（自前Syphonクライアントでピクセル検証済み）／SVG→Canvas編集／Inspector／Patch表／全画面プレビュー窓／Programmer（手動テスト）／保存・読込／`.app` 化（`dist/mac-arm64/DECOR STUDIO.app`・背面スロットリング対策済み）
- **精密化 A〜D 完了**：ズーム64x・1px/10pxグリッド・1px吸着・クリスプ／反復アレイ＋連番採番（`Shape.repeat`+`Fixture.addressStep`、512跨ぎは `dmx/address.ts addressAt`）／アルファPNGマスク（透明=描画領域・反転可）＋自動敷き詰め `autoFill`（上限4000）／ピクセルペン／編集Canvas化（数千要素OK・1280セル検証済み）
- **テスト**：`npm test` 17本（純ロジック）。型 `npm run typecheck`。

## 3. 確定済みの方針（変えない）

- **UI＝ソリッド照明卓ルック＋GrandMA2英語表記**（Brutalist Vivid から意図的離脱。戻さない）。番地は **`ユニバース.番地` ドット表記・Art-Net実番号0始まり**（`formatDmx`）。用語：New/Load/Save/Copy/Setup・Fixture/Patch・Universe/DMX Addr/Type/Offset・Programmer/Full/Chase/Check/Clear・Art-Net In/Syphon Out/Interface。
- **挙動モデル**：電飾は**1pxのLED**が軸（既定 strokeWidth=1・`[`/`]`で±1）。**図形単品のグロウは無し**（Shapeにglow属性なし）。グロウは**全体出力のブルーム**（Setup→Glow、既定OFF）＝スモーク表現。LED自体は常にクリスプ。
- **操作**：Selectでドラッグ移動（px吸着・**⌘/Optで自由移動**）／数値欄は**スクラブ**（左右ドラッグ=エンコーダ、クリック=全選択）`ui/NumberField.tsx`／矢印nudge(Shift=10px)・Delete・⌘D複製。
- 明るさは卓のバーチャルディマー前提（既定RGB 3ch）。初版ピクセルマッピング無し。

## 4. 場所・URL・公開まわり

| 項目 | 値 |
|---|---|
| ローカル | `~/Documents/decor-studio/`（main・クリーン運用） |
| GitHub | `https://github.com/nrs2013/decor-studio`（**Public**・gh CLIキーチェーン認証・PAT発行なし） |
| Web版（いつものアドレス） | `https://nrs2013.github.io/decor-studio/`（**開通済み**・branch Pages: main `/docs`・build_type=legacy） |
| Web版の更新手順 | `npx vite build --config vite.web.config.ts` → `rm -rf docs/assets docs/index.html && cp -R dist-web/. docs/` → commit&push（`docs/superpowers/` の設計書は消さない） |
| 再公開ボタン | `~/Desktop/DECOR-公開.command`（のむさんがダブルクリックで再公開できる予備スイッチ） |
| 起動オプション | `DECOR_QUERY='live'`（本番モード）`'live&demo'`（サンプル点灯）。URLクエリ `?live ?demo ?output` |

- **Web版の限界**：ブラウザはUDP不可→**Art-Net受信とSyphon出力は絶対に動かない**（Macアプリ専用）。作図・Patch・マスク・敷き詰め・Programmer・Live表示はWeb版でも動く（`window.api` をfeature-detectしてfallback済み）。
- **Actions workflowは使えない**（ghトークンに`workflow`スコープ無し→docs/直置き方式にした経緯）。
- **安全装置の学び（重要）**：リポジトリのPublic化など「公開系」の操作は、会話で許可されていても**Claudeからは実行不可**＝のむさん本人のターミナル実行が必須。今回は実行ボタン（.command）をデスクトップに置く方式が有効だった。

## 5. 開発の道具・小ネタ

- 偽の卓：`node tools/artnet-test-sender.mjs 0`（U0のch1=R/ch3=Bを脈打たせる・127.0.0.1宛）
- 到達確認：`node tools/artnet-sniff.mjs [秒]`（本書 §0 参照）
- 点呼（ArtPollで機器を炙り出す）：`node tools/artnet-poll.mjs`（返事は sniff 側に HIT で出る）
- Syphon検証は自前クライアントで可能（過去の検証スクリプトの作り方は git log の M0/M3 コミット参照）
- ブラウザでUI確認：`npm run dev:web`（port 5174）。Claude のプレビューMCPは `~/Documents` を読めないため、`npm run build` → `out/renderer` を `~/.claude/decor-preview/` にコピー → launch.json の `decor-web`（python3静的配信 :8771）を使う
- モデル切替直後に Claude のコマンド実行が「classifier unavailable」で止まることがある→少し待って再試行

## 6. 残タスク

1. **【進行中】Art-Net受信トラブル**（§0の手順から再開）
2. **【本番Macで】Resolume最終目視**：`DECOR_QUERY='live&demo' npm run dev`＋偽の卓→ResolumeのSyphonソースに「DECOR STUDIO」→**Addで黒が消えて電飾だけ乗る**ことを確認（M0からの唯一の積み残し）
3. （任意）UI磨き：複数選択・整列、スクラブ感度調整など

## 7. 次チャットの始め方（のむさんがコピペ）

> `~/Documents/decor-studio` の引き継ぎ書（DECOR-STUDIO-引き継ぎ-2026-06-10.md）を読んで。Art-Net受信トラブルの続きから（§0）。

## 8. 別のMacで作業を始める（ゼロから・クローン）

別のMacへ移して続ける場合。**リポジトリはPublic**なので認証なしでクローンできる。

```
git clone https://github.com/nrs2013/decor-studio.git ~/Documents/decor-studio
cd ~/Documents/decor-studio
npm install
```

- node-syphon のビルドに **Xcode Command Line Tools** が要る。未導入なら：`xcode-select --install`
- 編集画面を動かす：`npm run dev`
- **`.app` を作る**（Art-Net受信・Syphon出力の本番動作はこれ必須。gitに入らないので各Macで毎回ビルド）：
```
npm run build && npx electron-builder --dir
open "dist/mac-arm64/DECOR STUDIO.app"
```
（未署名なので初回は右クリック→開く）
- **本書 §0 のIP（`192.168.1.171` 等）は今のMac（nomura-mini）専用**。別Macでは `ipconfig getifaddr en0`（必要なら en1）で**その機体のIPを取り直して**読み替え、Art-Netの送信先・サブネットも合わせる。
- 引き継ぎ・使い方・設計書（`docs/superpowers/`）は全部リポジトリ内。クローンすれば付いてくる。

---
*2026-06-10 作成（同日追記：別Mac立ち上げ手順＋送信ソフト=grandMA系の情報）。前版（2026-06-08・実装前のもの）は歴史資料として残置。*
