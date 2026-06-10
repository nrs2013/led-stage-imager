export interface MaskData {
  bitmap: Uint8Array // length w*h, 1 = drawable
  w: number
  h: number
  overlay: string // data URL: shades the NON-drawable area for the editor
  /** data URL: neutral grey under the DRAWABLE area, so transparent punch-outs read
   *  clearly against dark artwork (Photoshop-checkerboard idea, but calm). */
  holes: string
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
 * "Nothing there" test for one chart pixel. Alpha images: transparent = empty.
 * Images without a usable alpha channel (JPG, flattened PNG): near-black = empty,
 * so a black-background chart still yields the LED faces.
 */
export function isEmptyPixel(r: number, g: number, b: number, a: number, hasAlpha: boolean): boolean {
  if (hasAlpha) return a < 128
  return r + g + b < 72 // ≈24/channel: tolerates compression noise in "black"
}

/**
 * Builds a drawable-area mask from a chart image, scaled to the canvas size.
 * Empty pixels (transparent — or near-black when the image has no alpha) are the
 * drawable area by default: the chart is show artwork with the decoration areas
 * punched out as transparent (or black) holes. `invert` flips that for materials
 * authored the other way around (LED faces drawn as opaque panels).
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

  let hasAlpha = false
  for (let i = 0; i < w * h; i++) {
    if (src[i * 4 + 3] < 250) {
      hasAlpha = true
      break
    }
  }

  const bitmap = new Uint8Array(w * h)
  const ov = document.createElement('canvas')
  ov.width = w
  ov.height = h
  const octx = ov.getContext('2d')
  if (!octx) return null
  const oimg = octx.createImageData(w, h)
  const od = oimg.data
  const hv = document.createElement('canvas')
  hv.width = w
  hv.height = h
  const hctx = hv.getContext('2d')
  if (!hctx) return null
  const himg = hctx.createImageData(w, h)
  const hd = himg.data

  for (let i = 0; i < w * h; i++) {
    const empty = isEmptyPixel(src[i * 4], src[i * 4 + 1], src[i * 4 + 2], src[i * 4 + 3], hasAlpha)
    const drawable = empty !== invert // empty => drawable (unless inverted)
    bitmap[i] = drawable ? 1 : 0
    if (!drawable) {
      od[i * 4] = 6
      od[i * 4 + 1] = 6
      od[i * 4 + 2] = 8
      od[i * 4 + 3] = 175 // shade non-drawable
    } else {
      od[i * 4 + 3] = 0
      hd[i * 4] = 70 // neutral grey under the drawable area: edges read clearly,
      hd[i * 4 + 1] = 70 // and no hue is added anywhere near the artwork
      hd[i * 4 + 2] = 76
      hd[i * 4 + 3] = 255
    }
  }
  octx.putImageData(oimg, 0, 0)
  hctx.putImageData(himg, 0, 0)
  return { bitmap, w, h, overlay: ov.toDataURL(), holes: hv.toDataURL() }
}
