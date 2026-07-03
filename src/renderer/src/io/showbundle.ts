// 画像照明モードの公演を「1ファイル(.ledshow)」に包む/開く。
// 中身は ZIP: show.json + media/（写真・動画）。フォルダ保存(show.json+media/)と同じ内容を
// 1ファイルにまとめただけ＝アイコン付きでダブルクリックでき、写真も一緒に持ち運べる。
import JSZip from 'jszip'

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime'
}
const mimeOf = (name: string): string => {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase()
  return MIME[ext] ?? (['mp4', 'webm', 'mov'].includes(ext) ? 'video/mp4' : 'image/png')
}

/** {json, media(dataURL)} → .ledshow の中身(Uint8Array)。 */
export async function zipShow(
  json: string,
  media: { file: string; dataUrl: string }[]
): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file('show.json', json)
  for (const m of media) {
    const comma = m.dataUrl.indexOf(',')
    const b64 = comma >= 0 ? m.dataUrl.slice(comma + 1) : m.dataUrl
    zip.file(m.file, b64, { base64: true })
  }
  return await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}

/** .ledshow の中身(Uint8Array) → {json, media(dataURL)}（restoreShow にそのまま渡せる形）。 */
export async function unzipShow(
  bytes: Uint8Array
): Promise<{ json: string; media: Record<string, string> }> {
  const zip = await JSZip.loadAsync(bytes)
  const jf = zip.file('show.json')
  if (!jf) throw new Error('show.json が見つかりません')
  const json = await jf.async('string')
  const media: Record<string, string> = {}
  const entries = Object.values(zip.files).filter((f) => !f.dir && f.name !== 'show.json')
  for (const f of entries) {
    const b64 = await f.async('base64')
    media[f.name] = `data:${mimeOf(f.name)};base64,${b64}`
  }
  return { json, media }
}
