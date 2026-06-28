// レンダラから来る RGBA フレームを、FFI(koffi) 経由で NDI ライブラリへ直接渡して送信する。
// Mac の Syphon→ブリッジ経路とは独立した、もう一本の出力経路。
//  - Windows: ここが NDI 出力の本体（Syphon が無いため）。Processing.NDI.Lib.x64.dll を使う。
//  - Mac でも動くが、本番は実績ある Syphon+ブリッジ経路を使うので通常は起動しない。
// koffi は全プラットフォームのプリビルド .node を同梱（asarUnpack で展開）。
// ライブラリ(DLL)が無い/読めない時は active=false の no-op に倒し、アプリ本体は壊さない。
import koffi from 'koffi'
import { existsSync } from 'fs'
import { join } from 'path'

type KFn = (...args: unknown[]) => unknown

/** プラットフォームに合った NDI ライブラリの絶対パスを探す。見つからなければ null。
 *  優先: ①アプリ同梱(bundledDir) → ②NDIランタイム環境変数 → ③よくある既定インストール先。
 *  Windows は NDI Tools / Resolume を入れると ②③ にDLLが置かれる（公式の探し方）。 */
export function resolveNdiLibPath(bundledDir: string): string | null {
  if (process.platform === 'win32') {
    const dll = 'Processing.NDI.Lib.x64.dll'
    const candidates = [
      join(bundledDir, dll), // ①アプリ同梱（あれば最優先）
      process.env.NDI_RUNTIME_DIR_V6 ? join(process.env.NDI_RUNTIME_DIR_V6, dll) : '', // ②NDI Tools/Redist
      process.env.NDI_RUNTIME_DIR_V5 ? join(process.env.NDI_RUNTIME_DIR_V5, dll) : '',
      `C:\\Program Files\\NDI\\NDI 6 Runtime\\v6\\${dll}`,
      `C:\\Program Files\\NDI\\NDI 5 Runtime\\v5\\${dll}`,
      `C:\\Program Files\\NDI\\NDI 6 Tools\\Runtime\\${dll}`,
      `C:\\Program Files\\Resolume Arena\\${dll}`, // ③Resolume を入れていれば同梱DLLを拝借
      `C:\\Program Files\\Resolume Avenue\\${dll}`
    ].filter(Boolean)
    return candidates.find((p) => existsSync(p)) ?? null
  }
  // Mac（通常は Syphon+ブリッジ経路を使うので未使用。テスト/将来用）。
  const dylib = join(bundledDir, 'libndi.dylib')
  if (existsSync(dylib)) return dylib
  const resolume = '/Applications/Resolume Arena/libndi.dylib'
  return existsSync(resolume) ? resolume : null
}

let sender: unknown = null
let sendVideo: KFn | null = null
let getConns: KFn | null = null
let sendDestroy: KFn | null = null
let rxCount = 0
let connTimer: NodeJS.Timeout | null = null
let structsReady = false

// RGBA のFourCC（バイト並び R,G,B,A）。レンダラの getImageData は RGBA 並び。
const FOURCC_RGBA =
  'R'.charCodeAt(0) |
  ('G'.charCodeAt(0) << 8) |
  ('B'.charCodeAt(0) << 16) |
  ('A'.charCodeAt(0) << 24)

// 毎フレーム作り直さず再利用する送信フレーム（中身だけ書き換える）。
const frame: Record<string, unknown> = {
  xres: 0,
  yres: 0,
  FourCC: FOURCC_RGBA,
  frame_rate_N: 60,
  frame_rate_D: 1,
  picture_aspect_ratio: 0,
  frame_format_type: 1, // progressive
  timecode: 0,
  p_data: null,
  line_stride_in_bytes: 0,
  p_metadata: null,
  timestamp: 0
}

