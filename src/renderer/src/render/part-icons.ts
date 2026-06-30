// 灯体・モチーフの「クールな線アイコン」（実物の形）。両モード共通の1か所。
//   線（構造）= currentColor／発光部 = var(--icon-accent)。
//   使う側で色を指定：簡単/照明(LIGHT SKETCH)= --icon-accent: amber、電飾(チャート編集)= cyan。
//   <svg viewBox="0 0 24 24"> に dangerouslySetInnerHTML で流し込む。
//   キーは灯体の type（ShapeType / Beam.motif と一致）。

const hexPath = (cx: number, cy: number, r: number): string => {
  let p = ''
  for (let i = 0; i < 6; i++) {
    const a = ((-90 + 60 * i) * Math.PI) / 180
    p += (i ? 'L' : 'M') + (cx + r * Math.cos(a)).toFixed(2) + ' ' + (cy + r * Math.sin(a)).toFixed(2)
  }
  return p + 'Z'
}

const pixelPattIcon = ((): string => {
  let g = '<g fill="none" stroke="currentColor" stroke-width="1.1"><path d="' + hexPath(12, 12, 2.6) + '"/>'
  for (let i = 0; i < 6; i++) {
    const a = (i * 60 * Math.PI) / 180
    g += '<path d="' + hexPath(12 + 4.7 * Math.cos(a), 12 + 4.7 * Math.sin(a), 2.4) + '"/>'
  }
  return g + '</g><circle cx="12" cy="12" r="1.1" fill="var(--icon-accent)"/>'
})()

