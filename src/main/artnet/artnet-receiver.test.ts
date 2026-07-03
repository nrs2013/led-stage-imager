import { describe, it, expect, afterEach } from 'vitest'
import { createSocket } from 'node:dgram'
import { ArtNetReceiver } from './artnet-receiver'

// 来週の卓接続の要：①ArtPoll に ArtPollReply で返事する（卓のノード一覧に出る）
// ②回線の絞り込みはサブネット判定（bind し直さない＝ブロードキャストを殺さない）
// ③ArtDMX は今まで通り届く。実ソケットで in-process 検証する（テスト用ポート使用）。

const TEST_PORT = 16454 // 本番の 6454 とは別＝起動中のアプリと衝突しない

function artPoll(): Buffer {
  const b = Buffer.alloc(14)
  b.write('Art-Net\0', 0, 'latin1')
  b.writeUInt16LE(0x2000, 8)
  b.writeUInt16BE(14, 10)
  return b
}
function artDmx(universe: number, data: number[]): Buffer {
  const b = Buffer.alloc(18 + data.length)
  b.write('Art-Net\0', 0, 'latin1')
  b.writeUInt16LE(0x5000, 8)
  b.writeUInt16BE(14, 10)
  b.writeUInt8(1, 12)
  b.writeUInt8(universe & 0xff, 14)
  b.writeUInt8((universe >> 8) & 0x7f, 15)
  b.writeUInt16BE(data.length, 16)
  Buffer.from(data).copy(b, 18)
  return b
}
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

let receiver: ArtNetReceiver | null = null
afterEach(() => {
  receiver?.stop()
  receiver = null
})

async function startReceiver(): Promise<ArtNetReceiver> {
  receiver = new ArtNetReceiver()
  const ready = new Promise<void>((resolve) => receiver!.once('listening', () => resolve()))
  receiver.start(TEST_PORT)
  await ready
  return receiver
}

describe('ArtNetReceiver（卓との接続の作法）', () => {
  it('ArtPoll に ArtPollReply（名前入り・正しい形式）で返事する', async () => {
    const r = await startReceiver()
    // 受信ソケットの send を横取りして、返事の中身と宛先を検証
    const sent: { buf: Buffer; port: number; addr: string }[] = []
    const sock = (r as unknown as { socket: { send: (...a: unknown[]) => void } }).socket
    sock.send = ((buf: Buffer, port: number, addr: string): void => {
      sent.push({ buf, port, addr })
    }) as never
    // 偽卓からポーリング
    const tx = createSocket('udp4')
    tx.send(artPoll(), TEST_PORT, '127.0.0.1')
    await wait(150)
    tx.close()
    expect(sent.length).toBe(1)
    const { buf, port, addr } = sent[0]
    expect(addr).toBe('127.0.0.1') // 聞いてきた相手へ返す
    expect(port).toBe(TEST_PORT) // Art-Net の作法＝相手も同じポートで待っている
    expect(buf.toString('latin1', 0, 8)).toBe('Art-Net\0')
    expect(buf.readUInt16LE(8)).toBe(0x2100) // OpPollReply
    expect(buf.length).toBe(239)
    expect(buf.toString('latin1', 26, 44).replace(/\0+$/, '')).toBe('LED STAGE IMAGER')
    // 「U1〜U4(線上0〜3)を受け取れる」記載＝grandMAのAuto配信/ノード一覧が正しく働く鍵
    expect(buf.readUInt16BE(172)).toBe(4) // NumPorts
    for (let i = 0; i < 4; i++) {
      expect(buf.readUInt8(174 + i)).toBe(0x80) // PortTypes: output
      expect(buf.readUInt8(190 + i)).toBe(i) // SwOut: universe 0..3
    }
  })

  it('ArtDMX は dmx イベントとして届く（ArtPoll は dmx にならない）', async () => {
    const r = await startReceiver()
    const got: { universe: number; data: Uint8Array }[] = []
    r.on('dmx', (p) => got.push(p))
    const tx = createSocket('udp4')
    tx.send(artPoll(), TEST_PORT, '127.0.0.1')
    tx.send(artDmx(0, [255, 128, 64]), TEST_PORT, '127.0.0.1')
    await wait(150)
    tx.close()
    expect(got.length).toBe(1)
    expect(got[0].universe).toBe(0)
    expect(Array.from(got[0].data)).toEqual([255, 128, 64])
  })

  it('絞り込み：127.0.0.1（ローカルテスト）は常に通る・解除で全部通る', async () => {
    const r = await startReceiver()
    const got: number[] = []
    r.on('dmx', (p) => got.push(p.universe))
    // ありえないサブネット（10.99.99.0/24）で絞る → 127.0.0.1 は特例で通る
    ;(r as unknown as { filterBase: number; filterMask: number }).filterBase =
      (10 << 24) | (99 << 16) | (99 << 8)
    ;(r as unknown as { filterMask: number }).filterMask = 0xffffff00
    const tx = createSocket('udp4')
    tx.send(artDmx(2, [1]), TEST_PORT, '127.0.0.1')
    await wait(120)
    r.setSourceFilter('0.0.0.0') // 解除
    tx.send(artDmx(3, [1]), TEST_PORT, '127.0.0.1')
    await wait(120)
    tx.close()
    expect(got).toEqual([2, 3])
  })

  it('setSourceFilter: 一覧にない IP を渡されたら絞り込み解除（受信を殺さない）', async () => {
    const r = await startReceiver()
    expect(r.setSourceFilter('203.0.113.9')).toBe(false) // 存在しないNIC → false＝解除扱い
    const got: number[] = []
    r.on('dmx', (p) => got.push(p.universe))
    const tx = createSocket('udp4')
    tx.send(artDmx(1, [9]), TEST_PORT, '127.0.0.1')
    await wait(120)
    tx.close()
    expect(got).toEqual([1]) // 受信は生きている
  })
})
