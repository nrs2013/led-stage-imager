// node-syphon 1.5.0 のネイティブバイナリ (syphon.node) を、メモリリークを直した
// 自前ビルドに差し替える。npm install のたびに公式版へ戻ってしまうので postinstall で当て直す。
//
// 直した中身: src/addon/metal/MetalServer.mm の PublishImageData が、毎フレーム
// newTextureWithDescriptor で確保した MTLTexture を一度も release しておらず、
// 約 14.7MB/フレーム (30fps で約 440MB/秒) 漏れていた。GPU 完了後に release する
// 1 行を足しただけ (隣の publishSurfaceHandle と同じ方式)。実測 3000 フレームで
// +3069MB → +14MB に。詳細は vendor/node-syphon/README.md。
import { existsSync, copyFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const fixed = join(root, 'vendor', 'node-syphon', 'syphon.node')
const target = join(root, 'node_modules', 'node-syphon', 'dist', 'bin', 'syphon.node')

// Syphon は macOS 専用。Windows/Linux や node-syphon 未導入時は何もしない。
if (process.platform !== 'darwin') {
  console.log('[patch-node-syphon] not macOS — skip')
  process.exit(0)
}
if (process.arch !== 'arm64') {
  console.log('[patch-node-syphon] 同梱バイナリは arm64 専用。このアーキでは skip:', process.arch)
  process.exit(0)
}
if (!existsSync(target)) {
  console.log('[patch-node-syphon] node-syphon 未導入 — skip')
  process.exit(0)
}
if (!existsSync(fixed)) {
  console.error('[patch-node-syphon] 同梱バイナリが見つからない:', fixed)
  process.exit(0) // インストール自体は止めない
}

// 既に当て済み（同サイズ）ならスキップして冪等に。
try {
  if (statSync(target).size === statSync(fixed).size) {
    console.log('[patch-node-syphon] 既にメモリリーク修正版 — skip')
    process.exit(0)
  }
} catch {
  /* fall through to copy */
}

copyFileSync(fixed, target)
console.log('[patch-node-syphon] メモリリーク修正版 syphon.node を適用しました')
