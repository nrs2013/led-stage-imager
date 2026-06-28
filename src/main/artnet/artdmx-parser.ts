export interface ArtDmxPacket {
  universe: number // 0..32767 (Net<<8 | SubUni)
  sequence: number
  data: Uint8Array // length 1..512
}

const ART_NET_ID = 'Art-Net\0'
const OP_DMX = 0x5000

export function parseArtDmx(buf: Buffer): ArtDmxPacket | null {
  if (buf.length < 18) return null
  if (buf.toString('latin1', 0, 8) !== ART_NET_ID) return null
  const opcode = buf.readUInt16LE(8) // Art-Net opcodes are little-endian
  if (opcode !== OP_DMX) return null
  const sequence = buf.readUInt8(12)
  const subUni = buf.readUInt8(14)
  const net = buf.readUInt8(15)
  const length = buf.readUInt16BE(16) // length is big-endian
  // 宣言長が DMX 範囲外、または実ペイロードより長い（=ラント/破損パケット）なら丸ごと捨てる。
  // subarray は黙ってクランプするので、信用すると本番中にチャンネルが欠けて灯体が消える。
  if (length < 1 || length > 512) return null
  if (18 + length > buf.length) return null
  const universe = (net << 8) | subUni
  const data = new Uint8Array(buf.subarray(18, 18 + length))
  return { universe, sequence, data }
}
