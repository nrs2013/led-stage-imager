// アプリ内蔵の NDI 出力。Mac 専用。
// 同梱した arm64 ブリッジ(syphon2ndi)を子プロセスで起動し、自分自身の "LED STAGE IMAGER"
// Syphon ソースを読んで NDI としてネットワークへ再送信する。これにより .app 単体で NDI が
// 出る（別アプリ／Resolume 不要・パス直書きなし）。部品は app.asar.unpacked に同梱。
import { spawn, type ChildProcess } from 'child_process'
import { join } from 'path'
import { existsSync } from 'fs'

let child: ChildProcess | null = null
let stopped = false
let initTimer: NodeJS.Timeout | null = null
let restartTimer: NodeJS.Timeout | null = null
let currentName = 'LED STAGE IMAGER'
// ブリッジが stdout に出す "RX=<n>"（受け手=Resolume 等の接続数）の最新値。
let rxCount = 0

/** 内蔵 NDI 出力の状態。active=配信中(ブリッジ稼働)・rx=受け手の数。Mac 以外は active:false。 */
export function getNdiStatus(): { active: boolean; rx: number } {
  if (process.platform !== 'darwin') return { active: false, rx: -1 }
  return { active: !!child, rx: child ? rxCount : 0 }
}

/** 同梱物（ブリッジ／libndi／Syphon framework）の絶対パス。Mac 以外は null。
 *  ndi/ の配置はパッケージ方式（asarUnpack か extraResources か）で変わりうるので候補から探す。 */
function bundledPaths(): { bridge: string; libndi: string; syphon: string } | null {
  if (process.platform !== 'darwin') return null
  const res = process.resourcesPath
  const unpacked = join(res, 'app.asar.unpacked')
  const ndiCandidates = [
    join(unpacked, 'resources', 'ndi'),
    join(res, 'ndi'),
    join(res, 'resources', 'ndi')
  ]
  const ndiDir = ndiCandidates.find((d) => existsSync(join(d, 'syphon2ndi')))
  if (!ndiDir) return null
  return {
    bridge: join(ndiDir, 'syphon2ndi'),
    libndi: join(ndiDir, 'libndi.dylib'),
    syphon: join(
      unpacked,
      'node_modules',
      'node-syphon',
      'dist',
      'Frameworks',
      'Syphon.framework',
      'Syphon'
    )
  }
}

function launch(): void {
  if (stopped || child) return
  const p = bundledPaths()
  if (!p) return
  if (!existsSync(p.bridge) || !existsSync(p.libndi) || !existsSync(p.syphon)) {
    console.warn('[ndi] 同梱物が見つからないため NDI 出力は無効:', p)
    return
  }
  // 引数: [1]=Syphonサーバー名 [2]=NDI送信名 [3]=Syphon framework [4]=libndi
  // stdout はブリッジが出す "RX=<n>"（受け手の接続数）を読むため pipe。stderr は捨てる。
  child = spawn(p.bridge, [currentName, currentName, p.syphon, p.libndi], {
    stdio: ['ignore', 'pipe', 'ignore']
  })
  child.stdout?.on('data', (buf: Buffer) => {
    const matches = buf.toString().match(/RX=(-?\d+)/g)
    if (matches && matches.length) {
      const n = parseInt(matches[matches.length - 1].slice(3), 10)
      if (!Number.isNaN(n)) rxCount = n
    }
  })
  child.on('exit', () => {
    child = null
    rxCount = 0
    if (stopped) return
    // クラッシュ／切断（アプリ再起動など）→ 少し待って再接続（橋渡し側も再探索する）。
    restartTimer = setTimeout(launch, 2500)
  })
  child.on('error', (e) => console.error('[ndi] ブリッジ起動エラー:', e))
  console.log('[ndi] 内蔵 Syphon→NDI ブリッジを起動')
}

/** 内蔵 NDI 出力を開始。Syphon サーバーが立ち上がってから少し待って接続する。 */
export function startNdiBridge(name = 'LED STAGE IMAGER'): void {
  if (process.platform !== 'darwin') return
  stopped = false
  currentName = name
  if (child || initTimer) return
  initTimer = setTimeout(() => {
    initTimer = null
    launch()
  }, 1500)
}

/** 内蔵 NDI 出力を停止（アプリ終了時）。 */
export function stopNdiBridge(): void {
  stopped = true
  if (initTimer) {
    clearTimeout(initTimer)
    initTimer = null
  }
  if (restartTimer) {
    clearTimeout(restartTimer)
    restartTimer = null
  }
  if (child) {
    child.kill()
    child = null
  }
}

/** Syphon 名が変わったらブリッジも繋ぎ直す。 */
export function restartNdiBridge(name: string): void {
  currentName = name
  if (process.platform !== 'darwin') return
  if (child) {
    child.kill() // exit ハンドラが 2.5 秒後に新名で再起動
  } else {
    startNdiBridge(name)
  }
}
