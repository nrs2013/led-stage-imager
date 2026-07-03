import { createSocket, type Socket } from 'node:dgram'
import { EventEmitter } from 'node:events'
import { networkInterfaces } from 'node:os'
import { parseArtDmx } from './artdmx-parser'

export const ARTNET_PORT = 6454
const OP_POLL = 0x2000

/** Art-Net 受信機。
 *  🔴 ソケットは常に 0.0.0.0 に bind する（NIC の IP に bind すると macOS では
 *  ブロードキャスト（卓の既定の送り方）が一切届かなくなり、無言で「No Signal」になる）。
 *  「Interface(回線)」選択は bind 先ではなく“送り主の絞り込み”として実装する。
 *  さらに卓の ArtPoll（誰かいる？）に ArtPollReply で返事をする＝卓のノード一覧に
 *  「LED STAGE IMAGER」が出る。ユニキャスト運用の卓にも見つけてもらえる。 */
export class ArtNetReceiver extends EventEmitter {
  private socket: Socket | null = null
  private port = ARTNET_PORT
  // 送り主の絞り込み（null=すべて受ける）。選んだ NIC のサブネットからのパケットだけ通す。
  private filterBase: number | null = null
  private filterMask: number | null = null
  private replyCache: Buffer | null = null

  /** @param port テスト用に変更可（本番は既定の 6454 のまま） */
  start(port = ARTNET_PORT): void {
    this.stop()
    this.port = port
    const sock = createSocket({ type: 'udp4', reuseAddr: true })
    sock.on('message', (msg, rinfo) => {
      // 卓の「誰かいる？」(ArtPoll) には絞り込みに関係なく返事する（見つけてもらうのが目的）
      if (
        msg.length >= 10 &&
        msg.toString('latin1', 0, 8) === 'Art-Net\0' &&
        msg.readUInt16LE(8) === OP_POLL
      ) {
        const reply = this.buildPollReply()
        if (reply) this.socket?.send(reply, this.port, rinfo.address)
        return
      }
      if (!this.senderAllowed(rinfo.address)) return
      const pkt = parseArtDmx(msg)
      if (pkt) this.emit('dmx', pkt) // { universe, sequence, data }
    })
    sock.on('error', (err) => this.emit('error', err))
    sock.on('listening', () => this.emit('listening'))
    sock.bind(this.port, '0.0.0.0')
    this.socket = sock
  }

  /** 「Interface(回線)」選択：ip が NIC のアドレスなら、その回線のサブネットの送り主だけ受ける。
   *  '0.0.0.0'/空 = すべて受ける。bind し直さないので、選択ミスで受信が死ぬことはない。 */
  setSourceFilter(ip: string): boolean {
    if (!ip || ip === '0.0.0.0') {
      this.filterBase = null
      this.filterMask = null
      return true
    }
    for (const addrs of Object.values(networkInterfaces())) {
      for (const a of addrs ?? []) {
        if (a.family === 'IPv4' && a.address === ip && a.netmask) {
          const mask = ipToInt(a.netmask)
          this.filterBase = ipToInt(ip) & mask
          this.filterMask = mask
          return true
        }
      }
    }
    // 見つからない（抜かれた/古い一覧）＝絞り込み解除で受信は生かす
    this.filterBase = null
    this.filterMask = null
    return false
  }

  private senderAllowed(addr: string): boolean {
    if (this.filterBase == null || this.filterMask == null) return true
    if (addr === '127.0.0.1') return true // ローカルのテスト送信は常に通す
    return (ipToInt(addr) & this.filterMask) === this.filterBase
  }

  /** ArtPollReply（Art-Net 4・239バイト）。卓のノード一覧に出るための最小限の名刺。 */
  private buildPollReply(): Buffer | null {
    if (this.replyCache) return this.replyCache
    const myIp = primaryIPv4()
    if (!myIp) return null
    const buf = Buffer.alloc(239)
    buf.write('Art-Net\0', 0, 'latin1')
    buf.writeUInt16LE(0x2100, 8) // OpPollReply
    const ipParts = myIp.split('.').map(Number)
    ipParts.forEach((p, i) => buf.writeUInt8(p, 10 + i)) // IP
    buf.writeUInt16LE(ARTNET_PORT, 14) // Port（仕様どおり low-byte first）
    buf.writeUInt16BE(1, 16) // VersInfo
    // NetSwitch(18)/SubSwitch(19)=0、Oem(20-21)=0x00ff(汎用)、Status1(23)=0
    buf.writeUInt16BE(0x00ff, 20)
    buf.write('LED STAGE IMAGER', 26, 'latin1') // ShortName(18バイト枠)
    buf.write('LED STAGE IMAGER (Art-Net in)', 44, 'latin1') // LongName(64バイト枠)
    buf.write('#0001 [0000] OK', 108, 'latin1') // NodeReport(64バイト枠)
    buf.writeUInt16BE(1, 172) // NumPorts=1
    buf.writeUInt8(0x80, 174) // PortTypes[0]: output (Art-Net → この機器)
    buf.writeUInt8(0x80, 182) // GoodOutput[0]: data transmitted
    this.replyCache = buf
    return buf
  }

  stop(): void {
    this.socket?.close()
    this.socket = null
    this.replyCache = null
  }
}

const ipToInt = (ip: string): number =>
  ip.split('.').reduce((acc, o) => ((acc << 8) | (Number(o) & 0xff)) >>> 0, 0)

/** 自分の代表 IPv4（ArtPollReply の名刺に書く住所）。内蔵ループバック以外の最初の IPv4。 */
function primaryIPv4(): string | null {
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal) return a.address
    }
  }
  return null
}
