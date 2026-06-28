import { describe, it, expect } from 'vitest'
import { buildDecorLeds, decorChannelColor } from './decor-pattern'
import type { RGB3 as Rgb } from './colors'

const C1: Rgb = [255, 45, 120]
const C2: Rgb = [25, 182, 255]

/** 全面アルファ(=どこでも描ける)の長方形マスクを作る。 */
function fullMask(w: number, h: number): Uint8Array {
  const a = new Uint8Array(w * h)
  a.fill(255)
  return a
}

describe('buildDecorLeds', () => {
  it('横ストライプ: lineSpacing ごとの横線分（run）を出し、上から番号 % channels で色分け', () => {
    const w = 120
    const h = 120
    const segs = buildDecorLeds(fullMask(w, h), w, h, { kind: 'h', channels: 3, lineSpacing: 10 })
    expect(segs.length).toBeGreaterThan(3)
    expect(segs.every((s) => !s.vertical)).toBe(true) // 全部 横線
    // 全面マスクなので 1 線につき 1 run（横幅いっぱい）
    for (const s of segs) expect(s.len).toBeGreaterThan(w * 0.8)
    // y 昇順に並べた線の色 = 並び順 % channels
    const lines = [...segs].sort((a, b) => a.y - b.y)
    lines.forEach((s, idx) => expect(s.c).toBe(idx % 3))
  })

  it('縦ストライプ: 縦線分（vertical run）を出す', () => {
    const w = 120
    const h = 120
    const segs = buildDecorLeds(fullMask(w, h), w, h, { kind: 'v', channels: 3, lineSpacing: 10 })
    expect(segs.length).toBeGreaterThan(3)
    expect(segs.every((s) => s.vertical)).toBe(true)
    for (const s of segs) expect(s.len).toBeGreaterThan(h * 0.8)
  })

  it('縁取りは外周だけ（中心付近は含まない）', () => {
    const w = 120
    const h = 120
    const segs = buildDecorLeds(fullMask(w, h), w, h, { kind: 'outline', channels: 6, lineSpacing: 10 })
    expect(segs.length).toBeGreaterThan(0)
    const nearCenter = segs.filter((s) => Math.abs(s.x - 60) < 12 && Math.abs(s.y - 60) < 12)
    expect(nearCenter.length).toBe(0)
    for (const s of segs) {
      expect(s.c).toBeGreaterThanOrEqual(0)
      expect(s.c).toBeLessThan(6)
    }
  })

  it('描ける所が無いマスク（全部透過）は空を返す', () => {
    const w = 40
    const h = 40
    const empty = new Uint8Array(w * h) // 全部 0
    expect(buildDecorLeds(empty, w, h, { kind: 'h', channels: 6, lineSpacing: 10 })).toEqual([])
  })

  it('生成された線分の始点はすべてマスクの内側にある', () => {
    const w = 80
    const h = 80
    const a = new Uint8Array(w * h)
    for (let y = 20; y < 60; y++) for (let x = 20; x < 60; x++) a[y * w + x] = 255
    const segs = buildDecorLeds(a, w, h, { kind: 'h', channels: 4, lineSpacing: 6 })
    expect(segs.length).toBeGreaterThan(0)
    for (const s of segs) expect(a[s.y * w + s.x]).toBeGreaterThanOrEqual(128)
  })

  it('各コンテナ（分かれた図形）ごとに独立して線が並ぶ（色は各コンテナで 0 から振り直し）', () => {
    const w = 120
    const h = 120
    const a = new Uint8Array(w * h)
    const fill = (x0: number, x1: number, y0: number, y1: number): void => {
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) a[y * w + x] = 255
    }
    fill(10, 50, 10, 60) // 左上ブロック
    fill(70, 110, 70, 110) // 右下ブロック（4連結で離れている）
    const segs = buildDecorLeds(a, w, h, { kind: 'h', channels: 3, lineSpacing: 8 })
    const inA = segs.filter((s) => s.x < 60 && s.y < 65)
    const inB = segs.filter((s) => s.x >= 60 && s.y >= 65)
    expect(inA.length).toBeGreaterThan(0)
    expect(inB.length).toBeGreaterThan(0)
    const topC = (arr: typeof segs): number => {
      const minY = Math.min(...arr.map((s) => s.y))
      return arr.find((s) => s.y === minY)!.c
    }
    expect(topC(inA)).toBe(0)
    expect(topC(inB)).toBe(0)
  })

  it('追加した出方（ドット/格子/斜め/レンガ/市松/リング）は線分を出し、始点はマスク内側・色は範囲内', () => {
    const w = 120
    const h = 120
    const mask = fullMask(w, h)
    for (const kind of ['dot', 'grid', 'diag', 'brick', 'checker', 'ring'] as const) {
      const segs = buildDecorLeds(mask, w, h, { kind, channels: 6, lineSpacing: 10 })
      expect(segs.length).toBeGreaterThan(0)
      for (const s of segs) {
        expect(mask[s.y * w + s.x]).toBeGreaterThanOrEqual(128)
        expect(s.c).toBeGreaterThanOrEqual(0)
        expect(s.c).toBeLessThan(6)
      }
    }
  })

  it('格子は横線と縦線の両方を含む', () => {
    const segs = buildDecorLeds(fullMask(100, 100), 100, 100, {
      kind: 'grid',
      channels: 4,
      lineSpacing: 12
    })
    expect(segs.some((s) => s.vertical)).toBe(true)
    expect(segs.some((s) => !s.vertical)).toBe(true)
  })
})

