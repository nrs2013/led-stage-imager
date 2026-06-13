import { describe, it, expect } from 'vitest'
import { alignSnap, equalSnapX } from './snap'

describe('alignSnap（整列スナップ）', () => {
  it('近い x に吸着し、縦ガイドを返す', () => {
    const r = alignSnap([{ x: 103, y: 50 }], [{ x: 100, y: 0 }], 8)
    expect(r.dx).toBe(-3)
    expect(r.vx).toEqual([100])
    expect(r.dy).toBe(0)
    expect(r.hy).toEqual([])
  })
  it('閾値より遠ければ吸着しない', () => {
    const r = alignSnap([{ x: 120, y: 50 }], [{ x: 100, y: 0 }], 8)
    expect(r.dx).toBe(0)
    expect(r.vx).toEqual([])
  })
  it('x と y を別々に吸着する', () => {
    const r = alignSnap([{ x: 102, y: 198 }], [{ x: 100, y: 200 }], 8)
    expect(r.dx).toBe(-2)
    expect(r.dy).toBe(2)
    expect(r.vx).toEqual([100])
    expect(r.hy).toEqual([200])
  })
  it('群（複数点）でも、どれか1点が揃えば吸着する', () => {
    const r = alignSnap(
      [
        { x: 50, y: 50 },
        { x: 203, y: 80 }
      ],
      [{ x: 200, y: 0 }],
      8
    )
    expect(r.dx).toBe(-3)
    expect(r.vx).toEqual([200])
  })
})

describe('equalSnapX（等間隔スナップ）', () => {
  it('右側に並べて等間隔（100,200 → 300）', () => {
    const r = equalSnapX(
      303,
      [
        { x: 100, y: 0 },
        { x: 200, y: 0 }
      ],
      8
    )
    expect(r?.x).toBe(300)
    expect(r?.marks).toEqual([
      [100, 200],
      [200, 300]
    ])
  })
  it('真ん中に入って等間隔（100,200 → 150）', () => {
    const r = equalSnapX(
      148,
      [
        { x: 100, y: 0 },
        { x: 200, y: 0 }
      ],
      8
    )
    expect(r?.x).toBe(150)
  })
  it('遠ければ null', () => {
    const r = equalSnapX(
      260,
      [
        { x: 100, y: 0 },
        { x: 200, y: 0 }
      ],
      8
    )
    expect(r).toBeNull()
  })
  it('他の灯体が1つだけなら null', () => {
    const r = equalSnapX(150, [{ x: 100, y: 0 }], 8)
    expect(r).toBeNull()
  })
})
