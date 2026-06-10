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
  - **（6/10 14時台 追加診断）同じ網に送信側らしき `macbookpro` = `192.168.1.101` を発見・pingは通る**＝道は物理的に通っている（容疑「網違い」はほぼシロ）。**ArtPoll点呼（`tools/artnet-poll.mjs`）には全機無応答**＝送信ソフトの電波が出ていない。
- **容疑（有力順・6/10更新）：**
  1. 送信側Macの **macOS「ローカルネットワーク」許可がOFF**（pingは通るのにソフトの通信だけ出ない症状と完全一致＝本命。設定→プライバシーとセキュリティ→ローカルネットワーク→卓ソフトON→ソフト再起動）
  2. grandMA出力設定（**既定の `2.x.x.x` 網のまま** → 宛先IPを `192.168.1.171` にUnicast直指定が必要。grandMA3 onPC: Menu→Network→DMX Protocols→Art-Net／MA2: Setup→Network）
  3. onPCの動作環境問題：**仮想Windows（Parallels等）なら「ブリッジ接続」必須**（共有/NATだと外に出られない）。Windows実機ならWin側Firewall。
- **次の一手（ここから再開）：**
  1. のむさんに依頼済み（6/10）：①送信側のローカルネットワーク許可ON→再起動 ②宛先 `192.168.1.171` ③ダメなら送信側から `echo hello | nc -u -w1 192.168.1.171 6454` ④**onPCが動いている機体はどれか（Mac直？仮想Win？Windows機？）の回答待ち**
  2. このMacで見張り：`cd ~/Documents/decor-studio && node tools/artnet-sniff.mjs 1800`（1発でも届けば即HIT表示）
- **直し方（どちらか）：**
  - **A（推奨）**: 送信側で送信先IP（Unicast）に `192.168.1.171` を直指定＋送信側自身のIPも同網（例 `192.168.1.200/255.255.255.0`）。**grandMA3 onPC**: Menu→Network→DMX Protocols→Art-Net で出力ON・宛先・Universe・出力NICを設定／**MA2 onPC**: Setup→Network。送信側Macは**設定→プライバシーとセキュリティ→ローカルネットワーク**で卓ソフトをON＋ソフト再起動。
  - **B**: このMacに 2.x を追加（システム設定→ネットワーク→卓が繋がる口→詳細→TCP/IP→手入力 `2.0.0.100` / `255.0.0.0`）
- 備考：受信ランプはユニバース不問で点く（届きさえすれば点灯）。盗み聞きツールはアプリと同居可能（reuseAddr）。ただしUnicast受信中はパケットを奪い合う可能性があるので、最終確認はツールを止めてアプリのランプで。

## 1. このアプリは何（30秒）

コンサートLEDに出す「電飾」を本物のDMX卓（Art-Net）で光らせるMacアプリ（Electron）。電飾以外は黒で出し、**Syphon→Resolume ArenaにAdd合成**で本番映像に乗せる。詳細仕様は `docs/superpowers/specs/`、運用手順は `DECOR-STUDIO-使い方-2026-06-08.md`。

## 2. 到達点（全部実装・検証済み）

- **M0〜M7 完了**：Art-Net受信／Syphon出力（自前Syphonクライアントでピクセル検証済み）／SVG→Canvas編集／Inspector／Patch表／全画面プレビュー窓／Programmer（手動テスト）／保存・読込／`.app` 化（`dist/mac-arm64/DECOR STUDIO.app`・背面スロットリング対策済み）
- **精密化 A〜D 完了**：ズーム64x・1px/10pxグリッド・1px吸着・クリスプ／反復アレイ＋連番採番（`Shape.repeat`+`Fixture.addressStep`、512跨ぎは `dmx/address.ts addressAt`）／アルファPNGマスク＋自動敷き詰め `autoFill`（上限4000）／ピクセルペン／編集Canvas化（数千要素OK・1280セル検証済み）
- **チャート主導ワークフロー（6/10 のむさん相談→同日実装・ブラウザ検証済み）**：
  - **スタート画面**＝正面玄関（`ui/StartScreen.tsx`）。チャート画像（LED面の図面）をD&D/クリックで読み込むと**キャンバスが画像の等倍ピクセルに自動設定**＋下絵＋Mask既定ON。逃げ道として Blank 1920×1080 / 3840×2160。`.decor.json` のドロップでも開ける。SubBar の New は玄関に戻る。
  - **ピクセル規約（確定・のむさん最終判断 6/10）**：**チャート＝本編アートワークに電飾エリアが透明でくり抜いてある素材**。**透明のくり抜き＝電飾を描く場所／絵がある所＝対象外**＝ `mask.invert: false` 既定。アルファ無し画像（JPG等）は**黒判定救済**（`ui/mask.ts isEmptyPixel`、r+g+b<72=くり抜き扱い）。逆向き素材（LED面が不透明で描いてある）は **Invert** ボタンで反転。
  - **出力の透明化**：背景は**透明黒 (0,0,0,0)**＋Syphon送出は**premultiplied**（`OutputRenderer.readRGBA`）→ Resolume **Addは従来と完全一致**・**Alpha合成も新たに可能**に。
  - SubBar の Background ボタンは **Chart** に改名（読み込みでキャンバス追従）。
