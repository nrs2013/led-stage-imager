// Windows ビルド前の部品チェック。NDI DLL は容量が大きく gitignore 済み（手動配置）なので、
// 無い環境からビルドすると「NDI出力が黙って死んだ setup.exe」が無警告で完成してしまう。
// ここで存在と大きさを確かめ、無ければビルドを止める（Windows の出力経路は NDI しかない）。
import { statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const dll = join(root, 'resources', 'ndi', 'Processing.NDI.Lib.x64.dll')
try {
  const st = statSync(dll)
  if (st.size < 1_000_000) throw new Error(`サイズが小さすぎる (${st.size} bytes)`)
  console.log(`[check-win-ndi] OK: ${dll} (${(st.size / 1e6).toFixed(1)} MB)`)
} catch (e) {
  console.error('')
  console.error('🔴 Windows 用 NDI DLL が見つかりません:')
  console.error(`   ${dll}`)
  console.error('   これが無い setup.exe は Windows で映像出力できません。')
  console.error('   resources/ndi/README.md の手順で DLL を配置してから再実行してください。')
  console.error(String(e))
  process.exit(1)
}
