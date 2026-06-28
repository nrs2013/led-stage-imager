interface DecorApi {
  openImage?: () => Promise<string | null>
}

/** Image file picker: Electron dialog when available, browser input fallback. */
export async function pickImage(): Promise<string | null> {
  const api = (window as unknown as { api?: DecorApi }).api
  if (api?.openImage) return api.openImage()
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.onchange = (): void => {
      const file = input.files?.[0]
      if (!file) return resolve(null)
      fileToDataUrl(file).then(resolve)
    }
    input.click()
  })
}

export function fileToDataUrl(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = (): void => resolve(reader.result as string)
    reader.onerror = (): void => resolve(null)
    reader.readAsDataURL(file)
  })
}

/** Natural pixel size of an image — this is what the canvas snaps to on chart load. */
export function imageSize(dataUrl: string): Promise<{ w: number; h: number } | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = (): void => resolve({ w: img.naturalWidth, h: img.naturalHeight })
    img.onerror = (): void => resolve(null) // 壊れた/非対応画像は reject せず null（呼び側で握りつぶし防止）
    img.src = dataUrl
  })
}