- **描き味・修正・道具バー改修（6/10 のむさん要望→同日実装・ブラウザ実技試験済み）**：
  - **Paint（ドット塗り）**：マウスを動かすと1pxドットがその場で埋まる塗り絵式。速いドラッグでも `geometry.ts cellsBetween`（階段状Bresenham・斜め飛びなし）で**通り道のドットを全部埋める**。クリック1回=1ドット。データは従来どおり freehand 1本=1シェイプ=1Fixture（セル中心 x.5 座標）。**玄関から入ると最初からPaintが選択済み**。
  - **修正（変形）実装**：選択時の四隅□が本物のハンドルに（rect/ellipse/triangle/star/polygon=四隅ドラッグで変形・対角アンカー固定）。line/polyline は**点を直接ドラッグ**。freehand は移動のみ（描き直しが速い）。⌘/Opt でスナップ解除は移動・変形共通。
  - **当たり判定の精密化**：バウンディングボックスから **isPointInStroke/isPointInPath**（線そのもの・塗りそのもの）に変更。1px線も拾える（ズームに応じた許容幅）・箱の中の空白では選ばれない。repeat配列は各反復で判定。
  - **道具バーをアイコン化**（`Toolbar.tsx ToolIcon`）：矢印/線/折れ線/ペン/階段ドット(Paint)/消しゴム/丸/三角/四角/星/六角形。星のアイコンを押せば次に描けるのは星。tooltipに英名＋日本語ヒント＋ショートカット。
- **描き味第2弾（6/10 のむさん再要望→同日実装・実技試験済み）**：
  - **Shift＝直線**：Paint中にShiftで水平/垂直/45°ロック（`axisSnap`）。ぐにゃぐにゃ動かしても完全な直線ドット列になる。
  - **消しゴム（Eraser, Eキー）**：なぞった1pxドットを塗り線から削除（`model/erase.ts`）。**真ん中を消すと2本に分裂**し、Fixtureは同番地のまま複製（=切った両側が同じ卓フェーダーで光り続ける）。line/rect等の図形には効かない（それらはDelete→描き直し）。
  - **塗り線の端に持ち手**：選択すると両端に□。引っ張ると**反対の端を固定したまま直線ドット列として再生成**（長さ・向き変更。Shiftで軸ロック。マスク端で停止）。曲がった塗り線を引っ張るとまっすぐになる仕様（のむさん「線は基本曲げない」前提）。持ち手はズームアウト時重なるので**最寄りの持ち手を掴む**。
  - **⌘/Optドラッグ＝どの描画ツール中でも掴んで移動**（道具持ち替え不要・ピクセル吸着维持）。ショートカット V=Select / P=Paint / E=Eraser / L=Line。
  - **線ごとの色分け表示**（編集室のみ・7色ローテーション）＋**ズーム遠でも見える表示専用太さ補正**（`boost`、出力は常に正確な1px）。本番の色は卓のDMXが決める。
