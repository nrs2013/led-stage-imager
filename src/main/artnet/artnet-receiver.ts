import { createSocket, type Socket } from 'node:dgram'
import { EventEmitter } from 'node:events'
import { parseArtDmx } from './artdmx-parser'

export const ARTNET_PORT = 6454

export class ArtNetReceiver extends EventEmitter {
  private socket: Socket | null = null

  /** @param bindAddress '0.0.0.0' for all NICs, or a specific NIC IP */
  start(bindAddress = '0.0.0.0'): void {
    this.stop()
    const sock = createSocket({ type: 'udp4', reuseAddr: true })
    sock.on('message', (msg) => {
      const pkt = parseArtDmx(msg)
      if (pkt) this.emit('dmx', pkt) // { universe, sequence, data }
    })
    sock.on('error', (err) => this.emit('error', err))
    sock.bind(ARTNET_PORT, bindAddress)
    this.socket = sock
  }

  stop(): void {
    this.socket?.close()
    this.socket = null
  }
}