const ALL_EFFECTS = [
  'chase',
  'theater',
  'comet',
  'wave',
  'fill',
  'rainbow',
  'grad',
  'sparkle',
  'strobe',
  'pulse',
  'twinkle',
  'meteor',
  'alt'
] as const
const ALL_DIRS = ['fwd', 'rev', 'ping', 'center'] as const

describe('decorChannelColor', () => {
  it('全エフェクト×全方向で明るさは必ず 0..1 に収まる', () => {
    for (const eff of ALL_EFFECTS) {
      for (const dir of ALL_DIRS) {
        for (let t = 0; t < 6; t += 0.31) {
          for (let c = 0; c < 6; c++) {
            const [, , , b] = decorChannelColor(c, 6, eff, dir, C1, C2, 1.2, t)
            expect(b).toBeGreaterThanOrEqual(0)
            expect(b).toBeLessThanOrEqual(1)
          }
        }
      }
    }
  })

  it('chase 順は t=0 で先頭 ch0 が一番明るく、遠い ch は暗い', () => {
    const head = decorChannelColor(0, 6, 'chase', 'fwd', C1, C2, 1.2, 0)[3]
    const tail = decorChannelColor(3, 6, 'chase', 'fwd', C1, C2, 1.2, 0)[3]
    expect(head).toBeGreaterThan(tail)
    expect(head).toBeGreaterThan(0.9)
  })

  it('chase 逆は t=0 で末尾 ch(N-1) が一番明るい（方向が効く）', () => {
    const head = decorChannelColor(5, 6, 'chase', 'rev', C1, C2, 1.2, 0)[3]
    const tail = decorChannelColor(2, 6, 'chase', 'rev', C1, C2, 1.2, 0)[3]
    expect(head).toBeGreaterThan(tail)
    expect(head).toBeGreaterThan(0.9)
  })

  it('全体一斉系（sparkle/strobe/pulse）は方向で変わらない', () => {
    for (const eff of ['sparkle', 'strobe', 'pulse'] as const) {
      const fwd = decorChannelColor(2, 6, eff, 'fwd', C1, C2, 1.2, 1.3)[3]
      const rev = decorChannelColor(2, 6, eff, 'rev', C1, C2, 1.2, 1.3)[3]
      expect(fwd).toBeCloseTo(rev, 9)
    }
  })

  it('pulse は全 ch 同じ明るさ（同時点滅）', () => {
    const b0 = decorChannelColor(0, 6, 'pulse', 'fwd', C1, C2, 1.2, 1.3)[3]
    const b5 = decorChannelColor(5, 6, 'pulse', 'fwd', C1, C2, 1.2, 1.3)[3]
    expect(b0).toBeCloseTo(b5, 6)
  })

  it('chase / pulse は color1 をそのまま使う', () => {
    const [r, g, b] = decorChannelColor(0, 6, 'chase', 'fwd', C1, C2, 1.2, 0)
    expect([r, g, b]).toEqual([C1[0], C1[1], C1[2]])
  })

  it('twinkle / alt も方向で変わらない（全体系）', () => {
    for (const eff of ['twinkle', 'alt'] as const) {
      const fwd = decorChannelColor(2, 6, eff, 'fwd', C1, C2, 1.2, 1.3)[3]
      const rev = decorChannelColor(2, 6, eff, 'rev', C1, C2, 1.2, 1.3)[3]
      expect(fwd).toBeCloseTo(rev, 9)
    }
  })

  it('meteor は方向が効く（順は頭が ch0、逆は ch(N-1)）', () => {
    const fwdHead = decorChannelColor(0, 6, 'meteor', 'fwd', C1, C2, 1.2, 0)[3]
    const fwdTail = decorChannelColor(3, 6, 'meteor', 'fwd', C1, C2, 1.2, 0)[3]
    expect(fwdHead).toBeGreaterThan(fwdTail)
    const revHead = decorChannelColor(5, 6, 'meteor', 'rev', C1, C2, 1.2, 0)[3]
    const revTail = decorChannelColor(2, 6, 'meteor', 'rev', C1, C2, 1.2, 0)[3]
    expect(revHead).toBeGreaterThan(revTail)
  })

  it('fill / center: 閾値内で外寄りchも満ちる（旧 pos>1 で満ちないバグの回帰）', () => {
    // N=6,M=3。t*speed=2.1 → thr=0.7。ch1 は e=1.5 → pos=0.6(修正後)で満ちる（旧 0.75 では満ちなかった）。
    const a = decorChannelColor(1, 6, 'fill', 'center', C1, C2, 1, 2.1)[3]
    expect(a).toBeCloseTo(1, 6)
  })
})
