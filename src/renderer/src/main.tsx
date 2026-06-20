import '@fontsource/bebas-neue/400.css'
import '@fontsource/inter/200.css'
import '@fontsource/inter/300.css'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/cormorant-garamond/300.css'
import '@fontsource/cormorant-garamond/400.css'
import '@fontsource/noto-sans-jp/japanese-400.css'
import '@fontsource/noto-sans-jp/japanese-500.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/neonderthaw/400.css'
import '@fontsource/pacifico/400.css'
import '@fontsource/mr-dafoe/400.css'
import '@fontsource/sacramento/400.css'
import '@fontsource/monoton/400.css'
import '@fontsource/tilt-neon/400.css'
import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { NEON_FONTS } from './render/neon'
import './io/debug-bridge' // 開発用「のぞき窓」：window.__debug* を生やす（main のローカルHTTPが読む）

// canvas measureText alone never triggers a webfont download — kick the neon faces
// into loading up-front so the first sign paints with real glyphs
for (const f of NEON_FONTS) void document.fonts?.load(`${f.weight} 24px "${f.family}"`)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