export const PART_ICON: Record<string, string> = {
  // フロント：前から当たる丸い光のプール（同心円）＋8の字サーチの軌跡
  front: `<circle cx='12' cy='12' r='8.5' fill='none' stroke='currentColor' stroke-width='1.3'/><circle cx='12' cy='12' r='4.2' fill='var(--icon-accent)'/><path d='M5.5 9 Q12 13 18.5 9 Q12 5 5.5 9 Z' fill='none' stroke='currentColor' stroke-width='0.8' opacity='0.6'/>`,
  // 街灯：灯具から下への光のコーン＋地面の光
  streetlamp: `<path d='M9 21V7' stroke='currentColor' stroke-width='1.5' stroke-linecap='round'/><path d='M9 7q0-3 4-3 4 0 4 3' fill='none' stroke='currentColor' stroke-width='1.5'/><path d='M15 7h4l-1.3 3.6h-1.4z' fill='var(--icon-accent)' stroke='currentColor' stroke-width='0.9'/><path d='M6 21h6' stroke='currentColor' stroke-width='1.5' stroke-linecap='round'/>`,
  // 街灯(一灯)：中央の柱に一つのランタン
  streetlamp1: `<circle cx='12' cy='4' r='0.7' fill='var(--icon-accent)'/><path d='M12 4.7V5.6' stroke='currentColor' stroke-width='1'/><path d='M9.5 8 L14.5 8 L13.5 5.6 L10.5 5.6 Z' fill='none' stroke='currentColor' stroke-width='1.1'/><rect x='9.8' y='8' width='4.4' height='4' rx='0.3' fill='var(--icon-accent)' stroke='currentColor' stroke-width='0.9'/><path d='M12 12V18.5' stroke='currentColor' stroke-width='1.5' stroke-linecap='round'/><path d='M9.8 18.5h4.4' stroke='currentColor' stroke-width='1'/><path d='M8.5 21h7' stroke='currentColor' stroke-width='1.5' stroke-linecap='round'/>`,
  // シャンデリア：暖色のロウソク球
  chandelier: `<path d='M12 3v3M6 8h12M8 8c0 3.5 1.5 4.5 1.5 4.5M16 8c0 3.5-1.5 4.5-1.5 4.5M12 6v6.5' fill='none' stroke='currentColor' stroke-width='1.4'/><g fill='var(--icon-accent)'><circle cx='8' cy='13.5' r='1.5'/><circle cx='16' cy='13.5' r='1.5'/><circle cx='12' cy='14.6' r='1.6'/></g>`,
  // マーキー：太字の「A」（電球文字看板）
  marquee: `<g stroke='currentColor' stroke-width='2.6' stroke-linejoin='round' stroke-linecap='round' fill='none'><path d='M5 19 L12 5 L19 19'/><path d='M7.8 14 H16.2'/></g>`,
  // 電球（丸球）
  bulb: `<circle cx='12' cy='10.5' r='6' fill='none' stroke='currentColor' stroke-width='1.5'/><circle cx='12' cy='10.5' r='2.4' fill='var(--icon-accent)'/><path d='M9.5 17.5h5M10.5 20h3' stroke='currentColor' stroke-width='1.5' stroke-linecap='round'/>`,
  // PAR：丸い缶の正面（フレネルの輪＋点灯中心＋ヨーク）
  parlight: `<path d='M3.5 9v6M20.5 9v6' stroke='currentColor' stroke-width='1.5' stroke-linecap='round'/><circle cx='12' cy='12' r='7.5' fill='none' stroke='currentColor' stroke-width='1.5'/><circle cx='12' cy='12' r='4.2' fill='none' stroke='currentColor' stroke-width='1.1'/><circle cx='12' cy='12' r='1.9' fill='var(--icon-accent)'/>`,
  // 8灯ミニブルダー（2×4）
  blinder: `<rect x='4' y='7' width='16' height='10' rx='1.5' fill='none' stroke='currentColor' stroke-width='1.5'/><g fill='var(--icon-accent)'><circle cx='7' cy='10.2' r='1.3'/><circle cx='10.3' cy='10.2' r='1.3'/><circle cx='13.7' cy='10.2' r='1.3'/><circle cx='17' cy='10.2' r='1.3'/><circle cx='7' cy='13.8' r='1.3'/><circle cx='10.3' cy='13.8' r='1.3'/><circle cx='13.7' cy='13.8' r='1.3'/><circle cx='17' cy='13.8' r='1.3'/></g>`,
  // PAT：丸い大型灯体（円盤＋中心ハブから3又スポーク＋穴あきメッシュ）
  patt: `<circle cx='12' cy='12' r='8.5' fill='none' stroke='currentColor' stroke-width='1.5'/><g stroke='currentColor' stroke-width='1.3' stroke-linecap='round'><path d='M12 14v6'/><path d='M10.3 11 L5.1 8'/><path d='M13.7 11 L18.9 8'/></g><circle cx='12' cy='12' r='2.1' fill='var(--icon-accent)'/><g fill='currentColor' opacity='0.45'><circle cx='12' cy='6.6' r='0.6'/><circle cx='7.4' cy='15' r='0.6'/><circle cx='16.6' cy='15' r='0.6'/><circle cx='6.6' cy='11' r='0.6'/><circle cx='17.4' cy='11' r='0.6'/></g>`,
  // Pixel PAT：六角7セルのハニカム
  pixelpatt: pixelPattIcon,
  // 星：満点の星空（スタークロス）
  stars: `<g fill='currentColor'><circle cx='6' cy='6.5' r='0.8'/><circle cx='13' cy='5' r='1'/><circle cx='19.5' cy='8' r='0.7'/><circle cx='9' cy='11.5' r='0.7'/><circle cx='16.5' cy='12.5' r='0.9'/><circle cx='4.5' cy='15' r='0.8'/><circle cx='11' cy='17.5' r='0.7'/><circle cx='20' cy='17' r='0.8'/><circle cx='7.5' cy='20' r='0.7'/><circle cx='15' cy='20.5' r='0.9'/></g><g fill='var(--icon-accent)'><path d='M11.5 6.9 L12.1 8.4 L13.6 9 L12.1 9.6 L11.5 11.1 L10.9 9.6 L9.4 9 L10.9 8.4 Z'/><path d='M17 14.7 L17.5 15.9 L18.7 16.5 L17.5 17.1 L17 18.3 L16.5 17.1 L15.3 16.5 L16.5 15.9 Z'/></g>`,
  // フェストゥーン（電球を連ねて垂らすストリング）＝本番では「Banner」表記
  festoon: `<path d='M3 7 Q12 16 21 7' fill='none' stroke='currentColor' stroke-width='1.4' stroke-linecap='round'/><g stroke='currentColor' stroke-width='0.8'><path d='M6.6 9.9v1.5M10.2 11.3v1.5M12 11.5v1.5M13.8 11.3v1.5M17.4 9.9v1.5'/></g><g fill='var(--icon-accent)'><circle cx='6.6' cy='12.7' r='1.4'/><circle cx='10.2' cy='14.1' r='1.4'/><circle cx='12' cy='14.3' r='1.4'/><circle cx='13.8' cy='14.1' r='1.4'/><circle cx='17.4' cy='12.7' r='1.4'/></g>`,
  // ネオン管（光る曲線チューブ）
  neon: `<path d='M5 16 C 7 7, 10 9, 11 12 S 14 17, 16 12 S 18 7, 20 11' fill='none' stroke='var(--icon-accent)' stroke-width='2.1' stroke-linecap='round'/><circle cx='5' cy='16' r='1' fill='currentColor'/><circle cx='20' cy='11' r='1' fill='currentColor'/>`,
  // スポット（灯体＋上向きの光のコーン）
  uplight: `<path d='M10.5 16 L6 5 H18 L13.5 16 Z' fill='var(--icon-accent)' opacity='0.85'/><rect x='9' y='16' width='6' height='3.6' rx='1' fill='none' stroke='currentColor' stroke-width='1.4'/><path d='M7.5 19.6h9' stroke='currentColor' stroke-width='1.3' stroke-linecap='round'/>`,
  // ムービング（土台＋ヨーク＋ヘッド＋ビーム）
  movinghead: `<path d='M8.3 20 H15.7 L14.6 17.4 H9.4 Z' fill='none' stroke='currentColor' stroke-width='1.3' stroke-linejoin='round'/><path d='M10 17.4 V14 M14 17.4 V14' stroke='currentColor' stroke-width='1.3'/><rect x='9.8' y='9.6' width='4.4' height='4.6' rx='1' fill='none' stroke='currentColor' stroke-width='1.3'/><path d='M11 9.6 L9.4 4.5 H14.6 L13 9.6 Z' fill='var(--icon-accent)' opacity='0.85'/>`,
  // 室内ランプ（シェード＋下へこぼれる光）
  roomlamp: `<path d='M8 4 H16 L18 10 H6 Z' fill='none' stroke='currentColor' stroke-width='1.4' stroke-linejoin='round'/><path d='M7 10 L9.4 17 H14.6 L17 10 Z' fill='var(--icon-accent)' opacity='0.65'/><path d='M12 17 V20 M9 20 H15' stroke='currentColor' stroke-width='1.4' stroke-linecap='round'/>`,
  // 写真（額縁＋下から照らされた絵）
  image: `<rect x='3' y='5' width='18' height='14' rx='2' fill='none' stroke='currentColor' stroke-width='1.5'/><circle cx='8' cy='10' r='1.6' fill='var(--icon-accent)'/><path d='M4 17l5-5 3 3 3-3 5 5' fill='none' stroke='currentColor' stroke-width='1.3' stroke-linejoin='round'/>`
}
