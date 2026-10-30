import type { Underlay } from '../model/types'
import { detectLedPanels } from '../model/led-layout'

/** Entirely local, conservative rectangular-grid recognition. Original pixels stay
 * embedded so conversion is reversible and old files retain their previous meaning. */
export async function prepareChartImage(
  dataUrl: string
): Promise<{ underlay: Underlay; w: number; h: number }> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('チャート画像を読み込めませんでした'))
    image.src = dataUrl
  })
  const w = img.naturalWidth,
    h = img.naturalHeight
  const underlay: Underlay = {
    dataUrl,
    opacity: 0.5,
    visible: true,
    mask: { enabled: true, invert: false }
  }
  if (w * h > 34_000_000) return { underlay, w, h }
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: true })
  if (!ctx) return { underlay, w, h }
  ctx.drawImage(img, 0, 0)
  const regions = detectLedPanels(ctx.getImageData(0, 0, w, h).data, w, h)
  if (!regions.length) return { underlay, w, h }
  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = '#303030'
  for (const r of regions) ctx.fillRect(r.x, r.y, r.w, r.h)
  return {
    w,
    h,
    underlay: {
      dataUrl: c.toDataURL('image/png'),
      sourceDataUrl: dataUrl,
      opacity: 1,
      visible: true,
      mask: { enabled: true, invert: true },
      ledLayout: { width: w, height: h, regions }
    }
  }
}
