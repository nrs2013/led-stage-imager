# node-syphon メモリリーク修正バイナリ

`node-syphon` 1.5.0 のネイティブ部分 (`syphon.node`) には、Syphon 出力で
**毎フレーム MTLTexture を確保して一度も解放しないメモリリーク**がある。
30fps だと約 440MB/秒で積み上がり、数十分〜数時間でメモリが 160GB に達して
アプリが落ちる（LED STAGE IMAGER で実際に発生）。

## 原因（1 行）

`src/addon/metal/MetalServer.mm` の `PublishImageData` が
`newTextureWithDescriptor` で確保したテクスチャを release していない。
作者自身が修正コードをコメントアウトで残していた（"Should we add this?"）。
正しく動いている隣の `publishSurfaceHandle` には同じ release が入っている。

## 修正内容

メンバ変数 `m_texture` をローカル変数 `texture` に変え、GPU 完了ハンドラで
`[texture release]` を呼ぶ（`publishSurfaceHandle` と同じ方式。メンバのまま
だと次フレームが上書きして解放対象がずれる競合があるためローカル化）。

修正後ソース全体: `MetalServer.mm.fixed`

## 効果（実測）

512×512×4 = 1MB のフレームを 3000 回 publish（接続クライアントなし）:

| | RSS 増加 |
|---|---|
| 公式 1.5.0 | +3069 MB |
| 修正版 | +14 MB |

接続の有無に関係なく漏れていたので、本番（Resolume 接続中）でも安全。

## 適用方法

`npm install` のたびに公式版へ戻るので、`postinstall` で
`scripts/patch-node-syphon.mjs` が `vendor/node-syphon/syphon.node` を
`node_modules/node-syphon/dist/bin/syphon.node` へ上書きする（arm64・macOS のみ）。

## バイナリの再ビルド手順（参考）

```
git clone https://github.com/benoitlahoz/node-syphon.git
cd node-syphon
# src/addon/metal/MetalServer.mm を MetalServer.mm.fixed と同じに直す
cp <decor-studio>/node_modules/node-syphon/dist/Frameworks/Syphon.framework lib/Syphon.framework
npm install --no-save node-addon-api@^8.3.0 node-gyp@^11.1.0
./node_modules/.bin/node-gyp configure --arch=arm64
./node_modules/.bin/node-gyp build --arch=arm64
# 成果物: build/Release/syphon.node → vendor/node-syphon/syphon.node へ
```

N-API なので ABI 安定。システム node でビルドしたものが Electron でも動く。
フルの Xcode は不要（Command Line Tools で OK。node-gyp の make ジェネレータを使う）。
