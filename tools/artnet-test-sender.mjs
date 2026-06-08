// tools/artnet-test-sender.mjs — run: node tools/artnet-test-sender.mjs [universe]
// Fake DMX console: streams ArtDMX to 127.0.0.1:6454, ramping ch1 (R) up and
// ch3 (B) down so you can see something pulse end-to-end.
import { createSocket } from 'node:dgram'

const UNIVERSE = Number(process.argv[2] ?? 0)
const HOST = '127.0.0.1'
const PORT = 6454
const sock = createSocket('udp4')
let t = 0

function packet(universe, data) {
  const head = Buffer.from('Art-Net\0', 'latin1')
  const op = Buffer.from([0x00, 0x50])
  const ver = Buffer.from([0x00, 0x0e])
  const seq = Buffer.from([t & 0xff, 0x00])
  const addr = Buffer.from([universe & 0xff, (universe >> 8) & 0xff])
  const len = Buffer.from([(data.length >> 8) & 0xff, data.length & 0xff])
  return Buffer.concat([head, op, ver, seq, addr, len, Buffer.from(data)])
}

setInterval(() => {
  t++
  const data = new Array(512).fill(0)
  const v = Math.floor((Math.sin(t / 20) * 0.5 + 0.5) * 255)
  data[0] = v // ch1 = R ramp
  data[1] = 0
  data[2] = 255 - v // ch3 = B inverse ramp
  sock.send(packet(UNIVERSE, data), PORT, HOST)
}, 1000 / 30)

console.log(`Sending ArtDMX to ${HOST}:${PORT} universe ${UNIVERSE} (Ctrl+C to stop)`)
