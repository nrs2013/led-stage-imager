import { describe, it, expect } from 'vitest'
import { clampTilt, autoHang, TILT_MAX, LH } from './engine'

describe('clampTilt（実機の220度＝±110で止める）', () => {
  it('範囲内は素通し', () => {
    expect(clampTilt(0)).toBe(0)
    expect(clampTilt(45)).toBe(45)
    expect(clampTilt(-110)).toBe(-110)
    expect(clampTilt(110)).toBe(110)
  })
  it('±110を超えたら端で止まる（古い保存の±180も）', () => {
    expect(clampTilt(180)).toBe(TILT_MAX)
    expect(clampTilt(-180)).toBe(-TILT_MAX)
    expect(clampTilt(999)).toBe(TILT_MAX)
  })
})

describe('autoHang（置いた高さで上吊り/床置きを自動判定）', () => {
  const box = { y: 100, h: 600 } // 写真=y100〜700・中央=400
  it('写真の上半分→上吊り(above)', () => {
    expect(autoHang(150, box)).toBe('above')
    expect(autoHang(399, box)).toBe('above')
  })
  it('写真の下半分（中央ちょうど含む）→床置き(undefined)', () => {
    expect(autoHang(400, box)).toBeUndefined()
    expect(autoHang(650, box)).toBeUndefined()
  })
  it('写真が無ければ画面(LH)の半分で判定', () => {
    expect(autoHang(LH / 2 - 1, null)).toBe('above')
    expect(autoHang(LH / 2, null)).toBeUndefined()
  })
})
