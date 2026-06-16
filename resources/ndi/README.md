# resources/ndi — NDI 出力に必要な部品

ここに置く 3 つのバイナリは **git に含めていません**（市販バイナリ＋自前ビルド）。
ビルド前に下記の手順で配置してください。`NDI-License.txt` のみリポに含みます。

| ファイル | 用途 | 入手・再生成 |
|---|---|---|
| `syphon2ndi` | Mac: Syphon→NDI ブリッジ（arm64） | `tools/syphon-ndi-bridge/build.sh` でビルド → ここにコピー |
| `libndi.dylib` | Mac: NDI ランタイム（arm64） | Resolume Arena 同梱の `libndi.dylib`（arm64 に thin 済み 約3MB） |
| `Processing.NDI.Lib.x64.dll` | Windows: NDI ランタイム（x64・直送に使用） | 公式 NDI 6 SDK から抽出 |

## Windows DLL の取り出し方（Mac 上）

```sh
brew install innoextract
curl -L -o /tmp/ndi_sdk.exe "https://downloads.ndi.tv/SDK/NDI%206%20SDK.exe"
innoextract -I "Processing.NDI.Lib.x64.dll" -s /tmp/ndi_sdk.exe -d /tmp/ndi
cp "/tmp/ndi/app/Bin/x64/Processing.NDI.Lib.x64.dll" resources/ndi/
```

## 仕組み

- Mac: `resources/ndi/{syphon2ndi,libndi.dylib}` を同梱し、起動時に内蔵ブリッジを spawn（`src/main/output/ndi-bridge.ts`）。
- Windows: `resources/ndi/Processing.NDI.Lib.x64.dll` を koffi で読み、RGBA を直接 NDI 送信（`src/main/output/ndi-direct.ts`）。同梱が無ければ NDI Tools / Resolume の既存ランタイムを探す。

NDI® は Vizrt NDI AB の商標です。再頒布条件は `NDI-License.txt` を参照。