- **操作性総点検＝第3弾（6/10「君が見直して」→同日実装・全実技試験済み）**：
  - **⌘Z取り消し／⌘⇧Zやり直し**：全編集操作対応（描く/消す/移動/変形/パッチ/下絵/敷き詰め…）。store内 `beginHistory`（同タグ600ms以内は合体=1ジェスチャー1手）＋各アクションにフック。履歴50段。
  - **ズーム/パン今どき化**：ピンチ(ctrl+wheel)/⌘+ホイール＝カーソル中心ズーム、二本指スクロール＝パン（Shift＝横）、**マウスのカリカリノッチ（整数・|ΔY|≥80・縦のみ）は自動判別でズーム**。Fキー＝Fit。
  - **吸着の種類追加**（`editor/snapping.ts`・きつくない半径6px/scale）：①1px（既存）②10pxソフトグリッド ③**整列吸着**＝他の線の端・縁に移動/変形/端引っ張りが吸い付き、**緑の点線ガイドが光る** ④端引っ張り/直線の頂点はShift無しでも**H/V/45°ソフト吸着**。Snapボタン=マスタースイッチ・⌘/Optで一時解除。
  - **変形強化**：四角系に**辺の真ん中ハンドル**（縦横だけ）＋**Shift＋四隅＝縦横比キープ**＋**Shift＋図形描画＝正方形/正円**＋Shift＋Line描画＝H/V/45°。
  - **小物**：右クリックドラッグ＝どのツールでも掴んで移動／Esc＝選択解除／ハンドル・線上でカーソル変化／左下に**セル座標読み取り**／New誤爆の確認ダイアログ／持ち手の感知半径は**線の長さの1/4まで**（ズーム遠で真ん中が掴めなくなる罠の対策）。
- **「LINEも描けない」事件の解決（6/10・重要な学び）**：原因は**透明の無いチャート画像**（全面不透明・明るい絵）→ 規約上描ける場所が**0マス**になり全ツールが**無言ブロック**されていた。対策3点：
  1. **描ける場所0のマスクは自動で制限解除**（`use-mask.ts`・`store.maskEmpty`）＋SubBarに琥珀色のお知らせ「この画像では描ける所が0 → 制限を解除中（Invertで反転を試して）」
  2. **描けない場所をクリックしたら必ずトースト表示**（無言ブロック禁止・EditorCanvas `showBlocked`）：「ここは描けないエリアです…Invertで反転/Mask OFFで解除」
  3. **下書き（draft）の読み取りを同期ref経由に統一**（`setDraft`ラッパー）— 最速クリック＆ドラッグでも確定が古い下書きを見ない。Reactの描画タイミング起因の「たまに描けない」を根絶。
- **くり抜きの可視化（6/10 のむさん要望）**：黒い絵×黒背景でくり抜きの縁が見えない問題 → **描けるエリア（透明くり抜き）の下に無彩色グレー(70,70,76)を敷く**（`MaskData.holes`・絵より先に描くので**絵そのものには一切色を載せない**）。絵側は従来の薄暗シェード。ピクセル実測：くり抜き(70,70,76)/絵(6,6,7)で境界明瞭。
- **寸法バッジ＋Z取り消し（6/10 のむさん要望）**：
  - **寸法バッジ**：描く/端引っ張り/移動/変形の最中、カーソル横に **`X 41 · Y 21 · 61 dots`** 形式でリアルタイム表示（ref直書き・React state不使用）。Paint/端引っ張り＝Xスパン・Yスパン・ドット数、Line＝X・Y・L（斜め長）、箱系＝W×H、移動＝ΔX・ΔY。離すと消える。**Inspector上部にも選択中の寸法を常設**（`sizeText`）。
  - **⌘Z事件の真相**：Macアプリは**Electron既定メニューが⌘Zを横取り**して編集室に届いていなかった（ブラウザでは効くのに.appで効かない罠）。`main/index.ts buildMenu` で自前メニューを構築し Undo/Redo を `edit:undo/redo` IPC→renderer（`App.tsx useMenuUndo`・テキスト入力中はネイティブundo）。Cut/Copy/Paste はネイティブrole維持。
  - **Z＝取り消し／Shift+Z＝やり直し**（修飾キー無しの1発・メニュー経由問題と無関係に効く）。失敗→Zポン。
- **テスト**：`npm test` 19本（純ロジック）。型 `npm run typecheck`。

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
2. **【本番Macで】Resolume最終目視**：`DECOR_QUERY='live&demo' npm run dev`＋偽の卓→ResolumeのSyphonソースに「DECOR STUDIO」→**Addで黒が消えて電飾だけ乗る**ことを確認（M0からの唯一の積み残し）。**追加確認**：出力が透明化されたので**Alpha合成でも抜けるか**・グロウのフチの見え方も目視。
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
*2026-06-10 作成（同日追記1：別Mac立ち上げ手順＋送信ソフト=grandMA系の情報／追記2：チャート主導ワークフロー実装＋出力透明化＋Art-Net追加診断。「別Macに移した」騒動はMACアドレス照合で同一機=nomura-miniと判明）。前版（2026-06-08・実装前のもの）は歴史資料として残置。*