function defineStructsOnce(): void {
  if (structsReady) return
  // NDI 公式 SDK のレイアウトに一致（ブリッジの .m と同じ）。
  koffi.struct('NDIlib_send_create_t', {
    p_ndi_name: 'str',
    p_groups: 'str',
    clocked_video: 'bool',
    clocked_audio: 'bool'
  })
  koffi.struct('NDIlib_video_frame_v2_t', {
    xres: 'int',
    yres: 'int',
    FourCC: 'int',
    frame_rate_N: 'int',
    frame_rate_D: 'int',
    picture_aspect_ratio: 'float',
    frame_format_type: 'int',
    timecode: 'int64',
    p_data: 'uint8_t*',
    line_stride_in_bytes: 'int',
    p_metadata: 'str',
    timestamp: 'int64'
  })
  structsReady = true
}

/** NDI 直送を開始。libPath=NDIライブラリの絶対パス。成功すれば active になる。 */
export function startNdiDirect(name: string, libPath: string): boolean {
  if (sender) return true
  try {
    const lib = koffi.load(libPath)
    defineStructsOnce()
    const init = lib.func('bool NDIlib_initialize()') as unknown as KFn
    const create = lib.func(
      'void* NDIlib_send_create(NDIlib_send_create_t* p)'
    ) as unknown as KFn
    sendVideo = lib.func(
      'void NDIlib_send_send_video_v2(void* p, NDIlib_video_frame_v2_t* f)'
    ) as unknown as KFn
    getConns = lib.func(
      'int NDIlib_send_get_no_connections(void* p, uint32_t timeout)'
    ) as unknown as KFn
    sendDestroy = lib.func('void NDIlib_send_destroy(void* p)') as unknown as KFn

    if (!init()) {
      console.warn('[ndi-direct] NDIlib_initialize 失敗（CPU 非対応の可能性）')
      sendVideo = getConns = sendDestroy = null // 失敗時に関数ポインタを残さない（再起動でリーク防止）
      return false
    }
    sender = create({
      p_ndi_name: name,
      p_groups: null,
      clocked_video: true,
      clocked_audio: false
    })
    if (!sender) {
      console.warn('[ndi-direct] NDI 送信機の作成失敗')
      sendVideo = getConns = sendDestroy = null
      return false
    }
    // 受け手の接続数を 1 秒ごとにポーリングしてキャッシュ。
    connTimer = setInterval(() => {
      try {
        rxCount = (getConns!(sender, 0) as number) | 0
      } catch {
        /* noop */
      }
    }, 1000)
    console.log(`[ndi-direct] NDI 送信機を作成: "${name}"`)
    return true
  } catch (e) {
    console.warn('[ndi-direct] 起動失敗（ライブラリ未配置/非対応）:', e)
    sender = null
    sendVideo = getConns = sendDestroy = null
    return false
  }
}

/** RGBA フレーム（width*height*4 の連続バイト）を 1 枚送る。active でなければ無視。 */
export function sendNdiFrame(
  width: number,
  height: number,
  rgba: Uint8Array | Uint8ClampedArray | Buffer
): void {
  if (!sender || !sendVideo || width <= 0 || height <= 0) return
  const buf = Buffer.isBuffer(rgba)
    ? rgba
    : Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength)
  frame.xres = width
  frame.yres = height
  frame.p_data = buf
  frame.line_stride_in_bytes = width * 4
  try {
    sendVideo(sender, frame)
  } catch (e) {
    console.warn('[ndi-direct] 送信エラー:', e)
  }
}

/** 状態。active=送信機あり・rx=受け手の数。 */
export function getNdiDirectStatus(): { active: boolean; rx: number } {
  return { active: !!sender, rx: sender ? rxCount : 0 }
}

/** 停止（アプリ終了時）。 */
export function stopNdiDirect(): void {
  if (connTimer) {
    clearInterval(connTimer)
    connTimer = null
  }
  try {
    if (sender && sendDestroy) sendDestroy(sender)
  } catch {
    /* noop */
  }
  sender = null
  sendVideo = null
  getConns = null
  sendDestroy = null
  rxCount = 0
}
