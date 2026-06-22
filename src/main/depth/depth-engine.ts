// 深度推定エンジン（完全同梱・Python/ComfyUI 不要）。
// onnxruntime-node で Depth Anything V2 Small(Apache-2.0) の ONNX をアプリ内蔵モデルから実行。
// Mac は CoreML(Neural Engine/GPU)優先・無理なら CPU。前処理/後処理はレンダラ側で行い、
// ここは「前処理済みテンソル(1x3xHxW float32) → 生深度(float32 H*W)」だけを担う。
// 失敗しても throw しない＝深度が作れないだけでアプリは通常動作（立体感オフ相当）。
import { InferenceSession, Tensor } from 'onnxruntime-node'
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

/** 前処理済みテンソル(NCHW float32, 1x3xHxW) → 生深度(float32, H*W)。失敗で {error}。 */
export async function runDepth(
  input: Float32Array,
  w: number,
  h: number
): Promise<{ depth?: Float32Array; w?: number; h?: number; error?: string }> {
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
