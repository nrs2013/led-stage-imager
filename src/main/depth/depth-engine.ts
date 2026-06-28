// 深度推定エンジン（完全同梱・Python/ComfyUI 不要）。
// onnxruntime-node で Depth Anything V2 Small(Apache-2.0) の ONNX をアプリ内蔵モデルから実行。
// Mac は CoreML(Neural Engine/GPU)優先・無理なら CPU。前処理/後処理はレンダラ側で行い、
// ここは「前処理済みテンソル(1x3xHxW float32) → 生深度(float32 H*W)」だけを担う。
// 失敗しても throw しない＝深度が作れないだけでアプリは通常動作（立体感オフ相当）。
//
// 推論はまず別スレッド(depth-worker)で回し、メインスレッド(=Syphon/NDI発行・Art-Net中継)を
// 止めないようにする。worker が使えない/失敗した環境では、これまで通りメインスレッドの同期実行
// (runDepthInProcess)へ自動フォールバックするので、深度機能そのものは決して壊れない。
import { InferenceSession, Tensor } from 'onnxruntime-node'
import { Worker } from 'worker_threads'
import { existsSync } from 'fs'
import { join } from 'path'

let session: InferenceSession | null = null
let loading: Promise<InferenceSession | null> | null = null

/** 同梱モデルの絶対パス（パッケージ方式の差を候補で吸収・dev は project の resources）。 */
function modelPath(): string | null {
  const res = process.resourcesPath || ''
  const name = 'depth-anything-v2-small.onnx'
  const cands = [
    join(res, 'app.asar.unpacked', 'resources', 'models', name),
    join(res, 'resources', 'models', name),
    join(res, 'models', name),
    join(process.cwd(), 'resources', 'models', name)
  ]
  return cands.find((p) => existsSync(p)) ?? null
}

async function getSession(): Promise<InferenceSession | null> {
  if (session) return session
  if (loading) return loading
  loading = (async () => {
    const p = modelPath()
    if (!p) {
      console.warn('[depth] 同梱モデルが見つからない')
      return null
    }
    const tryCreate = async (eps: string[]): Promise<InferenceSession> =>
      InferenceSession.create(p, { executionProviders: eps })
    try {
      session = await tryCreate(process.platform === 'darwin' ? ['coreml', 'cpu'] : ['cpu'])
      console.log('[depth] onnx session ready:', p)
    } catch (e) {
      console.warn('[depth] CoreML失敗→CPUで再試行', e)
      try {
        session = await tryCreate(['cpu'])
      } catch (e2) {
        console.error('[depth] session作成失敗', e2)
        session = null
      }
    }
    return session
  })()
  return loading
}

/** 深度エンジンが使えるか（同梱モデルが在るか）。 */
export function depthEngineAvailable(): boolean {
  return modelPath() != null
}

type DepthResult = { depth?: Float32Array; w?: number; h?: number; error?: string }

// ---------- 別スレッド(worker)実行 ----------
let worker: Worker | null = null
let workerBroken = false // 一度でも worker が壊れたら以後は同期実行のみ（クラッシュループ防止）
let reqSeq = 0
const pending = new Map<number, { resolve: (m: DepthResult) => void; reject: (e: unknown) => void }>()

/** worker を遅延生成。生成に失敗したら null（=同期実行へフォールバック）。 */
function getWorker(): Worker | null {
  if (workerBroken) return null
  if (worker) return worker
  try {
    // depth-worker.js は out/main/ に並ぶ（electron.vite.config の main 追加エントリ）。
    // パッケージ時は asarUnpack で実ファイル展開されるので app.asar → app.asar.unpacked を指す
    // （dev では 'app.asar' を含まないので無変換）。
    const dir = __dirname.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1')
    const w = new Worker(join(dir, 'depth-worker.js'))
    w.on('message', (m: DepthResult & { id: number }) => {
      const p = pending.get(m.id)
      if (!p) return
      pending.delete(m.id)
      p.resolve(m.error ? { error: m.error } : { depth: m.depth, w: m.w, h: m.h })
    })
    w.on('error', (e) => {
      console.warn('[depth] worker エラー→以後は同期実行へ', e)
      workerBroken = true
      worker = null
      for (const [, p] of pending) p.reject(e)
      pending.clear()
    })
    w.on('exit', () => {
      worker = null
    })
    worker = w
    console.log('[depth] worker thread started（深度AIを別スレッドで実行）')
    return worker
  } catch (e) {
    console.warn('[depth] worker 生成失敗→同期実行へ', e)
    workerBroken = true
    return null
  }
}

function runOnWorker(wk: Worker, input: Float32Array, w: number, h: number): Promise<DepthResult> {
  return new Promise<DepthResult>((resolve, reject) => {
    const id = ++reqSeq
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error('depth-worker-timeout'))
    }, 20000)
    pending.set(id, {
      resolve: (m) => {
        clearTimeout(timer)
        resolve(m)
      },
      reject: (e) => {
        clearTimeout(timer)
        reject(e)
      }
    })
    // 入力は transfer しない（コピー）＝worker が落ちても下のフォールバックで input を再利用できる。
    wk.postMessage({ id, input, w, h })
  })
}

/** メインスレッドで同期実行（フォールバック・従来の挙動）。 */
async function runDepthInProcess(input: Float32Array, w: number, h: number): Promise<DepthResult> {
  try {
    const sess = await getSession()
    if (!sess) return { error: 'depth-model-missing' }
    const t = new Tensor('float32', input, [1, 3, h, w])
    const feeds: Record<string, Tensor> = {}
    feeds[sess.inputNames[0]] = t
    const out = await sess.run(feeds)
    const o = out[sess.outputNames[0]]
    return { depth: o.data as Float32Array, w, h }
  } catch (e) {
    return { error: String(e) }
  }
}

/** 前処理済みテンソル(NCHW float32, 1x3xHxW) → 生深度(float32, H*W)。失敗で {error}。
 *  まず別スレッドで実行し、worker が使えない/落ちた場合のみメインスレッド同期実行へフォールバック。 */
export async function runDepth(input: Float32Array, w: number, h: number): Promise<DepthResult> {
  const wk = getWorker()
  if (!wk) return runDepthInProcess(input, w, h)
  try {
    return await runOnWorker(wk, input, w, h)
  } catch (e) {
    // worker がタイムアウト/クラッシュ → このコールは確実に返すため同期実行に切替。
    console.warn('[depth] worker 実行失敗→同期実行で再試行', e)
    workerBroken = true
    try {
      wk.terminate()
    } catch {
      /* noop */
    }
    worker = null
    return runDepthInProcess(input, w, h)
  }
}
