import { describe, it, expect } from 'vitest'
import { zipShow, unzipShow } from './showbundle'

// .ledshow は本番データそのもの。zip→unzip で show.json と写真が完全一致で戻ることを保証する。
describe('showbundle (.ledshow の1ファイル保存)', () => {
  it('show.json と media を往復しても完全一致で戻る', async () => {
    const json = JSON.stringify({ scenes: [{ name: 'A' }], beams: [1, 2, 3] })
    // 1x1 PNG（赤）と小さな jpg 相当のダミー
    const pngB64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    const media = [
      { file: 'media/photo1.png', dataUrl: `data:image/png;base64,${pngB64}` },
      { file: 'media/clip1.mp4', dataUrl: `data:video/mp4;base64,AAAA` }
    ]
    const bytes = await zipShow(json, media)
    expect(bytes).toBeInstanceOf(Uint8Array)
    expect(bytes.length).toBeGreaterThan(0)

    const back = await unzipShow(bytes)
    expect(back.json).toBe(json)
    // media は path→dataURL の map で戻る。base64 中身が一致すること。
    expect(back.media['media/photo1.png']).toBe(`data:image/png;base64,${pngB64}`)
    expect(back.media['media/clip1.mp4']).toBe('data:video/mp4;base64,AAAA')
    expect(Object.keys(back.media).sort()).toEqual(['media/clip1.mp4', 'media/photo1.png'])
  })

  it('media が無い公演でも json だけで往復できる', async () => {
    const json = '{"scenes":[]}'
    const back = await unzipShow(await zipShow(json, []))
    expect(back.json).toBe(json)
    expect(Object.keys(back.media)).toHaveLength(0)
  })
})
