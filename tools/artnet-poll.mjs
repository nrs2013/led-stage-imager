// ArtPoll送信 — ネットワーク上のArt-Net機器に「点呼」をかける
// 使い方: node tools/artnet-poll.mjs [宛先=全ブロードキャスト]
// 返事(ArtPollReply op=0x2100)は artnet-sniff.mjs 側に HIT として現れる
import { createSocket } from 'node:dgram'

const targets = process.argv[2]
  ? [process.argv[2]]
  : ['192.168.1.255', '10.229.81.255', '255.255.255.255']

// ArtPoll: "Art-Net\0" + op 0x2000 LE + ProtVer 0,14 + TalkToMe 0 + Priority 0
const pkt = Buffer.concat([
  Buffer.from('Art-Net\0', 'latin1'),
  Buffer.from([0x00, 0x20, 0x00, 0x0e, 0x00, 0x00]),
])

const s = createSocket({ type: 'udp4', reuseAddr: true })
s.bind(0, '0.0.0.0', () => {
  s.setBroadcast(true)
  let done = 0
  for (const t of targets) {
    s.send(pkt, 6454, t, (err) => {
      console.log(err ? `NG: ${t} (${err.message})` : `点呼送信: ${t}:6454`)
      if (++done === targets.length) setTimeout(() => s.close(), 200)
    })
  }
})
