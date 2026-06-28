import { describe, it, expect } from 'vitest'
import { parseArtDmx } from './artdmx-parser'

function buildPacket(net: number, subUni: number, data: number[]): Buffer {
  const header = Buffer.from('Art-Net\0', 'latin1') // 8 bytes
  const opcode = Buffer.from([0x00, 0x50]) // 0x5000 little-endian
  const protVer = Buffer.from([0x00, 0x0e]) // 14 big-endian
  const seqPhys = Buffer.from([0x01, 0x00]) // sequence, physical
  const addr = Buffer.from([subUni, net]) // SubUni, Net
  const len = Buffer.from([(data.length >> 8) & 0xff, data.length & 0xff])
  return Buffer.concat([header, opcode, protVer, seqPhys, addr, len, Buffer.from(data)])
}

describe('parseArtDmx', () => {
  it('parses a valid packet and composes the universe number', () => {
    const pkt = buildPacket(1, 0x23, [10, 20, 30])
    const r = parseArtDmx(pkt)
    expect(r).not.toBeNull()
    expect(r!.universe).toBe((1 << 8) | 0x23) // 291
    expect(r!.sequence).toBe(1)
    expect(Array.from(r!.data)).toEqual([10, 20, 30])
  })

  it('returns null for a non Art-Net header', () => {
    const bad = Buffer.from('NOPE....xxxxxxxxxxxxxxxxxx')
    expect(parseArtDmx(bad)).toBeNull()
  })

  it('returns null for a non-DMX opcode (e.g. ArtPoll 0x2000)', () => {
    const pkt = buildPacket(0, 0, [1, 2])
    pkt[8] = 0x00
    pkt[9] = 0x20 // overwrite opcode to 0x2000
    expect(parseArtDmx(pkt)).toBeNull()
  })

  it('truncates data to the declared length', () => {
    const pkt = buildPacket(0, 5, [1, 2, 3, 4])
    const r = parseArtDmx(pkt)
    expect(r!.data.length).toBe(4)
  })

  it('rejects a packet whose declared length exceeds the real payload (runt/corrupt)', () => {
    const pkt = buildPacket(0, 5, [1, 2, 3, 4])
    pkt[16] = 0x02 // overwrite declared length to 512 while only 4 bytes follow
    pkt[17] = 0x00
    expect(parseArtDmx(pkt)).toBeNull()
  })

  it('rejects length 0 and length > 512', () => {
    expect(parseArtDmx(buildPacket(0, 0, []))).toBeNull()
    expect(parseArtDmx(buildPacket(0, 0, new Array(520).fill(7)))).toBeNull()
  })
})
