export interface MaskData {
  bitmap: Uint8Array // length w*h, 1 = drawable
  w: number
  h: number
  overlay: string // data URL: shades the NON-drawable area for the editor
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = (): void => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

/**
 * Builds a drawable-area mask from an (alpha) PNG, scaled to the canvas size.
 * By default the transparent pixels are the drawable area; `invert` flips that.
 * Also returns an overlay image that shades the non-drawable area for the editor.
 */
export async function computeMask(
  dataUrl: string,
  w: number,
  h: number,
  invert: boolean
): Promise<MaskData | null> {
  if (w <= 0 || h <= 0) return null
  const img = await loadImage(dataUrl)
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.clearRect(0, 0, w, h)
  ctx.drawImage(img, 0, 0, w, h)
  const src = ctx.getImageData(0, 0, w, h).data

  const bitmap = new Uint8Array(w * h)
  const ov = document.createElement('canvas')
  ov.width = w
  ov.height = h
  const octx = ov.getContext('2d')
  if (!octx) return null
  const oimg = octx.createImageData(w, h)
  const od = oimg.data

  for (let i = 0; i < w * h; i++) {
    const a = src[i * 4 + 3]
    const drawable = (a < 128) !== invert // transparent => drawable (unless inverted)
    bitmap[i] = drawable ? 1 : 0
    if (!drawable) {
      od[i * 4] = 6
      od[i * 4 + 1] = 6
      od[i * 4 + 2] = 8
      od[i * 4 + 3] = 175 // shade non-drawable
    } else {
      od[i * 4 + 3] = 0
    }
  }
  octx.putImageData(oimg, 0, 0)
  return { bitmap, w, h, overlay: ov.toDataURL() }
}
