// 深度推定を「メインスレッドの外」で回す worker スレッド。
// onnxruntime-node の sess.run は同期実行でメインを止めるため、ここ(別スレッド)で走らせる。
// これで写真読み込み時に Syphon/NDI 発行・Art-Net 中継が固まらなくなる。
// ※ 読み込み/実行に失敗しても depth-engine 側がメインスレッドの同期実行へフォールバックするので、
//    この worker が動かない環境でも深度機能自体は壊れない（最悪これまで通り＝同期で動く）。
import { parentPort } from 'worker_threads'
import { InferenceSession, Tensor } from 'onnxruntime-node'
import { existsSync } from 'fs'
import { join } from 'path'

let session: InferenceSession | null = null
let loading: Promise<InferenceSession | null> | null = null

/** 同梱モデルの絶対パス（depth-engine.ts と同じ探索順）。worker でも process.resourcesPath は使える。 */
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
    if (!p) return null
    const tryCreate = async (eps: string[]): Promise<InferenceSession> =>
      InferenceSession.create(p, { executionProviders: eps })
    try {
      session = await tryCreate(process.platform === 'darwin' ? ['coreml', 'cpu'] : ['cpu'])
    } catch {
      try {
        session = await tryCreate(['cpu'])
      } catch {
        session = null
      }
    }
    return session
  })()
  return loading
}

interface DepthReq {
  id: number
  input: Float32Array
  w: number
  h: number
}

parentPort?.on('message', async (msg: DepthReq) => {
  const { id, input, w, h } = msg
  try {
    const sess = await getSession()
    if (!sess) {
      parentPort!.postMessage({ id, error: 'depth-model-missing' })
      return
    }
    const t = new Tensor('float32', input, [1, 3, h, w])
    const feeds: Record<string, Tensor> = {}
    feeds[sess.inputNames[0]] = t
    const out = await sess.run(feeds)
    const o = out[sess.outputNames[0]]
    // onnx が内部で持つバッファを transfer すると不具合の元なので、自前バッファへコピーしてから渡す。
    const depth = Float32Array.from(o.data as Float32Array)
    parentPort!.postMessage({ id, depth, w, h }, [depth.buffer])
  } catch (e) {
    parentPort!.postMessage({ id, error: String(e) })
  }
})
