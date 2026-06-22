// 深度推定エンジン（暫定・外部 Python 経由）。
// 画像 → 単眼深度マップ(8bit グレー・near=明/far=暗) を作る。
// まずは「最短で立体を体感」するため、既に動く ComfyUI venv の Python
// （Depth Anything V2 Small＝Apache-2.0＝商用OK）を子プロセスで呼ぶ。
// 後で onnxruntime-node による“完全同梱”版へ差し替える（呼び口 generateDepthMap は据え置く）。
//
// 失敗しても throw しない＝深度が作れないだけで、アプリは今まで通り（立体感オフ）動く。
import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

// Depth Anything V2 Small で深度PNGを書き出すだけの小さなスクリプト（near=明/far=暗の 8bit L）。
const PY = `
import sys
try:
    from transformers import pipeline
    from PIL import Image
    inp, outp = sys.argv[1], sys.argv[2]
    try:
        pipe = pipeline('depth-estimation', model='depth-anything/Depth-Anything-V2-Small-hf', device='mps')
    except Exception:
        pipe = pipeline('depth-estimation', model='depth-anything/Depth-Anything-V2-Small-hf', device='cpu')
    img = Image.open(inp).convert('RGB')
    res = pipe(img)
    res['depth'].save(outp)
    print('OK')
except Exception as e:
    sys.stderr.write(repr(e))
    sys.exit(1)
`

/** torch+transformers が入った Python を探す。env DECOR_DEPTH_PYTHON で上書き可。無ければ null。 */
function resolvePython(): string | null {
  const cands = [
    process.env.DECOR_DEPTH_PYTHON,
    join(homedir(), 'Codex', 'local-tools', 'ComfyUI', '.venv', 'bin', 'python')
  ].filter((p): p is string => !!p)
  return cands.find((p) => existsSync(p)) ?? null
}

/** 深度エンジンが使えるか（対応 Python が見つかるか）。 */
export function depthEngineAvailable(): boolean {
  return resolvePython() != null
}

/** 画像(inPath) → 深度PNG(outPath)。成否を返す（失敗しても throw しない）。 */
export function generateDepthMap(
  inPath: string,
  outPath: string
): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    const py = resolvePython()
    if (!py) {
      resolve({ ok: false, error: 'depth-python-not-found' })
      return
    }
    const child = spawn(py, ['-c', PY, inPath, outPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        // MPS 未対応の演算は CPU に逃がす（落とさない）。HF の注意書きや進捗バーはログに留める。
        PYTORCH_ENABLE_MPS_FALLBACK: '1',
        HF_HUB_DISABLE_PROGRESS_BARS: '1',
        TRANSFORMERS_VERBOSITY: 'error',
        TOKENIZERS_PARALLELISM: 'false'
      }
    })
    let err = ''
    child.stderr?.on('data', (b: Buffer) => {
      err += b.toString()
    })
    // 初回だけモデル取得(~数十秒)が走り得るので長めの保険。通常は数秒。
    const timer = setTimeout(() => {
      child.kill()
      resolve({ ok: false, error: 'depth-timeout' })
    }, 120000)
    child.on('exit', (code) => {
      clearTimeout(timer)
      if (code === 0 && existsSync(outPath)) resolve({ ok: true })
      else resolve({ ok: false, error: `depth-failed(code=${code}) ${err.slice(-300)}` })
    })
    child.on('error', (e) => {
      clearTimeout(timer)
      resolve({ ok: false, error: String(e) })
    })
  })
}
