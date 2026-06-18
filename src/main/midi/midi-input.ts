// CoreMIDI 直読みの MIDI 入力（Mac 専用）。同梱した midiread を子プロセスで起動し、
// stdout の "PORT <名>" / "M <s> <d1> <d2>" を読んで、メッセージをコールバックへ渡す。
// Electron の Web MIDI(requestMIDIAccess)がこの版で機能しないための代替（NDI と同じ同梱方式）。
import { spawn, type ChildProcess } from 'child_process'
import { join } from 'path'
import { existsSync } from 'fs'

let child: ChildProcess | null = null
let stopped = false
let restartTimer: NodeJS.Timeout | null = null
let ports: string[] = [] // 現在つながっている入力ポート名（ステータス表示用）
let pending: string[] = [] // READY までに受けた PORT を貯めて、READY で確定
let buf = ''
let onMsg: ((s: number, d1: number, d2: number) => void) | null = null

/** 同梱した midiread の絶対パス。配置はパッケージ方式で変わりうるので候補から探す。Mac 以外は null。 */
function bridgePath(): string | null {
  if (process.platform !== 'darwin') return null
  const res = process.resourcesPath
  const cands = [
    join(res, 'app.asar.unpacked', 'resources', 'midi', 'midiread'),
    join(res, 'midi', 'midiread'),
    join(res, 'resources', 'midi', 'midiread')
  ]
  return cands.find((p) => existsSync(p)) ?? null
}

function launch(): void {
  if (stopped || child) return
  const p = bridgePath()
  if (!p) return
  child = spawn(p, [], { stdio: ['ignore', 'pipe', 'ignore'] })
  buf = ''
  pending = []
  child.stdout?.on('data', (b: Buffer) => {
    buf += b.toString()
    let nl: number
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (line.startsWith('M ')) {
        const a = line.split(' ')
        const s = Number(a[1])
        if (!Number.isNaN(s)) onMsg?.(s, Number(a[2]) | 0, Number(a[3]) | 0)
      } else if (line.startsWith('PORT ')) {
        pending.push(line.slice(5))
      } else if (line.startsWith('READY')) {
        ports = pending // 直前の PORT 群を現在の接続として確定
        pending = []
        console.log('[midi] 入力ポート:', ports.length ? ports.join(', ') : '(なし)')
      }
    }
  })
  child.on('exit', () => {
    child = null
    ports = []
    if (stopped) return
    restartTimer = setTimeout(launch, 2000) // クラッシュ時は再起動
  })
  child.on('error', (e) => console.error('[midi] reader 起動エラー:', e))
  console.log('[midi] CoreMIDI リーダーを起動')
}

/** MIDI 入力を開始。受信メッセージごとに onMessage(status, data1, data2) を呼ぶ。 */
export function startMidiInput(onMessage: (s: number, d1: number, d2: number) => void): void {
  if (process.platform !== 'darwin') return
  stopped = false
  onMsg = onMessage
  if (child) return
  launch()
}

/** MIDI 入力を停止（アプリ終了時）。 */
export function stopMidiInput(): void {
  stopped = true
  if (restartTimer) {
    clearTimeout(restartTimer)
    restartTimer = null
  }
  if (child) {
    child.kill()
    child = null
  }
  ports = []
}

/** 現在つながっている MIDI 入力ポート名。 */
export function getMidiPorts(): string[] {
  return ports.slice()
}
